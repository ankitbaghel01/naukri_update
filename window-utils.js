/**
 * Keeps the automation browser out of the way WITHOUT making it unreachable.
 *
 * The scripts used to launch Chrome at --window-position=-32000,-32000. That did
 * hide it, but it also broke the taskbar: clicking the button "restored" the window
 * to coordinates no monitor covers, so it could never be brought up to watch the run.
 *
 * Instead the window now opens on-screen and is immediately minimised, so it sits in
 * the taskbar like any other window and a click brings it up normally.
 *
 * Only windows belonging to the given Chrome user-data-dir are touched, so a
 * personal Chrome running at the same time is never minimised.
 */
const { execFile } = require("child_process");

// Embed the path as a PowerShell single-quoted literal. It cannot be passed as a
// parameter: `powershell -Command <script>` does not bind trailing arguments to a
// param() block, so the earlier version silently ran with an empty path and matched
// nothing (it reported "0 minimised" while the window sat there wide open).
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const script = (profileDir) => `
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class AaWin32 {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
$dir = ${psQuote(profileDir)}
$SW_MINIMIZE = 6
$n = 0
$procIds = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$dir*" } |
  Select-Object -ExpandProperty ProcessId
foreach ($procId in $procIds) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne 0) {
    # Never re-minimise a window the user has deliberately restored.
    if (-not [AaWin32]::IsIconic($proc.MainWindowHandle)) {
      [void][AaWin32]::ShowWindow($proc.MainWindowHandle, $SW_MINIMIZE)
      $n++
    }
  }
}
Write-Output $n
`;

/**
 * Minimise every Chrome window that belongs to `profileDir`.
 * Windows-only and best-effort: any failure is swallowed, since not being able to
 * tidy the window away must never take down an otherwise healthy run.
 * Already-minimised windows are left alone, so this will not fight a user who has
 * clicked the taskbar to watch what the script is doing.
 *
 * @returns {Promise<number>} how many windows were minimised (0 on any failure)
 */
function minimizeBrowserWindows(profileDir) {
  if (process.platform !== "win32") return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script(profileDir)],
      { timeout: 20000, windowsHide: true },
      (err, stdout) =>
        resolve(err ? 0 : parseInt(String(stdout).trim(), 10) || 0),
    );
  });
}

module.exports = { minimizeBrowserWindows };
