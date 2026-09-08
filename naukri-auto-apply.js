/**
 * Naukri Auto-Apply — personal data loaded from .env
 * =================================
 * HOW TO USE:
 * 1. Log in to naukri.com and open a job search, e.g.
 *    https://www.naukri.com/full-stack-developer-jobs?experience=1
 *    (any search works — the script filters titles itself).
 * 2. ALLOW POPUPS for naukri.com (the script opens each job in a popup window
 *    it controls — same origin, so one paste drives many applications).
 *    Chrome: click the blocked-popup icon in the address bar → Always allow.
 * 3. Open DevTools console (F12 → Console), paste this WHOLE file, press Enter.
 *    Keep BOTH the search tab and the popup visible; don't close the popup.
 * 4. It starts in DRY_RUN mode: it opens each matching job and finds the Apply
 *    button but does NOT click it. Watch a couple, then set DRY_RUN = false
 *    and re-paste to apply for real.
 *
 * WHAT IT DOES PER JOB:
 * - Skips "Apply on company site" (external) and already-applied jobs.
 * - Clicks Apply (one-click — Naukri sends your profile + resume).
 * - If Naukri's chatbot questionnaire pops up, answers each question from the
 *   QA bank below (radio/chip options: picks the "yes/willing" style one;
 *   text questions: typed answer). Unmatched questions optionally go to Gemini.
 *
 * NOTES:
 * - When the current results page is exhausted it clicks Next — that reloads
 *   the page and KILLS the script; PASTE AGAIN there. Progress is kept in
 *   localStorage so it continues where it left off.
 * - Naukri changes its HTML often; lookups are text-based to survive that, but
 *   if it stops finding things, update the SELECTORS section.
 * - Auto-applying may violate Naukri's ToS. Delays are human-ish. Use at your own risk.
 */
(async function naukriAutoApply() {
  'use strict';

  // Personal data is injected by the runner from .env (window.__APPLY_CONFIG); nothing PII is hard-coded here.
  const __CFG = (typeof window !== 'undefined' && window.__APPLY_CONFIG) || {};

  // ======================= CONFIG =======================
  const CONFIG = {
    DRY_RUN: true,             // true = open jobs + locate Apply but never click it. Flip to false when ready.
    MAX_APPLICATIONS: 15,      // stop after this many applications this run (tracked across pastes)
    MIN_DELAY_MS: 8000,        // wait between applications (randomized between min/max)
    MAX_DELAY_MS: 20000,
    geminiKey: __CFG.geminiKey || '',   // optional: Gemini API key for unmatched chatbot questions

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
      'senior staff', 'principal', 'director', 'manager', 'lead', 'devops',
      'data engineer', 'qa', 'test', 'intern', 'designer', 'sales', 'marketing',
      '.net', 'c#', 'php', 'ruby', 'golang', 'ios', 'android native', 'flutter',
    ],
  };

  // ======================= CV DATA (from .env via the runner) =======================
  const CV = __CFG.CV || {
    name: '', email: '', phone: '', location: '', currentRole: '', company: '', education: '',
    yearsOfExperience: '', yearsNumber: '1', skills: '', highlights: ['', '', '', '', ''], noticePeriod: '',
    currentCTC: '', expectedCTC: '', currentSalary: '', expectedSalary: '', dob: '', gender: '',
    workAuth: '', github: '', linkedin: '', portfolio: '', links: '', remoteOk: '', relocate: '', startDate: '',
  };

  // ============== QUESTION → ANSWER BANK ==============
  // First pattern that matches the question text wins. Naukri chatbot questions
  // are often numeric/short — keep those answers terse.
  const QA_BANK = [
    [/company name|current (company|employer)|organi[sz]ation/i, CV.company],
    [/notice period|when can you (start|join)|start date|joining|how soon/i, CV.noticePeriod],
    [/current .{0,15}(ctc|salary|compensation|annual)/i, CV.currentCTC],          // bare lakhs number
    [/(expected|desired) .{0,15}(ctc|salary|compensation|pay)|salary expectation/i, CV.expectedCTC], // bare lakhs
    [/years? of (work |professional |total |relevant )?experience|how (long|many years)|total experience|relevant experience/i, CV.yearsNumber || '1'],
    [/remote|work from home|wfh/i, CV.remoteOk],
    [/reloc|move to|shift to|based out of|work from (our )?office|commute|on-?site/i, CV.relocate],
    [/e-?mail/i, CV.email], // before location — "Email address" must not match /address/
    [/where are you (based|located)|current location|city|address/i, CV.location],
    [/visa|sponsorship|work authorization|legally authorized|right to work|citizen/i, CV.workAuth],
    [/\blinkedin\b/i, CV.linkedin],
    [/\bgithub\b/i, CV.github],
    [/portfolio|personal website/i, CV.portfolio],
    [/linkedin|github|portfolio|website|link/i, CV.links],
    [/why (do you want|are you interested|this role|this company|us|join)/i,
      `I ship production features end to end. ${CV.highlights[0] || ''}. This role matches my stack directly, and I want to keep building products with real ownership.`],
    [/tell (us|me) about yourself|introduce yourself|about you|summary/i,
      `I'm ${CV.name}, ${CV.currentRole}. ${CV.highlights[0] || ''}. Previously: ${CV.highlights[2] || ''}. ${CV.highlights[3] || ''}.`],
    [/react|frontend|front-end/i,
      `Strong frontend experience: React.js, Next.js, Redux, TypeScript and Tailwind CSS, plus React Native.`],
    [/node|backend|back-end|api/i,
      `I build production backends daily: Node.js/Express and Python/FastAPI, REST + GraphQL, WebSockets, MongoDB/PostgreSQL/Redis, on cloud with Docker and CI/CD.`],
    [/\b(ai|llm|ml|machine learning|genai|langchain)\b/i,
      `AI is a core focus: production GenAI agents, RAG pipelines, tool calling, MCP and multi-agent systems.`],
    [/education|degree|university|college|qualification/i, CV.education],
    [/phone|contact number|mobile/i, CV.phone],
    [/^name$|your name|full name|candidate name|first name/i, CV.name],
  ];

  const GENERIC_ANSWER =
    `I'm ${CV.name}, ${CV.currentRole}. ` + (CV.highlights[0] || '') + '.';

  // ======================= HELPERS =======================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const humanDelay = () => sleep(CONFIG.MIN_DELAY_MS + Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS));
  // Instantly materialising a full sentence is the most obviously non-human thing
  // the script does. Insert it in 1-3 char bursts with jittered gaps instead.
  const typeLikeHuman = async (doc, text) => {
    for (let i = 0; i < text.length;) {
      const n = 1 + Math.floor(Math.random() * 3);
      doc.execCommand('insertText', false, text.slice(i, i + n));
      i += n;
      await sleep(45 + Math.random() * 95);
    }
  };
  const log = (...a) => console.log('%c[auto-apply]', 'color:#4a90d9;font-weight:bold', ...a);

  function visible(el) {
    return el && el.offsetParent !== null && !el.disabled;
  }

  function findButtonByText(root, regex) {
    return [...root.querySelectorAll('button, a, [role="button"], [type="submit"], div[class*="btn" i]')]
      .find((b) => visible(b) && regex.test(b.textContent.trim()) && b.textContent.trim().length < 40);
  }

  async function waitFor(fn, timeoutMs = 10000, pollMs = 300) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      let res = null;
      try { res = fn(); } catch (e) { /* popup mid-navigation */ }
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
                `You are answering a job application chatbot question on my behalf. Answer in first person, 1-3 sentences, professional, no markdown. If the question expects a number, answer with just the number.\n\nMy CV:\n${JSON.stringify(CV)}\n\nQuestion: ${questionText}` }] }],
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

  // ======================= SELECTORS (edit here if Naukri changes) =======================
  const SELECTORS = {
    // job cards on the search results page
    jobCards: '.srp-jobtuple-wrapper, article.jobTuple',
    jobTitleLink: 'a.title',
    // job detail page (inside the popup)
    applyButtonText: /^apply$/i,
    externalApplyText: /company site/i,
    alreadyAppliedText: /^applied/i,
    // "you have already applied" deliberately NOT here — it's a duplicate-apply
    // rejection, not a new application; counting it inflated state.applied.
    appliedToast: /successfully applied|applied successfully|application sent|application submitted/i,
    alreadyAppliedToast: /you have already applied/i,
    // chatbot questionnaire drawer (appears after Apply on some jobs)
    chatbot: '[class*="chatbot" i], [class*="_drawer" i][class*="chat" i]',
    botMessage: '[class*="botMsg" i], [class*="bot-msg" i], [class*="message" i] span',
    chatInput: 'div[contenteditable="true"], [class*="chatbot" i] textarea, [class*="chatbot" i] input[type="text"]',
    chatSendText: /^send$|^save$|^submit$|^ok$|^done$/i,
    chatOption: '[class*="chatbot" i] label, [class*="chip" i], [class*="radio" i] label, [class*="checkbox" i] label',
    nextPageText: /^next$/i,
  };

  // ======================= CROSS-PASTE STATE =======================
  const STORE_KEY = 'autoApplyNaukri';
  let state;
  try { state = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { state = {}; }
  if (!Array.isArray(state.seen)) state.seen = [];
  if (typeof state.applied !== 'number') state.applied = 0;
  const saveState = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

  const titleOk = (t) => {
    const lower = t.toLowerCase();
    return CONFIG.TITLE_KEYWORDS.some((k) => lower.includes(k)) &&
           !CONFIG.TITLE_BLOCKLIST.some((k) => lower.includes(k));
  };

  // ======================= CHATBOT QUESTIONNAIRE (inside popup) =======================
  async function handleChatbot(doc) {
    const YES = /yes|willing|open to|agree|relocat|remote|immediat|i am able|i can|bengaluru|bangalore/i;

    for (let turn = 0; turn < 15; turn++) {
      await sleep(2500);
      const drawer = doc.querySelector(SELECTORS.chatbot);
      if (!drawer || !visible(drawer)) return true;    // chatbot gone → done

      // Latest bot question = last non-empty bot message in the drawer
      const msgs = [...drawer.querySelectorAll(SELECTORS.botMessage)]
        .map((m) => m.textContent.trim()).filter(Boolean);
      const question = msgs[msgs.length - 1] || drawer.textContent.trim().slice(0, 200);
      log(`  🤖 Q: "${question.slice(0, 80)}"`);

      // 1. Option chips / radios / checkboxes → pick the YES-style one, else the first
      const options = [...drawer.querySelectorAll(SELECTORS.chatOption)].filter(visible)
        .filter((o) => o.textContent.trim().length > 0 && o.textContent.trim().length < 60);
      if (options.length) {
        const pick = options.find((o) => YES.test(o.textContent)) || options[0];
        pick.click();
        log(`  ☑ picked option: "${pick.textContent.trim().slice(0, 50)}"`);
      } else {
        // 2. Free-text answer into the contenteditable / input
        const input = [...drawer.querySelectorAll(SELECTORS.chatInput)].filter(visible).pop();
        if (!input) { log('  ⚠ chatbot: no options and no input found — finish it manually.'); return false; }
        const answer = await answerQuestion(question);
        if (input.isContentEditable) {
          // execCommand performs a real edit, so the browser fires a trusted
          // input event; setting .textContent left the framework's state empty.
          // Verified in Chrome: inserts the text and fires `input`.
          input.focus();
          doc.getSelection().selectAllChildren(input);
          await typeLikeHuman(doc, String(answer));
        } else {
          const proto = input.tagName === 'TEXTAREA' ? doc.defaultView.HTMLTextAreaElement.prototype
                                                     : doc.defaultView.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, answer);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        log(`  ✍ A: "${String(answer).slice(0, 60)}"`);
      }

      await sleep(800);
      const send = findButtonByText(drawer, SELECTORS.chatSendText) ||
                   drawer.querySelector('[class*="send" i]');
      if (send) send.click();
      else {
        // some inputs submit on Enter
        const input = [...drawer.querySelectorAll(SELECTORS.chatInput)].filter(visible).pop();
        input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      }
    }
    log('  ⚠ chatbot: too many turns — finish it manually.');
    return false;
  }

  // ======================= APPLY TO ONE JOB (in popup) =======================
  async function applyInPopup(popup, job) {
    popup.location.href = job.href;
    const applyBtn = await waitFor(() => {
      const doc = popup.document;
      if (!doc || doc.readyState !== 'complete') return null;
      if (findButtonByText(doc, SELECTORS.externalApplyText)) return 'external';
      const btn = findButtonByText(doc, SELECTORS.applyButtonText) ||
                  doc.querySelector('#apply-button, button[id*="apply" i]');
      if (btn && SELECTORS.alreadyAppliedText.test(btn.textContent.trim())) return 'applied';
      return btn;
    }, 15000);

    if (!applyBtn) { log('  ⚠ no Apply button found — skipping.'); return false; }
    // In-page JS can't follow the handoff to the employer's domain (cross-origin),
    // so hand the job to the Node runner, which applies on the company site itself.
    if (applyBtn === 'external') { log(`  🔗 EXTERNAL | ${job.title} | ${job.href}`); return false; }
    if (applyBtn === 'applied') { log('  already applied — skipping.'); return false; }

    if (CONFIG.DRY_RUN) {
      log(`  🔍 DRY_RUN — would click: "${applyBtn.textContent.trim()}". Set DRY_RUN=false to apply for real.`);
      return true;
    }

    applyBtn.click();

    const doc = popup.document;
    // Only the button we actually clicked counts as a state change. Scanning every
    // button for /^applied/i matched unrelated chrome ("Applied filters", an
    // already-applied entry in a similar-jobs rail) and confirmed a success that
    // never happened. If Naukri swaps the node out instead of relabelling it,
    // isConnected goes false and we fall back to the toast text.
    const confirmed = () =>
      SELECTORS.appliedToast.test(doc.body.textContent) ||
      (applyBtn.isConnected && SELECTORS.alreadyAppliedText.test(applyBtn.textContent.trim()));

    // Race the questionnaire drawer against the applied confirmation, whichever
    // lands first. A fixed sleep raced the drawer's render and silently skipped
    // the questions; polling the drawer alone stalled the full timeout on every
    // direct apply, which is the common case.
    const outcome = await waitFor(() => {
      if (SELECTORS.alreadyAppliedToast.test(doc.body.textContent)) return 'duplicate';
      const d = doc.querySelector(SELECTORS.chatbot);
      if (d && visible(d)) return 'chatbot';
      return confirmed() ? 'applied' : null;
    }, 10000);
    if (outcome === 'duplicate') { log('  ↩ already applied to this job — not counting it.'); return false; }
    if (outcome === 'chatbot') {
      const ok = await handleChatbot(doc);
      if (!ok) return false;
    }

    // Confirm success (toast or Apply button turned into "Applied")
    const success = outcome === 'applied' || await waitFor(confirmed, 10000);
    if (success) {
      log('  ✅ applied');
    } else {
      // The confirmation wording is the one thing we could not verify without a real
      // apply. Dump what the page actually said so the regex can be calibrated
      // instead of guessing again.
      const btns = [...doc.querySelectorAll('button')].filter(visible)
        .map((b) => b.textContent.trim()).filter(Boolean).slice(0, 8);
      log('  ⚠ could not confirm success — check the popup.');
      log(`  🔬 calibration — visible buttons: ${JSON.stringify(btns)}`);
      log(`  🔬 calibration — page text: "${doc.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)}"`);
    }
    return !!success;
  }

  // ======================= MAIN LOOP =======================
  log(`Starting. DRY_RUN=${CONFIG.DRY_RUN}, max=${CONFIG.MAX_APPLICATIONS}, applied so far: ${state.applied}`);
  if (!/naukri\./.test(location.hostname)) { log('⚠ Open a naukri.com job search first.'); return; }

  const popup = window.open('about:blank', 'naukriApplyPopup', 'width=1250,height=900');
  if (!popup) {
    log('🚫 POPUP BLOCKED. Allow popups for naukri.com (address-bar icon → Always allow), then paste again.');
    return;
  }

  while (state.applied < CONFIG.MAX_APPLICATIONS) {
    const cards = [...document.querySelectorAll(SELECTORS.jobCards)].filter(visible);
    let job = null;

    let nSeen = 0, nFiltered = 0;
    for (const card of cards) {
      const link = card.querySelector(SELECTORS.jobTitleLink);
      if (!link) continue;
      const title = link.textContent.replace(/\s+/g, ' ').trim();
      if (state.seen.includes(link.href)) { nSeen++; continue; }
      if (!titleOk(title)) { nFiltered++; continue; }
      job = { href: link.href, title, card };
      break;
    }

    if (!job) {
      const sample = cards.slice(0, 3).map((c) =>
        `"${(c.querySelector(SELECTORS.jobTitleLink)?.textContent || '?').trim().slice(0, 40)}"`).join(', ');
      // Split the two very different reasons for "nothing to do here": jobs already
      // visited on an earlier run vs jobs the title filter rejected. Reporting a
      // combined "0 match" made an exhausted page look like a broken filter.
      log(`(this page: ${cards.length} cards — ${nSeen} already seen, ${nFiltered} filtered out; sample: ${sample})`);
      const nextBtn = findButtonByText(document, SELECTORS.nextPageText);
      if (nextBtn) {
        log('🌐 Next results page — the page will reload. PASTE THE SCRIPT AGAIN when it loads.');
        popup.close();
        nextBtn.click();
        return;
      }
      log('No more pages. Change your search and paste again.');
      break;
    }

    state.seen.push(job.href);
    saveState();
    log(`▶ Applying: ${job.title} | ${job.href}`);
    job.card.scrollIntoView({ block: 'center' });

    const ok = await applyInPopup(popup, job);
    if (ok && !CONFIG.DRY_RUN) {
      state.applied++;
      saveState();
      log(`  progress: ${state.applied}/${CONFIG.MAX_APPLICATIONS}`);
    }
    await humanDelay();
  }

  popup.close();
  log(CONFIG.DRY_RUN
    ? 'DRY RUN finished — nothing was actually sent. Set CONFIG.DRY_RUN = false and re-paste to apply for real.'
    : `Finished. Applied to ${state.applied} jobs total. Clear localStorage["${STORE_KEY}"] to reset the counter.`);
})();
