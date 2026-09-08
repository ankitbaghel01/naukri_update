/**
 * node external-apply.test.js
 * Pure-logic checks plus one real browser pass over a local fake application form,
 * so the field-filling path is exercised without touching a live employer site.
 */
const assert = require('assert');
const { atsKind, answerFor, SUCCESS_RE, SUBMIT_RE } = require('./external-apply');

// ---- ATS classification: account-required portals must never be attempted ----
for (const url of [
  'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Engineer',
  'https://acme.taleo.net/careersection/jobdetail.ftl',
  'https://careers.icims.com/jobs/1234',
  'https://performancemanager.successfactors.eu/apply',
]) assert.strictEqual(atsKind(url), 'account', `must skip account portal: ${url}`);

for (const url of [
  'https://boards.greenhouse.io/acme/jobs/4001',
  'https://jobs.lever.co/acme/abc-123/apply',
  'https://acme.freshteam.com/jobs/xyz',
  'https://acme.keka.com/careers/jobdetails/1',
  'https://careers.acme.com/apply',
]) assert.strictEqual(atsKind(url), 'form', `must attempt real form: ${url}`);

assert.strictEqual(atsKind('https://www.linkedin.com/jobs/view/123'), 'deadend');
assert.strictEqual(atsKind('about:blank'), 'unknown');

// ---- answer bank ----
const CV = {
  name: 'Ankit Baghel', email: 'a@b.com', phone: '99999', location: 'Bengaluru',
  currentRole: 'Software Engineer', company: 'Acme', noticePeriod: '15 days',
  currentCTC: '10', expectedCTC: '20', linkedin: 'li/x', github: 'gh/x', portfolio: 'p.dev',
  education: 'B.Tech', skills: 'React, Node', workAuth: 'Indian citizen', relocate: 'Yes',
  remoteOk: 'Yes', yearsOfExperience: '2', dob: '07/12/2003', gender: 'Male', highlights: ['Shipped X'],
};
assert.strictEqual(answerFor('First Name', CV), 'Ankit');
assert.strictEqual(answerFor('Last Name', CV), 'Baghel');
assert.strictEqual(answerFor('Full Name', CV), 'Ankit Baghel');
// "Email address" must not fall through to the location/address answer
assert.strictEqual(answerFor('Email address *', CV), 'a@b.com');
assert.strictEqual(answerFor('Current CTC (LPA)', CV), '10');
assert.strictEqual(answerFor('Expected CTC', CV), '20');
assert.strictEqual(answerFor('Notice period', CV), '15 days');
assert.strictEqual(answerFor('LinkedIn Profile URL', CV), 'li/x');
assert.strictEqual(answerFor('Total years of experience', CV), '2');
assert.strictEqual(answerFor('Current city', CV), 'Bengaluru');
assert.ok(answerFor('Why do you want to join us?', CV).includes('Ankit Baghel'));
assert.strictEqual(answerFor('Favourite colour', CV), '', 'unknown fields stay empty, never guessed');

// ---- submit / success matching ----
for (const t of ['Submit', 'Submit Application', 'Apply Now', 'Send Application'])
  assert.ok(SUBMIT_RE.test(t), `should be a submit button: ${t}`);
for (const t of ['Back', 'Save draft', 'Cancel', 'Apply filters'])
  assert.ok(!SUBMIT_RE.test(t), `must NOT be treated as submit: ${t}`);

for (const t of ['Thank you for applying!', 'Your application has been received.', 'We have received your application'])
  assert.ok(SUCCESS_RE.test(t), `should confirm success: ${t}`);
for (const t of ['Please fill all required fields', 'Application form', 'Error submitting'])
  assert.ok(!SUCCESS_RE.test(t), `must NOT read as success: ${t}`);

// ---- live browser pass over a local fake form ----
(async () => {
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (e) {
    console.log('external-apply: pure checks passed (playwright not available, skipped browser pass)');
    return;
  }
  const form = `<!doctype html><meta charset=utf-8><body><form>
    <label for=fn>First Name</label><input id=fn>
    <label for=ln>Last Name</label><input id=ln>
    <label for=em>Email address</label><input id=em type=email>
    <label for=ph>Phone</label><input id=ph>
    <label for=cc>Current CTC</label><input id=cc>
    <label for=np>Notice period</label><input id=np>
    <label for=cv>Resume</label><input id=cv type=file>
    <label for=st>Are you willing to relocate?</label>
    <select id=st><option></option><option>No</option><option>Yes</option></select>
    <fieldset><legend>Do you have work authorization?</legend>
      <label><input type=radio name=wa value=n>No</label>
      <label><input type=radio name=wa value=y>Yes</label></fieldset>
    <label><input type=checkbox id=tc required> I agree to the terms</label>
    <label for=zz>Favourite colour</label><input id=zz>
    <button type=button>Submit Application</button>
  </form></body>`;

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => null);
  if (!browser) { console.log('external-apply: pure checks passed (no Chrome, skipped browser pass)'); return; }
  const page = await browser.newPage();
  try {
    await page.setContent(form);
    const mod = require('./external-apply');
    const res = await mod.fillFieldsForTest(page, CV, require('./config').resumePath);
    const val = (sel) => page.inputValue(sel);
    assert.strictEqual(await val('#fn'), 'Ankit');
    assert.strictEqual(await val('#em'), 'a@b.com');
    assert.strictEqual(await val('#cc'), '10');
    assert.strictEqual(await val('#np'), '15 days');
    assert.strictEqual(await val('#zz'), '', 'unknown field must be left alone');
    assert.strictEqual(await val('#st'), 'Yes', 'select should pick the yes-ish option');
    assert.strictEqual(await page.isChecked('input[name=wa][value=y]'), true, 'radio should pick Yes');
    assert.strictEqual(await page.isChecked('#tc'), true, 'required consent box should be ticked');
    assert.ok(res.report.some((r) => r.startsWith('file:')), 'resume should be attached');
    const sub = await mod.findSubmitForTest(page);
    assert.ok(sub, 'submit button should be found');
    console.log('external-apply: all checks passed (including live form fill)');
  } finally {
    await browser.close().catch(() => {});
  }
})().catch((e) => { console.error('external-apply TEST FAILED:', e.message); process.exit(1); });
