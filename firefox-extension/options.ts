/**
 * Options page script for Browser Control MCP extension
 */
import {
  getSecret,
  AVAILABLE_TOOLS,
  getAllToolSettings,
  setToolEnabled,
  getDomainDenyList,
  setDomainDenyList,
} from "./extension-config";

const secretDisplay = document.getElementById(
  "secret-display"
) as HTMLDivElement;
const copyButton = document.getElementById("copy-button") as HTMLButtonElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const toolSettingsContainer = document.getElementById(
  "tool-settings-container"
) as HTMLDivElement;
const domainDenyListTextarea = document.getElementById(
  "domain-deny-list"
) as HTMLTextAreaElement;
const saveDomainListsButton = document.getElementById(
  "save-domain-lists"
) as HTMLButtonElement;
const domainStatusElement = document.getElementById(
  "domain-status"
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
  AVAILABLE_TOOLS.forEach((tool) => {
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
    // No status message displayed
  } catch (error) {
    console.error("Error saving tool setting:", error);

    // Revert the checkbox state
    checkbox.checked = !isEnabled;
  }
}

/**
 * Loads the domain lists from storage and displays them
 */
async function loadDomainLists() {
  try {
    // Load deny list
    const denyList = await getDomainDenyList();
    domainDenyListTextarea.value = denyList.join("\n");
  } catch (error) {
    console.error("Error loading domain lists:", error);
    domainStatusElement.textContent =
      "Error loading domain lists. Please check console for details.";
    domainStatusElement.style.color = "red";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Saves the domain lists to storage
 */
async function saveDomainLists(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    // Parse deny list (split by newlines and filter out empty lines)
    const denyListText = domainDenyListTextarea.value.trim();
    const denyList = denyListText
      ? denyListText
          .split("\n")
          .map((domain) => domain.trim())
          .filter(Boolean)
      : [];

    // Save to storage
    await setDomainDenyList(denyList);

    // Show success message
    domainStatusElement.textContent = "Domain deny list saved successfully!";
    domainStatusElement.style.color = "#4caf50";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  } catch (error) {
    console.error("Error saving domain lists:", error);
    domainStatusElement.textContent = "Failed to save domain lists";
    domainStatusElement.style.color = "red";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Initializes the collapsible sections
 */
function initializeCollapsibleSections() {
  const sectionHeaders = document.querySelectorAll(".section-container > h2");

  sectionHeaders.forEach((header) => {
    // Add click event listener to toggle section visibility
    header.addEventListener("click", (event) => {
      event.preventDefault();

      // Toggle the collapsed class on the header
      header.classList.toggle("collapsed");

      // Toggle the collapsed class on the section content
      const sectionContent = header.nextElementSibling as HTMLElement;
      sectionContent.classList.toggle("collapsed");
    });
  });
}

function showPermissionRequest(url: string) {
  const domain = new URL(url).hostname;
  const origin = new URL(url).origin;

  // Show the modal and hide the main content
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  const domainElement = document.getElementById("permission-domain") as HTMLDivElement;
  const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;

  // Set the domain in the modal
  domainElement.textContent = domain;

  // Show modal and blur main content
  modal.classList.remove("hidden");
  mainContent.classList.add("modal-open");

  // Handle grant permission button click
  const handleGrant = async () => {
    try {
      const granted = await browser.permissions.request({
        origins: [`${origin}/*`],
      });

      if (granted) {
        // Permission granted, close the window or redirect back
        window.close();
      } else {
        // Permission denied, hide modal and show main content
        hidePermissionModal();
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      hidePermissionModal();
    }
  };

  // Handle cancel button click
  const handleCancel = () => {
    hidePermissionModal();
  };

  // Add event listeners
  grantBtn.addEventListener("click", handleGrant);
  cancelBtn.addEventListener("click", handleCancel);

  // Store references to remove listeners later
  (window as any).permissionHandlers = {
    handleGrant,
    handleCancel,
    grantBtn,
    cancelBtn
  };
}

function hidePermissionModal() {
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;

  // Hide modal and restore main content
  modal.classList.add("hidden");
  mainContent.classList.remove("modal-open");

  // Clean up event listeners
  const handlers = (window as any).permissionHandlers;
  if (handlers) {
    handlers.grantBtn.removeEventListener("click", handlers.handleGrant);
    handlers.cancelBtn.removeEventListener("click", handlers.handleCancel);
    delete (window as any).permissionHandlers;
  }
}

// Initialize the page
copyButton.addEventListener("click", copyToClipboard);
saveDomainListsButton.addEventListener("click", saveDomainLists);
document.addEventListener("DOMContentLoaded", () => {
  loadSecret();
  createToolSettingsUI();
  loadDomainLists();
  initializeCollapsibleSections();

  // Ensure modal is hidden by default
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  modal.classList.add("hidden");
  mainContent.classList.remove("modal-open");

  const params = new URLSearchParams(window.location.search);
  const requestUrl = params.get("requestUrl");

  if (requestUrl) {
    // Show UI for requesting permission for this specific URL
    showPermissionRequest(requestUrl);
  }
});
