// Renders coverLetter() straight out of wellfound-auto-apply.js with the real CV,
// so this is byte-for-byte what gets typed into the application box.
const fs = require('fs'), path = require('path');
const { CV } = require('./config');
const src = fs.readFileSync(path.join(__dirname, 'wellfound-auto-apply.js'), 'utf8');
const start = src.indexOf('function coverLetter(');
let i = src.indexOf('{', start), d = 0, end = -1;
for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) { end = j; break; } } }
const coverLetter = new Function('CV', 'return (' + src.slice(start, end + 1) + ');')(CV);
const [company, title] = process.argv.slice(2);
console.log(coverLetter(company, title));
