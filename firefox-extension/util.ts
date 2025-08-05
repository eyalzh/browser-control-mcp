
  export function formatBookmarksAsText(
    bookmarks: browser.bookmarks.BookmarkTreeNode[],
    isTree: boolean,
    level: number = 0,
    parentPrefix: string = ""
  ): string {
    let result = "";
    let counter = 1;

    for (const bookmark of bookmarks) {
      const indent = "  ".repeat(level);
      let prefix: string;
      
      if (isTree) {
        // Create hierarchical numbering like 1., 1.1, 1.2, 2., 2.1, etc.
        const currentNumber = level === 0 ? `${counter}` : `${parentPrefix}.${counter}`;
        prefix = `${currentNumber}.`;
      } else {
        prefix = "-";
      }
      
      if (bookmark.type === "folder") {
        result += `${indent}${prefix} [Folder] ${bookmark.title}\n`;
        if (bookmark.children && bookmark.children.length > 0) {
          const childPrefix = level === 0 ? `${counter}` : `${parentPrefix}.${counter}`;
          result += formatBookmarksAsText(bookmark.children, isTree, level + 1, childPrefix);
        }
      } else if (bookmark.type === "bookmark") {
        result += `${indent}${prefix} ${bookmark.title}`;
        if (bookmark.url) {
          result += ` - ${bookmark.url}`;
        }
        result += "\n";
      }
      
      counter++;
    }

    return result;
  }