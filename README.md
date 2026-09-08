# Auto-Apply

Job-application automation for **Naukri**, **Wellfound** and **Indeed**, plus an
hourly **Naukri profile refresh** that keeps your profile at the top of recruiter
searches. Everything runs locally in Chrome via Playwright, and every personal
detail lives in `.env` — nothing is hard-coded in the scripts.

| What | Entry point |
|---|---|
| Keep the Naukri profile "recently updated" (hourly) | `node naukri-profile-refresh.js` |
| Auto-apply on Naukri | `node auto-apply-runner.js naukri` |
| Auto-apply on Wellfound | `node auto-apply-runner.js wellfound` |
| Auto-apply on Indeed | `node auto-apply-runner.js indeed` |

The apply runners start in **DRY RUN** mode — they fill everything but never press
Send — so you can watch them work before adding `--live`.

---

# Part 1 — Naukri profile refresh

Keeps your Naukri profile "recently updated" — recruiters see fresh profiles first.
Every run it cycles trailing dots on your **resume headline** ("" -> "." -> ".." -> ""),
which counts as a profile update on Naukri, and re-uploads your resume PDF whenever
the profile's "Uploaded on" date is not today. Schedule it hourly and forget about it.

- Logs in automatically with your **Google account** (session is saved after the first login).
- Runs in an off-screen Chrome window (Naukri blocks headless browsers).
- Verifies the save actually stuck on the server before reporting success.
- Re-uploads the resume daily; pass `--force-cv` to re-upload even when the date is already today.
- All personal data lives in `.env` — nothing sensitive is in the code.

## Requirements

- Windows 10/11 (uses Task Scheduler for the hourly run)
- [Node.js](https://nodejs.org/) 18+
- Google Chrome installed
- A Naukri account that signs in with Google

## Setup

**1. Clone and install:**

```powershell
git clone https://github.com/ankitbaghel01/naukri_update.git
cd naukri_update
npm install
```

**2. Create your `.env`:**

```powershell
copy .env.example .env
```

Open `.env` and fill in at least:

| Variable | What it is |
|---|---|
| `GOOGLE_EMAIL` | The Google account your Naukri profile uses |
| `GOOGLE_PASSWORD` | Its password (used only for the automated sign-in) |
| `NAUKRI_PROFILE_URL` | Your Naukri profile page — the default `https://www.naukri.com/mnjuser/profile` works for every account |
| `RESUME_FILE` | Resume PDF re-uploaded to the profile daily — filename relative to this folder, or an absolute path |

`.env` is git-ignored, so your credentials never get pushed.

**3. First login (one time, visible browser):**

```powershell
node naukri-profile-refresh.js login
```

A Chrome window opens and signs in with Google. If Google asks for 2-step
verification, approve it once — the session is saved to `.naukri-chrome-profile/`
and reused by every later run.

**4. Test a silent run:**

```powershell
node naukri-profile-refresh.js
```

Check `naukri-refresh.log` — you should see a line like:

```
[27/7/2026, 1:05:12 pm] OK: headline dot 1 added (verified), cv up-to-date → "AI Full Stack Developer | ..."
```

## Run it hourly (Task Scheduler)

Run this once in PowerShell (adjust the path to where you cloned the repo):

```powershell
$repo = "C:\path\to\auto-apply"
$action  = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$repo\naukri-profile-refresh.js`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "NaukriProfileRefresh" -Action $action -Trigger $trigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
```

That's it — the script now refreshes your profile every hour while your PC is on.

Useful commands:

```powershell
Get-ScheduledTask NaukriProfileRefresh            # check status
Start-ScheduledTask NaukriProfileRefresh          # run now
Disable-ScheduledTask NaukriProfileRefresh        # pause
Enable-ScheduledTask NaukriProfileRefresh         # resume
Unregister-ScheduledTask NaukriProfileRefresh     # remove
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Google login did not complete` in the log | Run `node naukri-profile-refresh.js login` and approve the 2-step verification prompt once manually. |
| `save did not stick` in the log | Naukri changed its headline editor — open an issue. |
| Any other error | Check `naukri-refresh-error-*.png` screenshots in the repo folder — they show exactly what the browser saw when it failed. |
| Want to start fresh | Delete the `.naukri-chrome-profile/` folder and run the `login` step again. |

## Files

| File | Purpose |
|---|---|
| `naukri-profile-refresh.js` | The refresh script |
| `config.js` | Loads `.env` (no dependencies) |
| `.env.example` | Template — copy to `.env` and fill in |
| `naukri-refresh.log` | Run history (git-ignored) |
| `.naukri-chrome-profile/` | Saved Chrome session (git-ignored) |

## Disclaimer

Automating your own profile may be against Naukri's Terms of Service. It only
edits your own headline at a slow, human-like rate, but use at your own risk.

---

# Part 2 — Auto-apply (Wellfound / Indeed / Naukri)

Automatically applies to matching jobs on [Wellfound](https://wellfound.com) (ex-AngelList Talent).
A Playwright runner opens Chrome with your saved Wellfound session, injects the apply
script into the `/jobs` feed, and the script:

- scrolls the infinite feed and picks jobs whose **title matches your keywords** (and skips a blocklist),
- opens each job's "Apply to *Company*" panel,
- fills the **cover letter** (personalized per company/role from your `.env` data),
- answers extra questions from a built-in Q&A bank (optionally falls back to **Gemini** for unknown questions),
- handles location prompts ("I can relocate to…"), dropdowns, radios and checkboxes,
- submits, logs every application to `applications.csv`, and respects a **50/day cap**.

It starts in **DRY RUN** mode by default — it fills everything but never presses Send —
so you can watch it work before going live.

## Requirements

- Windows 10/11 (Task Scheduler used for automatic daily runs — manual runs work anywhere Node does)
- [Node.js](https://nodejs.org/) 18+
- Google Chrome
- A Wellfound account with your profile + resume completed

## Setup

**1. Clone and install:**

```powershell
git clone https://github.com/ankitbaghel01/wellfound_autoApply.git
cd wellfound_autoApply
npm install
```

**2. Create your `.env`:**

```powershell
copy .env.example .env
```

Open `.env` and fill in your details — name, contact, skills, highlights, salary
expectations, links, etc. Every application answer and cover letter is built from
these values; **nothing personal is hard-coded in the scripts**. `.env` is
git-ignored, so your data never gets pushed.

Optional: set `GEMINI_KEY` to a free Google Gemini API key — any application
question the built-in answer bank can't match gets answered by Gemini using your CV.

**3. Log in to Wellfound (one time, visible browser):**

```powershell
node auto-apply-runner.js wellfound login
```

A Chrome window opens — log in to wellfound.com, then close the window.
The session is saved to `.wellfound-chrome-profile/` and reused by every later run.

**4. Dry run (watch it, nothing is submitted):**

```powershell
node auto-apply-runner.js wellfound
```

Chrome opens on the jobs feed, and you'll see forms being filled. The log
(`auto-apply-wellfound.log`) shows lines like:

```
✍ cover letter filled
🔍 DRY_RUN — would click: Apply
==> 1/50 this run (1/50 today)
```

**5. Go live:**

```powershell
node auto-apply-runner.js wellfound --live
```

Same flow, but Send is actually clicked. Each application is appended to
`applications.csv` (Date, Site, Role, Company, Salary, Skills, Job Link, JD) and
counted in `apply-state-wellfound.json` toward the daily cap.

## Customizing which jobs it applies to

Edit the `CONFIG` block at the top of `wellfound-auto-apply.js`:

| Setting | What it does |
|---|---|
| `TITLE_KEYWORDS` | Apply only when the job title contains one of these (case-insensitive) |
| `TITLE_BLOCKLIST` | Skip when the title contains any of these (senior, manager, .net, …) |
| `MAX_APPLICATIONS` | Per-run cap (the runner overrides it with the daily cap remaining) |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | Wait between applications (default 60–150 s — human pace; going faster trips Wellfound's bot-check) |

**Locations:** the script applies to whatever your Wellfound search filters show on
`wellfound.com/jobs` — set your filters (remote / worldwide / a city) once in the
browser and it follows them. Jobs in other locations are still handled: when
Wellfound asks, it picks "I can relocate to…" and selects the job's offered location.
Jobs the company has location-blocked are detected and skipped. Jobs posted more than
14 days ago are skipped.

## Run it automatically every day (Task Scheduler)

```powershell
$repo = "C:\path\to\wellfound_autoApply"
$action  = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$repo\auto-apply-runner.js`" wellfound --live" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 12:30
Register-ScheduledTask -TaskName "WellfoundAutoApply" -Action $action -Trigger $trigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
```

Useful commands:

```powershell
Start-ScheduledTask WellfoundAutoApply       # run now
Disable-ScheduledTask WellfoundAutoApply     # pause
Enable-ScheduledTask WellfoundAutoApply      # resume
Unregister-ScheduledTask WellfoundAutoApply  # remove
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `0 job cards found` on every page | Wellfound is showing a DataDome "Verification Required" captcha. Run `node auto-apply-runner.js wellfound login`, solve the slider once manually, close the window, re-run. |
| Session logged out | Delete `.wellfound-chrome-profile/` and repeat the `login` step. |
| `no apply modal found — skipping` | That job opened as a full page instead of the apply panel — it's skipped safely and not counted. |
| `no Send button found` on many jobs in a row | Usually the bot-check again (see first row). Keep delays at 60 s+. |
| Want today's counter reset | Delete `apply-state-wellfound.json`. |

## Files

| File | Purpose |
|---|---|
| `auto-apply-runner.js` | Playwright wrapper: opens Chrome, injects the site script, logs to CSV, enforces the daily cap |
| `wellfound-auto-apply.js` | The Wellfound apply logic (also pasteable directly into the DevTools console) |
| `config.js` | Tiny no-dependency `.env` loader |
| `.env.example` | Template — copy to `.env` and fill in |
| `applications.csv` | Every submitted application (git-ignored) |
| `apply-state-wellfound.json` | Today's application count for the 50/day cap (git-ignored) |
| `auto-apply-wellfound.log` | Run history (git-ignored) |
| `.wellfound-chrome-profile/` | Saved Chrome session (git-ignored) |

## Disclaimer

Auto-applying may violate Wellfound's Terms of Service and can get an
account rate-limited or banned. The delays are deliberately human-like and everything
runs on your own machine with your own account — use at your own risk, and review
the dry run before going live.
