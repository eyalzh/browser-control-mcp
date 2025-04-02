# AI-supported contribution types

## Adding a new tool

### Context

- common/tools.ts
- common/resources.ts
- mcp-server/browser-api.ts
- server.ts
- firefox-extension/background.ts

### Prompt

Let's add a new feature to the MCP WS server as well as support for it in the extension.

The feature will allow to {add feature info}, similar to the {add most similar other feature already in the code}.

1. Add the tool message interface in `tools.ts`, with a unique "cmd" as well as any other information that the browser would need.
2. If the tool relies on information provided by the browser, add the resource message interface in `resources.ts` including all the information that the browser will provide.
3. If the tool involves fetching info from the browser, then add a new EphemeralMap in `browser-api.ts` which will map the info from the correlationId.
4. Update `handleDecodedResourceMessage` in `browser-api.ts` such that it writes to the new EphemeralMap when the resource returns from the extension.
5. Add a new method in `browser-api.ts` that sends the tool message to the extension, waits for response and then returns the info from the EphemeralMap.
6. Add a new `mcpServer.tool` in `server.js` that include the required parameters from the MCP client and that calls the browser API and returns the info back to the client (format should be similar to other tools).
7. In `background.ts`, add a new function that uses the browser API to fulfill the feature, sending back the resource info to the WS server if needed, using the correlationId
8. In `background.ts`, update `handleDecodedMessage` to support the new tool.
