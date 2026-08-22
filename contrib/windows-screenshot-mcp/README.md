# Windows Screenshot/Control MCP (optional companion)

> **Heads-up — this is intentionally outside the Browser Control security model.**
> Browser Control MCP is deliberately *read-mostly*: it cannot script pages, inject
> input, or capture pixels, and every content read needs per-domain consent. This
> companion does the opposite — it screenshots windows and synthesizes mouse/keyboard
> input at the **OS level**. It is offered as a separate, opt-in helper for users who
> specifically need screenshots and input automation on Windows (e.g. driving legacy
> Flash/HTML5 content that only renders in Firefox). It is **not** wired into the
> extension and does **not** use its consent mechanism. Use only on your own machine.

A small, self-contained MCP server (Windows only) that automates a desktop window via
PowerShell + .NET (`System.Windows.Forms` / `System.Drawing`). No browser extension and
no network are involved.

## Why this exists

The extension-based design can't return screenshots (by design — capturing pixels and
injecting input aren't part of the secure model). Some workflows still need to *see* a
rendered tab and step through it (for example, content that renders only in Firefox).
This companion fills that gap at the OS level, kept clearly separate so it never weakens
the extension's guarantees.

## Tools

| Tool | Purpose |
|---|---|
| `list_windows` | List visible top-level window titles. |
| `focus_window` | Bring a window whose title contains a substring to the foreground. |
| `screenshot` | Focus a window by title substring and capture it as a PNG (optional window-relative crop `x,y,w,h`). |
| `press_keys` | Send keystrokes to the focused window (.NET `SendKeys` syntax, e.g. `{RIGHT}`, `{ENTER}`, `^{TAB}`). |
| `click` | Left-click at window-relative coordinates (optional double-click). |

## Requirements

- Windows with PowerShell (built in).
- Node.js 18+.

## Install & run

```bash
cd contrib/windows-screenshot-mcp
npm install
node server.js
```

## MCP client configuration

```json
{
  "mcpServers": {
    "windows-screenshot": {
      "command": "node",
      "args": ["/absolute/path/to/contrib/windows-screenshot-mcp/server.js"]
    }
  }
}
```

## Limitations & safety

- **Windows only** (uses Win32 APIs via PowerShell).
- Captures the **entire window** unless a crop region is given — be mindful of anything
  else visible in that window.
- Synthesizes real input to the foreground window; don't run it unattended on a machine
  where stray clicks/keys could cause harm.
- Coordinates for `click` are window-relative (top-left origin), matching what `screenshot` returns.
