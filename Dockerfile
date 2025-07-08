FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY mcp-server/package*.json ./mcp-server/

# Copy common directory (shared dependency)
COPY common/ ./common/

# Set working directory to mcp-server for installation
WORKDIR /app/mcp-server

# Install dependencies
RUN npm install

# Copy mcp-server source code
COPY mcp-server/ ./

# Build mcp-server
RUN npm run build

# Set default port (EXTENSION_SECRET should be provided at runtime)
ENV EXTENSION_PORT=8089

# Expose port (default WebSocket port for extension communication)
EXPOSE 8089

# Start the MCP server
CMD ["npm", "start"]