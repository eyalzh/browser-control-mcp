import type {
  ExtensionMessage,
  ServerMessageRequest,
} from "@browser-control-mcp/common";
import { getMessageSignature } from "./auth";

const WS_PORTS = [8081, 8082];

// config.json is generated by the main build process (root directory)
// and contains the secret key for the browser extension
const configUrl = browser.runtime.getURL("dist/config.json");

async function getConfig() {
  const response = await fetch(configUrl);

  if (!response.ok) {
    throw new Error(
      "Failed to load config.json - make sure to run the postbuild step in the root directory"
    );
  }
  const config = await response.json();
  return config;
}

function initWsClient(port: number, secret: string) {
  let socket: WebSocket | null = null;

  function connectWebSocket() {
    console.log("Connecting to WebSocket server");

    socket = new WebSocket(`ws://localhost:${port}`);

    socket.addEventListener("open", () => {
      console.log("Connected to WebSocket server at port", port);
    });

    socket.addEventListener("message", async (event) => {
      console.log("Message from server:", event.data);

      try {
        const signedMessage = JSON.parse(event.data);
        const messageSig = await getMessageSignature(
          JSON.stringify(signedMessage.payload),
          secret
        );
        if (messageSig.length === 0 || messageSig !== signedMessage.signature) {
          console.error("Invalid message signature");
          return;
        }
        handleDecodedMessage(signedMessage.payload);
      } catch (error) {
        console.error("Failed to parse message:", error);
      }
    });

    socket.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
      socket && socket.close();
    });
  }

  function handleDecodedMessage(req: ServerMessageRequest) {
    switch (req.cmd) {
      case "open-tab":
        openUrl(req.correlationId, req.url);
        break;
      case "close-tabs":
        closeTabs(req.tabIds);
        break;
      case "get-tab-list":
        sendTabs(req.correlationId);
        break;
      case "get-browser-recent-history":
        sendRecentHistory(req.correlationId, req.searchQuery);
        break;
      case "get-tab-content":
        sendTabsContent(req.correlationId, req.tabId, req.offset);
        break;
      case "reorder-tabs":
        reorderTabs(req.correlationId, req.tabOrder);
        break;
      case "find-highlight":
        findAndHighlightText(req.correlationId, req.tabId, req.queryPhrase);
        break;
      default:
        const _exhaustiveCheck: never = req;
        console.error("Invalid message received:", req);
    }
  }

  async function sendResourceToServer(resource: ExtensionMessage) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("Socket is not open");
      return;
    }
    const signedMessage = {
      payload: resource,
      signature: await getMessageSignature(JSON.stringify(resource), secret),
    };
    socket.send(JSON.stringify(signedMessage));
  }

  async function openUrl(correlationId: string, url: string) {
    if (!url.startsWith("https://")) {
      console.error("Invalid URL:", url);
      return;
    }

    const tab = await browser.tabs.create({
      url,
    });

    await sendResourceToServer({
      resource: "opened-tab-id",
      correlationId,
      tabId: tab.id,
    });
  }

  function closeTabs(tabIds: number[]) {
    browser.tabs
      .remove(tabIds)
      .then(() => {
        console.log(`Successfully closed ${tabIds.length} tabs`);
      })
      .catch((error) => {
        console.error(`Error closing tabs: ${error}`);
      });
  }

  function sendTabs(correlationId: string) {
    browser.tabs.query({}).then(async (tabs) => {
      await sendResourceToServer({
        resource: "tabs",
        correlationId,
        tabs,
      });
    });
  }

  function sendRecentHistory(
    correlationId: string,
    searchQuery: string | null = null
  ) {
    browser.history
      .search({
        text: searchQuery ?? "", // Search for all URLs (empty string matches everything)
        maxResults: 200, // Limit to 200 results
        startTime: 0, // Search from the beginning of time
      })
      .then(async (historyItems) => {
        const filteredHistoryItems = historyItems.filter((item) => {
          return !!item.url;
        });
        await sendResourceToServer({
          resource: "history",
          correlationId,
          historyItems: filteredHistoryItems,
        });
      })
      .catch((error) => {
        console.error(`Error fetching history: ${error}`);
      });
  }

  function sendTabsContent(
    correlationId: string,
    tabId: number,
    offset?: number
  ) {
    const MAX_CONTENT_LENGTH = 50_000;
    browser.tabs
      .executeScript(tabId, {
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
          let text = document.body.innerText.substring(${offset || 0});
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
      })
      .then(async (results) => {
        const { isTruncated, fullText, links, totalLength } = results[0];
        await sendResourceToServer({
          resource: "tab-content",
          tabId,
          correlationId,
          isTruncated,
          fullText,
          links,
          totalLength,
        });
      })
      .catch((error) => {
        console.error(
          "sendTabsContent for tab ID %s - Error executing script:",
          tabId,
          error
        );
      });
  }

  async function reorderTabs(correlationId: string, tabOrder: number[]) {
    // Reorder the tabs sequentially
    for (let newIndex = 0; newIndex < tabOrder.length; newIndex++) {
      const tabId = tabOrder[newIndex];
      try {
        await browser.tabs.move(tabId, { index: newIndex });
      } catch (error) {
        console.error(`Error moving tab ${tabId}: ${error}`);
      }
    }
    sendResourceToServer({
      resource: "tabs-reordered",
      correlationId,
      tabOrder,
    });
  }

  async function findAndHighlightText(
    correlationId: string,
    tabId: number,
    queryPhrase: string
  ) {
    const findResults = await browser.find.find(queryPhrase, {
      tabId,
      caseSensitive: true,
    });

    // If there are results, highlight them
    if (findResults.count > 0) {
      // But first, activate the tab. In firefox, this would also enable
      // auto-scrolling to the highlighted result.
      await browser.tabs.update(tabId, { active: true });
      browser.find.highlightResults({
        tabId,
      });
    }

    sendResourceToServer({
      resource: "find-highlight-result",
      correlationId,
      noOfResults: findResults.count,
    });
  }

  // Connect to WebSocket as soon as the extension loads
  connectWebSocket();

  // Try to connect every 2 seconds if the connection is closed
  setInterval(() => {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      connectWebSocket();
    }
  }, 2000);
}

getConfig()
  .then((config) => {
    const secret = config.secret;
    if (!secret) {
      console.error("Secret not found in config.json");
      return;
    }
    for (const port of WS_PORTS) {
      initWsClient(port, secret);
    }
    console.log("Browser extension initialized");
  })
  .catch((error) => {
    console.error("Error loading config.json:", error);
  });
