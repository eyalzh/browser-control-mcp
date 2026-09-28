import WebSocket from "ws";
import type {
  ExtensionMessage,
  BrowserTab,
  BrowserHistoryItem,
  ServerMessage,
  TabContentExtensionMessage,
  ServerMessageRequest,
  ExtensionError,
  ScreenshotExtensionMessage,
} from "@browser-control-mcp/common";
import { isPortInUse } from "./util";
import * as crypto from "crypto";

const WS_DEFAULT_PORT = 8089;
const EXTENSION_RESPONSE_TIMEOUT_MS = 1000;
// Capturing may foreground the tab, wait for it to paint, encode the image and transfer a
// payload orders of magnitude larger than the other responses.
const SCREENSHOT_RESPONSE_TIMEOUT_MS = 10000;
const HANDSHAKE_TIMEOUT_MS = 5000;
const MAX_PENDING_CONNECTIONS = 8;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const PROTOCOL = "browser-control-mcp:v2";

interface AuthenticatedPeer {
  socket: WebSocket;
  nonce: string;
  sent: number;
  received: number;
}

interface ExtensionRequestResolver<T extends ExtensionMessage["resource"]> {
  resource: T;
  resolve: (value: Extract<ExtensionMessage, { resource: T }>) => void;
  reject: (reason?: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrowserAPI {
  private peer: AuthenticatedPeer | null = null;
  private connections = new Set<WebSocket>();
  private wsServers: WebSocket.Server[] = [];
  private sharedSecret: string | null = null;

  // Map to persist the request to the extension. It maps the request correlationId
  // to a resolver, fulfulling a promise created when sending a message to the extension.
  private extensionRequestMap: Map<
    string,
    ExtensionRequestResolver<ExtensionMessage["resource"]>
  > = new Map();

  async init() {
    const { secret, port } = readConfig();
    if (!secret) {
      throw new Error(
        "EXTENSION_SECRET env var missing. See the extension's options page."
      );
    }
    this.sharedSecret = secret;

    if (await isPortInUse(port)) {
      throw new Error(
        `Configured port ${port} is already in use. Please configure a different port.`
      );
    }

    // Bind explicitly to both loopback addresses so Firefox connects regardless of how
    // it resolves "localhost". On Linux, getaddrinfo("localhost") often returns ::1
    // before 127.0.0.1; binding only to "localhost" then yields an IPv6-only listener
    // and IPv4 connect attempts get refused. Listening on 127.0.0.1 *and* ::1 keeps
    // the server loopback-only (unlike "::"/"0.0.0.0", which would expose external
    // interfaces), while accepting both IPv4 and IPv6 clients.
    const hosts = process.env.CONTAINERIZED ? ["0.0.0.0"] : ["127.0.0.1", "::1"];

    for (const host of hosts) {
      const wsServer = new WebSocket.Server({ host, port, maxPayload: MAX_MESSAGE_BYTES });

      console.error(`Starting WebSocket server on ${host}:${port}`);
      wsServer.on("connection", (connection, request) => {
        connection.on("error", () => connection.terminate());
        const origin = request.headers.origin;
        if ((origin && !/^moz-extension:\/\/[a-z0-9-]+$/i.test(origin)) ||
            this.peer || this.connections.size >= MAX_PENDING_CONNECTIONS) {
          connection.close(1008, "Connection refused");
          return;
        }
        this.connections.add(connection);
        const nonce = crypto.randomBytes(32).toString("hex");
        let authenticated = false;
        const timer = setTimeout(() => connection.terminate(), HANDSHAKE_TIMEOUT_MS);
        connection.on("close", () => {
          clearTimeout(timer);
          this.connections.delete(connection);
          if (this.peer?.socket === connection) {
            this.peer = null;
            this.rejectPendingRequests("Browser extension disconnected");
          }
        });
        connection.on("message", (message, isBinary) => {
          try {
            if (isBinary) throw new Error("Binary frame");
            const decoded: unknown = JSON.parse(message.toString());
            if (!isRecord(decoded)) throw new Error("Invalid frame");
            if (!authenticated) {
              if (this.peer || decoded.type !== "authenticate" || decoded.nonce !== nonce ||
                  typeof decoded.clientNonce !== "string" || !/^[a-f0-9]{64}$/.test(decoded.clientNonce) ||
                  !this.verifySignature(JSON.stringify([PROTOCOL, "authenticate", "extension", nonce, decoded.clientNonce]), decoded.signature)) {
                throw new Error("Authentication failed");
              }
              authenticated = true;
              clearTimeout(timer);
              this.peer = { socket: connection, nonce: `${nonce}:${decoded.clientNonce}`, sent: 0, received: 0 };
              connection.send(JSON.stringify({
                type: "ready", nonce, clientNonce: decoded.clientNonce,
                signature: this.createSignature(JSON.stringify([PROTOCOL, "authenticate", "server", nonce, decoded.clientNonce])),
              }));
              return;
            }
            const peer = this.peer;
            if (!peer || peer.socket !== connection || decoded.type !== "message" ||
                !Number.isSafeInteger(decoded.sequence) || decoded.sequence !== peer.received + 1 ||
                !this.verifySignature(JSON.stringify([PROTOCOL, "message", "extension", peer.nonce, decoded.sequence, decoded.payload]), decoded.signature)) {
              throw new Error("Invalid authenticated frame");
            }
            const payload = decoded.payload;
            if (!isRecord(payload) || typeof payload.correlationId !== "string" ||
                payload.correlationId.length > 128 || typeof payload.resource !== "string") {
              throw new Error("Invalid response");
            }
            peer.received++;
            if (payload.resource === "error") {
              if (!isErrorMessage(payload)) throw new Error("Invalid error response");
              this.handleExtensionError(payload);
            } else {
              this.handleDecodedExtensionMessage(payload as unknown as ExtensionMessage);
            }
          } catch {
            // Reject only the offending connection. Do not log incoming data.
            connection.close(1008, "Invalid bridge message");
          }
        });
        connection.send(JSON.stringify({ type: "challenge", version: 2, nonce }));
      });
      wsServer.on("error", (error) => {
        console.error(`WebSocket server error on ${host}:${port}:`, error);
      });

      this.wsServers.push(wsServer);
    }
  }

  close() {
    this.rejectPendingRequests("Browser bridge closed");
    for (const connection of this.connections) connection.terminate();
    this.connections.clear();
    this.peer = null;
    for (const wsServer of this.wsServers) {
      wsServer.close();
    }
    this.wsServers = [];
  }

  getSelectedPort() {
    const address = this.wsServers[0]?.address();
    return address && typeof address !== "string" ? address.port : undefined;
  }

  async openTab(url: string): Promise<number | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "open-tab",
      url,
    });
    const message = await this.waitForResponse(correlationId, "opened-tab-id");
    return message.tabId;
  }

  async closeTabs(tabIds: number[]) {
    const correlationId = this.sendMessageToExtension({
      cmd: "close-tabs",
      tabIds,
    });
    await this.waitForResponse(correlationId, "tabs-closed");
  }

  async getTabList(): Promise<BrowserTab[]> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-tab-list",
    });
    const message = await this.waitForResponse(correlationId, "tabs");
    return message.tabs;
  }

  async getBrowserRecentHistory(
    searchQuery?: string
  ): Promise<BrowserHistoryItem[]> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-browser-recent-history",
      searchQuery,
    });
    const message = await this.waitForResponse(correlationId, "history");
    return message.historyItems;
  }

  async getTabContent(
    tabId: number,
    offset: number
  ): Promise<TabContentExtensionMessage> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-tab-content",
      tabId,
      offset,
    });
    return await this.waitForResponse(correlationId, "tab-content");
  }

  async reorderTabs(tabOrder: number[]): Promise<number[]> {
    const correlationId = this.sendMessageToExtension({
      cmd: "reorder-tabs",
      tabOrder,
    });
    const message = await this.waitForResponse(correlationId, "tabs-reordered");
    return message.tabOrder;
  }

  async findHighlight(tabId: number, queryPhrase: string): Promise<number> {
    const correlationId = this.sendMessageToExtension({
      cmd: "find-highlight",
      tabId,
      queryPhrase,
    });
    const message = await this.waitForResponse(
      correlationId,
      "find-highlight-result"
    );
    return message.noOfResults;
  }

  async groupTabs(
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: string,
    groupTitle: string
  ): Promise<number> {
    const correlationId = this.sendMessageToExtension({
      cmd: "group-tabs",
      tabIds,
      isCollapsed,
      groupColor,
      groupTitle,
    });
    const message = await this.waitForResponse(correlationId, "new-tab-group");
    return message.groupId;
  }

  async captureScreenshot(
    tabId: number,
    format: "jpeg" | "png",
    quality: number,
    scale: number
  ): Promise<ScreenshotExtensionMessage> {
    const correlationId = this.sendMessageToExtension({
      cmd: "capture-screenshot",
      tabId,
      format,
      quality,
      scale,
    });
    return await this.waitForResponse(
      correlationId,
      "screenshot",
      SCREENSHOT_RESPONSE_TIMEOUT_MS
    );
  }

  private createSignature(payload: string): string {
    if (!this.sharedSecret) {
      throw new Error("Shared secret not initialized");
    }
    const hmac = crypto.createHmac("sha256", this.sharedSecret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  private verifySignature(payload: string, signature: unknown): boolean {
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
    return crypto.timingSafeEqual(Buffer.from(this.createSignature(payload), "hex"), Buffer.from(signature, "hex"));
  }

  private sendMessageToExtension(message: ServerMessage): string {
    const peer = this.peer;
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Browser extension is not authenticated");
    }

    const correlationId = crypto.randomUUID();
    const req: ServerMessageRequest = { ...message, correlationId };
    const sequence = ++peer.sent;
    const signature = this.createSignature(JSON.stringify([PROTOCOL, "message", "server", peer.nonce, sequence, req]));
    const signedMessage = {
      type: "message",
      sequence,
      payload: req,
      signature: signature,
    };

    // Send the signed message to the extension
    peer.socket.send(JSON.stringify(signedMessage), error => {
      if (error) peer.socket.terminate();
    });

    return correlationId;
  }

  private handleDecodedExtensionMessage(decoded: ExtensionMessage) {
    const { correlationId } = decoded;
    const pending = this.extensionRequestMap.get(correlationId);
    // A normal response can arrive after its request has timed out.
    if (!pending) return;
    const { resolve, resource, reject, timer } = pending;
    clearTimeout(timer);
    this.extensionRequestMap.delete(correlationId);
    if (resource !== decoded.resource) {
      reject(new Error("Unexpected browser response"));
      return;
    }
    resolve(decoded);
  }

  private handleExtensionError(decoded: ExtensionError) {
    const { correlationId, errorMessage } = decoded;
    const pending = this.extensionRequestMap.get(correlationId);
    if (!pending) return;
    const { reject, timer } = pending;
    clearTimeout(timer);
    this.extensionRequestMap.delete(correlationId);
    reject(new Error(errorMessage));
  }

  private rejectPendingRequests(message: string) {
    for (const pending of this.extensionRequestMap.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.extensionRequestMap.clear();
  }

  private async waitForResponse<T extends ExtensionMessage["resource"]>(
    correlationId: string,
    resource: T,
    timeoutMs: number = EXTENSION_RESPONSE_TIMEOUT_MS
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    return new Promise<Extract<ExtensionMessage, { resource: T }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.extensionRequestMap.delete(correlationId);
          reject(new Error("Timed out waiting for response"));
        }, timeoutMs);
        this.extensionRequestMap.set(correlationId, {
          resolve: resolve as (value: ExtensionMessage) => void,
          resource,
          reject,
          timer,
        });
      }
    );
  }
}

function readConfig() {
  return {
    secret: process.env.EXTENSION_SECRET,
    port: process.env.EXTENSION_PORT
      ? parseInt(process.env.EXTENSION_PORT, 10)
      : WS_DEFAULT_PORT,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isErrorMessage(message: unknown): message is ExtensionError {
  return (
    isRecord(message) && message.resource === "error" &&
    typeof message.errorMessage === "string" && typeof message.correlationId === "string"
  );
}
