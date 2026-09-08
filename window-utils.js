/**
 * Keeps the automation browser out of the way.
 *
 * Three states, in increasing order of "get it off my screen":
 *   --show      leave the window on screen (watch a run happen)
 *   minimise    sits in the taskbar; one click brings it up
 *   hide        gone from the screen AND the taskbar; runs invisibly (the default)
 *
 * The original code launched Chrome at --window-position=-32000,-32000. That hid it,
 * but it also broke the taskbar: clicking the button "restored" the window to
 * coordinates no monitor covers, so a run could never be brought up. Windows are now
 * launched on-screen and then minimised or hidden through ShowWindow, so the state is
 * a real window state rather than an off-screen position.
 *
 * A HIDDEN window cannot be clicked back — nothing appears in the taskbar.
 * `node show-windows.js` brings it back.
 *
 * Windows are enumerated with EnumWindows rather than Process.MainWindowHandle,
 * because a hidden window reports MainWindowHandle 0 — using it would have made
 * hiding a one-way trip with no way to restore.
 *
 * Only windows belonging to the given Chrome user-data-dir are touched, so a personal
 * Chrome running at the same time is never affected.
 */
const { execFile } = require("child_process");
const path = require("path");

/**
 * While this file exists, running scripts stop hiding their windows. show-windows.js
 * creates it, so a browser brought up to watch is not swept back out of sight a few
 * seconds later; `node show-windows.js --hide` removes it and hiding resumes.
 */
const SHOW_FLAG = path.join(__dirname, ".show-windows");

// Embed the path as a PowerShell single-quoted literal. It cannot be passed as a
// parameter: `powershell -Command <script>` does not bind trailing arguments to a
// param() block, so an earlier version silently ran with an empty path and matched
// nothing (it reported "0 minimised" while the window sat there wide open).
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// SW_HIDE 0 | SW_MINIMIZE 6 | SW_RESTORE 9
const CMD = { hide: 0, minimize: 6, restore: 9 };

const script = (profileDir, mode) => `
$sig = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AaWin32 {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

  public static List<IntPtr> ForPids(HashSet<uint> pids) {
    var found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      // Chrome owns many hidden helper windows; only ones with a title are real
      // browser windows worth showing or hiding.
      if (pids.Contains(p) && GetWindowTextLength(h) > 0) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
$dir = ${psQuote(profileDir)}
$cmd = ${CMD[mode]}
$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$dir*" } |
  ForEach-Object { [void]$pids.Add([uint32]$_.ProcessId) }
$n = 0
if ($pids.Count -gt 0) {
  foreach ($h in [AaWin32]::ForPids($pids)) {
    # Never re-apply a state a window is already in, so this does not fight a user who
    # has deliberately brought the window up.
    if ($cmd -eq 6 -and [AaWin32]::IsIconic($h)) { continue }
    if ($cmd -eq 0 -and -not [AaWin32]::IsWindowVisible($h)) { continue }
    if ($cmd -eq 9 -and [AaWin32]::IsWindowVisible($h) -and -not [AaWin32]::IsIconic($h)) { continue }
    if ($cmd -eq 9) {
      # Hidden runs launch Chrome at -32000 so it never flashes on screen. Showing one
      # therefore has to move it back into view first, or it would "restore" to
      # coordinates no monitor covers — the original bug this whole file exists to fix.
      # SWP_NOSIZE 0x1 | SWP_NOZORDER 0x4 | SWP_NOACTIVATE 0x10 = 0x15
      [void][AaWin32]::SetWindowPos($h, [IntPtr]::Zero, 60, 60, 0, 0, 0x15)
    }
    [void][AaWin32]::ShowWindow($h, $cmd)
    if ($cmd -eq 9) { [void][AaWin32]::SetForegroundWindow($h) }
    $n++
  }
}
Write-Output $n
`;

function run(profileDir, mode) {
  if (process.platform !== "win32") return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script(profileDir, mode)],
      { timeout: 20000, windowsHide: true },
      (err, stdout) =>
        resolve(err ? 0 : parseInt(String(stdout).trim(), 10) || 0),
    );
  });
}

/** Minimise to the taskbar. Returns how many windows changed (0 on any failure). */
const minimizeBrowserWindows = (profileDir) => run(profileDir, "minimize");

/** Hide completely — off screen and out of the taskbar. show-windows.js reverses it. */
const hideBrowserWindows = (profileDir) => run(profileDir, "hide");

/** Bring hidden or minimised windows back and focus them. */
const restoreBrowserWindows = (profileDir) => run(profileDir, "restore");

module.exports = {
  minimizeBrowserWindows,
  hideBrowserWindows,
  restoreBrowserWindows,
  SHOW_FLAG,
};
