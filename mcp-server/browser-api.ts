import WebSocket from "ws";
import {
  ResourceMessage,
  BrowserTab,
  BrowserHistoryItem,
  ToolMessage,
  TabContentResourceMessage,
  ToolMessageRequest,
} from "@browser-control-mcp/common";
import { isPortInUse } from "./util";
import EphemeralMap from "./ephemeral-map";
import { join } from "path";
import { readFile } from "fs/promises";
import * as crypto from "crypto";

// Support up to two initializations of the MCP server by the client
// More initializations will result in EDADDRINUSE errors
const WS_PORTS = [8081, 8082];

export class BrowserAPI {
  private ws: WebSocket | null = null;
  private wsServer: WebSocket.Server | null = null;
  private sharedSecret: string | null = null;

  // Local state representing the resources provided by the browser extension
  // These will be updated by an inbound message from the extension
  private openTabs: EphemeralMap<string, BrowserTab[]> = new EphemeralMap();
  private browserHistory: EphemeralMap<string, BrowserHistoryItem[]> =
    new EphemeralMap();
  private tabContent: EphemeralMap<string, TabContentResourceMessage> =
    new EphemeralMap();
  private openedTabId: EphemeralMap<string, number | undefined> =
    new EphemeralMap();
  private reorderedTabs: EphemeralMap<string, number[]> = new EphemeralMap();
  private findHighlightResults: EphemeralMap<string, number> =
    new EphemeralMap();

  async init() {
    const { secret } = await readConfig();
    if (!secret) {
      throw new Error("Secret not found in config.json");
    }
    this.sharedSecret = secret;

    let selectedPort = null;

    for (const port of WS_PORTS) {
      if (!(await isPortInUse(port))) {
        selectedPort = port;
        break;
      }
    }
    if (!selectedPort) {
      throw new Error("All available ports are in use");
    }

    this.wsServer = new WebSocket.Server({
      host: "localhost",
      port: selectedPort,
    });
    this.wsServer.on("connection", async (connection) => {
      this.ws = connection;

      this.ws.on("message", (message) => {
        const decoded = JSON.parse(message.toString());
        const signature = this.createSignature(JSON.stringify(decoded.payload));
        if (signature !== decoded.signature) {
          console.error("Invalid message signature");
          return;
        }
        this.handleDecodedResourceMessage(decoded.payload);
      });
    });
    this.wsServer.on("error", (error) => {
      console.error("WebSocket server error:", error);
    });
    return selectedPort;
  }

  close() {
    this.wsServer?.close();
  }

  getSelectedPort() {
    return this.wsServer?.options.port;
  }

  async openTab(url: string): Promise<number | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "open-tab",
      url,
    });
    await waitForResponse();
    return this.openedTabId.getAndDelete(correlationId);
  }

  async closeTabs(tabIds: number[]) {
    this.sendMessageToExtension({
      cmd: "close-tabs",
      tabIds,
    });
  }

  async getTabList(): Promise<BrowserTab[] | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-tab-list",
    });
    await waitForResponse();
    return this.openTabs.getAndDelete(correlationId);
  }

  async getBrowserRecentHistory(
    searchQuery?: string
  ): Promise<BrowserHistoryItem[] | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-browser-recent-history",
      searchQuery,
    });
    await waitForResponse();
    return this.browserHistory.getAndDelete(correlationId);
  }

  async getTabContent(
    tabId: number
  ): Promise<TabContentResourceMessage | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-tab-content",
      tabId,
    });
    await waitForResponse();
    return this.tabContent.getAndDelete(correlationId);
  }

  async reorderTabs(tabOrder: number[]): Promise<number[] | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "reorder-tabs",
      tabOrder,
    });
    await waitForResponse();
    return this.reorderedTabs.getAndDelete(correlationId);
  }

  async findHighlight(
    tabId: number,
    queryPhrase: string
  ): Promise<number | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "find-highlight",
      tabId,
      queryPhrase,
    });
    await waitForResponse();
    return this.findHighlightResults.getAndDelete(correlationId);
  }

  private createSignature(payload: string): string {
    if (!this.sharedSecret) {
      throw new Error("Shared secret not initialized");
    }
    const hmac = crypto.createHmac("sha256", this.sharedSecret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  private sendMessageToExtension(message: ToolMessage): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    const correlationId = Math.random().toString(36).substring(2);
    const req: ToolMessageRequest = { ...message, correlationId };
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

  private handleDecodedResourceMessage(decoded: ResourceMessage) {
    const { correlationId } = decoded;
    switch (decoded.resource) {
      case "tabs":
        this.openTabs.set(correlationId, decoded.tabs);
        break;
      case "history":
        this.browserHistory.set(correlationId, decoded.historyItems);
        break;
      case "opened-tab-id":
        this.openedTabId.set(correlationId, decoded.tabId);
        break;
      case "tab-content":
        this.tabContent.set(correlationId, decoded);
        break;
      case "tabs-reordered":
        this.reorderedTabs.set(correlationId, decoded.tabOrder);
        break;
      case "find-highlight-result":
        this.findHighlightResults.set(correlationId, decoded.noOfResults);
        break;
      default:
        const _exhaustiveCheck: never = decoded;
        console.error("Invalid resource message received:", decoded);
    }
  }
}

async function readConfig() {
  const configPath = join(__dirname, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return config;
}

async function waitForResponse() {
  // Wait for the extension to respond back on the same connection
  const WAIT_TIME_MS = 200;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, WAIT_TIME_MS);
  });
}
