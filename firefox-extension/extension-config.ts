/**
 * Configuration management for Browser Control MCP extension
 */

import { ServerMessageRequest } from "@browser-control-mcp/common/server-messages";

const DEFAULT_WS_PORT = 8089;
const AUDIT_LOG_SIZE_LIMIT = 100; // Maximum number of audit log entries to keep

// Define all available tools with their IDs and descriptions
export interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

export const AVAILABLE_TOOLS: ToolInfo[] = [
  {
    id: "open-browser-tab",
    name: "Open Browser Tab",
    description: "Allows the MCP server to open new browser tabs"
  },
  {
    id: "close-browser-tabs",
    name: "Close Browser Tabs",
    description: "Allows the MCP server to close browser tabs"
  },
  {
    id: "get-list-of-open-tabs",
    name: "Get List of Open Tabs",
    description: "Allows the MCP server to get a list of all open tabs"
  },
  {
    id: "get-recent-browser-history",
    name: "Get Recent Browser History",
    description: "Allows the MCP server to access your recent browsing history"
  },
  {
    id: "get-tab-web-content",
    name: "Get Tab Web Content",
    description: "Allows the MCP server to read the content of web pages"
  },
  {
    id: "reorder-browser-tabs",
    name: "Reorder/Group Browser Tabs",
    description: "Allows the MCP server to reorder/group your browser tabs"
  },
  {
    id: "find-highlight-in-browser-tab",
    name: "Find and Highlight in Browser Tab",
    description: "Allows the MCP server to search for and highlight text in web pages"
  },
  {
    id: "capture-tab-screenshot",
    name: "Capture Tab Screenshot",
    description: "Allows the MCP server to capture a screenshot of a tab, after you authorize that tab with the toolbar button"
  }
];

// Map command names to tool IDs
export const COMMAND_TO_TOOL_ID: Record<ServerMessageRequest["cmd"], string> = {
  "open-tab": "open-browser-tab",
  "close-tabs": "close-browser-tabs",
  "get-tab-list": "get-list-of-open-tabs",
  "get-browser-recent-history": "get-recent-browser-history",
  "get-tab-content": "get-tab-web-content",
  "reorder-tabs": "reorder-browser-tabs",
  "find-highlight": "find-highlight-in-browser-tab",
  "group-tabs": "reorder-browser-tabs",
  "capture-screenshot": "capture-tab-screenshot",
};

// Storage schema for tool settings
export interface ToolSettings {
  [toolId: string]: boolean;
}

// Audit log entry interface
export interface AuditLogEntry {
  toolId: string;
  command: string;
  timestamp: number;
  url?: string;
}

// Extended config interface
export interface ExtensionConfig {
  secret: string;
  toolSettings?: ToolSettings;
  domainDenyList?: string[];
  ports: number[];
  auditLog?: AuditLogEntry[];
}

/**
 * Gets the default tool settings (all enabled)
 */
export function getDefaultToolSettings(): ToolSettings {
  const settings: ToolSettings = {};
  AVAILABLE_TOOLS.forEach(tool => {
    settings[tool.id] = true;
  });
  return settings;
}

/**
 * Gets the extension configuration from storage
 * @returns A Promise that resolves with the extension configuration
 */
export async function getConfig(): Promise<ExtensionConfig> {
  const stored = await browser.storage.local.get([
    "config", "secret", "ports", "domainDenyList", "auditLog",
    ...AVAILABLE_TOOLS.map(tool => toolStorageKey(tool.id)),
  ]);
  // Read older installations without rewriting the legacy object. Each new value
  // has its own storage key, so writes from different extension pages cannot
  // overwrite unrelated settings or restore a revoked permission.
  const legacy: Partial<ExtensionConfig> = stored.config || {};
  const toolSettings = { ...getDefaultToolSettings(), ...legacy.toolSettings };
  for (const tool of AVAILABLE_TOOLS) {
    const value = stored[toolStorageKey(tool.id)];
    if (typeof value === "boolean") toolSettings[tool.id] = value;
  }
  return {
    secret: stored.secret ?? legacy.secret ?? "",
    ports: stored.ports ?? legacy.ports ?? [DEFAULT_WS_PORT],
    domainDenyList: stored.domainDenyList ?? legacy.domainDenyList ?? [],
    auditLog: stored.auditLog ?? legacy.auditLog ?? [],
    toolSettings,
  };
}

function toolStorageKey(toolId: string): string {
  return `toolEnabled:${toolId}`;
}

/**
 * Gets the secret from storage
 * @returns A Promise that resolves with the secret
 */
export async function getSecret(): Promise<string> {
  const config = await getConfig();
  return config.secret;
}

/**
 * Generates a new secret and saves it to storage
 * @returns A Promise that resolves with the new secret
 */
export async function generateSecret(): Promise<string> {
  const secret = crypto.randomUUID();
  await browser.storage.local.set({ secret });
  return secret;
}

/**
 * Checks if a tool is enabled
 * @param toolId The ID of the tool to check
 * @returns A Promise that resolves with true if the tool is enabled, false otherwise
 */
export async function isToolEnabled(toolId: string): Promise<boolean> {
  const config = await getConfig();
  // Default to true if not explicitly set to false
  return config.toolSettings?.[toolId] !== false;
}

/**
 * Checks if a command is allowed based on the tool permissions
 * @param command The command to check
 * @returns A Promise that resolves with true if the command is allowed, false otherwise
 */
export async function isCommandAllowed(command: ServerMessageRequest["cmd"]): Promise<boolean> {
  const toolId = COMMAND_TO_TOOL_ID[command];
  if (!toolId) {
    console.error(`Unknown command: ${command}`);
    return false;
  }
  return isToolEnabled(toolId);
}

/**
 * Sets the enabled status of a tool
 * @param toolId The ID of the tool to update
 * @param enabled Whether the tool should be enabled
 * @returns A Promise that resolves when the setting is saved
 */
export async function setToolEnabled(toolId: string, enabled: boolean): Promise<void> {
  if (!AVAILABLE_TOOLS.some(tool => tool.id === toolId)) {
    throw new Error("Unknown tool");
  }
  await browser.storage.local.set({ [toolStorageKey(toolId)]: enabled });
}

/**
 * Gets all tool settings
 * @returns A Promise that resolves with the current tool settings
 */
export async function getAllToolSettings(): Promise<ToolSettings> {
  const config = await getConfig();
  return config.toolSettings || getDefaultToolSettings();
}

/**
 * Gets the domain deny list
 * @returns A Promise that resolves with the domain deny list
 */
export async function getDomainDenyList(): Promise<string[]> {
  const config = await getConfig();
  return config.domainDenyList || [];
}

/**
 * Sets the domain deny list
 * @param domains Array of domains to deny
 * @returns A Promise that resolves when the setting is saved
 */
export async function setDomainDenyList(domains: string[]): Promise<void> {
  await browser.storage.local.set({ domainDenyList: domains });
}

/**
 * Checks if a domain is in the deny list
 * @param url The URL to check
 * @returns A Promise that resolves with true if the domain is in the deny list, false otherwise
 */
export async function isDomainInDenyList(url: string): Promise<boolean> {
  try {
    // Extract the domain from the URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    // Get the deny list
    const denyList = await getDomainDenyList();
    
    // Check if the domain is in the deny list
    return denyList.some(deniedDomain => 
      domain.toLowerCase() === deniedDomain.toLowerCase() || 
      domain.toLowerCase().endsWith(`.${deniedDomain.toLowerCase()}`)
    );
  } catch (error) {
    console.error(`Error checking domain in deny list: ${error}`);
    // If there's an error parsing the URL, return false
    return false;
  }
}

/**
 * Gets the WebSocket ports list
 * @returns A Promise that resolves with the ports list
 */
export async function getPorts(): Promise<number[]> {
  const config = await getConfig();
  return config.ports || [DEFAULT_WS_PORT];
}

/**
 * Sets the WebSocket ports list
 * @param ports Array of port numbers
 * @returns A Promise that resolves when the setting is saved
 */
export async function setPorts(ports: number[]): Promise<void> {
  await browser.storage.local.set({ ports });
}

/**
 * Adds an entry to the audit log
 * @param entry The audit log entry to add
 * @returns A Promise that resolves when the entry is saved
 */
let auditWriteQueue: Promise<void> = Promise.resolve();

export function addAuditLogEntry(entry: AuditLogEntry): Promise<void> {
  const write = auditWriteQueue.then(async () => {
    const auditLog = [entry, ...await getAuditLog()].slice(0, AUDIT_LOG_SIZE_LIMIT);
    await browser.storage.local.set({ auditLog });
  });
  auditWriteQueue = write.catch(() => {});
  return write;
}

/**
 * Gets the audit log entries
 * @returns A Promise that resolves with the audit log entries
 */
export async function getAuditLog(): Promise<AuditLogEntry[]> {
  const stored = await browser.storage.local.get(["auditLog", "config"]);
  return stored.auditLog ?? stored.config?.auditLog ?? [];
}

/**
 * Clears the audit log
 * @returns A Promise that resolves when the audit log is cleared
 */
export async function clearAuditLog(): Promise<void> {
  await browser.storage.local.set({ auditLog: [] });
}

/**
 * Gets the tool name by tool ID
 * @param toolId The tool ID to look up
 * @returns The tool name or the tool ID if not found
 */
export function getToolNameById(toolId: string): string {
  const tool = AVAILABLE_TOOLS.find(t => t.id === toolId);
  return tool ? tool.name : toolId;
}
