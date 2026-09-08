/**
 * Bring the automation browser windows back on screen, or send them away again.
 *
 * Runs are hidden by default — off screen and out of the taskbar — and a running
 * script keeps sweeping any new window (job popups, application tabs) out of sight,
 * so there is nothing to click when you want to watch one.
 *
 *   node show-windows.js                  show every automation browser, and keep it shown
 *   node show-windows.js wellfound        show just one (naukri | wellfound | indeed | refresh)
 *   node show-windows.js --hide           hide them again and resume automatic hiding
 *
 * Showing writes a flag file (.show-windows) that pauses the hide sweep, otherwise a
 * restored window would be swept away again within seconds. --hide clears it.
 */
const fs = require("fs");
const path = require("path");
const {
  restoreBrowserWindows,
  hideBrowserWindows,
  SHOW_FLAG,
} = require("./window-utils");

const PROFILES = {
  naukri: ".naukri-apply-profile",
  wellfound: ".wellfound-chrome-profile",
  indeed: ".indeed-chrome-profile",
  refresh: ".naukri-chrome-profile", // the hourly profile-refresh browser
};

(async () => {
  const args = process.argv.slice(2);
  const hideAgain = args.includes("--hide");
  const which = (args.find((a) => !a.startsWith("--")) || "").toLowerCase();

  if (which && !PROFILES[which]) {
    console.log(
      `Unknown profile "${which}". Options: ${Object.keys(PROFILES).join(", ")}`,
    );
    process.exit(1);
  }
  const names = which ? [which] : Object.keys(PROFILES);

  if (hideAgain) {
    try {
      fs.unlinkSync(SHOW_FLAG);
    } catch (e) {}
    let n = 0;
    for (const name of names)
      n += await hideBrowserWindows(path.join(__dirname, PROFILES[name]));
    console.log(
      n
        ? `hid ${n} window(s); automatic hiding resumed`
        : "nothing visible to hide; automatic hiding resumed",
    );
    return;
  }

  // Set the flag BEFORE restoring, so a sweep running right now does not undo it.
  try {
    fs.writeFileSync(SHOW_FLAG, new Date().toISOString());
  } catch (e) {}
  let total = 0;
  for (const name of names) {
    const n = await restoreBrowserWindows(path.join(__dirname, PROFILES[name]));
    total += n;
    if (n) console.log(`restored ${n} window(s) for ${name}`);
  }
  if (!total)
    console.log(
      "No automation windows found — nothing is running, or they are already visible.",
    );
  console.log(
    "Automatic hiding is PAUSED. Run `node show-windows.js --hide` to hide them again.",
  );
})();
