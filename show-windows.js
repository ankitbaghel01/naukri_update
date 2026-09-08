/**
 * Bring the automation browser windows back on screen.
 *
 * Runs are hidden by default — off screen and out of the taskbar — so there is
 * nothing to click when you want to watch one. This puts them back.
 *
 *   node show-windows.js            restore every automation profile's windows
 *   node show-windows.js naukri     restore just the naukri apply browser
 *   node show-windows.js wellfound  restore just the wellfound browser
 *
 * They stay visible: nothing re-hides a window you have deliberately brought up.
 * To start a run visible in the first place, pass --show:
 *   node auto-apply-runner.js naukri --show
 */
const path = require("path");
const { restoreBrowserWindows } = require("./window-utils");

const PROFILES = {
  naukri: ".naukri-apply-profile",
  wellfound: ".wellfound-chrome-profile",
  indeed: ".indeed-chrome-profile",
  refresh: ".naukri-chrome-profile", // the hourly profile-refresh browser
};

(async () => {
  const which = (process.argv[2] || "").toLowerCase();
  const names = which ? [which] : Object.keys(PROFILES);
  if (which && !PROFILES[which]) {
    console.log(
      `Unknown profile "${which}". Options: ${Object.keys(PROFILES).join(", ")}`,
    );
    process.exit(1);
  }
  let total = 0;
  for (const name of names) {
    const n = await restoreBrowserWindows(path.join(__dirname, PROFILES[name]));
    total += n;
    if (n) console.log(`restored ${n} window(s) for ${name}`);
  }
  if (!total)
    console.log(
      "No hidden automation windows found — nothing running, or already visible.",
    );
})();
