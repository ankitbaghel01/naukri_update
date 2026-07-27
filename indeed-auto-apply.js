/**
 * Indeed Auto-Apply — personal data loaded from .env
 * =================================
 * HOW TO USE:
 * 1. Log in to indeed.com and open a job search, e.g.
 *    https://in.indeed.com/jobs?q=full+stack+developer&l=Remote
 *    (any search works — the script filters titles itself and only touches
 *    "Easily apply" jobs; external-site jobs are skipped).
 * 2. Open DevTools console (F12 → Console), paste this WHOLE file, press Enter.
 * 3. IMPORTANT — clicking Apply opens smartapply.indeed.com in a NEW TAB, and a
 *    pasted script cannot follow you into another tab. So the flow is:
 *      • On the SEARCH page the script finds the next matching "Easily apply"
 *        job and clicks Apply → the application form opens in a NEW TAB.
 *      • SWITCH TO THAT NEW TAB, open its console (F12), and PASTE THIS SAME
 *        FILE AGAIN — it detects the form, fills every step (contact info,
 *        resume, questions), and submits.
 *      • Close the form tab, go back to the search tab, paste again for the
 *        next job. Repeat. (Pasting again in the SEARCH tab does NOT fill the
 *        form — it just moves on to the next job.)
 *    Progress (jobs already tried, submit count) is kept in localStorage, so
 *    re-pasting always continues where it left off.
 * 4. It starts in DRY_RUN mode: on the form it fills everything but stops
 *    before the final "Submit your application". Watch one run, then set
 *    DRY_RUN = false and re-paste.
 *
 * NOTES:
 * - Indeed uses Cloudflare bot detection aggressively. The delays are
 *   deliberately human-ish; don't lower them. Auto-applying may violate
 *   Indeed's ToS and can get your account flagged. Use at your own risk.
 * - Selectors are text-based where possible to survive Indeed's HTML churn;
 *   if something stops being found, update the SELECTORS section.
 * - Optional: put a Gemini API key in CONFIG.geminiKey and unmatched form
 *   questions get answered by Gemini using your CV.
 */
(async function indeedAutoApply() {
  'use strict';

  // Personal data is injected by the runner from .env (window.__APPLY_CONFIG); nothing PII is hard-coded here.
  const __CFG = (typeof window !== 'undefined' && window.__APPLY_CONFIG) || {};

  // ======================= CONFIG =======================
  const CONFIG = {
    DRY_RUN: true,             // true = fill forms but never click final Submit. Flip to false when ready.
    MAX_APPLICATIONS: 15,      // stop after this many submitted applications (tracked across pastes)
    MIN_DELAY_MS: 8000,        // wait between actions (randomized between min/max)
    MAX_DELAY_MS: 20000,
    geminiKey: __CFG.geminiKey || '',   // optional: Gemini API key for unmatched questions

    // Job titles to apply to (case-insensitive substring match on the job title)
    TITLE_KEYWORDS: [
      'full stack', 'fullstack', 'full-stack', 'mern', 'backend', 'back end',
      'frontend', 'front end', 'software engineer', 'software developer',
      'web developer', 'ai engineer', 'ai developer', 'ai specialist',
      'ml engineer', 'artificial intelligence', 'machine learning',
      'generative ai', 'gen ai', 'genai', 'llm', 'agentic',
      'react', 'node', 'javascript', 'js developer', 'js engineer',
      'typescript', 'python', 'mobile',
      'react native', 'sde', 'member of technical staff',
    ],
    // Skip jobs whose title contains any of these
    TITLE_BLOCKLIST: [
      // 'ai trainer' gig postings (DataAnnotation etc.): their apply wizard hangs at a
      // never-resolving spinner, so they burn time without ever submitting
      'trainer', 'annotation',
      'senior', 'sr.', 'sr ', 'principal', 'director', 'manager', 'lead', 'devops',
      'data engineer', 'qa', 'test', 'intern', 'designer', 'sales', 'marketing',
      '.net', 'c#', 'php', 'ruby', 'golang', 'ios', 'android native', 'flutter',
    ],
  };

  // ======================= CV DATA (from .env via the runner) =======================
  const CV = __CFG.CV || {
    name: '', email: '', phone: '', location: '', currentRole: '', company: '', education: '',
    yearsOfExperience: '', skills: '', highlights: ['', '', '', '', ''], noticePeriod: '',
    currentCTC: '', expectedCTC: '', currentSalary: '', expectedSalary: '', dob: '', gender: '',
    workAuth: '', github: '', linkedin: '', portfolio: '', links: '', remoteOk: '', relocate: '', startDate: '',
  };

  // ============== QUESTION → ANSWER BANK ==============
  // First pattern that matches the question text wins. Answers come from the CV above.
  const QA_BANK = [
    [/job ?title|designation|current (role|position)/i, CV.currentRole.split(' at ')[0] || CV.currentRole],
    [/^company\b|company name|current (company|employer)|organi[sz]ation/i, CV.company],
    [/years? of (work |professional )?experience|how (long|many years)/i,
      `1`], // Indeed experience questions are usually numeric inputs; text fallback below
    [/notice period|when can you (start|join)|start date|joining/i, CV.startDate],
    [/current .{0,15}(ctc|salary|compensation)/i, CV.currentSalary],
    [/(expected|desired) .{0,15}(ctc|salary|compensation|pay)|salary expectation/i, CV.expectedSalary],
    [/date of birth|\bdob\b|dd\/mm/i, CV.dob],
    [/\blinkedin\b/i, CV.linkedin],
    [/\bgithub\b/i, CV.github],
    [/portfolio|personal website/i, CV.portfolio],
    [/remote|work from home|wfh/i, CV.remoteOk],
    [/reloc|move to|shift to|based out of|work from (our )?office|commute|on-?site/i, CV.relocate],
    [/visa|sponsorship|work authorization|legally authorized|right to work|citizen/i, CV.workAuth],
    [/e-?mail/i, CV.email], // before the location pattern — "Email address" must not match /address/
    [/where are you (based|located)|current location|city|address/i, CV.location],
    [/linkedin|github|portfolio|website|link/i, CV.links],
    [/why (do you want|are you interested|this role|this company|us|join)/i,
      `I ship production features end to end. ${CV.highlights[0] || ''}. This role matches my stack directly, and I want to keep building products with real ownership.`],
    [/tell (us|me) about yourself|introduce yourself|about you|summary/i,
      `I'm ${CV.name}, ${CV.currentRole}. ${CV.highlights[0] || ''}. Previously: ${CV.highlights[2] || ''}. ${CV.highlights[3] || ''}.`],
    [/(biggest|proudest|favorite) (project|achievement|accomplishment)|worked on/i,
      `${CV.highlights[0] || ''}. I owned it end to end, from architecture through deployment and CI/CD.`],
    [/react|frontend|front-end/i,
      `Strong frontend experience: React.js, Next.js, Redux, TypeScript and Tailwind CSS, plus React Native for cross-platform mobile apps.`],
    [/node|backend|back-end|api/i,
      `I build production backends daily: Node.js/Express and Python/FastAPI, REST + GraphQL, WebSockets, MongoDB/PostgreSQL/Redis, on cloud with Docker and CI/CD.`],
    [/\b(ai|llm|ml|machine learning|genai|langchain)\b/i,
      `AI is a core focus: production GenAI agents, RAG pipelines, prompt engineering, tool calling, MCP and multi-agent systems.`],
    [/education|degree|university|college|qualification/i, CV.education],
    [/phone|contact number|mobile/i, CV.phone],
    [/e-?mail/i, CV.email],
    [/name/i, CV.name],
  ];

  const GENERIC_ANSWER =
    `I'm ${CV.name}, ${CV.currentRole}. Happy to elaborate in an interview — key highlights: ` +
    CV.highlights.slice(0, 2).join('; ') + '.';

  // ============== COVER LETTER (Indeed sometimes has an optional cover-letter step) ==============
  function coverLetter(company, title) {
    const role = CV.currentRole.split(' at ')[0] || 'a developer';
    return `Hi ${company ? company + ' team' : 'there'},

I'm ${CV.name}, ${role}, and the ${title || 'open engineering'} role is exactly the kind of work I do every day. ${CV.highlights[0] || ''}${CV.highlights[1] ? '. ' + CV.highlights[1] : ''}.

${[CV.highlights[3], CV.highlights[4]].filter(Boolean).join('. ')}.

I move fast, own features end to end, and I'd love to bring that to ${company || 'your team'}. Happy to chat anytime.

Best,
${CV.name}
${CV.email} | ${CV.phone}`;
  }

  // ======================= HELPERS =======================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const humanDelay = () => sleep(CONFIG.MIN_DELAY_MS + Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS));
  const log = (...a) => console.log('%c[auto-apply]', 'color:#2557a7;font-weight:bold', ...a);

  // React-controlled inputs ignore plain .value writes — use the native setter + input event.
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
                : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function labelTextOf(el) {
    return (
      el.closest('label')?.textContent ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
      el.closest('fieldset')?.querySelector('legend')?.textContent ||
      el.closest('div')?.previousElementSibling?.textContent ||
      el.parentElement?.textContent || ''
    ).trim();
  }

  function visible(el) {
    return el && el.offsetParent !== null && !el.disabled;
  }

  function findButtonByText(root, regex) {
    return [...root.querySelectorAll('button, a[role="button"], [type="submit"]')]
      .find((b) => visible(b) && regex.test(b.textContent.trim()));
  }

  async function waitFor(fn, timeoutMs = 8000, pollMs = 300) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const res = fn();
      if (res) return res;
      await sleep(pollMs);
    }
    return null;
  }

  async function answerQuestion(questionText) {
    for (const [pattern, answer] of QA_BANK) {
      if (pattern.test(questionText)) return answer;
    }
    if (CONFIG.geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text:
                `You are answering a job application question on my behalf. Answer in first person, 2-4 sentences, professional, no markdown. If the question expects a number, answer with just the number.\n\nMy CV:\n${JSON.stringify(CV)}\n\nQuestion: ${questionText}` }] }],
            }),
          }
        );
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (e) {
        log('Gemini call failed, using generic answer:', e.message);
      }
    }
    return GENERIC_ANSWER;
  }

  // ======================= SELECTORS (edit here if Indeed changes) =======================
  const SELECTORS = {
    // job cards on the search results page
    jobCards: '#mosaic-provider-jobcards li .job_seen_beacon, .job_seen_beacon',
    jobTitleLink: 'h2 a, h3 a, a.jcs-JobTitle, [data-testid="jobTitle"] a',
    easilyApplyBadge: /easily apply/i,
    // right-hand detail pane. Indeed dropped #indeedApplyButton — the button now
    // has a random hash id, so match by aria-label with text as final fallback.
    applyButton: '#indeedApplyButton, button[id*="indeedApply" i], button[aria-label*="apply with indeed" i], button[aria-label*="apply now" i]',
    applyButtonText: /apply now|easily apply|apply with indeed/i,
    alreadyApplied: /\bapplied\b/i,   // "Applied" chip; note "Easily apply" does NOT contain "applied"
    nextPage: 'a[data-testid="pagination-page-next"]',
    // smartapply form flow
    continueText: /^continue$|^next$|review your application|^review$/i,
    submitText: /submit( your)? application|^submit$/i,
    returnText: /return to (job )?search|find more jobs/i,
  };

  // ======================= CROSS-PASTE STATE (localStorage, per-origin) =======================
  // ponytail: indeed.com and smartapply.indeed.com have separate localStorage —
  // seen-jobs live on indeed.com, submit-count on smartapply. Good enough; a
  // Tampermonkey userscript with GM_setValue would unify them if this ever matters.
  const STORE_KEY = 'autoApply';
  const state = JSON.parse(localStorage.getItem(STORE_KEY) || '{"seen":[],"submitted":0}');
  const saveState = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

  const titleOk = (t) => {
    const lower = t.toLowerCase();
    return CONFIG.TITLE_KEYWORDS.some((k) => lower.includes(k)) &&
           !CONFIG.TITLE_BLOCKLIST.some((k) => lower.includes(k));
  };

  // ======================= MODE 1: SEARCH RESULTS PAGE =======================
  // Finds the next matching "Easily apply" job, opens its detail pane, clicks
  // Apply. That navigates to smartapply.indeed.com and this script dies —
  // paste the same file again there to fill the form.
  async function runSearchPage() {
    log(`SEARCH mode. Seen so far: ${state.seen.length} jobs. After Apply is clicked the form opens in a NEW TAB — paste this file again in that tab's console.`);

    while (true) {
      const cards = [...document.querySelectorAll(SELECTORS.jobCards)].filter(visible);
      let next = null;

      for (const card of cards) {
        const link = card.querySelector(SELECTORS.jobTitleLink);
        if (!link) continue;
        const title = link.textContent.replace(/\s+/g, ' ').trim();
        const jk = link.getAttribute('data-jk') || (link.href.match(/jk=([a-f0-9]+)/i) || [])[1] || link.href;
        if (state.seen.includes(jk)) continue;
        if (!titleOk(title)) continue;
        if (!SELECTORS.easilyApplyBadge.test(card.textContent)) continue;   // external-site jobs: skip
        if (SELECTORS.alreadyApplied.test(card.textContent.trim())) continue;
        next = { card, link, title, jk };
        break;
      }

      if (!next) {
        const sample = cards.slice(0, 3).map((c) =>
          `"${(c.querySelector(SELECTORS.jobTitleLink)?.textContent || '?').trim().slice(0, 40)}"`).join(', ');
        log(`(this page: ${cards.length} cards, 0 match — sample: ${sample})`);
        const nextBtn = document.querySelector(SELECTORS.nextPage);
        if (nextBtn && visible(nextBtn)) {
          log('🌐 Next results page… (Indeed paginates with a full page load — PASTE THE SCRIPT AGAIN when it loads)');
          nextBtn.click();
          return;
        }
        log('No more pages. Change your search query/filters and paste again.');
        return;
      }

      state.seen.push(next.jk);
      saveState();
      log(`▶ Opening: ${next.title} | ${next.link.href}`);
      next.link.scrollIntoView({ block: 'center' });
      await sleep(800);
      next.link.click();                              // opens right-hand detail pane (same page)
      await sleep(3000);

      const applyBtn = await waitFor(() =>
        document.querySelector(SELECTORS.applyButton) ||
        findButtonByText(document, SELECTORS.applyButtonText));

      if (!applyBtn) { log('  ⚠ no Apply button in pane (external job?) — next.'); continue; }
      if (SELECTORS.alreadyApplied.test(applyBtn.textContent.trim())) { log('  already applied — next.'); continue; }

      log(`  🖱 clicking Apply — the form opens in a NEW TAB. Switch to that tab and PASTE THIS FILE AGAIN in ITS console.`);
      await sleep(1500);
      applyBtn.click();
      return;                                          // form opens in a new tab — this instance is done
    }
  }

  // ======================= MODE 2: SMARTAPPLY FORM PAGE =======================
  // Multi-step wizard: contact info → resume → employer questions → review → submit.
  // Steps vary per job, so we loop generically: fill everything visible, click
  // Continue, repeat until the Submit button appears.
  async function fillCurrentStep() {
    const scope = document.querySelector('main') || document.body;
    const pageText = scope.textContent;

    // Resume step: pick the already-uploaded Indeed resume card if present
    const resumeCard = [...scope.querySelectorAll('[data-testid*="Resume" i], [class*="resume" i]')]
      .find((el) => visible(el) && /\.pdf|\.docx?|indeed resume/i.test(el.textContent));
    if (resumeCard && /choose|select|which resume/i.test(pageText)) {
      resumeCard.click();
      log('  📄 resume selected');
      await sleep(800);
    }

    // Textareas: cover letter box gets the letter, question boxes get QA answers
    for (const ta of [...scope.querySelectorAll('textarea')].filter(visible)) {
      if (ta.value.trim()) continue;
      const label = labelTextOf(ta);
      const answer = /cover letter|message to|why.*hire|anything else/i.test(label)
        ? coverLetter('', document.title.split(' - ')[0])
        : await answerQuestion(label);
      const taRequired = ta.required || ta.getAttribute('aria-required') === 'true' || /\*/.test(label);
      if (answer === GENERIC_ANSWER && !taRequired) { log(`  ⏭ optional unknown question skipped: "${label.slice(0, 50)}"`); continue; }
      setValue(ta, answer);
      log(`  ✍ textarea: "${label.slice(0, 60)}"`);
    }

    // Text/number/tel/email inputs
    for (const input of [...scope.querySelectorAll(
      'input[type="text"], input[type="number"], input[type="tel"], input[type="email"], input:not([type])'
    )].filter(visible)) {
      if (input.value.trim()) continue;                // contact info is usually prefilled — leave it
      const label = labelTextOf(input);
      // never guess government IDs — wrong data is worse than a skipped job
      if (/pan\b|aadhaar|passport/i.test(label)) continue;
      let answer = await answerQuestion(label);
      const inRequired = input.required || input.getAttribute('aria-required') === 'true' || /\*/.test(label);
      if (answer === GENERIC_ANSWER && !inRequired) { log(`  ⏭ optional unknown question skipped: "${label.slice(0, 50)}"`); continue; }
      if (input.type === 'number' || /years|salary|ctc|notice/i.test(label)) {
        const num = (answer.match(/\d+/) || ['1'])[0]; // numeric fields want a bare number
        answer = /notice/i.test(label) ? '15' : num;
      }
      setValue(input, answer);
      log(`  ✍ input: "${label.slice(0, 60)}" → "${String(answer).slice(0, 40)}"`);
    }

    // Selects / radios / checkboxes — prefer "yes / willing / open to" answers
    const YES = /yes|willing|open to|agree|relocat|remote|immediat|i am able|i can/i;
    const NO_PLACEHOLDER = /^select|^choose|^--|^pick/i;

    for (const sel of [...scope.querySelectorAll('select')].filter(visible)) {
      if (sel.value && !NO_PLACEHOLDER.test(sel.selectedOptions[0]?.text || '')) continue;
      const opts = [...sel.options].filter((o) => o.value && !NO_PLACEHOLDER.test(o.text.trim()));
      if (!opts.length) continue;
      const pick = opts.find((o) => YES.test(o.text)) ||
                   opts.find((o) => /bengaluru|bangalore|india/i.test(o.text)) ||
                   opts[0];
      setValue(sel, pick.value);
      log(`  ☑ select "${pick.text.trim()}" for "${labelTextOf(sel).slice(0, 50)}"`);
    }

    const radioGroups = {};
    for (const r of [...scope.querySelectorAll('input[type="radio"]')].filter(visible)) {
      (radioGroups[r.name || labelTextOf(r)] ||= []).push(r);
    }
    for (const group of Object.values(radioGroups)) {
      if (group.some((r) => r.checked)) continue;
      const groupCtx = (group[0].closest('fieldset')?.textContent || group.map((r) => labelTextOf(r)).join(' ')).slice(0, 200);
      let pick = null;
      if (/gender|^sex\b/i.test(groupCtx)) {
        pick = group.find((r) => { const l = labelTextOf(r); return /male/i.test(l) && !/female/i.test(l); });
      } else if (/disability|disabled/i.test(groupCtx)) {
        pick = group.find((r) => /no disability|not disabled|^no\b|none/i.test(labelTextOf(r)));
      } else if (/veteran|race|ethnic|religion|caste/i.test(groupCtx)) {
        continue; // still never guess these
      }
      pick = pick || group.find((r) => YES.test(labelTextOf(r))) || group[0];
      pick.click();
      log(`  ☑ radio "${labelTextOf(pick).slice(0, 50)}"`);
    }

    for (const cb of [...scope.querySelectorAll('input[type="checkbox"]')].filter(visible)) {
      const own = labelTextOf(cb);
      if (!cb.checked && /relocat|agree|confirm|authoriz|terms|acknowledge|remote|consent/i.test(own)) {
        cb.click();
        log(`  ☑ checked "${own.slice(0, 50)}"`);
      }
    }
  }

  async function runSmartApply() {
    log(`FORM mode. Submitted so far (this browser): ${state.submitted}.`);
    if (CONFIG.DRY_RUN) log('⚠️ DRY_RUN is ON — the form will be FILLED but NOT submitted. Set DRY_RUN: false at the top of this file to actually apply.');
    if (state.submitted >= CONFIG.MAX_APPLICATIONS) {
      log(`MAX_APPLICATIONS (${CONFIG.MAX_APPLICATIONS}) reached — not submitting. Clear localStorage["${STORE_KEY}"] to reset.`);
      return;
    }

    let misses = 0; // consecutive rounds with no button — the wizard shows a spinner between steps
    for (let step = 0; step < 20; step++) {           // wizard has at most a handful of steps
      await sleep(2000);
      await fillCurrentStep();
      await sleep(1000);

      const submitBtn = findButtonByText(document, SELECTORS.submitText);
      if (submitBtn) {
        if (CONFIG.DRY_RUN) {
          log(`🔍 DRY_RUN — would click: "${submitBtn.textContent.trim()}". Set DRY_RUN=false and re-paste to submit for real.`);
          return;
        }
        submitBtn.click();
        state.submitted++;
        saveState();
        log(`✅ application submitted (${state.submitted}/${CONFIG.MAX_APPLICATIONS})`);
        await sleep(4000);
        const back = findButtonByText(document, SELECTORS.returnText) ||
                     [...document.querySelectorAll('a')].find((a) => visible(a) && SELECTORS.returnText.test(a.textContent));
        if (back) { log('↩ returning to search — PASTE THE SCRIPT AGAIN THERE for the next job.'); await humanDelay(); back.click(); }
        return;
      }

      const contBtn = findButtonByText(document, SELECTORS.continueText);
      if (!contBtn) {
        misses++;
        if (misses >= 4) {
          log('  ⚠ no Continue/Submit button after several waits — a required field may be blocking. Finish this one manually.');
          return;
        }
        log('  ⏳ no button yet (spinner/loading) — waiting…');
        await sleep(5000);
        continue;
      }
      misses = 0;
      log(`  ➡ step ${step + 1}: "${contBtn.textContent.trim()}"`);
      contBtn.click();
    }
    log('⚠ too many wizard steps — stopping. Finish this one manually.');
  }

  // ======================= ENTRY: detect which page we're on =======================
  log(`Starting. DRY_RUN=${CONFIG.DRY_RUN}, max=${CONFIG.MAX_APPLICATIONS}, host=${location.hostname}`);
  if (/smartapply/.test(location.hostname) || /indeedapply|\/apply/.test(location.pathname)) {
    await runSmartApply();
  } else if (/indeed\./.test(location.hostname)) {
    await runSearchPage();
  } else {
    log('⚠ This does not look like an Indeed page. Open an indeed.com job search first.');
  }
})();
