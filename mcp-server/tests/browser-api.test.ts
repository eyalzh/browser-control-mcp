import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { BrowserAPI } from "../browser-api";

const SECRET = "synthetic-regression-test-key";
const PROTOCOL = "browser-control-mcp:v2";
const sign = (parts: unknown[]) => createHmac("sha256", SECRET).update(JSON.stringify(parts)).digest("hex");
let api: BrowserAPI;
let sockets: WebSocket[];
let previous: Record<string, string | undefined>;

beforeEach(async () => {
  previous = Object.fromEntries(["EXTENSION_SECRET", "EXTENSION_PORT", "CONTAINERIZED"].map(key => [key, process.env[key]]));
  process.env.EXTENSION_SECRET = SECRET;
  process.env.EXTENSION_PORT = "0";
  delete process.env.CONTAINERIZED;
  api = new BrowserAPI(); sockets = [];
  await api.init();
  for (let i = 0; !api.getSelectedPort() && i < 100; i++) await delay(5);
  assert.ok(api.getSelectedPort());
});
afterEach(() => {
  for (const socket of sockets) socket.terminate();
  api.close();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function connect(origin?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${api.getSelectedPort()}`, origin ? { origin } : {});
  sockets.push(socket);
  const frames: any[] = [];
  socket.on("message", data => frames.push(JSON.parse(data.toString())));
  socket.on("error", () => {});
  await once(socket, "open");
  return { socket, frames };
}
async function next(frames: any[]) {
  for (let i = 0; frames.length === 0 && i < 100; i++) await delay(5);
  assert.ok(frames.length, "expected a bridge frame");
  return frames.shift();
}
async function authenticate() {
  const { socket, frames } = await connect();
  const challenge = await next(frames);
  const clientNonce = randomBytes(32).toString("hex");
  const proof = { type: "authenticate", nonce: challenge.nonce, clientNonce,
    signature: sign([PROTOCOL, "authenticate", "extension", challenge.nonce, clientNonce]) };
  socket.send(JSON.stringify(proof));
  const ready = await next(frames);
  assert.equal(ready.type, "ready");
  assert.equal(ready.signature, sign([PROTOCOL, "authenticate", "server", challenge.nonce, clientNonce]));
  const nonce = `${challenge.nonce}:${clientNonce}`;
  let sequence = 0;
  return { socket, frames, proof, nonce, reply(payload: unknown) {
    const current = ++sequence;
    const frame = { type: "message", sequence: current, payload,
      signature: sign([PROTOCOL, "message", "extension", nonce, current, payload]) };
    socket.send(JSON.stringify(frame));
    return frame;
  }};
}

test("commands require authentication and have session-bound signatures", { timeout: 3000 }, async () => {
  const connection = await connect(); await next(connection.frames);
  await assert.rejects(api.getTabList(), /not authenticated/);
  const closed = once(connection.socket, "close"); connection.socket.close(); await closed;
  const peer = await authenticate();
  const response = api.getTabList(); const request = await next(peer.frames);
  assert.equal(request.signature, sign([PROTOCOL, "message", "server", peer.nonce, 1, request.payload]));
  peer.reply({ resource: "tabs", correlationId: request.payload.correlationId, tabs: [] });
  assert.deepEqual(await response, []);
});

test("new connections cannot replace an authenticated extension", { timeout: 3000 }, async () => {
  const peer = await authenticate();
  const extra = await connect();
  if (extra.socket.readyState !== WebSocket.CLOSED) await once(extra.socket, "close");
  assert.equal(extra.frames.length, 0);
  const result = api.getTabList(); const request = await next(peer.frames);
  peer.reply({ resource: "tabs", correlationId: request.payload.correlationId, tabs: [] });
  assert.deepEqual(await result, []);
});

test("web page origins are refused", { timeout: 3000 }, async () => {
  const extra = await connect("https://example.invalid");
  if (extra.socket.readyState !== WebSocket.CLOSED) await once(extra.socket, "close");
  assert.equal(extra.frames.length, 0);
});

for (const input of ["{", "null", JSON.stringify({ correlationId: "unknown", errorMessage: "synthetic" })]) {
  test("invalid unauthenticated input closes only its connection", { timeout: 3000 }, async () => {
    const peer = await connect(); await next(peer.frames);
    const closed = once(peer.socket, "close"); peer.socket.send(input); await closed;
    await authenticate();
  });
}

test("unsigned errors cannot resolve a pending request", { timeout: 3000 }, async () => {
  const peer = await authenticate();
  const pending = assert.rejects(api.getTabList(), /disconnected/);
  const request = await next(peer.frames);
  peer.socket.send(JSON.stringify({ correlationId: request.payload.correlationId, errorMessage: "synthetic unsigned error" }));
  await pending;
});

test("signed errors reject the matching request", { timeout: 3000 }, async () => {
  const peer = await authenticate();
  const pending = assert.rejects(api.getTabList(), /synthetic operation error/);
  const request = await next(peer.frames);
  peer.reply({ resource: "error", correlationId: request.payload.correlationId, errorMessage: "synthetic operation error" });
  await pending;
});

test("late responses are ignored and subsequent requests still work", { timeout: 4000 }, async () => {
  const peer = await authenticate();
  const pending = assert.rejects(api.getTabList(), /Timed out/);
  const first = await next(peer.frames); await pending;
  peer.reply({ resource: "tabs", correlationId: first.payload.correlationId, tabs: [] });
  const second = api.getTabList(); const request = await next(peer.frames);
  peer.reply({ resource: "tabs", correlationId: request.payload.correlationId, tabs: [] });
  assert.deepEqual(await second, []);
});

test("duplicate signed responses terminate the session", { timeout: 3000 }, async () => {
  const peer = await authenticate();
  const pending = api.getTabList(); const request = await next(peer.frames);
  const reply = peer.reply({ resource: "tabs", correlationId: request.payload.correlationId, tabs: [] });
  await pending;
  const closed = once(peer.socket, "close"); peer.socket.send(JSON.stringify(reply)); await closed;
});

test("authentication proof cannot be replayed on a new connection", { timeout: 3000 }, async () => {
  const peer = await authenticate();
  const closed = once(peer.socket, "close"); peer.socket.close(); await closed;
  const other = await connect(); const challenge = await next(other.frames);
  assert.notEqual(challenge.nonce, peer.proof.nonce);
  const rejected = once(other.socket, "close"); other.socket.send(JSON.stringify(peer.proof)); await rejected;
  await assert.rejects(api.getTabList(), /not authenticated/);
});
