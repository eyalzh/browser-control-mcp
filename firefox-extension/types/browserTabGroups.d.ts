// See: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups/update
// This is a partial type representation of the browser.tabGroups API.

declare namespace browser.tabGroups {
  type Color =
    | "blue"
    | "cyan"
    | "grey"
    | "green"
    | "orange"
    | "pink"
    | "purple"
    | "red"
    | "yellow";

  interface TabGroup {
    id: number;
  }

  interface GroupUpdateProperties {
    collapsed?: boolean;
    color?: Color;
    title?: string;
  }

  function update(
    groupId: number,
    updateProperties: GroupUpdateProperties
  ): Promise<TabGroup>;
}

declare namespace browser.tabs {
  interface GroupOptions {
    tabIds: number[];
  }

  function group(options: GroupOptions): Promise<number>;
}
