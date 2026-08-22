/**
 * Per-tab user consent for screenshot capture.
 *
 * Screenshots go through browser.tabs.captureVisibleTab(), which Firefox gates on either
 * the <all_urls> host permission or "activeTab". This extension deliberately uses activeTab:
 * the browser grants it only for the tab the user clicked the toolbar button on, and revokes
 * it as soon as that tab navigates or closes. Consent is therefore enforced by the browser,
 * per tab, rather than by a broad host permission.
 *
 * There is no API to ask whether an activeTab grant is still held, so this module mirrors its
 * lifetime: the map below is a prediction of what the browser will allow, used to fail fast
 * with an actionable message instead of a raw permission error. The browser stays the
 * enforcer -- if the prediction is wrong, captureVisibleTab() throws.
 */

const CONSENT_BADGE_TEXT = "✓";
const REQUEST_BADGE_TEXT = "!";
const CONSENT_BADGE_COLOR = "#2b8a3e";
const REQUEST_BADGE_COLOR = "#e8590c";
const CONSENT_BADGE_TIMEOUT_MS = 2500;

interface CaptureConsent {
  // URL at the time of the grant. activeTab does not survive navigation, so a change here
  // means the grant is gone even if we never saw the tabs.onUpdated event.
  url?: string;
  grantedAt: number;
}

const consentByTabId = new Map<number, CaptureConsent>();

export function grantCaptureConsent(tabId: number, url?: string): void {
  consentByTabId.set(tabId, { url, grantedAt: Date.now() });
}

export function revokeCaptureConsent(tabId: number): void {
  consentByTabId.delete(tabId);
}

export function hasCaptureConsent(tabId: number, currentUrl?: string): boolean {
  const consent = consentByTabId.get(tabId);
  if (!consent) {
    return false;
  }
  if (currentUrl && consent.url && currentUrl !== consent.url) {
    consentByTabId.delete(tabId);
    return false;
  }
  return true;
}

/**
 * Marks the toolbar button on a specific tab so the user can see which tab is waiting
 * for authorization. Badge state is per-tab and disappears with the tab.
 */
export async function markTabAsAwaitingConsent(tabId: number): Promise<void> {
  await setBadge(tabId, REQUEST_BADGE_TEXT, REQUEST_BADGE_COLOR);
}

/**
 * Confirms to the user that their click registered, then clears the badge.
 */
export async function showConsentGrantedFeedback(tabId: number): Promise<void> {
  await setBadge(tabId, CONSENT_BADGE_TEXT, CONSENT_BADGE_COLOR);
  setTimeout(() => {
    void clearBadge(tabId);
  }, CONSENT_BADGE_TIMEOUT_MS);
}

async function setBadge(
  tabId: number,
  text: string,
  color: string
): Promise<void> {
  try {
    await browser.browserAction.setBadgeText({ text, tabId });
    await browser.browserAction.setBadgeBackgroundColor({ color, tabId });
  } catch (error) {
    // The tab may have closed in the meantime - badge state is cosmetic, so don't fail
    // the capture over it.
    console.error("Failed to set browser action badge:", error);
  }
}

async function clearBadge(tabId: number): Promise<void> {
  try {
    await browser.browserAction.setBadgeText({ text: "", tabId });
  } catch (error) {
    console.error("Failed to clear browser action badge:", error);
  }
}
