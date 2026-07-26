import { MessageHandler } from "../message-handler";
import { WebsocketClient } from "../client";
import type { ServerMessageRequest } from "@browser-control-mcp/common";
import { ExtensionConfig } from "../extension-config";

jest.mock("../client", () => {
  return {
    WebsocketClient: jest.fn().mockImplementation(() => {
      return {
        sendResourceToServer: jest.fn().mockResolvedValue(undefined),
        sendErrorToServer: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe("MessageHandler", () => {
  let messageHandler: MessageHandler;
  let mockClient: jest.Mocked<WebsocketClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = new WebsocketClient(
      8080,
      "test-secret"
    ) as jest.Mocked<WebsocketClient>;
    messageHandler = new MessageHandler(mockClient);

    const defaultConfig: ExtensionConfig = {
      secret: "test-secret",
      toolSettings: {
        "open-browser-tab": true,
        "close-browser-tabs": true,
        "get-list-of-open-tabs": true,
        "activate-browser-tab": true,
        "list-browser-containers": true,
        "get-recent-browser-history": true,
        "get-tab-web-content": true,
        "reorder-browser-tabs": true,
        "find-highlight-in-browser-tab": true,
      },
      domainDenyList: [],
      ports: [8089],
      auditLog: [],
    };

    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: defaultConfig,
    });
    (browser.contextualIdentities.query as jest.Mock).mockResolvedValue([]);
  });

  it("opens a default tab when no container is requested", async () => {
    const request: ServerMessageRequest = {
      cmd: "open-tab",
      url: "https://example.com",
      correlationId: "test-correlation-id",
    };

    (browser.tabs.create as jest.Mock).mockResolvedValue({
      id: 123,
      windowId: 7,
      index: 0,
      url: "https://example.com",
      title: "Example",
      active: false,
      pinned: false,
      cookieStoreId: "firefox-default",
    });

    await messageHandler.handleDecodedMessage(request);

    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: "https://example.com",
    });
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "opened-tab-id",
        correlationId: "test-correlation-id",
        tabId: 123,
        tab: expect.objectContaining({
          id: 123,
          cookieStoreId: "firefox-default",
          container: null,
        }),
      })
    );
  });

  it("opens a tab in a requested container by cookieStoreId", async () => {
    const request: ServerMessageRequest = {
      cmd: "open-tab",
      url: "https://example.com",
      container: "firefox-container-2",
      correlationId: "test-correlation-id",
    };

    (browser.contextualIdentities.query as jest.Mock).mockResolvedValue([
      {
        cookieStoreId: "firefox-container-2",
        name: "Work",
        color: "blue",
        colorCode: "#37adff",
        icon: "briefcase",
      },
    ]);
    (browser.tabs.create as jest.Mock).mockResolvedValue({
      id: 123,
      windowId: 7,
      index: 0,
      url: "https://example.com",
      title: "Example",
      active: false,
      pinned: false,
      cookieStoreId: "firefox-container-2",
    });

    await messageHandler.handleDecodedMessage(request);

    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: "https://example.com",
      cookieStoreId: "firefox-container-2",
    });
  });

  it("opens a tab in a requested container by exact name", async () => {
    const request: ServerMessageRequest = {
      cmd: "open-tab",
      url: "https://example.com",
      container: "Work",
      correlationId: "test-correlation-id",
    };

    (browser.contextualIdentities.query as jest.Mock).mockResolvedValue([
      {
        cookieStoreId: "firefox-container-2",
        name: "Work",
        color: "blue",
        colorCode: "#37adff",
        icon: "briefcase",
      },
    ]);
    (browser.tabs.create as jest.Mock).mockResolvedValue({
      id: 123,
      windowId: 7,
      index: 0,
      url: "https://example.com",
      title: "Example",
      active: false,
      pinned: false,
      cookieStoreId: "firefox-container-2",
    });

    await messageHandler.handleDecodedMessage(request);

    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: "https://example.com",
      cookieStoreId: "firefox-container-2",
    });
  });

  it("rejects an unknown container", async () => {
    const request: ServerMessageRequest = {
      cmd: "open-tab",
      url: "https://example.com",
      container: "Unknown",
      correlationId: "test-correlation-id",
    };

    (browser.contextualIdentities.query as jest.Mock).mockResolvedValue([
      {
        cookieStoreId: "firefox-container-2",
        name: "Work",
        color: "blue",
        colorCode: "#37adff",
        icon: "briefcase",
      },
    ]);

    await expect(messageHandler.handleDecodedMessage(request)).rejects.toThrow(
      'Unknown container "Unknown"'
    );
  });

  it("rejects an ambiguous container name", async () => {
    const request: ServerMessageRequest = {
      cmd: "open-tab",
      url: "https://example.com",
      container: "work",
      correlationId: "test-correlation-id",
    };

    (browser.contextualIdentities.query as jest.Mock).mockResolvedValue([
      {
        cookieStoreId: "firefox-container-2",
        name: "Work",
        color: "blue",
        colorCode: "#37adff",
        icon: "briefcase",
      },
      {
        cookieStoreId: "firefox-container-3",
        name: "WORK",
        color: "green",
        colorCode: "#51cd00",
        icon: "circle",
      },
    ]);

    await expect(messageHandler.handleDecodedMessage(request)).rejects.toThrow(
      'Container name "work" is ambiguous'
    );
  });

  it("returns container-enriched tabs", async () => {
    const request: ServerMessageRequest = {
      cmd: "get-tab-list",
      correlationId: "test-correlation-id",
    };

    (browser.tabs.query as jest.Mock).mockResolvedValue([
      {
        id: 123,
        windowId: 2,
        index: 4,
        url: "https://example.com",
        title: "Example",
        active: false,
        pinned: true,
        cookieStoreId: "firefox-container-2",
      },
      {
        id: 124,
        windowId: 2,
        index: 5,
        url: "https://mozilla.org",
        title: "Mozilla",
        active: true,
        pinned: false,
        cookieStoreId: "firefox-default",
      },
    ]);
    (browser.contextualIdentities.query as jest.Mock).mockResolvedValue([
      {
        cookieStoreId: "firefox-container-2",
        name: "Work",
        color: "blue",
        colorCode: "#37adff",
        icon: "briefcase",
      },
    ]);

    await messageHandler.handleDecodedMessage(request);

    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "tabs",
      correlationId: "test-correlation-id",
      tabs: [
        expect.objectContaining({
          id: 123,
          cookieStoreId: "firefox-container-2",
          container: expect.objectContaining({
            name: "Work",
            cookieStoreId: "firefox-container-2",
          }),
        }),
        expect.objectContaining({
          id: 124,
          cookieStoreId: "firefox-default",
          container: null,
        }),
      ],
    });
  });

  it("activates a tab and focuses its window", async () => {
    const request: ServerMessageRequest = {
      cmd: "activate-tab",
      tabId: 123,
      correlationId: "test-correlation-id",
    };

    (browser.tabs.update as jest.Mock).mockResolvedValue({
      id: 123,
      windowId: 7,
      index: 1,
      url: "https://example.com",
      title: "Example",
      active: true,
      pinned: false,
      cookieStoreId: "firefox-default",
    });
    (browser.tabs.get as jest.Mock).mockResolvedValue({
      id: 123,
      url: "https://example.com",
    });

    await messageHandler.handleDecodedMessage(request);

    expect(browser.tabs.update).toHaveBeenCalledWith(123, { active: true });
    expect(browser.windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "activated-tab",
        correlationId: "test-correlation-id",
        tabId: 123,
        windowId: 7,
      })
    );
  });

  it("lists containers in a stable shape", async () => {
    const request: ServerMessageRequest = {
      cmd: "get-container-list",
      correlationId: "test-correlation-id",
    };

    (browser.contextualIdentities.query as jest.Mock).mockResolvedValue([
      {
        cookieStoreId: "firefox-container-2",
        name: "Work",
        color: "blue",
        colorCode: "#37adff",
        icon: "briefcase",
      },
      {
        cookieStoreId: "firefox-container-3",
        name: "Personal",
        color: "green",
        colorCode: "#51cd00",
        icon: "circle",
      },
    ]);

    await messageHandler.handleDecodedMessage(request);

    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "containers",
      correlationId: "test-correlation-id",
      containers: [
        {
          cookieStoreId: "firefox-container-3",
          name: "Personal",
          color: "green",
          colorCode: "#51cd00",
          icon: "circle",
        },
        {
          cookieStoreId: "firefox-container-2",
          name: "Work",
          color: "blue",
          colorCode: "#37adff",
          icon: "briefcase",
        },
      ],
    });
  });

  it("rejects disabled commands for new tools", async () => {
    const disabledConfig: ExtensionConfig = {
      secret: "test-secret",
      toolSettings: {
        "open-browser-tab": true,
        "close-browser-tabs": true,
        "get-list-of-open-tabs": true,
        "activate-browser-tab": false,
        "list-browser-containers": true,
        "get-recent-browser-history": true,
        "get-tab-web-content": true,
        "reorder-browser-tabs": true,
        "find-highlight-in-browser-tab": true,
      },
      domainDenyList: [],
      ports: [8089],
      auditLog: [],
    };
    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: disabledConfig,
    });

    const request: ServerMessageRequest = {
      cmd: "activate-tab",
      tabId: 123,
      correlationId: "test-correlation-id",
    };

    await expect(messageHandler.handleDecodedMessage(request)).rejects.toThrow(
      "Command 'activate-tab' is disabled in extension settings"
    );
  });

  it("keeps rejecting non-https tab URLs", async () => {
    const request: ServerMessageRequest = {
      cmd: "open-tab",
      url: "http://example.com",
      correlationId: "test-correlation-id",
    };

    await expect(messageHandler.handleDecodedMessage(request)).rejects.toThrow(
      "Invalid URL"
    );
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it("keeps rejecting deny-listed domains when opening tabs", async () => {
    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: {
        secret: "test-secret",
        toolSettings: {
          "open-browser-tab": true,
          "close-browser-tabs": true,
          "get-list-of-open-tabs": true,
          "activate-browser-tab": true,
          "list-browser-containers": true,
          "get-recent-browser-history": true,
          "get-tab-web-content": true,
          "reorder-browser-tabs": true,
          "find-highlight-in-browser-tab": true,
        },
        domainDenyList: ["example.com"],
        ports: [8089],
        auditLog: [],
      },
    });

    const request: ServerMessageRequest = {
      cmd: "open-tab",
      url: "https://example.com",
      correlationId: "test-correlation-id",
    };

    await expect(messageHandler.handleDecodedMessage(request)).rejects.toThrow(
      "Domain in user defined deny list"
    );
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it("closes tabs by id", async () => {
    const request: ServerMessageRequest = {
      cmd: "close-tabs",
      tabIds: [123, 456],
      correlationId: "test-correlation-id",
    };

    await messageHandler.handleDecodedMessage(request);

    expect(browser.tabs.remove).toHaveBeenCalledWith([123, 456]);
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "tabs-closed",
      correlationId: "test-correlation-id",
    });
  });

  it("searches browser history and filters entries without URLs", async () => {
    const request: ServerMessageRequest = {
      cmd: "get-browser-recent-history",
      searchQuery: "test",
      correlationId: "test-correlation-id",
    };

    (browser.history.search as jest.Mock).mockResolvedValue([
      { url: "https://example.com", title: "Example" },
      { title: "No URL" },
    ]);

    await messageHandler.handleDecodedMessage(request);

    expect(browser.history.search).toHaveBeenCalledWith({
      text: "test",
      maxResults: 200,
      startTime: 0,
    });
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "history",
      correlationId: "test-correlation-id",
      historyItems: [{ url: "https://example.com", title: "Example" }],
    });
  });

  it("uses an empty history query by default", async () => {
    const request: ServerMessageRequest = {
      cmd: "get-browser-recent-history",
      correlationId: "test-correlation-id",
    };

    (browser.history.search as jest.Mock).mockResolvedValue([]);

    await messageHandler.handleDecodedMessage(request);

    expect(browser.history.search).toHaveBeenCalledWith({
      text: "",
      maxResults: 200,
      startTime: 0,
    });
  });

  it("gets tab web content after URL permission is granted", async () => {
    const request: ServerMessageRequest = {
      cmd: "get-tab-content",
      tabId: 123,
      correlationId: "test-correlation-id",
    };

    (browser.tabs.get as jest.Mock).mockResolvedValue({
      id: 123,
      url: "https://example.com",
    });
    (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
    (browser.tabs.executeScript as jest.Mock).mockResolvedValue([
      {
        links: [{ url: "https://example.com/page", text: "Page" }],
        fullText: "Page content",
        isTruncated: false,
        totalLength: 12,
      },
    ]);

    await messageHandler.handleDecodedMessage(request);

    expect(browser.permissions.contains).toHaveBeenCalledWith({
      origins: ["https://example.com/*"],
    });
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "tab-content",
      tabId: 123,
      correlationId: "test-correlation-id",
      isTruncated: false,
      fullText: "Page content",
      links: [{ url: "https://example.com/page", text: "Page" }],
      totalLength: 12,
    });
  });

  it("rejects tab web content for deny-listed domains", async () => {
    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: {
        secret: "test-secret",
        toolSettings: {
          "open-browser-tab": true,
          "close-browser-tabs": true,
          "get-list-of-open-tabs": true,
          "activate-browser-tab": true,
          "list-browser-containers": true,
          "get-recent-browser-history": true,
          "get-tab-web-content": true,
          "reorder-browser-tabs": true,
          "find-highlight-in-browser-tab": true,
        },
        domainDenyList: ["example.com"],
        ports: [8089],
        auditLog: [],
      },
    });
    (browser.tabs.get as jest.Mock).mockResolvedValue({
      id: 123,
      url: "https://example.com",
    });

    const request: ServerMessageRequest = {
      cmd: "get-tab-content",
      tabId: 123,
      correlationId: "test-correlation-id",
    };

    await expect(messageHandler.handleDecodedMessage(request)).rejects.toThrow(
      "Domain in tab URL is in the deny list"
    );
    expect(browser.tabs.executeScript).not.toHaveBeenCalled();
  });

  it("reorders tabs by requested order", async () => {
    const request: ServerMessageRequest = {
      cmd: "reorder-tabs",
      tabOrder: [123, 456, 789],
      correlationId: "test-correlation-id",
    };

    await messageHandler.handleDecodedMessage(request);

    expect(browser.tabs.move).toHaveBeenCalledTimes(3);
    expect(browser.tabs.move).toHaveBeenNthCalledWith(1, 123, { index: 0 });
    expect(browser.tabs.move).toHaveBeenNthCalledWith(2, 456, { index: 1 });
    expect(browser.tabs.move).toHaveBeenNthCalledWith(3, 789, { index: 2 });
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "tabs-reordered",
      correlationId: "test-correlation-id",
      tabOrder: [123, 456, 789],
    });
  });

  it("finds and highlights matching text in a tab", async () => {
    const request: ServerMessageRequest = {
      cmd: "find-highlight",
      tabId: 123,
      queryPhrase: "test",
      correlationId: "test-correlation-id",
    };

    (browser.tabs.get as jest.Mock).mockResolvedValue({
      id: 123,
      url: "https://example.com",
    });
    (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
    (browser.find.find as jest.Mock).mockResolvedValue({ count: 5 });

    await messageHandler.handleDecodedMessage(request);

    expect(browser.find.find).toHaveBeenCalledWith("test", {
      tabId: 123,
      caseSensitive: true,
    });
    expect(browser.tabs.update).toHaveBeenCalledWith(123, { active: true });
    expect(browser.find.highlightResults).toHaveBeenCalledWith({
      tabId: 123,
    });
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "find-highlight-result",
      correlationId: "test-correlation-id",
      noOfResults: 5,
    });
  });

  it("does not activate or highlight when text is absent", async () => {
    const request: ServerMessageRequest = {
      cmd: "find-highlight",
      tabId: 123,
      queryPhrase: "test",
      correlationId: "test-correlation-id",
    };

    (browser.tabs.get as jest.Mock).mockResolvedValue({
      id: 123,
      url: "https://example.com",
    });
    (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
    (browser.find.find as jest.Mock).mockResolvedValue({ count: 0 });

    await messageHandler.handleDecodedMessage(request);

    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.find.highlightResults).not.toHaveBeenCalled();
    expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
      resource: "find-highlight-result",
      correlationId: "test-correlation-id",
      noOfResults: 0,
    });
  });
});
