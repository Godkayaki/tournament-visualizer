// Bumps the version in version-number following v[YEAR].[MONTH].[NUMBER].
// [NUMBER] starts at 1 each month and +1s on every run.
// Called by .github/workflows/version.yml on every push to main that touches code
// (site/data/** is excluded, so scheduled data refreshes don't bump it).
//
//   node scripts/bump-version.mjs
//
// Prints the previous and new version so the workflow can log them and use them in
// the commit message. Exits non-zero if the file doesn't exist, so a broken repo state
// fails loudly instead of silently starting from v1.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../version-number', import.meta.url));

let prev;
try { prev = (await readFile(FILE, 'utf8')).trim(); }
catch { console.error('version-number file not found at repo root'); process.exit(1); }

const m = /^v(\d{4})\.(\d{1,2})\.(\d+)$/.exec(prev);
if (!m) { console.error(`version-number is not in vYYYY.MM.N format: "${prev}"`); process.exit(1); }

const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth() + 1; // 1-12, not zero-based

// New month (or new year) -> reset the counter. Same month -> increment.
let next;
if (+m[1] !== year || +m[2] !== month) {
  next = `v${year}.${month}.1`;
} else {
  next = `v${year}.${month}.${+m[3] + 1}`;
}

await writeFile(FILE, next + '\n');
console.log(`Bumped ${prev} -> ${next}`);