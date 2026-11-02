// Makes a clean copy of HYPERSPACE for GitHub: only the files Git tracks, minus personal ones, and no Git history
// (the history carries your email address and every old version).
//   node scripts/export-public.js            -> C:\dev\hyperspace-github (or ../hyperspace-github)
// Then, in that folder: git init, commit, and push it to a new GitHub repository (see PUBLISHING.md).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'hyperspace-github'));
// personal: notes for Claude about this laptop, the tune-up checklist, a script tied to one rekordbox library
const PERSONAL = [/^CLAUDE\.md$/i, /^\.claude\//i,/^docs\/tune-up\.html$/i, /^scripts\/organize-rekordbox\.js$/i];

if (fs.existsSync(out) && fs.readdirSync(out).length) { console.error(`${out} already has files in it: pick an empty folder`); process.exit(1); }
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
let n = 0;
for (const f of files) {
  if (PERSONAL.some((re) => re.test(f))) continue;
  const to = path.join(out, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(root, f), to);
  n++;
}
console.log(`${n} files copied to ${out}`);
