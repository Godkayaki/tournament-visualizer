// Builds site/data/meta.json for the "Regional Metagame" window: for every tournament, how many decks of each
// commander were played, in which country (and continent) it took place, and the color identity of every commander.
//
//   node scripts/build-meta.mjs        (run it after scripts/fetch-data.mjs; it makes no TopDeck calls)
//   Optional: FULL=1 rebuild even if the file is up to date, and look up unmatched commanders on Scryfall again
//             BORDERS_FILE=path/to/countries.geojson  use a local borders file instead of downloading one
//             SCRYFALL_URL=http://...                 use another Scryfall host (tests)
//
// Color identity comes from Scryfall (one lookup per commander name, cached in site/data/colors.json so only new names are
// asked for); a partner pair has the union of both identities. The continent is a property of the borders file.
//
// Country = the country polygon that contains the tournament's coordinates (Natural Earth 50m borders, downloaded here at
// build time so they never reach the browser). A point that falls outside every polygon (a coast, a tiny island) goes to the
// nearest country within NEAREST_KM; farther than that it stays unplaced (-1) and only counts for "World".
//
// meta.json layout (the front-end reading it is site/js/regional.js):
//   {
//     schema, generated, bordersMissing?, colorsPending?
//     countries:  [{ code, name, continent }, ...]   only countries that have tournaments
//     commanders: [[name, ...], ...]             one entry per commander or partner pair (names sorted, so A/B = B/A)
//     colors:     ["GU", "", null, ...]          color identity of each commander entry, in WUBRG order ("" = colorless, null = unknown)
//     t: { <tournament id>: [countryIndex or -1, decksWithoutCommander, commanderIndex, decks, commanderIndex, decks, ...] }
//   }

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../site/data/', import.meta.url));
const SCHEMA = 2; // bump when the layout or the counting rules change, so cached files get rebuilt
const NEAREST_KM = 50;
const SCRYFALL_URL = process.env.SCRYFALL_URL || 'https://api.scryfall.com';
const SCRYFALL_HEADERS = { 'User-Agent': 'cedh-globe/1.0 (https://github.com/Godkayaki/tournament-visualizer)', Accept: 'application/json', 'Content-Type': 'application/json' };
const WUBRG = 'WUBRG';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BORDER_URLS = [
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson',
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson', // coarser: last resort
];

async function summary(lines) { // the run's summary page in GitHub Actions; no-op when run locally
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

let index;
try { index = JSON.parse(await readFile(OUT + 'tournaments.json', 'utf8')); }
catch { console.error('site/data/tournaments.json not found: run scripts/fetch-data.mjs first'); process.exit(1); }

let previous = null;
try { previous = JSON.parse(await readFile(OUT + 'meta.json', 'utf8')); } catch { /* first run */ }

// Code-only deploys reuse the cached data (same `generated` stamp): nothing changed, so skip the work and the download.
if (!process.env.FULL && previous?.schema === SCHEMA && previous.generated === index.generated && !previous.bordersMissing && !previous.colorsPending) {
  console.log('meta.json is up to date');
  await summary(['### Regional metagame data', 'Up to date: reused the cached meta.json.', '']);
  process.exit(0);
}

// ---- Borders ----
async function loadBorders() {
  if (process.env.BORDERS_FILE) return JSON.parse(await readFile(process.env.BORDERS_FILE, 'utf8')).features;
  for (const url of BORDER_URLS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { features } = await res.json();
        if (!Array.isArray(features) || !features.length) throw new Error('no features');
        console.log(`Borders: ${features.length} countries from ${url}`);
        return features;
      } catch (err) {
        console.warn(`  borders ${url} attempt ${attempt} failed (${err.cause?.code || err.message})`);
      }
    }
  }
  return null;
}

const polysOf = (g) => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []);
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole));

// Distance in km from a point to the outline of a ring (flat approximation: fine at this scale)
function distKm(lat, lng, ring) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x1 = (ring[j][0] - lng) * kx, y1 = (ring[j][1] - lat) * ky;
    const dx = (ring[i][0] - ring[j][0]) * kx, dy = (ring[i][1] - ring[j][1]) * ky;
    const len2 = dx * dx + dy * dy;
    const u = len2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x1 + u * dx, y1 + u * dy));
  }
  return best;
}

// Returns (lat, lng) => feature index, or -1
function makeLocator(features) {
  const items = [];
  features.forEach((f, idx) => {
    const polys = polysOf(f.geometry);
    if (!polys.length) return;
    const bb = [180, 90, -180, -90];
    for (const p of polys) for (const [x, y] of p[0]) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
    items.push({ idx, polys, bb });
  });
  const cache = new Map();
  return (lat, lng) => {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (cache.has(key)) return cache.get(key);
    let hit = -1;
    for (const it of items) {
      if (lng < it.bb[0] || lng > it.bb[2] || lat < it.bb[1] || lat > it.bb[3]) continue;
      if (it.polys.some((p) => inPoly(lng, lat, p))) { hit = it.idx; break; }
    }
    if (hit < 0) { // outside every polygon: nearest country within NEAREST_KM
      const padLat = NEAREST_KM / 110, padLng = NEAREST_KM / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.1));
      let best = NEAREST_KM;
      for (const it of items) {
        if (lng < it.bb[0] - padLng || lng > it.bb[2] + padLng || lat < it.bb[1] - padLat || lat > it.bb[3] + padLat) continue;
        for (const p of it.polys) { const d = distKm(lat, lng, p[0]); if (d <= best) { best = d; hit = it.idx; } }
      }
    }
    cache.set(key, hit);
    return hit;
  };
}

const features = await loadBorders();
if (!features) {
  if (previous) { // keep what we have rather than publishing a file without countries
    console.warn('Could not load country borders: keeping the previous meta.json');
    await summary(['### Regional metagame data', 'Could not load country borders: kept the previous meta.json.', '']);
    process.exit(0);
  }
  console.warn('Could not load country borders: meta.json will have no countries (World view only)');
}
const locate = features ? makeLocator(features) : () => -1;
const codeOf = (p = {}) => [p.ISO_A2_EH, p.ISO_A2, p.WB_A2, p.ADM0_A3, p.ISO_A3].find((v) => v && v !== '-99') || String(p.NAME || p.ADMIN || p.name || '?');
const nameOf = (p = {}) => p.NAME || p.ADMIN || p.name || 'Unknown';
const continentOf = (p = {}) => p.CONTINENT || p.continent || ''; // Natural Earth: Africa, Antarctica, Asia, Europe, North America, Oceania, South America

// ---- Count decks ----
const countries = [], countryIdx = new Map(); // Natural Earth feature index -> position in `countries`
const commanders = [], commanderIdx = new Map();
const idOf = (names) => {
  const key = names.join('\u0001');
  if (!commanderIdx.has(key)) { commanderIdx.set(key, commanders.length); commanders.push(names); }
  return commanderIdx.get(key);
};

const t = {};
let decks = 0, noCommander = 0, noStandings = 0;
const unplaced = [];
for (const tour of index.tournaments) {
  let rows;
  try { rows = JSON.parse(await readFile(`${OUT}t/${tour.f}.json`, 'utf8')); }
  catch { noStandings++; continue; }

  const counts = new Map();
  let unknown = 0;
  for (const p of rows) {
    const names = [...new Set((p.c || []).map((s) => String(s).trim()).filter(Boolean))].sort(); // sorted: A/B and B/A are the same deck
    if (!names.length) { unknown++; continue; }
    const id = idOf(names);
    counts.set(id, (counts.get(id) || 0) + 1);
    decks++;
  }
  noCommander += unknown;

  const f = locate(tour.lat, tour.lng);
  let k = -1;
  if (f >= 0) {
    if (!countryIdx.has(f)) { countryIdx.set(f, countries.length); countries.push({ code: codeOf(features[f].properties), name: nameOf(features[f].properties), continent: continentOf(features[f].properties) }); }
    k = countryIdx.get(f);
  } else if (features) unplaced.push(`${tour.n} (${tour.lat.toFixed(2)}, ${tour.lng.toFixed(2)})`);

  const entry = [k, unknown];
  for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])) entry.push(id, n);
  t[tour.id] = entry;
}

// ---- Color identity (Scryfall) ----
// cache: card name -> "WU" style string ("" = colorless), or null when Scryfall doesn't know the name.
// A name that could not be asked for (network error) is left out of the cache and retried on the next run.
async function lookUpColors(names) {
  let cache = {};
  try { cache = JSON.parse(await readFile(OUT + 'colors.json', 'utf8')); } catch { /* first run */ }
  const missing = [...names].filter((n) => !(n in cache) || (cache[n] === null && (process.env.FULL || n.includes(' // '))));
  console.log(`Color identity: ${names.size} commanders, ${missing.length} to look up`);
  let failed = 0;
  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75);
    try {
      const res = await fetch(`${SCRYFALL_URL}/cards/collection`, {
        method: 'POST',
        headers: SCRYFALL_HEADERS,
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name: name.split(' // ')[0].trim() })) }), // "A // B" -> look up "A"
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const lookup = new Map();
      for (const c of data) { lookup.set(c.name.toLowerCase(), c); lookup.set(c.name.split(' // ')[0].toLowerCase(), c); }
      for (const n of chunk) {
        const c = lookup.get(n.toLowerCase()) || lookup.get(n.split(' // ')[0].toLowerCase());
        cache[n] = c ? [...WUBRG].filter((x) => (c.color_identity || []).includes(x)).join('') : null;
      }
    } catch (err) {
      failed += chunk.length;
      console.warn(`  scryfall chunk failed (${err.cause?.code || err.message}); will retry next run`);
    }
    await sleep(600); // Scryfall asks for <= 2 req/s on this endpoint
  }
  await writeFile(OUT + 'colors.json', JSON.stringify(cache));
  return { cache, failed };
}
const singleNames = new Set(commanders.flat());
const { cache: colorCache, failed: colorsFailed } = await lookUpColors(singleNames);
const colors = commanders.map((names) => { // a pair is the union of its commanders; unknown if any of them is
  const ids = names.map((n) => colorCache[n]);
  if (ids.some((id) => id == null)) return null;
  return [...WUBRG].filter((x) => ids.some((id) => id.includes(x))).join('');
});

const meta = { schema: SCHEMA, generated: index.generated, ...(features ? {} : { bordersMissing: true }), ...(colorsFailed ? { colorsPending: true } : {}), countries, commanders, colors, t };
await writeFile(OUT + 'meta.json', JSON.stringify(meta));

const tournaments = Object.keys(t).length;
console.log(`Wrote meta.json: ${tournaments} tournaments, ${decks} decks, ${commanders.length} commanders, ${countries.length} countries`);
console.log(`${colors.filter((c) => c === null).length} commanders without color identity${colorsFailed ? ` (${colorsFailed} lookups failed, will retry)` : ''}`);
console.log(`${noCommander} players without a listed commander, ${noStandings} tournaments without standings, ${unplaced.length} not placed in a country`);
if (unplaced.length) { console.log('Not placed (first 10):'); unplaced.slice(0, 10).forEach((l) => console.log(`  ${l}`)); }
await summary([
  '### Regional metagame data',
  '| | |', '|---|---|',
  `| Tournaments / decks | ${tournaments} / ${decks} |`,
  `| Commanders (and partner pairs) | ${commanders.length} |`,
  `| Countries | ${countries.length} |`,
  `| Commanders without color data | ${colors.filter((c) => c === null).length} |`,
  `| Not placed in a country | ${unplaced.length} |`,
  `| Players without a listed commander | ${noCommander} |`,
  '',
]);
