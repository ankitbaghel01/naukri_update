const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function indianDateKey(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function uploadedDate(text, now = new Date()) {
  if (/Uploaded\s+today\b/i.test(text)) return indianDateKey(now);
  if (/Uploaded\s+yesterday\b/i.test(text)) {
    const previous = new Date(indianDateKey(now) + 'T00:00:00Z');
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
  }
  const m = /Uploaded on\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  if (!m) throw new Error('TopTier resume upload date was not found; refusing an unverified repeat upload');
  const [, d, mo, y] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) throw new Error('Invalid resume upload date');
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function nextSummary(value) {
  const current = String(value).trimEnd();
  const base = current.replace(/\.+$/, '');
  if (!base) throw new Error('Profile summary is empty; refusing to replace it');
  const count = current.length - base.length;
  const updated = base + '.'.repeat(count >= 2 ? 0 : count + 1);
  if (updated.length > 1000) throw new Error('Summary is at the character limit; manual adjustment required');
  return updated;
}
function profileInUse(profileDir) {
  const listing = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return listing.split('\n').some(line => line.split(/\s+/).includes(`--user-data-dir=${profileDir}`));
}
function acquireLock(file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
      return () => { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid refresh lock; manual inspection required');
      try { process.kill(pid, 0); return null; } catch (e) {
        if (e.code !== 'ESRCH') return null;
        fs.unlinkSync(file);
      }
    }
  }
  return null;
}
module.exports = { indianDateKey, uploadedDate, nextSummary, profileInUse, acquireLock };
