/** @jest-environment node */
import { createHmac, webcrypto } from "node:crypto";
import { WebsocketClient } from "../client";

const SECRET = "synthetic-regression-test-key";
const PROTOCOL = "browser-control-mcp:v2";
const SERVER_NONCE = "a".repeat(64);
const sign = (parts: unknown[]) => createHmac("sha256", SECRET).update(JSON.stringify(parts)).digest("hex");

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeSocket;
  readyState = 1;
  frames: any[] = [];
  listeners: Record<string, (event?: any) => void> = {};
  constructor(public url: string) { FakeSocket.last = this; }
  addEventListener(name: string, listener: (event?: any) => void) { this.listeners[name] = listener; }
  send(data: string) { this.frames.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.listeners.close?.(); }
}

let client: WebsocketClient;
let received: jest.Mock;
beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, "WebSocket", { value: FakeSocket, configurable: true });
  Object.defineProperty(globalThis, "window", { value: {
    setInterval: jest.fn(() => 1), clearInterval: jest.fn(),
  }, configurable: true });
  client = new WebsocketClient(8089, SECRET);
  received = jest.fn(); client.addMessageListener(received); client.connect();
});
afterEach(() => client.disconnect());

async function deliver(frame: unknown) {
  FakeSocket.last.listeners.message({ data: JSON.stringify(frame) });
  await (client as any).connection.incoming;
}
async function handshake() {
  await deliver({ type: "challenge", version: 2, nonce: SERVER_NONCE });
  const auth = FakeSocket.last.frames.shift();
  expect(auth.signature).toBe(sign([PROTOCOL, "authenticate", "extension", SERVER_NONCE, auth.clientNonce]));
  const ready = { type: "ready", nonce: SERVER_NONCE, clientNonce: auth.clientNonce,
    signature: sign([PROTOCOL, "authenticate", "server", SERVER_NONCE, auth.clientNonce]) };
  await deliver(ready);
  return { ready, nonce: `${SERVER_NONCE}:${auth.clientNonce}` };
}
function command(nonce: string, sequence = 1) {
  const payload = { cmd: "get-tab-list", correlationId: "synthetic-request" };
  return { type: "message", sequence, payload,
    signature: sign([PROTOCOL, "message", "server", nonce, sequence, payload]) };
}

test("requires a mutually authenticated session before executing commands", async () => {
  await deliver(command(SERVER_NONCE));
  expect(received).not.toHaveBeenCalled();
  expect(FakeSocket.last.readyState).toBe(FakeSocket.CLOSED);
});

test("authenticates commands and signs error responses", async () => {
  const { nonce } = await handshake();
  await deliver(command(nonce));
  expect(received).toHaveBeenCalledTimes(1);
  await client.sendErrorToServer("synthetic-request", "synthetic error");
  const error = FakeSocket.last.frames.shift();
  expect(error.payload.resource).toBe("error");
  expect(error.signature).toBe(sign([PROTOCOL, "message", "extension", nonce, 1, error.payload]));
});

test("rejects repeated commands", async () => {
  const { nonce } = await handshake(); const frame = command(nonce);
  await deliver(frame); await deliver(frame);
  expect(received).toHaveBeenCalledTimes(1);
  expect(FakeSocket.last.readyState).toBe(FakeSocket.CLOSED);
});

test("rejects a tampered command", async () => {
  const { nonce } = await handshake(); const frame = command(nonce);
  frame.payload.cmd = "close-tabs";
  await deliver(frame);
  expect(received).not.toHaveBeenCalled();
  expect(FakeSocket.last.readyState).toBe(FakeSocket.CLOSED);
});

test("fresh client nonce prevents replay of an old server handshake", async () => {
  const old = await handshake();
  client.disconnect(); client.connect();
  await deliver({ type: "challenge", version: 2, nonce: SERVER_NONCE });
  const fresh = FakeSocket.last.frames.shift();
  expect(fresh.clientNonce).not.toBe(old.ready.clientNonce);
  await deliver(old.ready);
  expect(FakeSocket.last.readyState).toBe(FakeSocket.CLOSED);
  expect(received).not.toHaveBeenCalled();
});

test("serializes cryptographic verification and outbound responses", async () => {
  const { nonce } = await handshake();
  FakeSocket.last.listeners.message({ data: JSON.stringify(command(nonce, 1)) });
  await deliver(command(nonce, 2));
  expect(received).toHaveBeenCalledTimes(2);
  await Promise.all([
    client.sendErrorToServer("one", "synthetic"),
    client.sendErrorToServer("two", "synthetic"),
  ]);
  expect(FakeSocket.last.frames.map(frame => frame.sequence)).toEqual([1, 2]);
});
