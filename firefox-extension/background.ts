import { WebsocketClient } from "./client";
import { MessageHandler } from "./message-handler";
import { getConfig, generateSecret } from "./extension-config";
import {
  grantCaptureConsent,
  revokeCaptureConsent,
  showConsentGrantedFeedback,
} from "./capture-consent";

function initClient(port: number, secret: string) {
  const wsClient = new WebsocketClient(port, secret);
  const messageHandler = new MessageHandler(wsClient);

  wsClient.connect();

  wsClient.addMessageListener(async (message) => {
    console.log("Message from server:", message);

    try {
      await messageHandler.handleDecodedMessage(message);
    } catch (error) {
      console.error("Error handling message:", error);
      if (error instanceof Error) {
        await wsClient.sendErrorToServer(message.correlationId, error.message);
      }
    }
  });
}

// Clicking the toolbar button is what makes Firefox grant "activeTab" for that tab, which is
// the permission screenshot capture runs on. Track the grant so the message handler can tell
// the server whether a capture will be allowed, and follow the browser in dropping it when the
// tab navigates or closes.
function initCaptureConsentTracking() {
  browser.browserAction.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) {
      return;
    }
    grantCaptureConsent(tab.id, tab.url);
    await showConsentGrantedFeedback(tab.id);
  });

  browser.tabs.onUpdated.addListener(
    (tabId) => {
      revokeCaptureConsent(tabId);
    },
    { properties: ["url"] }
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    revokeCaptureConsent(tabId);
  });
}

async function initExtension() {
  let config = await getConfig();
  if (!config.secret) {
    console.log("No secret found, generating new one");
    await generateSecret();
    // Open the options page to allow the user to view the config:
    await browser.runtime.openOptionsPage();
    config = await getConfig();
  }
  return config;
}

initExtension()
  .then((config) => {
    const secret = config.secret;

    if (!secret) {
      console.error("Secret not found in storage - reinstall extension");
      return;
    }
    const portList = config.ports;
    if (portList.length === 0) {
      console.error("No ports configured in extension config");
      return;
    }
    for (const port of portList) {
      initClient(port, secret);
    }
    initCaptureConsentTracking();
    console.log("Browser extension initialized");
  })
  .catch((error) => {
    console.error("Error initializing extension:", error);
  });
