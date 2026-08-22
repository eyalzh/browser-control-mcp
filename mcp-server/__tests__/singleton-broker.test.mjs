import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import broker from "../dist/singleton-broker.js";

test("broker rejects requests with the wrong token", async () => {
  await withBroker(async ({ server, socketPath }) => {
    await assert.rejects(
      broker.forwardToBroker({
        socketPath,
        token: "wrong-token",
        message: { cmd: "get-tab-list" },
        timeoutMs: 1000,
      }),
      /unauthorized/i
    );
  });
});

test("broker rejects commands outside the browser command allowlist", async () => {
  await withBroker(async ({ server, socketPath, token }) => {
    await assert.rejects(
      broker.forwardToBroker({
        socketPath,
        token,
        message: { cmd: "constructor" },
        timeoutMs: 1000,
      }),
      /unsupported broker command/i
    );
  });
});

test("broker rejects malformed browser commands", async () => {
  await withBroker(async ({ socketPath, token }) => {
    await assert.rejects(
      broker.forwardToBroker({
        socketPath,
        token,
        message: { cmd: "open-tab", url: 42 },
        timeoutMs: 1000,
      }),
      /invalid broker message/i
    );
  });
});

test("a second broker cannot replace an active broker socket", async () => {
  await withCacheDirectory(async () => {
    const identity = broker.createBrokerIdentity({ port: 18091, extensionSecret: "secret" });
    const socketPath = broker.getBrokerSocketPath(identity);
    const first = createServer(socketPath, "first-token");
    const second = createServer(socketPath, "second-token");

    await first.start();
    try {
      await assert.rejects(second.start(), { code: "EADDRINUSE" });
    } finally {
      await second.close();
      await first.close();
    }
  });
});

test("broker metadata is private and rejects another identity", async () => {
  await withCacheDirectory(async () => {
    const identity = broker.createBrokerIdentity({ port: 18092, extensionSecret: "secret-a" });
    const otherIdentity = broker.createBrokerIdentity({ port: 18092, extensionSecret: "secret-b" });
    const info = {
      pid: process.pid,
      identity,
      socketPath: broker.getBrokerSocketPath(identity),
      token: broker.createBrokerToken(),
      protocolVersion: broker.BROKER_PROTOCOL_VERSION,
    };

    fs.mkdirSync(broker.getBrokerDirectory(), { recursive: true });
    fs.writeFileSync(broker.getBrokerInfoPath(identity), "{}", { mode: 0o644 });
    broker.writeBrokerInfo(info);

    if (process.platform !== "win32") {
      assert.equal(fs.statSync(broker.getBrokerDirectory()).mode & 0o777, 0o700);
      assert.equal(fs.statSync(broker.getBrokerInfoPath(identity)).mode & 0o777, 0o600);
    }
    fs.writeFileSync(broker.getBrokerInfoPath(otherIdentity), JSON.stringify(info));
    assert.equal(broker.readBrokerInfo(otherIdentity), null);
  });
});

async function withBroker(run) {
  await withCacheDirectory(async () => {
    const identity = broker.createBrokerIdentity({ port: 18090, extensionSecret: "secret" });
    const socketPath = broker.getBrokerSocketPath(identity);
    const token = broker.createBrokerToken();
    const server = createServer(socketPath, token);
    await server.start();
    try {
      await run({ server, socketPath, token });
    } finally {
      await server.close();
    }
  });
}

function createServer(socketPath, token) {
  return broker.createBrokerServer({
    socketPath,
    token,
    handleMessage: async (message) => ({
      resource: "tabs",
      correlationId: "test",
      tabs: [{ title: message.cmd }],
    }),
  });
}

async function withCacheDirectory(run) {
  const temporaryDirectory = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const cacheDirectory = fs.mkdtempSync(path.join(temporaryDirectory, "bcm-"));
  const previousCacheDirectory = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cacheDirectory;
  try {
    await run();
  } finally {
    if (previousCacheDirectory === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = previousCacheDirectory;
    }
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
}
