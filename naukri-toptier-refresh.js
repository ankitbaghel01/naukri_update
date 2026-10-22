/** Independent TopTier refresher. Legacy naukri-profile-refresh.js is unchanged. */
const fs = require('node:fs');
const path = require('node:path');
const { indianDateKey, uploadedDate, nextSummary, profileInUse, acquireLock } = require('./naukri-toptier-helpers');

const DATA_DIR = path.resolve(process.env.NAUKRI_DATA_DIR || __dirname);
const PROFILE_DIR = path.join(DATA_DIR, '.naukri-chrome-profile');
const LOG_FILE = path.join(DATA_DIR, 'naukri-toptier-refresh.log');
const PROFILE_URL = 'https://www.naukri.com/mnjuser/profile';
function log(message) {
  const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const line = `[${timestamp} IST] ${message}`;
  console.log(line); fs.appendFileSync(LOG_FILE, line + '\n', { mode: 0o600 });
}
const heading = (page, name) => page.locator('p').filter({ hasText: new RegExp(`^${name}$`) });
const saveButton = field => field.locator('xpath=ancestor::*[.//button[starts-with(normalize-space(.), "Save")]][1]').locator('button:visible').filter({ hasText: /^Save\s*(?:Saved)?$/ });
async function loadProfile(page) {
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /Profile summary/.test(document.body.innerText) || /\/nlogin\//.test(location.pathname), null, { timeout: 45000 });
  if (/\/nlogin\//.test(new URL(page.url()).pathname)) throw new Error('Manual Naukri login required using the existing profile');
  await page.locator('nav[aria-label="Profile sections"]').waitFor({ timeout: 30000 });
}
async function openSummary(page) {
  const header = heading(page, 'Profile summary').first();
  await header.waitFor({ timeout: 30000 });
  await header.locator('..').locator('img[alt="PencilSimple"]').click();
  const field = page.getByPlaceholder('Craft a compelling profile summary', { exact: true });
  await field.waitFor({ timeout: 15000 });
  return field;
}
async function cancelEditor(page) {
  const field = page.locator('textarea[placeholder="Craft a compelling profile summary"]:visible, input[name="absoluteExpectedCtc"]:visible');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await field.waitFor({ state: 'hidden', timeout: 15000 });
}
async function openSalary(page) {
  await heading(page, 'Preferences').first().locator('..').locator('img[alt="PencilSimple"]').click();
  const field = page.locator('input[name="absoluteExpectedCtc"]');
  await field.waitFor({ timeout: 15000 });
  return field;
}
async function resumeCard(page) {
  await page.locator('#resume').waitFor({ state: 'attached', timeout: 30000 });
  const card = page.locator('#resume').locator('..');
  await card.getByText(/Uploaded\s+(?:today|yesterday|on\s*\d{1,2}\/\d{1,2}\/\d{4})/i).waitFor({ timeout: 30000 });
  return card;
}
async function refresh(page, resumePath, onStep = () => {}) {
  await loadProfile(page);
  const field = await openSummary(page);
  const expected = nextSummary(await field.inputValue());
  await field.fill(expected);
  await saveButton(field).click();
  await field.waitFor({ state: 'hidden', timeout: 20000 });
  await loadProfile(page);
  const saved = await openSummary(page);
  if ((await saved.inputValue()).trimEnd() !== expected) throw new Error('Profile summary did not persist after reload');
  await cancelEditor(page);
  onStep('profile summary refreshed (verified)');

  let card = await resumeCard(page);
  let resumeResult = 'resume already uploaded today';
  if (uploadedDate(await card.innerText()) !== indianDateKey()) {
    if (!fs.existsSync(resumePath)) throw new Error('Configured resume file is missing');
    await page.locator('#resume').setInputFiles(resumePath);
    await page.waitForFunction(({ filename, displayDate }) => {
      const input = document.querySelector('#resume');
      const text = input?.parentElement?.innerText || '';
      return text.includes(filename) && (/Uploaded\s+today\b/i.test(text) || text.includes('Uploaded on ' + displayDate));
    }, { filename: path.basename(resumePath), displayDate: indianDateKey().split('-').reverse().join('/') }, { timeout: 45000 });
    // Verification must be against reloaded server state, rather than the upload UI.
    await loadProfile(page);
    card = await resumeCard(page);
    const text = await card.innerText();
    if (uploadedDate(text) !== indianDateKey() || !text.includes(path.basename(resumePath))) throw new Error('Daily resume upload did not persist after reload');
    resumeResult = 'resume uploaded today (verified)';
  }
  onStep(resumeResult);

  const salary = await openSalary(page);
  await salary.fill('');
  await saveButton(salary).click();
  await salary.waitFor({ state: 'hidden', timeout: 20000 });
  await loadProfile(page);
  const persistedSalary = await openSalary(page);
  if ((await persistedSalary.inputValue()).trim() !== '') throw new Error('Minimum annual salary did not remain empty after reload');
  await cancelEditor(page);
  onStep('minimum annual salary empty (verified)');
  return { resumeResult };
}
async function main() {
  let release, ctx, page;
  try {
    if (profileInUse(PROFILE_DIR)) { log('SKIP: existing browser is using the shared Naukri profile'); return; }
    release = acquireLock(path.join(DATA_DIR, '.naukri-toptier-refresh.lock'));
    if (!release) { log('SKIP: another TopTier refresher is running'); return; }
    // Check again after acquiring our lock; the legacy automation may have launched.
    if (profileInUse(PROFILE_DIR)) { log('SKIP: shared profile became busy'); return; }
    const { chromium } = require(require.resolve('playwright-core', { paths: [DATA_DIR, __dirname] }));
    const { resumePath } = require(path.join(DATA_DIR, 'config.js'));
    try {
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless: false, viewport: { width: 1400, height: 1000 }, args: ['--window-position=0,0'] });
    } catch (error) {
      if (/ProcessSingleton|already in use|Opening in existing browser/.test(error.message)) { log('SKIP: Chrome profile is held by another session'); return; }
      throw error;
    }
    page = ctx.pages()[0] || await ctx.newPage();
    const result = await refresh(page, resumePath, message => log('STEP: ' + message));
    log(`OK: TopTier profile summary refreshed (verified), ${result.resumeResult}, minimum annual salary empty (verified)`);
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(DATA_DIR, 'naukri-toptier-refresh-error.png'), fullPage: true }).catch(() => {});
    log('ERROR: ' + String(error.message).split('\n')[0]);
    process.exitCode = 1;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    if (release) release();
  }
}
if (require.main === module) main();
module.exports = { refresh, openSummary, openSalary, resumeCard, loadProfile };
