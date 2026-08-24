import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { ExtensionMessage, ServerMessage } from "@browser-control-mcp/common";

export const BROKER_PROTOCOL_VERSION = 1;

export interface BrokerIdentity {
  id: string;
  port: number;
  secretHash: string;
}

export interface BrokerInfo {
  pid: number;
  identity: BrokerIdentity;
  socketPath: string;
  token: string;
  protocolVersion: number;
}

interface BrokerRequest {
  id: string;
  protocolVersion: number;
  token: string;
  operation: "ping" | "request";
  message?: unknown;
}

interface BrokerResponse {
  id: string;
  ok: boolean;
  result?: ExtensionMessage | "pong";
  error?: string;
}

const BROKER_COMMANDS = new Set([
  "open-tab",
  "close-tabs",
  "get-tab-list",
  "get-browser-recent-history",
  "get-tab-content",
  "reorder-tabs",
  "find-highlight",
  "group-tabs",
  "capture-screenshot",
]);

export function createBrokerIdentity(options: {
  port: number;
  extensionSecret: string;
}): BrokerIdentity {
  const secretHash = crypto
    .createHash("sha256")
    .update(options.extensionSecret)
    .digest("hex")
    .slice(0, 16);
  return {
    id: `${options.port}-${secretHash}`,
    port: options.port,
    secretHash,
  };
}

export function getBrokerDirectory(): string {
  const cacheDirectory =
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(cacheDirectory, "browser-control-mcp");
}

export function getBrokerInfoPath(identity: BrokerIdentity): string {
  return path.join(getBrokerDirectory(), `leader-${identity.id}.json`);
}

export function getBrokerSocketPath(identity: BrokerIdentity): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\browser-control-mcp-${identity.id}`;
  }
  return path.join(getBrokerDirectory(), `leader-${identity.id}.sock`);
}

export function createBrokerToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function writeBrokerInfo(info: BrokerInfo): void {
  ensureBrokerDirectory();
  const infoPath = getBrokerInfoPath(info.identity);
  fs.writeFileSync(infoPath, JSON.stringify(info), { mode: 0o600 });
  fs.chmodSync(infoPath, 0o600);
}

export function readBrokerInfo(identity: BrokerIdentity): BrokerInfo | null {
  try {
    const info = JSON.parse(
      fs.readFileSync(getBrokerInfoPath(identity), "utf8")
    ) as BrokerInfo;
    if (
      info.protocolVersion !== BROKER_PROTOCOL_VERSION ||
      info.identity?.id !== identity.id ||
      info.identity.port !== identity.port ||
      info.identity.secretHash !== identity.secretHash ||
      !Number.isInteger(info.pid) ||
      typeof info.socketPath !== "string" ||
      typeof info.token !== "string"
    ) {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

export function clearBrokerInfo(expected: BrokerInfo): void {
  const current = readBrokerInfo(expected.identity);
  if (current && current.token !== expected.token) {
    return;
  }
  try {
    fs.unlinkSync(getBrokerInfoPath(expected.identity));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function removeBrokerSocket(socketPath: string): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    fs.unlinkSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function createBrokerServer(options: {
  socketPath: string;
  token: string;
  handleMessage: (message: ServerMessage) => Promise<ExtensionMessage>;
}) {
  let server: net.Server | null = null;

  return {
    async start(): Promise<void> {
      ensureBrokerDirectory();

      server = net.createServer((socket) => {
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          if (!data.endsWith("\n")) {
            return;
          }

          let request: BrokerRequest;
          try {
            request = JSON.parse(data) as BrokerRequest;
          } catch (error) {
            respond(socket, {
              id: "unknown",
              ok: false,
              error: `Invalid broker request: ${toErrorMessage(error)}`,
            });
            return;
          }

          if (request.protocolVersion !== BROKER_PROTOCOL_VERSION) {
            respond(socket, {
              id: request.id,
              ok: false,
              error: "Unsupported broker protocol version",
            });
            return;
          }
          if (request.token !== options.token) {
            respond(socket, {
              id: request.id,
              ok: false,
              error: "Unauthorized broker request",
            });
            return;
          }
          if (request.operation === "ping") {
            respond(socket, { id: request.id, ok: true, result: "pong" });
            return;
          }
          if (request.operation !== "request" || !request.message) {
            respond(socket, {
              id: request.id,
              ok: false,
              error: "Unsupported broker request",
            });
            return;
          }
          if (!isAllowedBrokerCommand(request.message)) {
            respond(socket, {
              id: request.id,
              ok: false,
              error: `Unsupported broker command: ${getCommand(request.message)}`,
            });
            return;
          }
          if (!isBrokerMessage(request.message)) {
            respond(socket, {
              id: request.id,
              ok: false,
              error: "Invalid broker message",
            });
            return;
          }

          options
            .handleMessage(request.message)
            .then((result) => respond(socket, { id: request.id, ok: true, result }))
            .catch((error) =>
              respond(socket, {
                id: request.id,
                ok: false,
                error: toErrorMessage(error),
              })
            );
        });
      });

      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(options.socketPath, resolve);
      });
    },

    async close(): Promise<void> {
      if (!server?.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      if (process.platform !== "win32") {
        try {
          fs.unlinkSync(options.socketPath);
        } catch {
          // The socket may already be gone.
        }
      }
    },
  };
}

function ensureBrokerDirectory(): void {
  fs.mkdirSync(getBrokerDirectory(), { recursive: true, mode: 0o700 });
  fs.chmodSync(getBrokerDirectory(), 0o700);
}

function getCommand(message: unknown): unknown {
  return typeof message === "object" && message !== null
    ? (message as Record<string, unknown>).cmd
    : undefined;
}

function isAllowedBrokerCommand(message: unknown): boolean {
  const command = getCommand(message);
  return typeof command === "string" && BROKER_COMMANDS.has(command);
}

function isBrokerMessage(message: unknown): message is ServerMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const value = message as Record<string, unknown>;
  switch (value.cmd) {
    case "open-tab":
      return typeof value.url === "string";
    case "close-tabs":
      return isNumberArray(value.tabIds);
    case "get-tab-list":
      return true;
    case "get-browser-recent-history":
      return value.searchQuery === undefined ||
        typeof value.searchQuery === "string";
    case "get-tab-content":
      return isNumber(value.tabId) &&
        (value.offset === undefined || isNumber(value.offset));
    case "reorder-tabs":
      return isNumberArray(value.tabOrder);
    case "find-highlight":
      return isNumber(value.tabId) && typeof value.queryPhrase === "string";
    case "group-tabs":
      return isNumberArray(value.tabIds) &&
        typeof value.isCollapsed === "boolean" &&
        typeof value.groupColor === "string" &&
        typeof value.groupTitle === "string";
    case "capture-screenshot":
      return isNumber(value.tabId) &&
        (value.format === undefined ||
          value.format === "jpeg" ||
          value.format === "png") &&
        (value.quality === undefined || isNumber(value.quality)) &&
        (value.scale === undefined || isNumber(value.scale));
    default:
      return false;
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

export async function pingBroker(options: {
  socketPath: string;
  token: string;
  timeoutMs: number;
}): Promise<boolean> {
  try {
    return await sendBrokerRequest({ ...options, operation: "ping" }) === "pong";
  } catch {
    return false;
  }
}

export async function forwardToBroker(options: {
  socketPath: string;
  token: string;
  message: ServerMessage;
  timeoutMs: number;
}): Promise<ExtensionMessage> {
  return await sendBrokerRequest({
    ...options,
    operation: "request",
    message: options.message,
  }) as ExtensionMessage;
}

function respond(socket: net.Socket, response: BrokerResponse): void {
  socket.end(`${JSON.stringify(response)}\n`);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendBrokerRequest(options: {
  socketPath: string;
  token: string;
  operation: BrokerRequest["operation"];
  message?: ServerMessage;
  timeoutMs: number;
}): Promise<BrokerResponse["result"]> {
  const socket = net.createConnection(options.socketPath);
  const request: BrokerRequest = {
    id: crypto.randomUUID(),
    protocolVersion: BROKER_PROTOCOL_VERSION,
    token: options.token,
    operation: options.operation,
    message: options.message,
  };

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Broker request timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    let data = "";

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("data", (chunk) => {
      data += chunk.toString();
    });
    socket.on("end", () => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(data) as BrokerResponse;
        if (response.ok) {
          resolve(response.result);
        } else {
          reject(new Error(response.error ?? "Unknown broker error"));
        }
      } catch (error) {
        reject(error);
      }
    });
    socket.write(`${JSON.stringify(request)}\n`);
  });
}
