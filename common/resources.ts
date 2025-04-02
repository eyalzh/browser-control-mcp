export interface ResourceMessageBase {
  resource: string;
  correlationId: string;
}

export interface TabContentResourceMessage extends ResourceMessageBase {
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

export interface TabsResourceMessage extends ResourceMessageBase {
  resource: "tabs";
  tabs: BrowserTab[];
}

export interface OpenedTabIdResourceMessage extends ResourceMessageBase {
  resource: "opened-tab-id";
  tabId: number | undefined;
}

export interface BrowserHistoryItem {
  url?: string;
  title?: string;
  lastVisitTime?: number;
}

export interface BrowserHistoryResourceMessage extends ResourceMessageBase {
  resource: "history";

  historyItems: BrowserHistoryItem[];
}

export type ResourceMessage =
  | TabContentResourceMessage
  | TabsResourceMessage
  | OpenedTabIdResourceMessage
  | BrowserHistoryResourceMessage;
