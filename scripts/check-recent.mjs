// Diagnostic: what does TopDeck return for the last few days, and what would EDHGlobe do with each tournament?
//   PowerShell:  $env:TOPDECK_API_KEY="your_key"; node scripts/check-recent.mjs 4
//   bash:        TOPDECK_API_KEY=your_key node scripts/check-recent.mjs 4
// The number is how many days back to look (default 4). Nothing is written.
// Tip: run `node scripts/fetch-data.mjs` first, so "in the index" compares against fresh local data.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const KEY = process.env.TOPDECK_API_KEY;
if (!KEY) { console.error('Missing TOPDECK_API_KEY'); process.exit(1); }
const DAYS = Number(process.argv[2]) || 4;
const OUT = fileURLToPath(new URL('../site/data/', import.meta.url));
const HEADERS = { Authorization: KEY, 'Content-Type': 'application/json' };
const CEDH = /\bc\s?edh|bracket\s*5\b/i;
const NOW = Math.floor(Date.now() / 1000);
const FETCHED = process.env.FORMAT || 'EDH'; // the only format fetch-data.mjs downloads

let indexed = new Set();
try { indexed = new Set(JSON.parse(await readFile(OUT + 'tournaments.json', 'utf8')).tournaments.map((t) => t.id)); }
catch { console.log('(no local site/data/tournaments.json: "in the index" cannot be checked)'); }

async function search(format) {
  const res = await fetch('https://topdeck.gg/api/v2/tournaments', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ game: 'Magic: The Gathering', format, last: DAYS, columns: ['name'] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const where = (e = {}) => ['city', 'state', 'address'].map((k) => e[k]).filter(Boolean).join(' | ');

const totals = {};
const noCoordsCedh = [];
for (const format of [...new Set([FETCHED, 'Casual EDH', 'Other'])]) {
  let list;
  try { list = await search(format); } catch (err) { console.log(`\n${format}: request failed (${err.message})`); continue; }
  // other formats are only listed when the name looks like cEDH: an organizer may have picked the wrong format
  const rows = list.filter((t) => format === FETCHED || CEDH.test(t.tournamentName)).sort((a, b) => b.startDate - a.startDate);
  console.log(`\n${format}: ${list.length} completed tournaments in the last ${DAYS} days` + (format === FETCHED ? '' : ` (listing the ${rows.length} named cEDH / Bracket 5)`));
  for (const t of rows) {
    const { lat, lng } = t.eventData || {};
    let verdict;
    if (t.startDate > NOW) verdict = 'FUTURE DATE: skipped';
    else if (typeof lat !== 'number' || typeof lng !== 'number') {
      verdict = 'NO COORDINATES: skipped';
      if (CEDH.test(t.tournamentName)) noCoordsCedh.push(t);
    } else if (!t.standings?.length) verdict = 'NO STANDINGS: skipped';
    else if (format !== FETCHED) verdict = `NOT FETCHED (format: ${format})`; // fetch-data.mjs never asks for this format
    else verdict = indexed.has(t.TID) ? 'in the index' : 'new: added on the next run';
    totals[verdict] = (totals[verdict] || 0) + 1;
    const loc = verdict.startsWith('NO COORD') ? `  [location data: ${where(t.eventData) || 'none'}]` : '';
    console.log(`${new Date(t.startDate * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z  ${String(t.standings?.length ?? 0).padStart(3)} players  ${verdict.padEnd(30)} ${t.tournamentName}${loc}`);
  }
}

console.log('\nSummary:');
for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

// Does the single-tournament /info endpoint know where the cEDH-named, coordinate-less events are?
if (noCoordsCedh.length) {
  console.log('\n/info location for up to 5 cEDH-named events without coordinates:');
  for (const t of noCoordsCedh.slice(0, 5)) {
    try {
      const res = await fetch(`https://topdeck.gg/api/v2/tournaments/${encodeURIComponent(t.TID)}/info`, { headers: HEADERS });
      const info = res.ok ? await res.json() : null;
      console.log(`  ${t.tournamentName}: ${info ? JSON.stringify(info.location) : `HTTP ${res.status}`}`);
    } catch (err) { console.log(`  ${t.tournamentName}: request failed (${err.message})`); }
  }
}
