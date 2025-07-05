# Browser Control MCP
[![smithery badge](https://smithery.ai/badge/@eyalzh/browser-control-mcp)](https://smithery.ai/server/@eyalzh/browser-control-mcp)

An MCP server paired with a browser extension that enables AI agents, such as Claude Desktop, to manage the user's local browser, to interact with open tabs and to use the browser for research and information retrieval.

## Features

The MCP server supports the following tools:
- Open or close tabs
- Get the list of opened tabs
- Reorder opened tabs
- Read and search the browser's history
- Read a webpage's text content and links (requires user consent)
- Find and highlight text in a browser tab

In addition, the contents of each opened tab in the browser is available as an MCP resource, allowing the user
to select browser tabs in the MCP client itself (e.g. Claude) and load their content into the context.

## Example use-cases:

### Tab management
- *"Close all non-work related tabs in my browser."*
- *"Rearrange tabs in my browser in an order that makes sense."*
- *"Close all tabs in my browser that haven't been accessed within the past 24 hours"*

### Browser history search
- *"Help me find an article in my browser history about the Milford track in NZ."*
- *"Open all the articles about AI that I visited during the last week, up to 10 articles, avoid duplications."*

### Browsing and research 
- *"Open hackernews in my browser, then open the top story, read it, also read the comments. Do the comments agree with the story?"*
- *"In my browser, use Google Scholar to search for papers about L-theanine in the last 3 years. Open the 3 most cited papers. Read them and summarize them for me."*
- *"Use google search in my browser to look for flower shops. Open the 10 most relevant results. Show me a table of each flower shop with location and opening hours."*

## Comparison to web automation MCP servers

The purpose of this MCP server is to provide AI agents with safe access to the user's **personal** browser. It does not support web pages modification or arbitrary scripting. By default, accessing the content of a webpage will require the user's explicit consent on the browser side, for each domain. The browser extension can also be configured to limit the actions that the MCP server can perform (in the extension's preferences page).

## Installation

### Installing via Smithery

To install Browser Control MCP for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@eyalzh/browser-control-mcp):

```bash
npx -y @smithery/cli install @eyalzh/browser-control-mcp --client claude
```

Clone this repository, then run the following commands in the main repository directory to build both the MCP server and the browser extension.
```
npm install
npm install --prefix mcp-server
npm install --prefix firefox-extension
npm run build
```

### Usage with Firefox

The browser-control-mcp extension was developed for Firefox.

To install the extension:

1. Type `about:debugging` in the Firefox URL bar
2. Click on "This Firefox"
3. click on "Load Temporary Add-on..."
4. Select the `manifest.json` file under the `firefox-extension` folder in this project
5. The extension's preferences page will open. Copy the secret key to your clipboard. It will be used to configure the MCP server.

If you prefer not to run the extension on your personal Firefox browser, an alternative is to download a separate Firefox instance (such as Firefox Developer Edition, available at https://www.mozilla.org/en-US/firefox/developer/).


### Usage with Claude Desktop

#### Option 1: Install with .dxt file
Claude Desktop now supports Desktop Extension packages (.dxt).
To install this MCP server as a Desktop Extension, download and open [mcp-server-v1.3.1d.dxt](https://github.com/eyalzh/browser-control-mcp/releases/download/v1.3.1d/mcp-server-v1.3.1d.dxt). Make sure to enable the extension after installing it on Claude Desktop.

#### Option 2: Install with MCP server configuration
After installing the browser extension, add the following configuration to `claude_desktop_config.json` (use the Edit Config button in Claude Desktop Developer settings):
```
{
    "mcpServers": {
        "browser-control": {
            "command": "node",
            "args": [
                "/path/to/repo/mcp-server/dist/server.js"
            ],
            "env": {
                "EXTENSION_SECRET": "<secret_from_extension>"
            }
        }
    }
}
```
Replace `/path/to/repo` with the correct path.

Set the EXTENSION_SECRET based on the value provided on the extension's preferences in the extension management page in Firefox (you can access it from `about:addons`). You can also set the EXTENSION_PORT environment variable to specify the port that the MCP server will use to communicate with the extension (default is 8089).

Make sure to restart Claude Desktop. It might take a few seconds for the MCP server to connect to the extension.

