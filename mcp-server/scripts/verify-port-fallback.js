#!/usr/bin/env node
// Manual verification for the multi-port fallback logic in BrowserAPI.init().
// Run after `npm run build`:
//   node mcp-server/scripts/verify-port-fallback.js
//
// Starts 4 BrowserAPI instances in-process against the same EXTENSION_PORT list.
// The first 3 should each claim a distinct free port; the 4th should fail with the
// aggregated "all ports busy" error. Uses a high, unlikely-to-collide port range
// rather than the real defaults (8089-8091), since a real server may already be
// running on this machine and using those ports (which is exactly the scenario
// this fallback logic is meant to handle).

const expectedPorts = [18089, 18090, 18091];
process.env.EXTENSION_SECRET = "verify-script-secret";
process.env.EXTENSION_PORT = expectedPorts.join(",");

const { BrowserAPI } = require("../dist/browser-api");

async function main() {
  const instances = [];
  let failures = 0;

  for (const expectedPort of expectedPorts) {
    const api = new BrowserAPI();
    await api.init();
    const actualPort = api.getSelectedPort();
    if (actualPort === expectedPort) {
      console.log(`OK: instance bound to port ${actualPort} as expected`);
    } else {
      console.error(
        `FAIL: expected port ${expectedPort}, got ${actualPort}`
      );
      failures++;
    }
    instances.push(api);
  }

  const fourth = new BrowserAPI();
  try {
    await fourth.init();
    console.error("FAIL: 4th instance was expected to fail to bind, but succeeded");
    failures++;
    instances.push(fourth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const mentionsAllPorts = expectedPorts.every((p) => message.includes(String(p)));
    const mentionsHint = message.includes("options page");
    if (mentionsAllPorts && mentionsHint) {
      console.log("OK: 4th instance failed with the expected aggregated error");
    } else {
      console.error(`FAIL: 4th instance error missing expected detail: ${message}`);
      failures++;
    }
  }

  for (const api of instances) {
    api.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unexpected error running verification script:", err);
  process.exit(1);
});
