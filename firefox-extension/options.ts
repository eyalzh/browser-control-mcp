/**
 * Options page script for Browser Control MCP extension
 */
import { 
  getSecret, 
  AVAILABLE_TOOLS, 
  getAllToolSettings, 
  setToolEnabled 
} from "./extension-config";

const secretDisplay = document.getElementById(
  "secret-display"
) as HTMLDivElement;
const copyButton = document.getElementById("copy-button") as HTMLButtonElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const toolSettingsContainer = document.getElementById(
  "tool-settings-container"
) as HTMLDivElement;

/**
 * Loads the secret from storage and displays it
 */
async function loadSecret() {
  try {
    const secret = await getSecret();

    // Check if secret exists
    if (secret) {
      secretDisplay.textContent = secret;
    } else {
      secretDisplay.textContent =
        "No secret found. Please reinstall the extension.";
      secretDisplay.style.color = "red";
      copyButton.disabled = true;
    }
  } catch (error) {
    console.error("Error loading secret:", error);
    secretDisplay.textContent =
      "Error loading secret. Please check console for details.";
    secretDisplay.style.color = "red";
    copyButton.disabled = true;
  }
}

/**
 * Copies the secret to clipboard
 */
async function copyToClipboard(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }
  try {
    const secret = secretDisplay.textContent;
    if (
      !secret ||
      secret === "Loading..." ||
      secret.includes("No secret found") ||
      secret.includes("Error loading")
    ) {
      return;
    }

    await navigator.clipboard.writeText(secret);

    // Show success message
    statusElement.textContent = "Secret copied to clipboard!";
    setTimeout(() => {
      statusElement.textContent = "";
    }, 3000);
  } catch (error) {
    console.error("Error copying to clipboard:", error);
    statusElement.textContent = "Failed to copy to clipboard";
    statusElement.style.color = "red";
    setTimeout(() => {
      statusElement.textContent = "";
      statusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Creates the tool settings UI
 */
async function createToolSettingsUI() {
  const toolSettings = await getAllToolSettings();
  
  // Clear existing content
  toolSettingsContainer.innerHTML = "";
  
  // Create a toggle switch for each tool
  AVAILABLE_TOOLS.forEach(tool => {
    const isEnabled = toolSettings[tool.id] !== false; // Default to true if not set
    
    const toolRow = document.createElement("div");
    toolRow.className = "tool-row";
    
    const labelContainer = document.createElement("div");
    labelContainer.className = "tool-label-container";
    
    const toolName = document.createElement("div");
    toolName.className = "tool-name";
    toolName.textContent = tool.name;
    
    const toolDescription = document.createElement("div");
    toolDescription.className = "tool-description";
    toolDescription.textContent = tool.description;
    
    labelContainer.appendChild(toolName);
    labelContainer.appendChild(toolDescription);
    
    const toggleContainer = document.createElement("label");
    toggleContainer.className = "toggle-switch";
    
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isEnabled;
    checkbox.dataset.toolId = tool.id;
    checkbox.addEventListener("change", handleToolToggle);
    
    const slider = document.createElement("span");
    slider.className = "slider";
    
    toggleContainer.appendChild(checkbox);
    toggleContainer.appendChild(slider);
    
    toolRow.appendChild(labelContainer);
    toolRow.appendChild(toggleContainer);
    
    toolSettingsContainer.appendChild(toolRow);
  });
}

/**
 * Handles toggling a tool on/off
 */
async function handleToolToggle(event: Event) {
  const checkbox = event.target as HTMLInputElement;
  const toolId = checkbox.dataset.toolId;
  const isEnabled = checkbox.checked;
  
  if (!toolId) {
    console.error("Tool ID not found");
    return;
  }
  
  try {
    await setToolEnabled(toolId, isEnabled);
    
    // Show success message
    statusElement.textContent = `${isEnabled ? "Enabled" : "Disabled"} ${toolId}`;
    statusElement.style.color = "#4caf50";
    setTimeout(() => {
      statusElement.textContent = "";
      statusElement.style.color = "";
    }, 3000);
  } catch (error) {
    console.error("Error saving tool setting:", error);
    statusElement.textContent = "Failed to save setting";
    statusElement.style.color = "red";
    setTimeout(() => {
      statusElement.textContent = "";
      statusElement.style.color = "";
    }, 3000);
    
    // Revert the checkbox state
    checkbox.checked = !isEnabled;
  }
}

// Initialize the page
copyButton.addEventListener("click", copyToClipboard);
document.addEventListener("DOMContentLoaded", () => {
  loadSecret();
  createToolSettingsUI();
});
