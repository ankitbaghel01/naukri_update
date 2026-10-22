const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { indianDateKey, uploadedDate, nextSummary, acquireLock } = require('./naukri-toptier-helpers');
const { refresh } = require('./naukri-toptier-refresh');

test('uses the Indian calendar day and strictly parses TopTier dates', () => {
  assert.equal(indianDateKey(new Date('2026-10-21T18:31:00Z')), '2026-10-22');
  assert.equal(uploadedDate('Resume Uploaded on 2/10/2026'), '2026-10-02');
  assert.equal(uploadedDate('Uploaded today', new Date('2026-10-21T18:31:00Z')), '2026-10-22');
  assert.equal(uploadedDate('Uploaded yesterday', new Date('2026-10-21T18:31:00Z')), '2026-10-21');
  assert.throws(() => uploadedDate('Uploaded on 31/02/2026'));
  assert.throws(() => uploadedDate('last updated today'));
});
test('summary refresh preserves the prose and cycles trailing dots', () => {
  assert.equal(nextSummary('Original prose'), 'Original prose.');
  assert.equal(nextSummary('Original prose.'), 'Original prose..');
  assert.equal(nextSummary('Original prose..'), 'Original prose');
  assert.throws(() => nextSummary(''));
  assert.throws(() => nextSummary('x'.repeat(1000)));
});
test('active lock is skipped and released only by its owner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toptier-lock-'));
  const file = path.join(dir, 'lock');
  try { const release = acquireLock(file); assert.equal(acquireLock(file), null); release(); assert(!fs.existsSync(file)); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const fixture = `<!doctype html><html><body><nav aria-label="Profile sections">Profile sections</nav>
<div><p>Preferences</p><img alt="PencilSimple" width="24" height="24" onclick="salaryEditor()"></div>
<div><p>Profile summary</p><img alt="PencilSimple" width="24" height="24" onclick="summaryEditor()"></div>
<div id="resume-card"><input type="file" id="resume" hidden><p id="file"></p><p id="date"></p></div><div id="editor"></div>
<script>
let s=JSON.parse(localStorage.getItem('fixture')||'null')||{summary:'Original prose..',salary:'40,00,000',date:'01/01/2000',filename:'old.pdf',uploads:0};
const write=()=>localStorage.setItem('fixture',JSON.stringify(s));const render=()=>{document.querySelector('#file').textContent=s.filename;document.querySelector('#date').textContent=s.uploads ? 'Uploaded today' : 'Uploaded on '+s.date};render();
function summaryEditor(){document.querySelector('#editor').innerHTML='<textarea placeholder="Craft a compelling profile summary"></textarea><button onclick="saveSummary()">Save<span>Saved</span></button><button onclick="cancel()">Cancel</button>';document.querySelector('textarea').value=s.summary;}
function salaryEditor(){document.querySelector('#editor').innerHTML='<input name="absoluteExpectedCtc"><button onclick="saveSalary()">Save<span>Saved</span></button><button onclick="cancel()">Cancel</button>';document.querySelector('[name=absoluteExpectedCtc]').value=s.salary;}
function cancel(){document.querySelector('#editor').innerHTML='';}
function saveSummary(){if(!s.rejectSummary)s.summary=document.querySelector('textarea').value;write();cancel();}
function saveSalary(){if(!s.rejectSalary)s.salary=document.querySelector('[name=absoluteExpectedCtc]').value;write();cancel();}
document.querySelector('#resume').addEventListener('change',e=>{s.filename=e.target.files[0].name;s.date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata'}).format(new Date());s.uploads++;write();render();});
</script></body></html>`;

test('browser flow verifies persistence, uploads once a day, and rejects a lost save', { timeout: 90000 }, async () => {
  const { chromium } = require(require.resolve('playwright-core', { paths: [process.env.NAUKRI_DATA_DIR || __dirname] }));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toptier-resume-'));
  const resume = path.join(dir, 'resume.pdf');fs.writeFileSync(resume, '%PDF-1.4 fixture');
  try {
    const page = await browser.newPage();
    await page.route('https://www.naukri.com/mnjuser/profile', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    const first = await refresh(page, resume);
    assert.match(first.resumeResult, /uploaded today/);
    const second = await refresh(page, resume);
    assert.match(second.resumeResult, /already/);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture')));
    assert.equal(state.uploads, 1);assert.equal(state.salary, '');assert.equal(state.summary, 'Original prose.');
    await page.evaluate(() => {const s=JSON.parse(localStorage.getItem('fixture'));s.rejectSalary=true;s.salary='30,00,000';localStorage.setItem('fixture',JSON.stringify(s));});
    await assert.rejects(refresh(page, resume), /salary did not remain empty/);
    await page.evaluate(() => {const s=JSON.parse(localStorage.getItem('fixture'));s.rejectSummary=true;localStorage.setItem('fixture',JSON.stringify(s));});
    await assert.rejects(refresh(page, resume), /summary did not persist/);
  } finally { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
