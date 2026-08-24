import * as crypto from "node:crypto";

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

import {
  BROKER_PROTOCOL_VERSION,
  type BrokerIdentity,
  type BrokerInfo,
  clearBrokerInfo,
  createBrokerIdentity,
  createBrokerServer,
  createBrokerToken,
  forwardToBroker,
  getBrokerSocketPath,
  pingBroker,
  readBrokerInfo,
  removeBrokerSocket,
  writeBrokerInfo,
} from "./singleton-broker";

const WS_DEFAULT_PORT = 8089;
const EXTENSION_RESPONSE_TIMEOUT_MS = 1000;
// Capturing may foreground the tab, wait for it to paint, encode the image and transfer a
// payload orders of magnitude larger than the other responses.
const SCREENSHOT_RESPONSE_TIMEOUT_MS = 10000;
const BROKER_REQUEST_TIMEOUT_MS = 15000;
const BROKER_STARTUP_WAIT_MS = 1000;
const BROKER_POLL_INTERVAL_MS = 25;

interface ExtensionRequestResolver<T extends ExtensionMessage["resource"]> {
  resource: T;
  resolve: (value: Extract<ExtensionMessage, { resource: T }>) => void;
  reject: (reason?: string) => void;
}

export class BrowserAPI {
  private ws: WebSocket | null = null;
  private extensionSockets = new Set<WebSocket>();
  private wsServers: WebSocket.Server[] = [];
  private sharedSecret: string | null = null;
  private unavailableReason: string | null = null;
  private brokerInfo: BrokerInfo | null = null;
  private brokerServer: ReturnType<typeof createBrokerServer> | null = null;
  private brokerIdentity: BrokerIdentity | null = null;
  private selectedPort: number | null = null;

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
    this.selectedPort = port;
    const identity = createBrokerIdentity({ port, extensionSecret: secret });
    this.brokerIdentity = identity;

    if (await this.connectToBroker(identity, 0)) {
      return;
    }

    try {
      await this.becomeLeader(identity, port);
    } catch (error) {
      await this.close();
      if (!isAddressInUseError(error)) {
        throw error;
      }
      if (await this.connectToBroker(identity, BROKER_STARTUP_WAIT_MS)) {
        return;
      }
      this.unavailableReason =
        `Configured port ${port} is already in use and no browser-control broker responded.`;
      console.error(this.unavailableReason);
    }
  }

  private async becomeLeader(
    identity: BrokerIdentity,
    port: number
  ): Promise<void> {
    // Bind explicitly to both loopback addresses so Firefox connects regardless of how
    // it resolves "localhost". On Linux, getaddrinfo("localhost") often returns ::1
    // before 127.0.0.1; binding only to "localhost" then yields an IPv6-only listener
    // and IPv4 connect attempts get refused. Listening on 127.0.0.1 *and* ::1 keeps
    // the server loopback-only (unlike "::"/"0.0.0.0", which would expose external
    // interfaces), while accepting both IPv4 and IPv6 clients.
    const hosts = process.env.CONTAINERIZED ? ["0.0.0.0"] : ["127.0.0.1", "::1"];

    for (const host of hosts) {
      const wsServer = new WebSocket.Server({ host, port });

      console.error(`Starting WebSocket server on ${host}:${port}`);
      wsServer.on("connection", async (connection) => {
        this.ws = connection;
        this.extensionSockets.add(connection);

        console.error("WebSocket connection established on port", port);

        connection.on("message", (message) => {
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
        connection.on("close", () => {
          this.extensionSockets.delete(connection);
          if (this.ws === connection) {
            this.ws = null;
          }
        });
      });
      this.wsServers.push(wsServer);
      await new Promise<void>((resolve, reject) => {
        const handleStartupError = (error: Error) => reject(error);
        wsServer.once("error", handleStartupError);
        wsServer.once("listening", () => {
          wsServer.off("error", handleStartupError);
          resolve();
        });
      });
      wsServer.on("error", (error) => {
        console.error(`WebSocket server error on ${host}:${port}:`, error);
      });
    }

    const token = createBrokerToken();
    const brokerInfo: BrokerInfo = {
      pid: process.pid,
      identity,
      socketPath: getBrokerSocketPath(identity),
      token,
      protocolVersion: BROKER_PROTOCOL_VERSION,
    };
    removeBrokerSocket(brokerInfo.socketPath);
    this.brokerInfo = brokerInfo;
    this.brokerServer = createBrokerServer({
      socketPath: brokerInfo.socketPath,
      token,
      handleMessage: (message) => this.handleBrokerMessage(message),
    });
    await this.brokerServer.start();
    writeBrokerInfo(brokerInfo);
  }

  private async connectToBroker(
    identity: BrokerIdentity,
    waitMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    do {
      const brokerInfo = readBrokerInfo(identity);
      if (
        brokerInfo &&
        await pingBroker({
          socketPath: brokerInfo.socketPath,
          token: brokerInfo.token,
          timeoutMs: 1000,
        })
      ) {
        this.brokerInfo = brokerInfo;
        this.unavailableReason = null;
        console.error(
          `Forwarding browser requests to broker process ${brokerInfo.pid}`
        );
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, BROKER_POLL_INTERVAL_MS)
      );
    } while (true);
  }

  private async recoverBroker(): Promise<void> {
    if (!this.brokerIdentity || !this.selectedPort) {
      throw new Error("Browser broker identity is unavailable");
    }

    this.brokerInfo = null;
    if (await this.connectToBroker(this.brokerIdentity, 0)) {
      return;
    }

    try {
      await this.becomeLeader(this.brokerIdentity, this.selectedPort);
    } catch (error) {
      await this.close();
      if (
        isAddressInUseError(error) &&
        await this.connectToBroker(this.brokerIdentity, BROKER_STARTUP_WAIT_MS)
      ) {
        return;
      }
      throw error;
    }

    const deadline = Date.now() + BROKER_STARTUP_WAIT_MS;
    while (Date.now() < deadline) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, BROKER_POLL_INTERVAL_MS)
      );
    }
    throw new Error("Firefox did not reconnect after browser broker recovery");
  }

  private async closeWebSocketServers(): Promise<void> {
    await Promise.all(
      this.wsServers.map(
        (wsServer) => new Promise<void>((resolve) => {
          wsServer.close(() => resolve());
        })
      )
    );
    this.wsServers = [];
  }

  async close(): Promise<void> {
    if (this.brokerServer && this.brokerInfo) {
      clearBrokerInfo(this.brokerInfo);
    }

    await Promise.all(
      [...this.extensionSockets].map(
        (socket) => new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.once("close", resolve);
          socket.close(1001, "browser-control broker shutting down");
        })
      )
    );
    this.extensionSockets.clear();
    this.ws = null;

    await this.brokerServer?.close();
    this.brokerServer = null;
    this.brokerInfo = null;

    await this.closeWebSocketServers();
  }

  getSelectedPort() {
    return this.wsServers[0]?.options.port ?? this.selectedPort ?? undefined;
  }

  async openTab(url: string): Promise<number | undefined> {
    const message = await this.requestExtension(
      { cmd: "open-tab", url },
      "opened-tab-id"
    );
    return message.tabId;
  }

  async closeTabs(tabIds: number[]) {
    await this.requestExtension(
      { cmd: "close-tabs", tabIds },
      "tabs-closed"
    );
  }

  async getTabList(): Promise<BrowserTab[]> {
    const message = await this.requestExtension({ cmd: "get-tab-list" }, "tabs");
    return message.tabs;
  }

  async getBrowserRecentHistory(
    searchQuery?: string
  ): Promise<BrowserHistoryItem[]> {
    const message = await this.requestExtension(
      { cmd: "get-browser-recent-history", searchQuery },
      "history"
    );
    return message.historyItems;
  }

  async getTabContent(
    tabId: number,
    offset: number
  ): Promise<TabContentExtensionMessage> {
    return await this.requestExtension(
      { cmd: "get-tab-content", tabId, offset },
      "tab-content"
    );
  }

  async reorderTabs(tabOrder: number[]): Promise<number[]> {
    const message = await this.requestExtension(
      { cmd: "reorder-tabs", tabOrder },
      "tabs-reordered"
    );
    return message.tabOrder;
  }

  async findHighlight(tabId: number, queryPhrase: string): Promise<number> {
    const message = await this.requestExtension(
      { cmd: "find-highlight", tabId, queryPhrase },
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
    const message = await this.requestExtension(
      { cmd: "group-tabs", tabIds, isCollapsed, groupColor, groupTitle },
      "new-tab-group"
    );
    return message.groupId;
  }

  async captureScreenshot(
    tabId: number,
    format: "jpeg" | "png",
    quality: number,
    scale: number
  ): Promise<ScreenshotExtensionMessage> {
    return await this.requestExtension(
      { cmd: "capture-screenshot", tabId, format, quality, scale },
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
    if (this.unavailableReason) {
      throw new Error(this.unavailableReason);
    }
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

  private async requestExtension<T extends ExtensionMessage["resource"]>(
    message: ServerMessage,
    resource: T,
    timeoutMs: number = EXTENSION_RESPONSE_TIMEOUT_MS,
    allowRecovery: boolean = true
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    if (!this.brokerServer) {
      if (!this.brokerInfo) {
        throw new Error(
          this.unavailableReason ?? "Browser broker is unavailable"
        );
      }
      let response: ExtensionMessage;
      try {
        response = await forwardToBroker({
          socketPath: this.brokerInfo.socketPath,
          token: this.brokerInfo.token,
          message,
          timeoutMs: BROKER_REQUEST_TIMEOUT_MS,
        });
      } catch (error) {
        if (!allowRecovery) {
          throw error;
        }
        await this.recoverBroker();
        return await this.requestExtension(message, resource, timeoutMs, false);
      }
      if (response.resource !== resource) {
        throw new Error(
          `Broker resource mismatch: expected ${resource}, received ${response.resource}`
        );
      }
      return response as Extract<ExtensionMessage, { resource: T }>;
    }

    const correlationId = this.sendMessageToExtension(message);
    return await this.waitForResponse(correlationId, resource, timeoutMs);
  }

  private async handleBrokerMessage(
    message: ServerMessage
  ): Promise<ExtensionMessage> {
    switch (message.cmd) {
      case "open-tab":
        return await this.requestExtension(message, "opened-tab-id");
      case "close-tabs":
        return await this.requestExtension(message, "tabs-closed");
      case "get-tab-list":
        return await this.requestExtension(message, "tabs");
      case "get-browser-recent-history":
        return await this.requestExtension(message, "history");
      case "get-tab-content":
        return await this.requestExtension(message, "tab-content");
      case "reorder-tabs":
        return await this.requestExtension(message, "tabs-reordered");
      case "find-highlight":
        return await this.requestExtension(message, "find-highlight-result");
      case "group-tabs":
        return await this.requestExtension(message, "new-tab-group");
      case "capture-screenshot":
        return await this.requestExtension(
          message,
          "screenshot",
          SCREENSHOT_RESPONSE_TIMEOUT_MS
        );
      default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unsupported broker command: ${exhaustiveCheck}`);
      }
    }
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
        }, timeoutMs).unref();
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

function isAddressInUseError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

export function isErrorMessage(message: any): message is ExtensionError {
  return (
    message.errorMessage !== undefined && message.correlationId !== undefined
  );
}
