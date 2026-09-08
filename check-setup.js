/**
 * One command that checks the whole setup and prints a pass/fail report.
 *
 *   node check-setup.js          everything (opens Chrome for the session checks)
 *   node check-setup.js --quick  skip the browser checks (config and text only)
 *
 * Nothing here submits an application or edits your Naukri profile — it only reads.
 * Stop any running job first: the browser checks need the Chrome profiles, and a
 * profile already in use by a run will be reported as "in use", not as a failure.
 */
const fs = require("fs");
const path = require("path");

const QUICK = process.argv.includes("--quick");
const results = [];
const pass = (name, detail) => results.push(["PASS", name, detail || ""]);
const fail = (name, detail) => results.push(["FAIL", name, detail || ""]);
const warn = (name, detail) => results.push(["WARN", name, detail || ""]);

// ---------------------------------------------------------------- config / data
function checkConfig() {
  let CV, CREDS, resumePath;
  try {
    ({ CV, CREDS, resumePath } = require("./config"));
  } catch (e) {
    return fail("config loads", e.message);
  }
  pass("config loads", "config.js parsed .env");

  const missing = [
    "name",
    "email",
    "phone",
    "location",
    "currentRole",
    "education",
  ].filter((k) => !CV[k]);
  missing.length
    ? fail("identity fields", "empty: " + missing.join(", "))
    : pass("identity fields", `${CV.name} · ${CV.email} · ${CV.phone}`);

  const placeholder = CV.highlights.filter((h) =>
    /First key achievement|Second achievement|Third achievement/i.test(h),
  );
  placeholder.length
    ? fail("highlights are real", `${placeholder.length} still template text`)
    : pass("highlights are real", `${CV.highlights.length} highlights`);

  // CTC must be in lakhs, not rupees: the forms are labelled LPA, so 1210000 there
  // would read as 12.1 crore.
  const ctcOk = (v) =>
    /^[\d.\-]+$/.test(v) && Number(String(v).split("-")[0]) < 100;
  ctcOk(CV.currentCTC) && ctcOk(CV.expectedCTC)
    ? pass(
        "CTC in lakhs",
        `current ${CV.currentCTC} / expected ${CV.expectedCTC}`,
      )
    : fail(
        "CTC in lakhs",
        `current ${CV.currentCTC} / expected ${CV.expectedCTC} — looks like rupees`,
      );

  fs.existsSync(resumePath)
    ? pass("resume file", path.basename(resumePath))
    : fail("resume file", "missing: " + resumePath);

  CREDS.email && CREDS.password
    ? pass("google credentials", CREDS.email)
    : fail("google credentials", "GOOGLE_EMAIL / GOOGLE_PASSWORD not set");

  return CV;
}

// ------------------------------------------------------------------- answer bank
function bankFrom(file, marker) {
  const src = fs.readFileSync(path.join(__dirname, file), "utf8");
  const start = src.indexOf(marker);
  if (start < 0) return null;
  let i = src.indexOf("[", start),
    d = 0,
    end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "[") d++;
    else if (src[j] === "]") {
      d--;
      if (!d) {
        end = j;
        break;
      }
    }
  }
  const { CV } = require("./config");
  return new Function("CV", "return " + src.slice(i, end + 1) + ";")(CV);
}

function checkAnswers() {
  const questions = [
    "What is your current company?",
    "Notice period",
    "Current CTC",
    "Expected CTC",
    "Years of experience",
    "Email address",
    "Where are you currently located?",
    "LinkedIn profile URL",
    "GitHub profile",
    "Tell us about yourself",
  ];
  for (const [file, marker, label] of [
    ["naukri-auto-apply.js", "const QA_BANK = [", "naukri answers"],
    ["wellfound-auto-apply.js", "const QA_BANK = [", "wellfound answers"],
  ]) {
    try {
      const bank = bankFrom(file, marker);
      const misses = questions.filter((q) => {
        const hit = bank.find(([re]) => re.test(q));
        return !hit || !String(hit[1] ?? "").trim();
      });
      misses.length
        ? warn(label, `${misses.length} unanswered: ${misses.join("; ")}`)
        : pass(label, `all ${questions.length} sample questions answered`);
    } catch (e) {
      fail(label, e.message);
    }
  }

  // external ATS field matching, including the snake_case and "contact no" forms
  try {
    const { answerFor } = require("./external-apply");
    const { CV } = require("./config");
    const fields = [
      "first_name",
      "last_name",
      "current_ctc",
      "expected_ctc",
      "notice_period",
      "Enter contact no",
      "linkedin_url",
      "Email address",
    ];
    const misses = fields.filter((f) => !answerFor(f, CV));
    misses.length
      ? fail("external form fields", "unmatched: " + misses.join(", "))
      : pass("external form fields", `all ${fields.length} resolve`);
    answerFor("password", CV)
      ? fail("passwords never filled", "a password field got a value")
      : pass("passwords never filled", "correctly left empty");
  } catch (e) {
    fail("external form fields", e.message);
  }
}

function checkCoverLetter() {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "wellfound-auto-apply.js"),
      "utf8",
    );
    const start = src.indexOf("function coverLetter(");
    let i = src.indexOf("{", start),
      d = 0,
      end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "{") d++;
      else if (src[j] === "}") {
        d--;
        if (!d) {
          end = j;
          break;
        }
      }
    }
    const { CV } = require("./config");
    const letter = new Function(
      "CV",
      "return (" + src.slice(start, end + 1) + ");",
    )(CV)("Acme", "Full Stack Engineer");
    const bad = /undefined|null|First key achievement/.test(letter);
    bad
      ? fail("cover letter", "contains placeholder or undefined text")
      : pass(
          "cover letter",
          `${letter.length} chars, mentions Acme and the role`,
        );
  } catch (e) {
    fail("cover letter", e.message);
  }
}

// ------------------------------------------------------------------ housekeeping
function checkFiles() {
  fs.existsSync(path.join(__dirname, "node_modules"))
    ? pass("dependencies installed", "node_modules present")
    : fail("dependencies installed", "run: npm install");

  const csv = path.join(__dirname, "applications.csv");
  if (!fs.existsSync(csv))
    return warn(
      "applications.csv",
      "not created yet (no live application logged)",
    );
  const lines = fs.readFileSync(csv, "utf8").trim().split(/\r?\n/);
  lines[0].includes("Verified")
    ? pass(
        "applications.csv",
        `${lines.length - 1} row(s), Verified column present`,
      )
    : warn("applications.csv", "older file without the Verified column");

  for (const site of ["naukri", "wellfound"]) {
    const f = path.join(__dirname, `apply-state-${site}.json`);
    if (!fs.existsSync(f)) {
      warn(`${site} daily count`, "no state file yet");
      continue;
    }
    try {
      const s = JSON.parse(fs.readFileSync(f, "utf8"));
      pass(`${site} daily count`, `${s.count} on ${s.date}`);
    } catch (e) {
      warn(`${site} daily count`, "unreadable");
    }
  }
}

// ---------------------------------------------------------------- browser checks
async function checkSessions() {
  const { chromium } = require("playwright-core");
  const targets = [
    [
      ".naukri-chrome-profile",
      "https://www.naukri.com/mnjuser/profile",
      /Application status|Recommended jobs|resume headline/i,
      "naukri profile session",
    ],
    [
      ".naukri-apply-profile",
      "https://www.naukri.com/mnjuser/profile",
      /Application status|Recommended jobs|resume headline/i,
      "naukri apply session",
    ],
    [
      ".wellfound-chrome-profile",
      "https://wellfound.com/jobs",
      /Applied|Messages|Profile/i,
      "wellfound session",
    ],
  ];
  for (const [dir, url, ok, label] of targets) {
    const full = path.join(__dirname, dir);
    if (!fs.existsSync(full)) {
      warn(label, "no saved session — run the login step");
      continue;
    }
    let ctx;
    try {
      ctx = await chromium.launchPersistentContext(full, {
        channel: "chrome",
        headless: false,
        viewport: { width: 1200, height: 800 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--window-position=0,0",
        ],
      });
    } catch (e) {
      warn(
        label,
        /in use|existing browser/i.test(e.message)
          ? "profile in use by a running job — stop it first"
          : e.message,
      );
      continue;
    }
    try {
      const page = ctx.pages()[0] || (await ctx.newPage());
      const { hideBrowserWindows } = require("./window-utils");
      setTimeout(() => hideBrowserWindows(full).catch(() => {}), 1200);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(9000);
      const text = await page
        .evaluate(() => document.body.innerText)
        .catch(() => "");
      ok.test(text)
        ? pass(label, "logged in")
        : fail(label, "looks logged out — run the login step");

      if (dir === ".wellfound-chrome-profile") {
        await page.goto("https://wellfound.com/jobs/applications", {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await page
          .waitForFunction(
            () =>
              /Ongoing|Archived|No applications/i.test(document.body.innerText),
            { timeout: 30000 },
          )
          .catch(() => {});
        await page.waitForTimeout(2500);
        const ids = await page.evaluate(() => [
          ...new Set(
            [...document.querySelectorAll('a[href*="/jobs/applications/"]')]
              .map((a) =>
                (a.getAttribute("href") || "").match(
                  /\/jobs\/applications\/\d+-(\d+)/,
                ),
              )
              .filter(Boolean)
              .map((m) => m[1]),
          ),
        ]);
        ids.length
          ? pass(
              "wellfound applied list",
              `${ids.length} applications readable (used for verification + seeding)`,
            )
          : fail(
              "wellfound applied list",
              "no applications parsed — verification would not work",
            );
      }
    } catch (e) {
      fail(label, e.message.split("\n")[0].slice(0, 90));
    } finally {
      await ctx.close().catch(() => {});
    }
  }
}

// ------------------------------------------------------------------------- main
(async () => {
  console.log("Checking setup...\n");
  checkConfig();
  checkAnswers();
  checkCoverLetter();
  checkFiles();
  if (!QUICK) await checkSessions();
  else warn("browser checks", "skipped (--quick)");

  console.log("");
  for (const [state, name, detail] of results) {
    const tag =
      state === "PASS" ? "  ok  " : state === "WARN" ? " warn " : " FAIL ";
    console.log(`[${tag}] ${name.padEnd(26)} ${detail}`);
  }
  const failed = results.filter((r) => r[0] === "FAIL").length;
  const warned = results.filter((r) => r[0] === "WARN").length;
  console.log(
    `\n${results.length - failed - warned} passed, ${warned} warning(s), ${failed} failure(s)`,
  );
  process.exit(failed ? 1 : 0);
})();
