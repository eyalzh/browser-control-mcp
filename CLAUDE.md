# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Installation
```bash
npm install  # Install all dependencies (includes subproject dependencies)
```

### Build
```bash
npm run build  # Build all projects using nx
```

### Individual project builds
```bash
# MCP Server
cd mcp-server && npm run build

# Firefox Extension  
cd firefox-extension && npm run build
```

### Test
```bash
cd firefox-extension && npm test
```

### Start MCP Server
```bash
cd mcp-server && npm start
```

### Package DXT
```bash
cd mcp-server && npm run pack-dxt
```

## Architecture

This is a monorepo with three main components:

1. **mcp-server**: Node.js MCP server that communicates with Claude Desktop and the browser extension via WebSocket
2. **firefox-extension**: Firefox browser extension that executes browser actions
3. **common**: Shared TypeScript interfaces for message passing between server and extension

### Communication Flow
- MCP Server ↔ Claude Desktop: MCP protocol over stdio
- MCP Server ↔ Firefox Extension: WebSocket with authentication via shared secret
- Extension uses Firefox WebExtensions API for browser control

### Key Files
- `mcp-server/server.ts`: Main MCP server with tool definitions
- `mcp-server/browser-api.ts`: WebSocket client for extension communication
- `firefox-extension/background.ts`: Extension background script
- `firefox-extension/message-handler.ts`: Handles server messages and executes browser actions
- `common/server-messages.ts`: Messages sent from server to extension
- `common/extension-messages.ts`: Messages sent from extension to server

### Authentication
The extension generates a random secret key that must be configured in the MCP server's environment as `EXTENSION_SECRET`. The server connects to the extension on port 8089 (configurable via `EXTENSION_PORT`).

### Development Notes
- Uses esbuild for extension bundling
- TypeScript throughout with shared interfaces
- Jest for testing (extension only)
- Nx for monorepo management
- Extension requires user consent for accessing webpage content by default