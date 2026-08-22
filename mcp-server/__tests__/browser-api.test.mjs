import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import WebSocket from "ws";

import browserApi from "../dist/browser-api.js";
import broker from "../dist/singleton-broker.js";

const { BrowserAPI } = browserApi;

test("a second BrowserAPI forwards requests through the first instance", async () => {
  await withConnectedApis(async ({ follower }) => {
    assert.deepEqual(await follower.getTabList(), [
      { id: 42, url: "https://example.com", title: "Example" },
    ]);
  });
});

test("a follower forwards every browser command", async () => {
  await withConnectedApis(async ({ follower }) => {
    assert.equal(await follower.openTab("https://example.com/new"), 7);
    await follower.closeTabs([42]);
    assert.deepEqual(await follower.getBrowserRecentHistory("search"), [
      { url: "https://example.com/history", title: "History" },
    ]);
    const tabContent = await follower.getTabContent(42, 5);
    assert.deepEqual({ ...tabContent, correlationId: "ignored" }, {
      resource: "tab-content",
      correlationId: "ignored",
      tabId: 42,
      fullText: "page text",
      isTruncated: false,
      totalLength: 9,
      links: [],
    });
    assert.deepEqual(await follower.reorderTabs([42, 7]), [7, 42]);
    assert.equal(await follower.findHighlight(42, "needle"), 2);
    assert.equal(await follower.groupTabs([42], false, "blue", "Group"), 9);
    const screenshot = await follower.captureScreenshot(42, "png", 100, 1);
    assert.deepEqual({ ...screenshot, correlationId: "ignored" }, {
      resource: "screenshot",
      correlationId: "ignored",
      tabId: 42,
      imageData: "aW1hZ2U=",
      mimeType: "image/png",
    });
  });
});

test("BrowserAPI waits for a broker that is still starting", async () => {
  const port = await getFreePort();
  const secret = `secret-${port}`;
  const cacheDirectory = createCacheDirectory();
  const previousEnvironment = setEnvironment({
    EXTENSION_PORT: String(port),
    EXTENSION_SECRET: secret,
    XDG_CACHE_HOME: cacheDirectory,
  });
  const portOwner = net.createServer();
  await new Promise((resolve, reject) => {
    portOwner.once("error", reject);
    portOwner.listen(port, "localhost", resolve);
  });
  const identity = broker.createBrokerIdentity({ port, extensionSecret: secret });
  const token = broker.createBrokerToken();
  const socketPath = broker.getBrokerSocketPath(identity);
  const brokerServer = broker.createBrokerServer({
    socketPath,
    token,
    handleMessage: async () => ({
      resource: "tabs",
      correlationId: "broker",
      tabs: [{ id: 42, url: "https://example.com", title: "Example" }],
    }),
  });
  const api = new BrowserAPI();

  try {
    const initializing = api.init();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await brokerServer.start();
    broker.writeBrokerInfo({
      pid: process.pid + 1,
      identity,
      socketPath,
      token,
      protocolVersion: broker.BROKER_PROTOCOL_VERSION,
    });
    await initializing;

    assert.deepEqual(await api.getTabList(), [
      { id: 42, url: "https://example.com", title: "Example" },
    ]);
  } finally {
    await api.close();
    await brokerServer.close();
    await new Promise((resolve) => portOwner.close(resolve));
    restoreEnvironment(previousEnvironment);
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

test("a follower takes ownership after the leader closes", async () => {
  const port = await getFreePort();
  const secret = `secret-${port}`;
  const cacheDirectory = createCacheDirectory();
  const previousEnvironment = setEnvironment({
    EXTENSION_PORT: String(port),
    EXTENSION_SECRET: secret,
    XDG_CACHE_HOME: cacheDirectory,
  });
  const leader = new BrowserAPI();
  const follower = new BrowserAPI();
  let extension;

  try {
    await leader.init();
    extension = await connectExtension(port, secret);
    await follower.init();
    await follower.getTabList();

    await closeWebSocket(extension);
    extension = undefined;
    await leader.close();

    const [reconnectedExtension, tabs] = await Promise.all([
      connectExtensionWithRetry(port, secret, 1000),
      follower.getTabList(),
    ]);
    extension = reconnectedExtension;
    assert.deepEqual(tabs, [
      { id: 42, url: "https://example.com", title: "Example" },
    ]);
  } finally {
    await closeWebSocket(extension);
    await follower.close();
    await leader.close();
    restoreEnvironment(previousEnvironment);
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

test("closing a leader disconnects the extension and removes broker metadata", async () => {
  const port = await getFreePort();
  const secret = `secret-${port}`;
  const cacheDirectory = createCacheDirectory();
  const previousEnvironment = setEnvironment({
    EXTENSION_PORT: String(port),
    EXTENSION_SECRET: secret,
    XDG_CACHE_HOME: cacheDirectory,
  });
  const identity = broker.createBrokerIdentity({ port, extensionSecret: secret });
  const api = new BrowserAPI();
  let extension;
  let closing;

  try {
    await api.init();
    extension = await connectExtension(port, secret);
    closing = api.close();
    await Promise.race([
      closing,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("BrowserAPI close timed out")),
        250
      )),
    ]);
    if (extension.readyState !== WebSocket.CLOSED) {
      await new Promise((resolve) => extension.once("close", resolve));
    }

    assert.equal(extension.readyState, WebSocket.CLOSED);
    assert.equal(broker.readBrokerInfo(identity), null);
  } finally {
    if (extension?.readyState !== WebSocket.CLOSED) {
      extension?.terminate();
    }
    await closing;
    await api.close();
    restoreEnvironment(previousEnvironment);
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

async function withConnectedApis(run) {
  const port = await getFreePort();
  const secret = `secret-${port}`;
  const cacheDirectory = createCacheDirectory();
  const previousEnvironment = setEnvironment({
    EXTENSION_PORT: String(port),
    EXTENSION_SECRET: secret,
    XDG_CACHE_HOME: cacheDirectory,
  });
  const leader = new BrowserAPI();
  const follower = new BrowserAPI();
  let extension;

  try {
    await leader.init();
    extension = await connectExtension(port, secret);
    await follower.init();
    await run({ follower, leader });
  } finally {
    await closeWebSocket(extension);
    await follower.close();
    await leader.close();
    restoreEnvironment(previousEnvironment);
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

function createCacheDirectory() {
  const temporaryDirectory = process.platform === "win32" ? os.tmpdir() : "/tmp";
  return fs.mkdtempSync(path.join(temporaryDirectory, "bcm-"));
}

async function connectExtension(port, secret) {
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  client.on("message", (rawMessage) => {
    const request = JSON.parse(rawMessage.toString());
    assert.equal(request.signature, sign(request.payload, secret));
    const payload = responseFor(request.payload);
    client.send(JSON.stringify({ payload, signature: sign(payload, secret) }));
  });
  await new Promise((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  return client;
}

async function connectExtensionWithRetry(port, secret, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      return await connectExtension(port, secret);
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } while (true);
}

function responseFor(request) {
  switch (request.cmd) {
    case "open-tab":
      assert.equal(request.url, "https://example.com/new");
      return { resource: "opened-tab-id", correlationId: request.correlationId, tabId: 7 };
    case "close-tabs":
      assert.deepEqual(request.tabIds, [42]);
      return { resource: "tabs-closed", correlationId: request.correlationId };
    case "get-tab-list":
      return {
        resource: "tabs",
        correlationId: request.correlationId,
        tabs: [{ id: 42, url: "https://example.com", title: "Example" }],
      };
    case "get-browser-recent-history":
      assert.equal(request.searchQuery, "search");
      return {
        resource: "history",
        correlationId: request.correlationId,
        historyItems: [{ url: "https://example.com/history", title: "History" }],
      };
    case "get-tab-content":
      assert.equal(request.tabId, 42);
      assert.equal(request.offset, 5);
      return {
        resource: "tab-content",
        correlationId: request.correlationId,
        tabId: 42,
        fullText: "page text",
        isTruncated: false,
        totalLength: 9,
        links: [],
      };
    case "reorder-tabs":
      assert.deepEqual(request.tabOrder, [42, 7]);
      return {
        resource: "tabs-reordered",
        correlationId: request.correlationId,
        tabOrder: [7, 42],
      };
    case "find-highlight":
      assert.equal(request.tabId, 42);
      assert.equal(request.queryPhrase, "needle");
      return {
        resource: "find-highlight-result",
        correlationId: request.correlationId,
        noOfResults: 2,
      };
    case "group-tabs":
      assert.deepEqual(request.tabIds, [42]);
      assert.equal(request.groupTitle, "Group");
      return { resource: "new-tab-group", correlationId: request.correlationId, groupId: 9 };
    case "capture-screenshot":
      assert.equal(request.tabId, 42);
      assert.equal(request.format, "png");
      assert.equal(request.quality, 100);
      assert.equal(request.scale, 1);
      return {
        resource: "screenshot",
        correlationId: request.correlationId,
        tabId: 42,
        imageData: "aW1hZ2U=",
        mimeType: "image/png",
      };
    default:
      throw new Error(`Unexpected browser command: ${request.cmd}`);
  }
}

function sign(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
}

async function closeWebSocket(client) {
  if (!client || client.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise((resolve) => {
    client.once("close", resolve);
    client.close();
  });
}

function setEnvironment(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return previous;
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
