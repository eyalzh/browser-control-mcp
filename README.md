# Browser Control MCP

An MCP server paired with a browser extension that enables LLM clients, such as Claude Desktop, to control the user's local browser (Firefox).

## Features

The MCP server supports the following tools:
- Open or close tabs
- Get the list of opened tabs
- Reorder opened tabs
- Read and search the browser's history
- Read webpages text content and links
- Find and highlight text in a browser tab

## Example use-cases:

- *"Close all non-work related tabs in my browser."*
- *"Rearrange tabs in my browser in an order that makes sense."*
- *"Help me find an article in my browser history about the Milford track in NZ."*
- *"Open hackernews in my browser, then open the top story, read it, also read the comments. Do the comments agree with the story?"*
- *"In my browser, use Google Scholar to search for papers about L-theanine in the last 3 years. Open the 3 most cited works."*

## Installation

Clone this repository, then run the following commands to build both the MCP server and the browser extension.
```
npm install
npm install --prefix mcp-server
npm install --prefix firefox-extension
npm run build
```

The final `npm run build` command should be executed in the main repository directory, as it also generates a shared `config.json` file used by both the server and the extension.


### Usage with Claude Desktop:

Add the following configuration to `claude_desktop_config.json` (use the Edit Config button in Claude Desktop Developer settings):
```
{
    "mcpServers": {
        "browser-control": {
            "command": "node",
            "args": [
                "<path to repo>/mcp-server/dist/server.js"
            ]
        }
    }
}
```
Replace `<path to repo>` with the correct path.

Make sure to restart Claude Desktop. 


### Usage with Firefox

The browser-control-mcp extension was developed for Firefox.

To install the extension:

1. Type `about:debugging` in the Firefox URL bar
2. Click on "This Firefox"
3. click on "Load Temporary Add-on..."
4. Select the `manifest.json` file under the `firefox-extension` folder in this project

If you prefer not to run the extension on your personal Firefox browser, an alternative is to download a separate Firefox instance (such as Firefox Developer Edition, available at https://www.mozilla.org/en-US/firefox/developer/).
