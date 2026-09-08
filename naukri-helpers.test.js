/** node naukri-helpers.test.js — throws on the first failure, silent + exit 0 when green. */
const assert = require('assert');
const { nextHeadline, uploadedToday } = require('./naukri-helpers');

// dot cycle: "" → "." → ".." → "" and never a no-op (a no-op = Naukri sees no edit)
assert.strictEqual(nextHeadline('Full stack dev'), 'Full stack dev.');
assert.strictEqual(nextHeadline('Full stack dev.'), 'Full stack dev..');
assert.strictEqual(nextHeadline('Full stack dev..'), 'Full stack dev');
assert.strictEqual(nextHeadline('Full stack dev  '), 'Full stack dev.'); // trailing space
for (const h of ['', 'x', 'x.', 'x..', 'x...', 'Ends with a sentence.']) {
  assert.notStrictEqual(nextHeadline(h), h.trimEnd(), `no-op cycle for ${JSON.stringify(h)}`);
}

// uploaded-on parsing — the bug: today's date elsewhere on the page must NOT count
const now = new Date('2026-08-12T10:00:00');
assert.strictEqual(uploadedToday('Uploaded on Aug 12, 2026', now), true);
assert.strictEqual(uploadedToday('Uploaded on Aug 09, 2026', now), false);
assert.strictEqual(uploadedToday('Uploaded on Aug 9, 2026', now), false);
assert.strictEqual(uploadedToday('Uploaded on: August 12, 2026', now), true);
assert.strictEqual(
  uploadedToday('Profile last updated Aug 12, 2026\nResume\nUploaded on Aug 09, 2026', now),
  false,
  'a today date elsewhere on the page must not mask a stale resume'
);
assert.strictEqual(uploadedToday('Uploaded on', now), false); // unparseable → re-upload
assert.strictEqual(uploadedToday('', now), false);

// ---- the job titles that MUST be applied to ----
// titleOk lives inside the browser-injected IIFE, so lift the two lists out of the
// source text rather than duplicating them here (a copy would rot silently).
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'naukri-auto-apply.js'), 'utf8');
const list = (name) => JSON.parse(
  new RegExp(`${name}:\\s*(\\[[^\\]]*\\])`).exec(src)[1]
    .replace(/\/\/[^\n]*/g, '')   // drop line comments
    .replace(/'/g, '"')           // JS single-quoted → JSON (no apostrophes in these entries)
    .replace(/,\s*\]$/, ']')      // trailing comma
);
const KEYWORDS = list('TITLE_KEYWORDS');
const BLOCKLIST = list('TITLE_BLOCKLIST');
const titleOk = (t) => {
  const lower = t.toLowerCase();
  return KEYWORDS.some((k) => lower.includes(k)) && !BLOCKLIST.some((k) => lower.includes(k));
};

for (const title of [
  'Full stack developer', 'AI Full stack developer', 'Full stack engineer',
  'software developer', 'software engineer', 'Web developer', 'AI Engineer',
  'Gen AI engineer', 'Generative AI Engineer', 'Generative AI Developer', 'Gen AI Developer',
  'Backend engineer', 'Backend developer', 'frontend Engineer', 'frontend Developer',
]) {
  assert.ok(titleOk(title), `must apply to: ${title}`);
}

// and must still skip the ones deliberately blocked
for (const title of ['QA Engineer', 'DevOps Engineer', 'Engineering Manager', '.NET Developer']) {
  assert.ok(!titleOk(title), `must skip: ${title}`);
}

// Titles that MATCH a keyword and must still be blocked — without these the
// blocklist is untested, since the cases above never get past the keyword check.
for (const title of ['Full Stack Team Lead', 'Backend QA Engineer', 'Python Test Engineer',
                     'Full Stack Developer Intern', 'React Native iOS Developer']) {
  assert.ok(!titleOk(title), `keyword matched but blocklist must win: ${title}`);
}

console.log('naukri-helpers: all checks passed');
