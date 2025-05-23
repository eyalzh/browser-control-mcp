/**
 * Configuration management for Browser Control MCP extension
 */

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
    name: "Reorder Browser Tabs",
    description: "Allows the MCP server to change the order of your browser tabs"
  },
  {
    id: "find-highlight-in-browser-tab",
    name: "Find and Highlight in Browser Tab",
    description: "Allows the MCP server to search for and highlight text in web pages"
  }
];

// Map command names to tool IDs
export const COMMAND_TO_TOOL_ID: Record<string, string> = {
  "open-tab": "open-browser-tab",
  "close-tabs": "close-browser-tabs",
  "get-tab-list": "get-list-of-open-tabs",
  "get-browser-recent-history": "get-recent-browser-history",
  "get-tab-content": "get-tab-web-content",
  "reorder-tabs": "reorder-browser-tabs",
  "find-highlight": "find-highlight-in-browser-tab"
};

// Storage schema for tool settings
export interface ToolSettings {
  [toolId: string]: boolean;
}

// Extended config interface
export interface ExtensionConfig {
  secret: string;
  toolSettings?: ToolSettings;
  domainDenyList?: string[];
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
  const configObj = await browser.storage.local.get("config");
  const config: ExtensionConfig = configObj.config || { secret: "" };
  
  // Initialize toolSettings if it doesn't exist
  if (!config.toolSettings) {
    config.toolSettings = getDefaultToolSettings();
  }
  
  return config;
}

/**
 * Saves the extension configuration to storage
 * @param config The configuration to save
 * @returns A Promise that resolves when the configuration is saved
 */
export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await browser.storage.local.set({ config });
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
  const config = await getConfig();
  config.secret = crypto.randomUUID();
  await saveConfig(config);
  return config.secret;
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
export async function isCommandAllowed(command: string): Promise<boolean> {
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
  const config = await getConfig();
  
  // Update the setting
  if (!config.toolSettings) {
    config.toolSettings = getDefaultToolSettings();
  }
  config.toolSettings[toolId] = enabled;
  
  // Save back to storage
  await saveConfig(config);
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
  const config = await getConfig();
  config.domainDenyList = domains;
  await saveConfig(config);
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
