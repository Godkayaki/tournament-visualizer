// Fetches cEDH tournaments from the TopDeck.gg API and writes static JSON into site/data/.
// Runs at build time (GitHub Action) so the API key never reaches the browser.
//
//   TOPDECK_API_KEY=xxxx node scripts/fetch-data.mjs
//   Optional: START_DATE=2023-01-01  FORMAT=EDH
//   Incremental: if site/data/tournaments.json already exists (restored from the Actions cache),
//   only the last 30 days are refetched and merged. FULL=1 forces a complete rebuild.
//   SKIP_IF_CACHED=1 skips the TopDeck fetch when cached data exists (used on code-only pushes).
//   Commander art (Scryfall art_crop URLs) is resolved here too and stored in site/data/art.json.

import { mkdir, writeFile, readFile, readdir, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const KEY = process.env.TOPDECK_API_KEY;
if (!KEY) { console.error('Missing TOPDECK_API_KEY'); process.exit(1); }

const FORMAT = process.env.FORMAT || 'EDH';
const START = Math.floor(Date.parse(process.env.START_DATE || '2023-01-01') / 1000);
const NOW = Math.floor(Date.now() / 1000);
const STEP = 14 * 86400; // 14-day windows keep each response small
const OUT = fileURLToPath(new URL('../site/data/', import.meta.url));

// Repo version-number file -> tournaments.json, so the front-end can show it without an extra request.
// Missing file (someone deleted it) degrades to 'unknown' rather than crashing the build.
// The stamp also runs on SKIP_IF_CACHED deploys, so a code push updates the footer without refetching TopDeck.
let version = 'unknown';
try { version = (await readFile(fileURLToPath(new URL('../version-number', import.meta.url)), 'utf8')).trim(); }
catch { /* keep 'unknown' */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(start, end) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('https://topdeck.gg/api/v2/tournaments', {
        method: 'POST',
        headers: { Authorization: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: 'Magic: The Gathering',
          format: FORMAT,
          start,
          end,
          columns: ['name', 'id', 'decklist', 'wins', 'draws', 'losses'],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        await sleep((j.retryAfterSeconds || 30) * 1000 + 500);
        attempt--; // rate limits don't count as failed attempts
        continue;
      }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`); // 4xx: retrying won't help
      return await res.json();
    } catch (err) {
      const fatal = /^HTTP 4/.test(err.message);
      console.warn(`  attempt ${attempt} failed (${err.cause?.code || err.message})`);
      if (fatal || attempt === 4) throw err;
      await sleep(attempt * 5000);
    }
  }
}

// If a window keeps failing (often because the response is too big), split it in half.
async function fetchRange(start, end) {
  try {
    return await query(start, end);
  } catch (err) {
    if (/^HTTP 4/.test(err.message) || end - start < 86400) throw err;
    const mid = Math.floor((start + end) / 2);
    console.warn(`  splitting ${start}-${end}`);
    return [...(await fetchRange(start, mid)), ...(await fetchRange(mid + 1, end))];
  }
}

// Commander names from structured deck data, falling back to the "~~Commanders~~" text block.
function commanders(p) {
  const obj = p.deckObj?.Commanders;
  if (obj && typeof obj === 'object' && Object.keys(obj).length) return Object.keys(obj);
  const m = /~~Commanders~~\r?\n([\s\S]*?)(?:\r?\n~~|$)/.exec(p.decklist || '');
  if (!m) return [];
  return m[1].split(/\r?\n/)
    .map((l) => l.replace(/^\d+x?\s+/, '').replace(/\s*[(\[].*$/, '').trim())
    .filter(Boolean);
}

const iso = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
// Writes to the run's summary page in GitHub Actions (Actions tab > the run > Summary). No-op when run locally.
async function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
const trigger = process.env.GITHUB_EVENT_NAME || 'local';

let previous = [];
let from = START;
let skipFetch = false;
let prevGenerated = null;
if (!process.env.FULL) {
  try {
    const prev = JSON.parse(await readFile(OUT + 'tournaments.json', 'utf8'));
    previous = prev.tournaments;
    prevGenerated = prev.generated;
    if (process.env.SKIP_IF_CACHED) {
      skipFetch = true;
      console.log('Cached data found, skipping tournament fetch');
    } else {
      from = Math.max(START, prev.generated - 30 * 86400); // overlap: late standings/edits
      console.log(`Incremental: ${previous.length} cached, fetching since ${new Date(from * 1000).toISOString().slice(0, 10)}`);
    }
  } catch { /* no cache: full fetch */ }
}

await mkdir(OUT + 't/', { recursive: true });

if (!skipFetch) {
  const seen = new Map();
  for (let s = from; s < NOW; s += STEP) {
    const e = Math.min(s + STEP - 1, NOW);
    const batch = await fetchRange(s, e);
    for (const t of batch) seen.set(t.TID, t);
    console.log(`${new Date(s * 1000).toISOString().slice(0, 10)}: ${batch.length} tournaments`);
    await sleep(2000); // be gentle: bulk endpoint has a low rate limit
  }

  const byId = new Map(previous.map((t) => [t.id, t]));
  let noLocation = 0, noStandings = 0;
  const recentSkips = []; // what we dropped from the last few days, so a "missing" tournament can be explained from the log
  const skip = (t, why) => {
    if (t.startDate >= NOW - 5 * 86400) recentSkips.push(`${new Date(t.startDate * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z  ${t.tournamentName}  (${why})`);
  };
  for (const t of seen.values()) {
    const { lat, lng, city, state } = t.eventData || {};
    if (t.startDate > NOW) continue; // future-dated events are staff tests
    if (typeof lat !== 'number' || typeof lng !== 'number') { noLocation++; skip(t, 'no coordinates'); continue; } // online / no location
    if (!t.standings?.length) { noStandings++; skip(t, 'no standings'); continue; }

    const f = String(t.TID).replace(/[^\w-]/g, '_');
    byId.set(t.TID, {
      id: t.TID, f, n: t.tournamentName, d: t.startDate,
      lat, lng, c: city || '', s: state || '',
      p: t.standings.length, sw: t.swissNum || 0, tc: t.topCut || 0,
    });
    // Standings are kept in the order the API returns them (assumed to be final placement).
    await writeFile(`${OUT}t/${f}.json`, JSON.stringify(
      t.standings.map((p) => ({ n: p.name, i: p.id, c: commanders(p), w: p.wins || 0, d: p.draws || 0, l: p.losses || 0 }))
    ));
  }

  const index = [...byId.values()].sort((a, b) => b.d - a.d);
  await writeFile(OUT + 'tournaments.json', JSON.stringify({ generated: NOW, version, tournaments: index }));
  console.log(`Wrote ${index.length} located tournaments (of ${seen.size} fetched)`);
  console.log(`Skipped: ${noLocation} without coordinates, ${noStandings} without standings`);
  const newest = [...seen.values()].sort((a, b) => b.startDate - a.startDate).slice(0, 5);
  console.log('Newest tournaments returned by the API:');
  for (const t of newest) console.log(`  ${new Date(t.startDate * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z  ${t.tournamentName}`);
  if (recentSkips.length) { console.log('Skipped from the last 5 days:'); recentSkips.forEach((l) => console.log(`  ${l}`)); }
  console.log(`Data stamp (what the footer shows): ${iso(NOW)}`);
  console.log(`Newest tournament in the index: ${index[0] ? `${iso(index[0].d)}  ${index[0].n}` : 'none'}`);
  await summary([
    '### Tournament data',
    '| | |', '|---|---|',
    `| Trigger | ${trigger} |`,
    `| Version | ${version} |`,
    `| Data stamp (footer) | ${iso(NOW)} |`,
    `| Fetched since | ${iso(from)} |`,
    `| Fetched / now in the index | ${seen.size} / ${index.length} |`,
    `| Skipped | ${noLocation} without coordinates, ${noStandings} without standings |`,
    `| Newest returned by the API | ${newest[0] ? `${iso(newest[0].startDate)} ${newest[0].tournamentName}` : 'none'} |`,
    `| Newest in the index | ${index[0] ? `${iso(index[0].d)} ${index[0].n}` : 'none'} |`,
    '',
  ]);
} else {
  await summary([
    '### Tournament data',
    `Code-only deploy (trigger: ${trigger}): reused the cached data, stamp unchanged: ${prevGenerated ? iso(prevGenerated) : 'unknown'}`,
    `Version: ${version}`,
    '',
  ]);
}

// ---- Commander art: name -> [front-face art_crop URL], resolved via Scryfall ----
const SCRYFALL = {
  'User-Agent': 'cedh-globe/1.0 (https://github.com/Godkayaki/tournament-visualizer)',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};
const frontFace = (n) => n.split(' // ')[0].toLowerCase();

async function buildArt() {
  let art = {};
  try { art = JSON.parse(await readFile(OUT + 'art.json', 'utf8')); } catch { /* first run */ }

  const names = new Set();
  for (const f of await readdir(OUT + 't/')) {
    for (const row of JSON.parse(await readFile(OUT + 't/' + f, 'utf8'))) row.c.forEach((c) => names.add(c));
  }
  // also retry empty entries of "A // B" names: an earlier version failed to resolve them
  const missing = [...names].filter((n) => !(n in art) || (!art[n].length && n.includes(' // ')));
  console.log(`Commander art: ${names.size} commanders, ${missing.length} to look up`);

  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75);
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: SCRYFALL,
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name: name.split(' // ')[0].trim() })) }), // "A // B" -> look up "A"
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const lookup = new Map();
      for (const c of data) { lookup.set(c.name.toLowerCase(), c); lookup.set(frontFace(c.name), c); }
      for (const n of chunk) {
        const c = lookup.get(n.toLowerCase()) || lookup.get(frontFace(n));
        const face = c && (c.image_uris || c.card_faces?.[0]?.image_uris); // front face only
        art[n] = face?.art_crop ? [face.art_crop] : []; // [] = not found
      }
    } catch (err) {
      console.warn(`  scryfall chunk failed (${err.cause?.code || err.message}); will retry next run`);
    }
    await sleep(600); // Scryfall asks for <= 2 req/s on this endpoint
  }
  await writeFile(OUT + 'art.json', JSON.stringify(art));
}
await buildArt();

// ---- Winner commanders in the index (t.w), so hovering a tournament in the list needs no extra request ----
// Reads the standings files already on disk, so it needs no TopDeck calls and also works on cached runs.
async function addWinners() {
  let index;
  try { index = JSON.parse(await readFile(OUT + 'tournaments.json', 'utf8')); } catch { return; }
  let changed = 0;
  for (const t of index.tournaments) {
    try {
      const rows = JSON.parse(await readFile(`${OUT}t/${t.f}.json`, 'utf8'));
      const w = rows[0]?.c || [];
      if (JSON.stringify(t.w) !== JSON.stringify(w)) { t.w = w; changed++; }
    } catch { /* standings file missing: leave as is */ }
  }
  if (changed) await writeFile(OUT + 'tournaments.json', JSON.stringify(index)); // `generated` survives; version is re-stamped below
  console.log(`Winners: ${changed} tournaments updated in the index`);
}
await addWinners();

// Code-only deploys skip the TopDeck rewrite, so the cached index would keep the old
// footer version. Always copy version-number onto the index without touching `generated`.
async function stampVersion() {
  let index;
  try { index = JSON.parse(await readFile(OUT + 'tournaments.json', 'utf8')); }
  catch { return; }
  if (index.version === version) {
    console.log(`Version already ${version}`);
    return;
  }
  index.version = version;
  await writeFile(OUT + 'tournaments.json', JSON.stringify(index));
  console.log(`Stamped version ${version} onto tournaments.json`);
}
await stampVersion();