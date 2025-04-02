const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Generate a random secret both the mcp server and the extension can use
// as a signature for the requests.
const secret = crypto.randomBytes(32).toString("hex");

const config = {
  secret,
};

const copyLocations = ["../firefox-extension/dist", "../mcp-server/dist"];

const jsonStr = JSON.stringify(config, null, 2);
for (const loc of copyLocations) {
  fs.writeFileSync(path.resolve(__dirname, loc + "/config.json"), jsonStr);
}
