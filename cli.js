#!/usr/bin/env node
const { execSync } = require("child_process");
const { existsSync } = require("fs");
const { join } = require("path");

const bundle = join(__dirname, "mcp-server", "dist", "bin.js");

if (!existsSync(bundle)) {
  console.error("Building MCP server bundle...");
  execSync("npm install --prefix mcp-server && npm run build --prefix mcp-server", {
    cwd: __dirname,
    stdio: "inherit",
  });
}

require(bundle);
