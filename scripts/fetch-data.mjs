// Fetches cEDH tournaments from the TopDeck.gg API and writes static JSON into site/data/.
// Runs at build time (GitHub Action) so the API key never reaches the browser.
//
//   TOPDECK_API_KEY=xxxx node scripts/fetch-data.mjs
//   Optional: START_DATE=2023-01-01  FORMAT=EDH
//   Incremental: if site/data/tournaments.json already exists (restored from the Actions cache),
//   only the last 30 days are refetched and merged. FULL=1 forces a complete rebuild.
//   SKIP_IF_CACHED=1 exits immediately when cached data exists (used on code-only pushes).

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const KEY = process.env.TOPDECK_API_KEY;
if (!KEY) { console.error('Missing TOPDECK_API_KEY'); process.exit(1); }

const FORMAT = process.env.FORMAT || 'EDH';
const START = Math.floor(Date.parse(process.env.START_DATE || '2023-01-01') / 1000);
const NOW = Math.floor(Date.now() / 1000);
const STEP = 14 * 86400; // 14-day windows keep each response small
const OUT = fileURLToPath(new URL('../site/data/', import.meta.url));

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

let previous = [];
let from = START;
if (!process.env.FULL) {
  try {
    const prev = JSON.parse(await readFile(OUT + 'tournaments.json', 'utf8'));
    if (process.env.SKIP_IF_CACHED) { console.log('Cached data found, skipping fetch'); process.exit(0); }
    previous = prev.tournaments;
    from = Math.max(START, prev.generated - 30 * 86400); // overlap: late standings/edits
    console.log(`Incremental: ${previous.length} cached, fetching since ${new Date(from * 1000).toISOString().slice(0, 10)}`);
  } catch { /* no cache: full fetch */ }
}

const seen = new Map();
for (let s = from; s < NOW; s += STEP) {
  const e = Math.min(s + STEP - 1, NOW);
  const batch = await fetchRange(s, e);
  for (const t of batch) seen.set(t.TID, t);
  console.log(`${new Date(s * 1000).toISOString().slice(0, 10)}: ${batch.length} tournaments`);
  await sleep(2000); // be gentle: bulk endpoint has a low rate limit
}

await mkdir(OUT + 't/', { recursive: true });

const byId = new Map(previous.map((t) => [t.id, t]));
for (const t of seen.values()) {
  const { lat, lng, city, state } = t.eventData || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') continue; // online / no location
  if (!t.standings?.length) continue;

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
await writeFile(OUT + 'tournaments.json', JSON.stringify({ generated: NOW, tournaments: index }));
console.log(`Wrote ${index.length} located tournaments (of ${seen.size} fetched)`);
