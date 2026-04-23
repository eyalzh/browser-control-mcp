export interface ExtensionMessageBase {
  resource: string;
  correlationId: string;
}

export interface BrowserContainer {
  cookieStoreId: string;
  name: string;
  color: string;
  colorCode?: string;
  icon: string;
}

export interface TabContentExtensionMessage extends ExtensionMessageBase {
  resource: "tab-content";
  tabId: number;
  fullText: string;
  isTruncated: boolean;
  totalLength: number;
  links: { url: string; text: string }[];
}

export interface BrowserTab {
  id?: number;
  windowId?: number;
  index?: number;
  url?: string;
  title?: string;
  lastAccessed?: number;
  active?: boolean;
  pinned?: boolean;
  cookieStoreId?: string;
  container?: BrowserContainer | null;
}

export interface TabsExtensionMessage extends ExtensionMessageBase {
  resource: "tabs";
  tabs: BrowserTab[];
}

export interface OpenedTabIdExtensionMessage extends ExtensionMessageBase {
  resource: "opened-tab-id";
  tabId: number | undefined;
  tab?: BrowserTab;
}

export interface ActivatedTabExtensionMessage extends ExtensionMessageBase {
  resource: "activated-tab";
  tabId: number | undefined;
  windowId: number | undefined;
  tab?: BrowserTab;
}

export interface ContainersExtensionMessage extends ExtensionMessageBase {
  resource: "containers";
  containers: BrowserContainer[];
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

export interface TabsClosedExtensionMessage extends ExtensionMessageBase {
  resource: "tabs-closed";
}

export interface TabGroupCreatedExtensionMessage extends ExtensionMessageBase {
  resource: "new-tab-group";
  groupId: number;
}

export type ExtensionMessage =
  | TabContentExtensionMessage
  | TabsExtensionMessage
  | OpenedTabIdExtensionMessage
  | ActivatedTabExtensionMessage
  | ContainersExtensionMessage
  | BrowserHistoryExtensionMessage
  | ReorderedTabsExtensionMessage
  | FindHighlightExtensionMessage
  | TabsClosedExtensionMessage
  | TabGroupCreatedExtensionMessage;

export interface ExtensionError {
  correlationId: string;
  errorMessage: string;
}
