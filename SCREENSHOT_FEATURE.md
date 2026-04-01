# Screenshot Feature for Browser Control MCP

This branch adds screenshot capture functionality to browser-control-mcp, allowing AI assistants to capture visual snapshots of browser tabs.

## New Feature

### `capture-browser-screenshot` Tool

Captures a screenshot of a browser tab and saves it to a temporary file.

**Parameters:**
- `tabId` (optional): The ID of the tab to capture. If not provided, captures the currently active tab.

**Returns:**
- Success: Path to the saved screenshot file and MCP resource URI
- Error: Error message if capture fails

## Implementation Details

### Changes Made:

1. **MCP Server (`mcp-server/`)**:
   - Added new tool `capture-browser-screenshot` in `server.ts`
   - Added `captureTabScreenshot` method in `browser-api.ts`
   - Screenshots are saved to system temp directory with timestamp

2. **Firefox Extension (`firefox-extension/`)**:
   - Added `captureScreenshot` handler in `message-handler.ts`
   - Uses Firefox's `browser.tabs.captureVisibleTab` API
   - Added `<all_urls>` permission in `manifest.json` for screenshot capability

3. **Common Types (`common/`)**:
   - Added `CaptureScreenshotServerMessage` in `server-messages.ts`
   - Added `CaptureScreenshotExtensionMessage` in `extension-messages.ts`

## Usage Example

```typescript
// In Claude Desktop or other MCP client
const result = await mcpClient.callTool("capture-browser-screenshot", {
  // tabId is optional - omit to capture active tab
});

// Result includes file path:
// "Screenshot captured and saved to: /tmp/browser-control-mcp-screenshots/screenshot-1234567890.png"
```

## Security Considerations

- Screenshots are saved to a temporary directory that's cleaned up by the OS
- The extension requires the `<all_urls>` permission to capture screenshots
- Each screenshot request is logged in the extension's audit log
- No screenshots are transmitted over the network - they're saved locally

## Testing

1. Build the project: `npm run build`
2. Load the extension in Firefox/Zen browser
3. Configure Claude Desktop with the MCP server
4. Test the screenshot tool on various websites

## Future Enhancements

- Add full-page screenshot capability (currently captures visible viewport only)
- Add options for different image formats (JPEG, WebP)
- Add ability to capture specific page elements by selector
- Add screenshot preview in the extension's audit log