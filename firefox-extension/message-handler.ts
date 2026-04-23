import type {
  BrowserContainer,
  BrowserTab,
  ServerMessageRequest,
} from "@browser-control-mcp/common";
import { WebsocketClient } from "./client";
import {
  isCommandAllowed,
  isDomainInDenyList,
  COMMAND_TO_TOOL_ID,
  addAuditLogEntry,
} from "./extension-config";

const DEFAULT_CONTAINER_NAME = "default";

export class MessageHandler {
  private client: WebsocketClient;

  constructor(client: WebsocketClient) {
    this.client = client;
  }

  public async handleDecodedMessage(req: ServerMessageRequest): Promise<void> {
    const isAllowed = await isCommandAllowed(req.cmd);
    if (!isAllowed) {
      throw new Error(`Command '${req.cmd}' is disabled in extension settings`);
    }

    this.addAuditLogForReq(req).catch((error) => {
      console.error("Failed to add audit log entry:", error);
    });

    switch (req.cmd) {
      case "open-tab":
        await this.openUrl(req.correlationId, req.url, req.container);
        break;
      case "close-tabs":
        await this.closeTabs(req.correlationId, req.tabIds);
        break;
      case "get-tab-list":
        await this.sendTabs(req.correlationId);
        break;
      case "activate-tab":
        await this.activateTab(req.correlationId, req.tabId);
        break;
      case "get-container-list":
        await this.sendContainers(req.correlationId);
        break;
      case "get-browser-recent-history":
        await this.sendRecentHistory(req.correlationId, req.searchQuery);
        break;
      case "get-tab-content":
        await this.sendTabsContent(req.correlationId, req.tabId, req.offset);
        break;
      case "reorder-tabs":
        await this.reorderTabs(req.correlationId, req.tabOrder);
        break;
      case "find-highlight":
        await this.findAndHighlightText(
          req.correlationId,
          req.tabId,
          req.queryPhrase
        );
        break;
      case "group-tabs":
        await this.groupTabs(
          req.correlationId,
          req.tabIds,
          req.isCollapsed,
          req.groupColor as browser.tabGroups.Color,
          req.groupTitle
        );
        break;
      default:
        const _exhaustiveCheck: never = req;
        console.error("Invalid message received:", req);
    }
  }

  private async addAuditLogForReq(req: ServerMessageRequest) {
    let contextUrl: string | undefined;
    if ("url" in req && req.url) {
      contextUrl = req.url;
    }
    if ("tabId" in req) {
      try {
        const tab = await browser.tabs.get(req.tabId);
        contextUrl = tab.url;
      } catch (error) {
        console.error("Failed to get tab URL for audit log:", error);
      }
    }

    const toolId = COMMAND_TO_TOOL_ID[req.cmd];
    const auditEntry = {
      toolId,
      command: req.cmd,
      timestamp: Date.now(),
      url: contextUrl,
    };

    await addAuditLogEntry(auditEntry);
  }

  private async openUrl(
    correlationId: string,
    url: string,
    container?: string
  ): Promise<void> {
    if (!url.startsWith("https://")) {
      console.error("Invalid URL:", url);
      throw new Error("Invalid URL");
    }

    if (await isDomainInDenyList(url)) {
      throw new Error("Domain in user defined deny list");
    }

    const cookieStoreId = await this.resolveRequestedContainer(container);
    const tab = await browser.tabs.create({
      url,
      ...(cookieStoreId ? { cookieStoreId } : {}),
    });
    const containerMap = await this.getContainerMap();
    const tabDetails = this.mapBrowserTab(tab, containerMap);

    await this.client.sendResourceToServer({
      resource: "opened-tab-id",
      correlationId,
      tabId: tab.id,
      tab: tabDetails,
    });
  }

  private async closeTabs(
    correlationId: string,
    tabIds: number[]
  ): Promise<void> {
    await browser.tabs.remove(tabIds);
    await this.client.sendResourceToServer({
      resource: "tabs-closed",
      correlationId,
    });
  }

  private async sendTabs(correlationId: string): Promise<void> {
    const tabs = await browser.tabs.query({});
    const containerMap = await this.getContainerMap();
    const mappedTabs = tabs.map((tab) => this.mapBrowserTab(tab, containerMap));
    await this.client.sendResourceToServer({
      resource: "tabs",
      correlationId,
      tabs: mappedTabs,
    });
  }

  private async activateTab(
    correlationId: string,
    tabId: number
  ): Promise<void> {
    const activatedTab = await browser.tabs.update(tabId, { active: true });
    if (activatedTab.windowId !== undefined) {
      await browser.windows.update(activatedTab.windowId, { focused: true });
    }
    const containerMap = await this.getContainerMap();
    const tabDetails = this.mapBrowserTab(activatedTab, containerMap);
    await this.client.sendResourceToServer({
      resource: "activated-tab",
      correlationId,
      tabId: activatedTab.id,
      windowId: activatedTab.windowId,
      tab: tabDetails,
    });
  }

  private async sendContainers(correlationId: string): Promise<void> {
    const containers = await this.getContainers();
    await this.client.sendResourceToServer({
      resource: "containers",
      correlationId,
      containers,
    });
  }

  private async sendRecentHistory(
    correlationId: string,
    searchQuery: string | null = null
  ): Promise<void> {
    const historyItems = await browser.history.search({
      text: searchQuery ?? "",
      maxResults: 200,
      startTime: 0,
    });
    const filteredHistoryItems = historyItems.filter((item) => {
      return !!item.url;
    });
    await this.client.sendResourceToServer({
      resource: "history",
      correlationId,
      historyItems: filteredHistoryItems,
    });
  }

  private async checkForUrlPermission(url: string | undefined): Promise<void> {
    if (url) {
      const origin = new URL(url).origin;
      const granted = await browser.permissions.contains({
        origins: [`${origin}/*`],
      });

      if (!granted) {
        const optionsUrl = browser.runtime.getURL("options.html");
        const urlWithParams = `${optionsUrl}?requestUrl=${encodeURIComponent(
          url
        )}`;

        await browser.tabs.create({ url: urlWithParams });
        throw new Error(
          `The user has not yet granted permission to access the domain "${origin}". A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
        );
      }
    }
  }

  private async checkForGlobalPermission(permissions: string[]): Promise<void> {
    const granted = await browser.permissions.contains({
      permissions,
    });

    if (!granted) {
      const optionsUrl = browser.runtime.getURL("options.html");
      const urlWithParams = `${optionsUrl}?requestPermissions=${encodeURIComponent(
        JSON.stringify(permissions)
      )}`;

      await browser.tabs.create({ url: urlWithParams });
      throw new Error(
        `The user has not yet granted permission for the following operations: ${permissions.join(
          ", "
        )}. A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
      );
    }
  }

  private async sendTabsContent(
    correlationId: string,
    tabId: number,
    offset?: number
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);
    if (tab.url && (await isDomainInDenyList(tab.url))) {
      throw new Error(`Domain in tab URL is in the deny list`);
    }

    await this.checkForUrlPermission(tab.url);

    const MAX_CONTENT_LENGTH = 50_000;
    const results = await browser.tabs.executeScript(tabId, {
      code: `
      (function () {
        function getLinks() {
          const linkElements = document.querySelectorAll('a[href]');
          return Array.from(linkElements).map(el => ({
            url: el.href,
            text: el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || ''
          })).filter(link => link.text !== '' && link.url.startsWith('https://') && !link.url.includes('#'));
        }

        function getTextContent() {
          let isTruncated = false;
          let text = document.body.innerText.substring(${Number(offset) || 0});
          if (text.length > ${MAX_CONTENT_LENGTH}) {
            text = text.substring(0, ${MAX_CONTENT_LENGTH});
            isTruncated = true;
          }
          return {
            text, isTruncated
          }
        }

        const textContent = getTextContent();

        return {
          links: getLinks(),
          fullText: textContent.text,
          isTruncated: textContent.isTruncated,
          totalLength: document.body.innerText.length
        };
      })();
    `,
    });
    const { isTruncated, fullText, links, totalLength } = results[0];
    await this.client.sendResourceToServer({
      resource: "tab-content",
      tabId,
      correlationId,
      isTruncated,
      fullText,
      links,
      totalLength,
    });
  }

  private async reorderTabs(
    correlationId: string,
    tabOrder: number[]
  ): Promise<void> {
    for (let newIndex = 0; newIndex < tabOrder.length; newIndex++) {
      const tabId = tabOrder[newIndex];
      await browser.tabs.move(tabId, { index: newIndex });
    }
    await this.client.sendResourceToServer({
      resource: "tabs-reordered",
      correlationId,
      tabOrder,
    });
  }

  private async findAndHighlightText(
    correlationId: string,
    tabId: number,
    queryPhrase: string
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);

    if (tab.url && (await isDomainInDenyList(tab.url))) {
      throw new Error(`Domain in tab URL is in the deny list`);
    }

    await this.checkForGlobalPermission(["find"]);

    const findResults = await browser.find.find(queryPhrase, {
      tabId,
      caseSensitive: true,
    });

    if (findResults.count > 0) {
      await browser.tabs.update(tabId, { active: true });
      browser.find.highlightResults({
        tabId,
      });
    }

    await this.client.sendResourceToServer({
      resource: "find-highlight-result",
      correlationId,
      noOfResults: findResults.count,
    });
  }

  private async groupTabs(
    correlationId: string,
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: browser.tabGroups.Color,
    groupTitle: string
  ): Promise<void> {
    const groupId = await browser.tabs.group({
      tabIds,
    });

    const tabGroup = await browser.tabGroups.update(groupId, {
      collapsed: isCollapsed,
      color: groupColor,
      title: groupTitle,
    });

    await this.client.sendResourceToServer({
      resource: "new-tab-group",
      correlationId,
      groupId: tabGroup.id,
    });
  }

  private async getContainers(): Promise<BrowserContainer[]> {
    const identities = await browser.contextualIdentities.query({});
    return identities
      .map((identity) => ({
        cookieStoreId: identity.cookieStoreId,
        name: identity.name,
        color: identity.color,
        colorCode: identity.colorCode,
        icon: identity.icon,
      }))
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) {
          return byName;
        }
        return a.cookieStoreId.localeCompare(b.cookieStoreId);
      });
  }

  private mapBrowserTab(
    tab: browser.tabs.Tab,
    containerMap: Map<string, BrowserContainer>
  ): BrowserTab {
    return {
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      url: tab.url,
      title: tab.title,
      lastAccessed: tab.lastAccessed,
      active: tab.active,
      pinned: tab.pinned,
      cookieStoreId: tab.cookieStoreId,
      container:
        tab.cookieStoreId && !this.isDefaultCookieStore(tab.cookieStoreId)
          ? (containerMap.get(tab.cookieStoreId) ?? null)
          : null,
    };
  }

  private async getContainerMap(): Promise<Map<string, BrowserContainer>> {
    const containers = await this.getContainers();
    return new Map(
      containers.map((container) => [container.cookieStoreId, container])
    );
  }

  private isDefaultCookieStore(cookieStoreId: string): boolean {
    return cookieStoreId === "firefox-default";
  }

  private async resolveRequestedContainer(
    requestedContainer?: string
  ): Promise<string | undefined> {
    const candidate = requestedContainer?.trim();
    if (!candidate || candidate === DEFAULT_CONTAINER_NAME) {
      return undefined;
    }

    const containers = await this.getContainers();

    const exactIdMatch = containers.find(
      (container) => container.cookieStoreId === candidate
    );
    if (exactIdMatch) {
      return exactIdMatch.cookieStoreId;
    }

    const exactNameMatches = containers.filter(
      (container) => container.name === candidate
    );
    if (exactNameMatches.length === 1) {
      return exactNameMatches[0].cookieStoreId;
    }
    if (exactNameMatches.length > 1) {
      throw new Error(
        `Container name "${candidate}" is ambiguous. Use cookieStoreId instead.`
      );
    }

    const caseInsensitiveMatches = containers.filter(
      (container) => container.name.toLowerCase() === candidate.toLowerCase()
    );
    if (caseInsensitiveMatches.length === 1) {
      return caseInsensitiveMatches[0].cookieStoreId;
    }
    if (caseInsensitiveMatches.length > 1) {
      throw new Error(
        `Container name "${candidate}" is ambiguous. Use cookieStoreId instead.`
      );
    }

    const validContainers = containers
      .map((container) => `${container.name} (${container.cookieStoreId})`)
      .join(", ");
    throw new Error(
      `Unknown container "${candidate}". Valid containers: ${validContainers}`
    );
  }
}
