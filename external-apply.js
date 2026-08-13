/**
 * External ("Apply on company site") applications.
 *
 * The injected console script CANNOT do this: once Naukri hands off to the
 * employer's own domain the page is cross-origin and in-page JS can't touch it.
 * So the Playwright runner drives it from Node instead — it opens the Naukri job,
 * clicks through to the company site, and fills whatever generic form it lands on.
 *
 * Honest scope: this handles the common "one public form, no login" ATSs
 * (Greenhouse, Lever, SmartRecruiters, Zoho, Keka, Freshteam, plain career pages).
 * Portals that require creating an account with email verification (Workday, Taleo,
 * iCIMS, SuccessFactors, BrassRing) are detected and skipped — they cannot be
 * completed unattended, and half-finishing them is worse than not starting.
 */

// ATSs that force account creation / email verification before the form.
const ACCOUNT_REQUIRED = /myworkdayjobs|workday|taleo|icims|successfactors|brassring|oraclecloud|peoplestrong|smartrecruiters\.com\/.*\/login/i;
// Not an application form at all.
const DEAD_END = /linkedin\.com|indeed\.com|glassdoor\./i;

/** Classify the page we landed on after the handoff. */
const atsKind = (url) => {
  if (!url || /^about:/.test(url)) return 'unknown';
  if (ACCOUNT_REQUIRED.test(url)) return 'account';
  if (DEAD_END.test(url)) return 'deadend';
  return 'form';
};

/** Yes-ish option picker for radios/selects/consent. */
const YES = /^(yes|i agree|agree|i consent|consent|willing|open to|immediately|available|true)\b/i;

/**
 * Answer bank for external forms. Deliberately separate from the Naukri chatbot
 * bank in naukri-auto-apply.js — that one is injected into a browser page and
 * can't require() anything. First match wins, so order matters.
 */
const answerFor = (label, CV) => {
  const L = String(label || '');
  const bank = [
    [/first name|given name/i, (CV.name || '').split(' ')[0]],
    [/last name|surname|family name/i, (CV.name || '').split(' ').slice(1).join(' ')],
    [/full name|^name$|your name|candidate name/i, CV.name],
    [/e-?mail/i, CV.email], // before any /address/ pattern
    [/phone|mobile|contact number|telephone/i, CV.phone],
    [/linkedin/i, CV.linkedin],
    [/github/i, CV.github],
    [/portfolio|personal (web)?site|website|blog/i, CV.portfolio],
    [/current (company|employer)|present employer|organi[sz]ation/i, CV.company],
    [/current (job )?title|current role|designation/i, CV.currentRole],
    [/notice period|when can you (start|join)|availability|start date|joining/i, CV.noticePeriod],
    [/current .{0,15}(ctc|salary|compensation)/i, CV.currentCTC],
    [/(expected|desired) .{0,15}(ctc|salary|compensation|pay)|salary expectation/i, CV.expectedCTC],
    [/years? of|total experience|work experience|experience \(/i, CV.yearsOfExperience || '1'],
    [/city|current location|where are you based|location|address/i, CV.location],
    [/visa|sponsorship|work authori|legally authori|right to work/i, CV.workAuth],
    [/relocat/i, CV.relocate],
    [/remote|work from home/i, CV.remoteOk],
    [/education|degree|university|college|qualification/i, CV.education],
    [/skills|technolog/i, CV.skills],
    [/date of birth|dob/i, CV.dob],
    [/gender/i, CV.gender],
    [/cover letter|why (do you|are you)|tell us|about yourself|summary|message/i,
      `I'm ${CV.name}, ${CV.currentRole}. ${(CV.highlights && CV.highlights[0]) || ''}`.trim()],
  ];
  for (const [re, val] of bank) if (re.test(L)) return val == null ? '' : String(val);
  return '';
};

/** Collect fillable fields and tag them so Node can address each one. */
const COLLECT = () => {
  const seen = new Set();
  const out = [];
  const labelFor = (el) => {
    let byFor = '';
    try { if (el.id) byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || ''; } catch (e) {}
    const own = el.closest('label')?.innerText || '';
    const group = el.closest('div,section,fieldset,li')?.innerText || '';
    return (byFor || own || el.getAttribute('aria-label') || el.placeholder || el.name || group)
      .replace(/\s+/g, ' ').trim().slice(0, 150);
  };
  const vis = (el) => el.getClientRects().length > 0 && !el.disabled && !el.readOnly;
  let i = 0;
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    if (type !== 'file' && !vis(el)) continue; // file inputs are usually visually hidden
    if (type === 'radio') {
      if (seen.has(el.name)) continue; // one entry per radio group
      seen.add(el.name);
      const opts = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
        .map((r, n) => { r.setAttribute('data-aa-r', `${i}-${n}`); return labelFor(r).slice(0, 60); });
      out.push({ i, type, label: labelFor(el), options: opts, required: el.required });
      i++;
      continue;
    }
    el.setAttribute('data-aa-i', String(i));
    const options = type === 'select-one' || el.tagName === 'SELECT'
      ? [...el.options].map((o) => o.textContent.trim()) : [];
    out.push({ i, type: el.tagName === 'SELECT' ? 'select' : type, label: labelFor(el), options, required: el.required });
    i++;
  }
  return out;
};

/** Fill every field we have an answer for. Returns a per-field report. */
async function fillFields(page, CV, resumePath) {
  const fields = await page.evaluate(COLLECT);
  const report = [];
  for (const f of fields) {
    const loc = page.locator(`[data-aa-i="${f.i}"]`).first();
    try {
      if (f.type === 'file') {
        if (resumePath) { await loc.setInputFiles(resumePath, { timeout: 15000 }); report.push(`file:${f.label.slice(0, 25)}`); }
        continue;
      }
      if (f.type === 'checkbox') {
        // only tick consent/agreement boxes, never opt-outs we can't read
        if (f.required || /agree|consent|terms|privacy|confirm|acknowledge/i.test(f.label)) {
          await loc.check({ timeout: 8000 }); report.push(`check:${f.label.slice(0, 25)}`);
        }
        continue;
      }
      if (f.type === 'radio') {
        const pick = f.options.findIndex((o) => YES.test(o));
        const n = pick >= 0 ? pick : 0;
        await page.locator(`[data-aa-r="${f.i}-${n}"]`).first().check({ timeout: 8000 });
        report.push(`radio:${f.label.slice(0, 20)}=${f.options[n] || ''}`);
        continue;
      }
      const answer = answerFor(f.label, CV);
      if (!answer) continue;
      if (f.type === 'select') {
        const match = f.options.find((o) => o.toLowerCase().includes(String(answer).toLowerCase())) ||
                      f.options.find((o) => YES.test(o));
        if (match) { await loc.selectOption({ label: match }, { timeout: 8000 }); report.push(`select:${f.label.slice(0, 20)}=${match}`); }
        continue;
      }
      await loc.fill(String(answer), { timeout: 8000 });
      report.push(`${f.label.slice(0, 25)}=${String(answer).slice(0, 25)}`);
    } catch (e) { /* one stubborn field must not abort the form */ }
  }
  return { count: fields.length, report };
}

const SUBMIT_RE = /^(submit|submit application|apply|apply now|send application|send|finish|complete)$/i;
const SUCCESS_RE = /thank you|thanks for (applying|your interest)|application (has been )?(received|submitted|sent|complete)|successfully applied|we (have )?received your application|your application is in/i;

/** Find a submit-ish button by visible text. */
async function findSubmit(page) {
  const handle = await page.evaluateHandle((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const els = [...document.querySelectorAll('button, input[type="submit"], a[role="button"], [role="button"]')];
    return els.find((b) => {
      const t = (b.value || b.textContent || '').trim();
      return b.getClientRects().length > 0 && !b.disabled && t.length < 40 && re.test(t);
    }) || null;
  }, SUBMIT_RE.source);
  const el = handle.asElement();
  return el || null;
}

/**
 * When we can't find a submit button, say WHERE we were and WHAT was on the page.
 * Guessing at the cause of these failures is how you end up tuning regexes blind.
 */
async function calibration(page, fieldCount) {
  const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return '?'; } })();
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button, input[type="submit"], a[role="button"]')]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => (b.value || b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 40).slice(0, 8)
  ).catch(() => []);
  return `${host} | ${fieldCount} fields | buttons: ${JSON.stringify(btns)}`;
}

/**
 * Apply to one external job. Returns {status, detail}.
 * status: applied | would-apply (dry run) | skipped | failed
 */
async function applyExternal(ctx, job, { CV, live, resumePath, log = () => {} }) {
  const page = await ctx.newPage();
  let target = page;
  try {
    await page.goto(job.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const btn = page.locator('button, a').filter({ hasText: /apply on company site/i }).first();
    if (!(await btn.count())) return { status: 'failed', detail: 'no "Apply on company site" button' };

    // the handoff usually opens a new tab; sometimes it navigates in place
    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 25000 }).catch(() => null),
      btn.click({ timeout: 15000 }).catch(() => {}),
    ]);
    target = popup || page;
    await target.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
    await target.waitForTimeout(5000); // ATS pages are SPA-heavy

    const kind = atsKind(target.url());
    if (kind === 'account') return { status: 'skipped', detail: `needs an account: ${new URL(target.url()).hostname}` };
    if (kind === 'deadend') return { status: 'skipped', detail: `not an application form: ${new URL(target.url()).hostname}` };

    // Greenhouse/Lever style landing pages need one click to reveal the form.
    // Two passes: the exact labels first, then anything apply-ish, but only while
    // the page still has no real form to fill — otherwise a stray "Apply" link
    // navigates us away from a form that was already there.
    for (const re of [/^(apply|apply for this job|apply now|i'm interested)$/i, /apply/i]) {
      const fieldCount = (await target.evaluate(COLLECT).catch(() => [])).length;
      if (fieldCount > 2) break;
      const opener = target.locator('button, a').filter({ hasText: re }).first();
      if (!(await opener.count().catch(() => 0))) continue;
      await opener.click({ timeout: 8000 }).catch(() => {});
      await target.waitForTimeout(4000);
    }

    // Confirm this is an application form before typing into it. Some handoffs land
    // on the employer's job-search page, whose filter inputs look exactly like form
    // fields — one run filled 13 of them on a search page and found no submit.
    // A real application asks for a resume or at least an email/name.
    const probe = await target.evaluate(COLLECT).catch(() => []);
    const looksLikeForm = probe.some((f) => f.type === 'file') ||
      probe.filter((f) => /e-?mail|full name|first name|resume|cover letter|phone/i.test(f.label)).length >= 2;
    if (!looksLikeForm) {
      return { status: 'skipped', detail: `no application form here — ${await calibration(target, probe.length)}` };
    }

    // up to 3 passes: fill → submit → (next step of a multi-step form)
    let filledTotal = 0;
    for (let step = 0; step < 3; step++) {
      const { count, report } = await fillFields(target, CV, resumePath);
      filledTotal += report.length;
      if (report.length) log(`    filled ${report.length}/${count}: ${report.slice(0, 6).join(', ')}`);

      if (!live) {
        const sub = await findSubmit(target);
        return { status: sub ? 'would-apply' : 'failed',
                 detail: sub ? `form filled (${filledTotal} fields), submit found — DRY RUN, not clicked`
                             : `no submit button — ${await calibration(target, count)}` };
      }

      const sub = await findSubmit(target);
      if (!sub) return { status: 'failed', detail: `no submit button — ${await calibration(target, count)}` };
      await sub.click({ timeout: 15000 }).catch(() => {});
      await target.waitForTimeout(8000);

      const body = await target.evaluate('document.body.innerText.slice(0, 4000)').catch(() => '');
      if (SUCCESS_RE.test(body) || /thank|confirm|success/i.test(target.url())) {
        return { status: 'applied', detail: `confirmed after ${step + 1} step(s)` };
      }
      // still fields left → probably a multi-step wizard, loop; otherwise give up
      const left = await target.evaluate(COLLECT).catch(() => []);
      if (!left.length) {
        return { status: 'failed', detail: 'submitted but no confirmation text found — verify manually' };
      }
    }
    return { status: 'failed', detail: 'form still incomplete after 3 steps' };
  } catch (e) {
    return { status: 'failed', detail: String(e.message || e).split('\n')[0].slice(0, 120) };
  } finally {
    if (target !== page) await target.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

module.exports = {
  applyExternal, atsKind, answerFor, SUCCESS_RE, SUBMIT_RE,
  // exposed so external-apply.test.js can drive them against a local fake form
  fillFieldsForTest: fillFields, findSubmitForTest: findSubmit,
};
