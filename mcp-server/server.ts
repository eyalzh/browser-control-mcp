import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserAPI } from "./browser-api";
import type { BrowserContainer, BrowserTab } from "@browser-control-mcp/common";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const mcpServer = new McpServer({
  name: "BrowserControl",
  version: "1.5.1",
});

const browserApi = new BrowserAPI();

function describeContainer(tab: BrowserTab): string {
  if (tab.container) {
    return `${tab.container.name} (${tab.container.cookieStoreId})`;
  }
  return "default";
}

function describeLastAccessed(lastAccessed?: number): string {
  if (!lastAccessed) {
    return "unknown";
  }
  return dayjs(lastAccessed).fromNow();
}

function filterTabsByContainer(
  tabs: BrowserTab[],
  requestedContainer?: string
): BrowserTab[] {
  const candidate = requestedContainer?.trim();
  if (!candidate) {
    return tabs;
  }

  if (candidate === "default") {
    return tabs.filter(
      (tab) => tab.container === null || tab.container === undefined
    );
  }

  return tabs.filter((tab) => {
    if (!tab.container) {
      return false;
    }
    return (
      tab.container.cookieStoreId === candidate ||
      tab.container.name === candidate ||
      tab.container.name.toLowerCase() === candidate.toLowerCase()
    );
  });
}

function renderTabLine(tab: BrowserTab): string {
  return [
    `tab id=${tab.id}`,
    `window id=${tab.windowId}`,
    `index=${tab.index}`,
    `tab url=${tab.url}`,
    `tab title=${tab.title}`,
    `container=${describeContainer(tab)}`,
    `active=${tab.active ? "yes" : "no"}`,
    `pinned=${tab.pinned ? "yes" : "no"}`,
    `last accessed=${describeLastAccessed(tab.lastAccessed)}`,
  ].join(", ");
}

function renderContainerLine(container: BrowserContainer): string {
  return [
    `container name=${container.name}`,
    `cookieStoreId=${container.cookieStoreId}`,
    `color=${container.color}`,
    `icon=${container.icon}`,
  ].join(", ");
}

mcpServer.tool(
  "open-browser-tab",
  "Open a new tab in the user's browser. Optionally choose a Firefox container by exact name or cookieStoreId.",
  {
    url: z.string(),
    container: z.string().optional(),
  },
  async ({ url, container }) => {
    const openedTab = await browserApi.openTab(url, container);
    if (openedTab.tabId !== undefined) {
      const details = openedTab.tab
        ? ` in ${describeContainer(openedTab.tab)}`
        : "";
      return {
        content: [
          {
            type: "text",
            text: `${url} opened in tab id ${openedTab.tabId}${details}`,
          },
        ],
        structuredContent: {
          tabId: openedTab.tabId,
          tab: openedTab.tab ?? null,
        },
      };
    }
    return {
      content: [{ type: "text", text: "Failed to open tab", isError: true }],
    };
  }
);

mcpServer.tool(
  "close-browser-tabs",
  "Close tabs in the user's browser by tab IDs",
  { tabIds: z.array(z.number()) },
  async ({ tabIds }) => {
    await browserApi.closeTabs(tabIds);
    return {
      content: [{ type: "text", text: "Closed tabs" }],
    };
  }
);

mcpServer.tool(
  "get-list-of-open-tabs",
  "Get the list of open tabs in the user's browser. Use offset and limit parameters for pagination when there are many tabs.",
  {
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Starting index for pagination (0-based, must be >= 0)"),
    limit: z
      .number()
      .default(100)
      .describe("Maximum number of tabs to return (default: 100, max: 500)"),
    container: z
      .string()
      .optional()
      .describe("Optional Firefox container name or cookieStoreId filter"),
    windowId: z
      .number()
      .int()
      .optional()
      .describe("Optional browser window ID filter"),
    activeOnly: z
      .boolean()
      .default(false)
      .describe("If true, return only active tabs"),
  },
  async ({ offset, limit, container, windowId, activeOnly }) => {
    const effectiveLimit = Math.min(Math.max(1, limit), 500);

    let openTabs = await browserApi.getTabList();
    openTabs = filterTabsByContainer(openTabs, container);

    if (windowId !== undefined) {
      openTabs = openTabs.filter((tab) => tab.windowId === windowId);
    }
    if (activeOnly) {
      openTabs = openTabs.filter((tab) => tab.active);
    }

    const totalTabs = openTabs.length;
    const paginatedTabs = openTabs.slice(offset, offset + effectiveLimit);
    const hasMore = offset + effectiveLimit < totalTabs;

    const paginationInfo = {
      type: "text" as const,
      text:
        `Showing tabs ${offset + 1}-${offset + paginatedTabs.length} ` +
        `of ${totalTabs} total tabs` +
        (hasMore ? ` (use offset=${offset + effectiveLimit} to see more)` : ""),
    };

    return {
      content: [
        paginationInfo,
        ...paginatedTabs.map((tab) => ({
          type: "text" as const,
          text: renderTabLine(tab),
        })),
      ],
      structuredContent: {
        tabs: paginatedTabs,
        total: totalTabs,
        offset,
        limit: effectiveLimit,
        hasMore,
      },
    };
  }
);

mcpServer.tool(
  "activate-browser-tab",
  "Activate an open browser tab and focus its window",
  { tabId: z.number() },
  async ({ tabId }) => {
    const activatedTab = await browserApi.activateTab(tabId);
    return {
      content: [
        {
          type: "text",
          text: `Activated tab id ${activatedTab.tabId} in window ${activatedTab.windowId}`,
        },
      ],
      structuredContent: {
        tabId: activatedTab.tabId,
        windowId: activatedTab.windowId,
        tab: activatedTab.tab ?? null,
      },
    };
  }
);

mcpServer.tool(
  "list-browser-containers",
  "List Firefox containers with both human names and cookieStoreId values",
  {},
  async () => {
    const containers = await browserApi.getContainerList();
    return {
      content: containers.map((container) => ({
        type: "text" as const,
        text: renderContainerLine(container),
      })),
      structuredContent: {
        containers,
      },
    };
  }
);

mcpServer.tool(
  "get-recent-browser-history",
  "Get the list of recent browser history (to get all, don't use searchQuery)",
  { searchQuery: z.string().optional() },
  async ({ searchQuery }) => {
    const browserHistory = await browserApi.getBrowserRecentHistory(
      searchQuery
    );
    if (browserHistory.length > 0) {
      return {
        content: browserHistory.map((item) => {
          let lastVisited = "unknown";
          if (item.lastVisitTime) {
            lastVisited = dayjs(item.lastVisitTime).fromNow();
          }
          return {
            type: "text" as const,
            text: `url=${item.url}, title="${item.title}", lastVisitTime=${lastVisited}`,
          };
        }),
      };
    }
    const hint = searchQuery ? "Try without a searchQuery" : "";
    return { content: [{ type: "text", text: `No history found. ${hint}` }] };
  }
);

mcpServer.tool(
  "get-tab-web-content",
  `
    Get the full text content of the webpage and the list of links in the webpage, by tab ID.
    Use "offset" only for larger documents when the first call was truncated and if you require more content in order to assist the user.
  `,
  { tabId: z.number(), offset: z.number().default(0) },
  async ({ tabId, offset }) => {
    const content = await browserApi.getTabContent(tabId, offset);
    let links: { type: "text"; text: string }[] = [];
    if (offset === 0) {
      links = content.links.map((link: { text: string; url: string }) => {
        return {
          type: "text",
          text: `Link text: ${link.text}, Link URL: ${link.url}`,
        };
      });
    }

    let text = content.fullText;
    let hint: { type: "text"; text: string }[] = [];
    if (content.isTruncated || offset > 0) {
      const rangeString = `${offset}-${offset + text.length}`;
      hint = [
        {
          type: "text",
          text:
            `The following text content is truncated due to size (includes character range ${rangeString} out of ${content.totalLength}). ` +
            "If you want to read characters beyond this range, please use the 'get-tab-web-content' tool with an offset. ",
        },
      ];
    }

    return {
      content: [...hint, { type: "text", text }, ...links],
    };
  }
);

mcpServer.tool(
  "reorder-browser-tabs",
  "Change the order of open browser tabs",
  { tabOrder: z.array(z.number()) },
  async ({ tabOrder }) => {
    const newOrder = await browserApi.reorderTabs(tabOrder);
    return {
      content: [
        { type: "text", text: `Tabs reordered: ${newOrder.join(", ")}` },
      ],
    };
  }
);

mcpServer.tool(
  "find-highlight-in-browser-tab",
  "Find and highlight text in a browser tab (use a query phrase that exists in the web content)",
  { tabId: z.number(), queryPhrase: z.string() },
  async ({ tabId, queryPhrase }) => {
    const noOfResults = await browserApi.findHighlight(tabId, queryPhrase);
    return {
      content: [
        {
          type: "text",
          text: `Number of results found and highlighted in the tab: ${noOfResults}`,
        },
      ],
    };
  }
);

mcpServer.tool(
  "group-browser-tabs",
  "Organize opened browser tabs in a new tab group",
  {
    tabIds: z.array(z.number()),
    isCollapsed: z.boolean().default(false),
    groupColor: z
      .enum([
        "grey",
        "blue",
        "red",
        "yellow",
        "green",
        "pink",
        "purple",
        "cyan",
        "orange",
      ])
      .default("grey"),
    groupTitle: z.string().default("New Group"),
  },
  async ({ tabIds, isCollapsed, groupColor, groupTitle }) => {
    const groupId = await browserApi.groupTabs(
      tabIds,
      isCollapsed,
      groupColor,
      groupTitle
    );
    return {
      content: [
        {
          type: "text",
          text: `Created tab group "${groupTitle}" with ${tabIds.length} tabs (group ID: ${groupId})`,
        },
      ],
    };
  }
);

browserApi.init().catch((err) => {
  console.error("Browser API init error", err);
  process.exit(1);
});

const transport = new StdioServerTransport();
mcpServer.connect(transport).catch((err) => {
  console.error("MCP Server connection error", err);
  process.exit(1);
});

process.stdin.on("close", () => {
  browserApi.close();
  mcpServer.close();
  process.exit(0);
});
