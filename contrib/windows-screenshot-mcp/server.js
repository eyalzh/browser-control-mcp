// Self-contained OS-automation MCP server (Windows) for driving a browser window
// autonomously: window focus, screenshot, keypress, and click. Uses PowerShell +
// .NET (System.Windows.Forms / System.Drawing) — no extension, no network.
// Dependencies (@modelcontextprotocol/sdk, zod) are declared in this folder's package.json.
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

function ps(script) {
  // Run a PowerShell script, return stdout (utf8). Throws on failure.
  return execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
}

// Shared C# helpers (window enum, focus, cursor, mouse, capture).
const CS = `
using System;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> Found = new List<IntPtr>();
  public static IntPtr FindByTitle(string sub) {
    IntPtr res = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h); if (len == 0) return true;
      StringBuilder sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity);
      string t = sb.ToString();
      if (t.IndexOf(sub, StringComparison.OrdinalIgnoreCase) >= 0) { res = h; return false; }
      return true;
    }, IntPtr.Zero);
    return res;
  }
  public static string ListTitles() {
    StringBuilder outp = new StringBuilder();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h); if (len == 0) return true;
      StringBuilder sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity);
      outp.Append(sb.ToString()).Append("\\n");
      return true;
    }, IntPtr.Zero);
    return outp.ToString();
  }
  public const int SW_RESTORE = 9;
  public const uint LEFTDOWN = 0x2, LEFTUP = 0x4;
}
`;

function focusScript(title) {
  return `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; Add-Type @"
${CS}
"@
$h=[Win]::FindByTitle(${JSON.stringify(title)})
if($h -eq [IntPtr]::Zero){ Write-Output "NOTFOUND"; exit }
[Win]::ShowWindow($h,[Win]::SW_RESTORE) | Out-Null
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400
$r=New-Object Win+RECT; [Win]::GetWindowRect($h,[ref]$r) | Out-Null
Write-Output ("RECT " + $r.Left + " " + $r.Top + " " + ($r.Right-$r.Left) + " " + ($r.Bottom-$r.Top))`;
}

const mcp = new McpServer({ name: "ff-auto", version: "1.0.0" });

mcp.tool("list_windows", "List visible top-level window titles (to find the browser window)", {}, async () => {
  const out = ps(`Add-Type @"
${CS}
"@
[Win]::ListTitles()`);
  return { content: [{ type: "text", text: out.trim() || "(none)" }] };
});

mcp.tool("focus_window",
  "Bring the window whose title contains the given substring to the foreground. Returns its rect.",
  { title: z.string() },
  async ({ title }) => {
    const out = ps(focusScript(title)).trim();
    return { content: [{ type: "text", text: out }] };
  });

mcp.tool("screenshot",
  "Focus the window matching `title` (substring) and capture it as a PNG. Optional crop x,y,w,h are window-relative. Returns the image.",
  { title: z.string().default("Mozilla Firefox"),
    x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional() },
  async ({ title, x, y, w, h }) => {
    const tmp = path.join(os.tmpdir(), "ff-shot-" + Date.now() + ".png");
    const crop = (x != null && y != null && w != null && h != null)
      ? `$cx=${x};$cy=${y};$cw=${w};$ch=${h}` : `$cx=0;$cy=0;$cw=$ww;$ch=$wh`;
    const out = ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; Add-Type @"
${CS}
"@
$h=[Win]::FindByTitle(${JSON.stringify(title)})
if($h -eq [IntPtr]::Zero){ Write-Output "NOTFOUND"; exit }
[Win]::ShowWindow($h,[Win]::SW_RESTORE) | Out-Null
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 450
$r=New-Object Win+RECT; [Win]::GetWindowRect($h,[ref]$r) | Out-Null
$ww=$r.Right-$r.Left; $wh=$r.Bottom-$r.Top
${crop}
$bmp=New-Object System.Drawing.Bitmap $cw,$ch
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left+$cx,$r.Top+$cy,0,0,(New-Object System.Drawing.Size($cw,$ch)))
$bmp.Save(${JSON.stringify(tmp)},[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("OK " + $r.Left + " " + $r.Top + " " + $ww + " " + $wh)`).trim();
    if (out.startsWith("NOTFOUND")) {
      return { content: [{ type: "text", text: `Window matching "${title}" not found. Use list_windows.` }] };
    }
    const data = fs.readFileSync(tmp).toString("base64");
    try { fs.unlinkSync(tmp); } catch (e) {}
    return { content: [
      { type: "text", text: out },
      { type: "image", data, mimeType: "image/png" },
    ] };
  });

mcp.tool("press_keys",
  "Focus the window matching `title` and send keystrokes via SendKeys (e.g. '{RIGHT}', '{ENTER}', '{TAB}', 'a'). See .NET SendKeys syntax.",
  { title: z.string().default("Mozilla Firefox"), keys: z.string() },
  async ({ title, keys }) => {
    const out = ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; Add-Type @"
${CS}
"@
$h=[Win]::FindByTitle(${JSON.stringify(title)})
if($h -eq [IntPtr]::Zero){ Write-Output "NOTFOUND"; exit }
[Win]::ShowWindow($h,[Win]::SW_RESTORE) | Out-Null
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(keys)})
Write-Output "SENT"`).trim();
    return { content: [{ type: "text", text: out }] };
  });

mcp.tool("click",
  "Focus the window matching `title`, then left-click at window-relative coordinates (x,y). Set double=true for double-click.",
  { title: z.string().default("Mozilla Firefox"), x: z.number(), y: z.number(), double: z.boolean().default(false) },
  async ({ title, x, y, double }) => {
    const dbl = double ? `Start-Sleep -Milliseconds 60; [Win]::mouse_event([Win]::LEFTDOWN,0,0,0,[IntPtr]::Zero); [Win]::mouse_event([Win]::LEFTUP,0,0,0,[IntPtr]::Zero)` : "";
    const out = ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; Add-Type @"
${CS}
"@
$h=[Win]::FindByTitle(${JSON.stringify(title)})
if($h -eq [IntPtr]::Zero){ Write-Output "NOTFOUND"; exit }
[Win]::ShowWindow($h,[Win]::SW_RESTORE) | Out-Null
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 350
$r=New-Object Win+RECT; [Win]::GetWindowRect($h,[ref]$r) | Out-Null
[Win]::SetCursorPos($r.Left+${x}, $r.Top+${y}) | Out-Null
Start-Sleep -Milliseconds 120
[Win]::mouse_event([Win]::LEFTDOWN,0,0,0,[IntPtr]::Zero)
[Win]::mouse_event([Win]::LEFTUP,0,0,0,[IntPtr]::Zero)
${dbl}
Write-Output ("CLICK " + ($r.Left+${x}) + " " + ($r.Top+${y}))`).trim();
    return { content: [{ type: "text", text: out }] };
  });

const transport = new StdioServerTransport();
mcp.connect(transport).catch((e) => { console.error("ff-auto connect error", e); process.exit(1); });
process.stdin.on("close", () => { mcp.close(); process.exit(0); });
