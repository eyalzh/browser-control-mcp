import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserAPI } from "./browser-api";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { promises as fs } from "fs";
import path from "path";
import { URL } from "url";

dayjs.extend(relativeTime);

function generateFilenameFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    // Create filename from hostname and pathname
    let filename = parsedUrl.hostname.replace(/\./g, '_');
    
    // Add sanitized pathname if it exists and isn't just '/'
    if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
      const pathname = parsedUrl.pathname
        .replace(/^\//g, '') // Remove leading slash
        .replace(/\/$/g, '') // Remove trailing slash
        .replace(/[^a-zA-Z0-9-_]/g, '_'); // Replace special chars with underscore
      if (pathname) {
        filename += '_' + pathname;
      }
    }
    
    // Add timestamp to ensure uniqueness
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    filename += '_' + timestamp + '.txt';
    
    return filename;
  } catch (error) {
    // Fallback for invalid URLs
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    return `webpage_${timestamp}.txt`;
  }
}

const mcpServer = new McpServer({
  name: "BrowserControl",
  version: "1.5.1",
});

mcpServer.tool(
  "open-browser-tab",
  "Open a new tab in the user's browser (useful when the user asks to open a website)",
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
      return {
        content: [{ type: "text", text: "Failed to open tab", isError: true }],
      };
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
  "Get the list of open tabs in the user's browser. Use offset and limit parameters for pagination when there are many tabs.",
  {
    offset: z.number().int().min(0).default(0).describe("Starting index for pagination (0-based, must be >= 0)"),
    limit: z.number().default(100).describe("Maximum number of tabs to return (default: 100, max: 500)"),
  },
  async ({ offset, limit }) => {
    // Validate and cap the limit
    const effectiveLimit = Math.min(Math.max(1, limit), 500);

    const openTabs = await browserApi.getTabList();
    const totalTabs = openTabs.length;

    // Apply pagination
    const paginatedTabs = openTabs.slice(offset, offset + effectiveLimit);
    const hasMore = offset + effectiveLimit < totalTabs;

    // Add pagination info as the first content item
    const paginationInfo = {
      type: "text" as const,
      text: `Showing tabs ${offset + 1}-${offset + paginatedTabs.length} of ${totalTabs} total tabs${hasMore ? ` (use offset=${offset + effectiveLimit} to see more)` : ''}`,
    };

    const tabContent = paginatedTabs.map((tab) => {
      let lastAccessed = "unknown";
      if (tab.lastAccessed) {
        lastAccessed = dayjs(tab.lastAccessed).fromNow(); // LLM-friendly time ago
      }
      return {
        type: "text" as const,
        text: `tab id=${tab.id}, tab url=${tab.url}, tab title=${tab.title}, last accessed=${lastAccessed}`,
      };
    });

    return {
      content: [paginationInfo, ...tabContent],
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
            lastVisited = dayjs(item.lastVisitTime).fromNow(); // LLM-friendly time ago
          }
          return {
            type: "text",
            text: `url=${item.url}, title="${item.title}", lastVisitTime=${lastVisited}`,
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
  `
    Get the full text content of the webpage and the list of links in the webpage, by tab ID. 
    Use "offset" only for larger documents when the first call was truncated and if you require more content in order to assist the user.
  `,
  { tabId: z.number(), offset: z.number().default(0) },
  async ({ tabId, offset }) => {
    const content = await browserApi.getTabContent(tabId, offset);
    let links: { type: "text"; text: string }[] = [];
    if (offset === 0) {
      // Only include the links if offset is 0 (default value). Otherwise, we can
      // assume this is not the first call. Adding the links again would be redundant.
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
      // If the content is truncated, add a "tip" suggesting
      // that another tool, search in page, can be used to
      // discover additional data.
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

mcpServer.tool(
  "download-page-content",
  "Download webpage content to a file with a meaningful filename based on URL",
  { 
    tabId: z.number(),
    directory: z.string().optional().describe("Directory to save the file (defaults to current directory)"),
    fileName: z.string().optional().describe("Optional filename to save the content, otherwise generated from URL"),
  },
  async ({ tabId, directory, fileName }) => {
    // Get tab info first to get the URL
    const tabs = await browserApi.getTabList();
    const tab = tabs?.find(t => t.id === tabId);
    if (!tab) {
      return {
        content: [{ type: "text", text: `Tab with ID ${tabId} not found` }],
      };
    }
    
    // Get the content
    const content = await browserApi.getTabContent(tabId, 0);
    if (!content) {
      return {
        content: [{ type: "text", text: "No content found for the tab" }],
      };
    }
    
    try {
      // Generate filename from URL
      const filename = fileName || generateFilenameFromUrl(tab.url || 'unknown');
      const targetDir = directory || process.cwd();
      const filepath = path.join(targetDir, filename);
      
      // Prepare content with metadata
      const fileContent = `URL: ${tab.url}
Title: ${tab.title || 'Untitled'}
Downloaded: ${new Date().toISOString()}
================================================================================

${content.fullText}

================================================================================
LINKS FOUND ON PAGE:
================================================================================
${content.links.map((link: { text: string; url: string }) => `${link.text} -> ${link.url}`).join('\n')}`;
      
      // Write to file
      await fs.writeFile(filepath, fileContent, 'utf-8');
      
      return {
        content: [{ 
          type: "text", 
          text: `Downloaded content from ${tab.url} to ${filepath}` 
        }],
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: `Failed to download content: ${error instanceof Error ? error.message : 'Unknown error'}` 
        }],
      };
    }
  }
);

mcpServer.tool(
  "bulk-download",
  "Bulk download webpage content from multiple URLs to files",
  {
    downloads: z.array(z.object({
      url: z.string().describe("URL to download"),
      filename: z.string().describe("Filename to save the content")
    })).describe("Array of URLs and filenames to download"),
    directory: z.string().describe("Directory to save all files")
  },
  async ({ downloads, directory }) => {
    const results: Array<{ url: string; filename: string; status: string; filepath?: string; error?: string }> = [];
    
    // Ensure directory exists
    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: `Failed to create directory ${directory}: ${error instanceof Error ? error.message : 'Unknown error'}` 
        }],
      };
    }
    
    for (const download of downloads) {
      try {
        // Open tab for the URL
        const tabId = await browserApi.openTab(download.url);
        if (tabId === undefined) {
          results.push({
            url: download.url,
            filename: download.filename,
            status: "failed",
            error: "Failed to open tab"
          });
          continue;
        }
        
        // Wait a bit for the page to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get the content
        const content = await browserApi.getTabContent(tabId, 0);
        if (!content) {
          results.push({
            url: download.url,
            filename: download.filename,
            status: "failed",
            error: "No content found"
          });
          // Close the tab
          await browserApi.closeTabs([tabId]);
          continue;
        }
        
        // Get tab info for title
        const tabs = await browserApi.getTabList();
        const tab = tabs?.find(t => t.id === tabId);
        
        // Prepare content with metadata
        const fileContent = `URL: ${download.url}
Title: ${tab?.title || 'Untitled'}
Downloaded: ${new Date().toISOString()}
================================================================================

${content.fullText}

================================================================================
LINKS FOUND ON PAGE:
================================================================================
${content.links.map((link: { text: string; url: string }) => `${link.text} -> ${link.url}`).join('\n')}`;
        
        // Write to file
        const filepath = path.join(directory, download.filename);
        await fs.writeFile(filepath, fileContent, 'utf-8');
        
        results.push({
          url: download.url,
          filename: download.filename,
          status: "success",
          filepath: filepath
        });
        
        // Close the tab
        await browserApi.closeTabs([tabId]);
        
      } catch (error) {
        results.push({
          url: download.url,
          filename: download.filename,
          status: "failed",
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    // Prepare summary
    const successful = results.filter(r => r.status === "success").length;
    const failed = results.filter(r => r.status === "failed").length;
    
    let summary = `Bulk download completed: ${successful} successful, ${failed} failed\n\n`;
    for (const result of results) {
      if (result.status === "success") {
        summary += `✓ ${result.url} → ${result.filepath}\n`;
      } else {
        summary += `✗ ${result.url} - Error: ${result.error}\n`;
      }
    }
    
    return {
      content: [{ type: "text", text: summary }],
    };
  }
);

const browserApi = new BrowserAPI();
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
