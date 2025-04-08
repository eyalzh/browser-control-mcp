export interface ExtensionMessageBase {
  resource: string;
  correlationId: string;
}

export interface TabContentExtensionMessage extends ExtensionMessageBase {
  resource: "tab-content";
  tabId: number;
  fullText: string;
  links: { url: string; text: string }[];
}

export interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
}

export interface TabsExtensionMessage extends ExtensionMessageBase {
  resource: "tabs";
  tabs: BrowserTab[];
}

export interface OpenedTabIdExtensionMessage extends ExtensionMessageBase {
  resource: "opened-tab-id";
  tabId: number | undefined;
}

export interface BrowserHistoryItem {
  url?: string;
  title?: string;
  lastVisitTime?: number;
}

export interface BrowserHistoryExtensionMessage extends ExtensionMessageBase {
  resource: "history";

  historyItems: BrowserHistoryItem[];
}

export interface ReorderedTabsExtensionMessage extends ExtensionMessageBase {
  resource: "tabs-reordered";
  tabOrder: number[];
}

export interface FindHighlightExtensionMessage extends ExtensionMessageBase {
  resource: "find-highlight-result";
  noOfResults: number;
}

export type ExtensionMessage =
  | TabContentExtensionMessage
  | TabsExtensionMessage
  | OpenedTabIdExtensionMessage
  | BrowserHistoryExtensionMessage
  | ReorderedTabsExtensionMessage
  | FindHighlightExtensionMessage;
