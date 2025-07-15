# AI-supported contribution types

## Adding a new tool

### Context

- common/server-messages.ts
- common/extension-messages.ts
- mcp-server/browser-api.ts
- server.ts
- firefox-extension/message-handler.ts

### Prompt

Let's add a new feature to the MCP WS server as well as support for it in the extension.

The feature will allow to {add feature info}, similar to the {add most similar other feature already in the code}.

1. Add the server message interface in `server-messages.ts`, with a unique "cmd" as well as any other information that the browser would need.
2. If the tool relies on information provided by the browser, add the extension message interface in `extension-messages.ts` including all the information that the browser will provide.
3. Add a new method in `browser-api.ts` that sends the tool message to the extension, waits for response and then returns the relevant data.
4. Add a new `mcpServer.tool` in `server.js` that include the required parameters from the MCP client and that calls the browser API and returns the info back to the client (format should be similar to other tools).
5. In `message-handler.ts`, add a new function that uses the browser API to fulfill the feature, sending back the resource info to the WS server if needed, using the correlationId
6. In `message-handler.ts`, update `handleDecodedMessage` to support the new tool.
