import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserAPI } from "./browser-api";

const mcpServer = new McpServer({
  name: "BrowserControl",
  version: "1.2.0",
});

mcpServer.tool(
  "open-browser-tab",
  "Open a new tab in the user's browser",
  { url: z.string() },
  async ({ url }) => {
    const openedTabId = await browserApi.openTab(url);
    if (openedTabId !== undefined) {
      return {
        content: [
          {
            type: "text",
            text: `${url} opened in tab id ${openedTabId}`,
          },
        ],
      };
    } else {
      return { content: [{ type: "text", text: "Failed to open tab" }] };
    }
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
  "Get the list of open tabs in the user's browser",
  {},
  async () => {
    const openTabs = await browserApi.getTabList();
    if (openTabs) {
      return {
        content: openTabs.map((tab) => ({
          type: "text",
          text: `tab id=${tab.id}, tab url=${tab.url}, tab title=${tab.title}`,
        })),
      };
    } else {
      return {
        content: [{ type: "text", text: "Failed to get list of open tabs" }],
      };
    }
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
    if (browserHistory) {
      return {
        content: browserHistory.map((item) => {
          return {
            type: "text",
            text: `url=${item.url}, title="${item.title}", lastVisitTime=${item.lastVisitTime}`,
          };
        }),
      };
    } else {
      // If nothing was found for the search query, hint the AI to list
      // all the recent history items instead.
      const hint = searchQuery ? "Try without a searchQuery" : "";
      return { content: [{ type: "text", text: `No history found. ${hint}` }] };
    }
  }
);

mcpServer.tool(
  "get-tab-web-content",
  "Get the full text content of the webpage and the list of links in the webpage, by tab ID",
  { tabId: z.number() },
  async ({ tabId }) => {
    const content = await browserApi.getTabContent(tabId);
    if (content) {
      const links: { type: "text"; text: string }[] = content.links.map(
        (link) => {
          return {
            type: "text",
            text: `Link text: ${link.text}, Link URL: ${link.url}`,
          };
        }
      );
      return {
        content: [...links, { type: "text", text: content.fullText }],
      };
    } else {
      return {
        content: [{ type: "text", text: "No content found" }],
      };
    }
  }
);

mcpServer.tool(
  "reorder-browser-tabs",
  "Change the order of open browser tabs",
  { tabOrder: z.array(z.number()) },
  async ({ tabOrder }) => {
    const newOrder = await browserApi.reorderTabs(tabOrder);
    if (newOrder) {
      return {
        content: [
          { type: "text", text: `Tabs reordered: ${newOrder.join(", ")}` },
        ],
      };
    } else {
      return {
        content: [{ type: "text", text: "Failed to reorder tabs" }],
      };
    }
  }
);

mcpServer.tool(
  "find-highlight-in-browser-tab",
  "Find and highlight text in a browser tab",
  { tabId: z.number(), queryPhrase: z.string() },
  async ({ tabId, queryPhrase }) => {
    const noOfResults = await browserApi.findHighlight(tabId, queryPhrase);
    if (noOfResults !== undefined) {
      return {
        content: [
          {
            type: "text",
            text: `Number of results found and highlighted in the tab: ${noOfResults}`,
          },
        ],
      };
    } else {
      return {
        content: [{ type: "text", text: "Failed to find and highlight text" }],
      };
    }
  }
);

const browserApi = new BrowserAPI();
browserApi
  .init()
  .then((port) => {
    console.error("Browser API initialized on port", port);
  })
  .catch((err) => {
    console.error("Browser API init error", err);
    process.exit(1);
  });

const transport = new StdioServerTransport();
mcpServer
  .connect(transport)
  .then(() => {
    console.error("MCP Server running on stdio");
  })
  .catch((err) => {
    console.error("MCP Server connection error", err);
    process.exit(1);
  });

process.stdin.on("close", () => {
  console.error("MCP Server closed");
  browserApi.close();
  mcpServer.close();
  process.exit(0);
});
