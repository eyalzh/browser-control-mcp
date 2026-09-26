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
import * as crypto from "crypto";

const DEFAULT_PORTS = [8089, 8090, 8091];
const EXTENSION_RESPONSE_TIMEOUT_MS = 1000;
// Capturing may foreground the tab, wait for it to paint, encode the image and transfer a
// payload orders of magnitude larger than the other responses.
const SCREENSHOT_RESPONSE_TIMEOUT_MS = 10000;

interface ExtensionRequestResolver<T extends ExtensionMessage["resource"]> {
  resource: T;
  resolve: (value: Extract<ExtensionMessage, { resource: T }>) => void;
  reject: (reason?: string) => void;
}

export class BrowserAPI {
  private ws: WebSocket | null = null;
  private wsServers: WebSocket.Server[] = [];
  private sharedSecret: string | null = null;

  // Map to persist the request to the extension. It maps the request correlationId
  // to a resolver, fulfulling a promise created when sending a message to the extension.
  private extensionRequestMap: Map<
    string,
    ExtensionRequestResolver<ExtensionMessage["resource"]>
  > = new Map();

  async init() {
    const { secret, ports } = readConfig();
    if (!secret) {
      throw new Error(
        "EXTENSION_SECRET env var missing. See the extension's options page."
      );
    }
    this.sharedSecret = secret;

    // Bind explicitly to both loopback addresses so Firefox connects regardless of how
    // it resolves "localhost". On Linux, getaddrinfo("localhost") often returns ::1
    // before 127.0.0.1; binding only to "localhost" then yields an IPv6-only listener
    // and IPv4 connect attempts get refused. Listening on 127.0.0.1 *and* ::1 keeps
    // the server loopback-only (unlike "::"/"0.0.0.0", which would expose external
    // interfaces), while accepting both IPv4 and IPv6 clients.
    const hosts = process.env.CONTAINERIZED ? ["0.0.0.0"] : ["127.0.0.1", "::1"];

    const skipped: number[] = [];
    const attemptErrors: string[] = [];
    let boundPort: number | null = null;
    let boundServers: WebSocket.Server[] = [];

    for (const port of ports) {
      try {
        boundServers = await bindAllHosts(hosts, port);
        boundPort = port;
        break;
      } catch (err) {
        skipped.push(port);
        attemptErrors.push(
          `${port}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (boundPort === null) {
      throw new Error(
        `Could not bind the WebSocket server to any of the configured ports ` +
          `(${ports.join(", ")}). Details: ${attemptErrors.join("; ")}. Add more ` +
          `ports via the EXTENSION_PORT env var (comma-separated) and to the ` +
          `"Ports" field on the Firefox extension's options page.`
      );
    }

    console.error(
      skipped.length > 0
        ? `Using port ${boundPort} (${skipped.join(", ")} in use)`
        : `Using port ${boundPort}`
    );

    for (const wsServer of boundServers) {
      const host = wsServer.options.host;
      console.error(`Starting WebSocket server on ${host}:${boundPort}`);
      wsServer.on("connection", async (connection) => {
        this.ws = connection;

        console.error("WebSocket connection established on port", boundPort);

        this.ws.on("message", (message) => {
          const decoded = JSON.parse(message.toString());
          if (isErrorMessage(decoded)) {
            this.handleExtensionError(decoded);
            return;
          }
          const signature = this.createSignature(JSON.stringify(decoded.payload));
          if (signature !== decoded.signature) {
            console.error("Invalid message signature");
            return;
          }
          this.handleDecodedExtensionMessage(decoded.payload);
        });
      });
      wsServer.on("error", (error) => {
        console.error(`WebSocket server error on ${host}:${boundPort}:`, error);
      });

      this.wsServers.push(wsServer);
    }
  }

  close() {
    for (const wsServer of this.wsServers) {
      wsServer.close();
    }
    this.wsServers = [];
  }

  getSelectedPort() {
    return this.wsServers[0]?.options.port;
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

  private sendMessageToExtension(message: ServerMessage): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    const correlationId = Math.random().toString(36).substring(2);
    const req: ServerMessageRequest = { ...message, correlationId };
    const payload = JSON.stringify(req);
    const signature = this.createSignature(payload);
    const signedMessage = {
      payload: req,
      signature: signature,
    };

    // Send the signed message to the extension
    this.ws.send(JSON.stringify(signedMessage));

    return correlationId;
  }

  private handleDecodedExtensionMessage(decoded: ExtensionMessage) {
    const { correlationId } = decoded;
    const { resolve, resource } = this.extensionRequestMap.get(correlationId)!;
    if (resource !== decoded.resource) {
      console.error("Resource mismatch:", resource, decoded.resource);
      return;
    }
    this.extensionRequestMap.delete(correlationId);
    resolve(decoded);
  }

  private handleExtensionError(decoded: ExtensionError) {
    const { correlationId, errorMessage } = decoded;
    const { reject } = this.extensionRequestMap.get(correlationId)!;
    this.extensionRequestMap.delete(correlationId);
    reject(errorMessage);
  }

  private async waitForResponse<T extends ExtensionMessage["resource"]>(
    correlationId: string,
    resource: T,
    timeoutMs: number = EXTENSION_RESPONSE_TIMEOUT_MS
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    return new Promise<Extract<ExtensionMessage, { resource: T }>>(
      (resolve, reject) => {
        this.extensionRequestMap.set(correlationId, {
          resolve: resolve as (value: ExtensionMessage) => void,
          resource,
          reject,
        });
        setTimeout(() => {
          this.extensionRequestMap.delete(correlationId);
          reject("Timed out waiting for response");
        }, timeoutMs);
      }
    );
  }
}

function parsePorts(raw: string | undefined): number[] {
  if (!raw) {
    return DEFAULT_PORTS;
  }

  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(
      `Invalid EXTENSION_PORT value: "${raw}". Expected a comma-separated ` +
        `list of ports between 1 and 65535 (e.g. "8089,8090,8091").`
    );
  }

  const ports: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const port = Number(part);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `Invalid port "${part}" in EXTENSION_PORT="${raw}". Each port must ` +
          `be an integer between 1 and 65535.`
      );
    }
    if (seen.has(port)) {
      throw new Error(`Duplicate port ${port} in EXTENSION_PORT="${raw}".`);
    }
    seen.add(port);
    ports.push(port);
  }
  return ports;
}

function readConfig() {
  return {
    secret: process.env.EXTENSION_SECRET,
    ports: parsePorts(process.env.EXTENSION_PORT),
  };
}

// Attempts to bind one host:port pair. Resolves on the real 'listening' event so
// callers never rely on a separate isPortInUse-style pre-check, which is prone to a
// TOCTOU race when several server instances start within the same millisecond.
function bindWebSocketServer(host: string, port: number): Promise<WebSocket.Server> {
  return new Promise((resolve, reject) => {
    const wsServer = new WebSocket.Server({ host, port });
    const onListening = () => {
      wsServer.removeListener("error", onError);
      resolve(wsServer);
    };
    const onError = (err: NodeJS.ErrnoException) => {
      wsServer.removeListener("listening", onListening);
      reject(err);
    };
    wsServer.once("listening", onListening);
    wsServer.once("error", onError);
  });
}

// Binds all hosts for a single candidate port. If any host fails, closes whichever
// hosts already succeeded for this candidate so the caller can move to the next port.
async function bindAllHosts(hosts: string[], port: number): Promise<WebSocket.Server[]> {
  const bound: WebSocket.Server[] = [];
  try {
    for (const host of hosts) {
      bound.push(await bindWebSocketServer(host, port));
    }
    return bound;
  } catch (err) {
    for (const wsServer of bound) {
      wsServer.close();
    }
    throw err;
  }
}

export function isErrorMessage(message: any): message is ExtensionError {
  return (
    message.errorMessage !== undefined && message.correlationId !== undefined
  );
}
