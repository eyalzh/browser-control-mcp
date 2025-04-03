export interface ToolMessageBase {
  cmd: string;
}

export interface OpenTabToolMessage extends ToolMessageBase {
  cmd: "open-tab";
  url: string;
}

export interface CloseTabsToolMessage extends ToolMessageBase {
  cmd: "close-tabs";
  tabIds: number[];
}

export interface GetTabListToolMessage extends ToolMessageBase {
  cmd: "get-tab-list";
}

export interface GetBrowserRecentHistoryToolMessage extends ToolMessageBase {
  cmd: "get-browser-recent-history";
  searchQuery?: string;
}

export interface GetTabContentToolMessage extends ToolMessageBase {
  cmd: "get-tab-content";
  tabId: number;
}

export interface ReorderTabsToolMessage extends ToolMessageBase {
  cmd: "reorder-tabs";
  tabOrder: number[];
}

export interface FindHighlightToolMessage extends ToolMessageBase {
  cmd: "find-highlight";
  tabId: number;
  queryPhrase: string;
}

export type ToolMessage =
  | OpenTabToolMessage
  | CloseTabsToolMessage
  | GetTabListToolMessage
  | GetBrowserRecentHistoryToolMessage
  | GetTabContentToolMessage
  | ReorderTabsToolMessage
  | FindHighlightToolMessage;

export type ToolMessageRequest = ToolMessage & { correlationId: string };