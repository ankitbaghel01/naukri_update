# Naukri TopTier hourly refresh

This is an independent implementation for the TopTier profile UI. The legacy `naukri-profile-refresh.js` and its automation are unchanged.

Run from this branch/worktree:

```sh
NAUKRI_DATA_DIR=/Users/neelesh/Documents/GitHub/naukri_update TZ=Asia/Kolkata node naukri-toptier-refresh.js --show
```

`NAUKRI_DATA_DIR` points at the existing checkout containing `.env`, `config.js`, installed Playwright, and `.naukri-chrome-profile`. The configured resume is loaded through that checkout's `config.js`. Credentials are neither copied to this branch nor logged. The browser is visible; `--show` is accepted for consistency with the old command.

On every run:

1. Skip if Chrome already uses the shared profile or another TopTier runner holds the lock. Never stop another session.
2. Cycle only trailing dots in **Profile summary**, since TopTier does not expose the legacy resume-headline editor. Preserve the rest of the summary and verify it after reloading.
3. Read the resume card's upload date. Support `Uploaded today`, `Uploaded yesterday`, and `Uploaded on DD/MM/YYYY`, using the India calendar day. Upload the configured resume only when stale and verify the date and filename after reloading. An unreadable date is a failure, not permission to re-upload repeatedly.
4. Clear **Preferences → Minimum annual salary**, save, reload, and reopen to verify the empty value. Other preferences and professional details are not edited.

Results append to `NAUKRI_DATA_DIR/naukri-toptier-refresh.log`: `OK` only follows all three verified operations; `SKIP` means a session is busy; `ERROR` exits 1. A failure screenshot is saved as `naukri-toptier-refresh-error.png`. Expired logins require manual sign-in using the existing profile; the scheduled command never submits credentials or job applications.

The new automation is named **Hourly Naukri TopTier profile refresh** and targets this worktree. Keep this worktree available while the schedule is active. The old automation remains intact and may continue to report its existing selector failures; it is not silently disabled.

Tests:

```sh
NAUKRI_DATA_DIR=/Users/neelesh/Documents/GitHub/naukri_update node --test naukri-toptier-refresh.test.js
```

Browser tests route the profile URL to a local fixture; they do not alter a real Naukri profile. They cover reloaded persistence, failed saves, a single upload across two same-day refreshes, relative and numeric date formats, summary preservation, and active locks.
