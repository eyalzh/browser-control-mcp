import { WebsocketClient } from "./client";
import { MessageHandler } from "./message-handler";
import { getConfig, generateSecret } from "./extension-config";

const WS_PORTS = [8081, 8082];

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
    for (const port of WS_PORTS) {
      initClient(port, secret);
    }
    console.log("Browser extension initialized");
  })
  .catch((error) => {
    console.error("Error initializing extension:", error);
  });
