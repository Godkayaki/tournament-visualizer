// Builds site/data/meta.json for the "Regional Metagame" window: for every tournament, how many decks of each
// commander were played and how many of them made the top cut, in which country (and continent) it took place, and the
// color identity of every commander.
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
//     t: { <tournament id>: [countryIndex or -1, decksWithoutCommander, hasTopCut (1/0), drawGames, games, commanderIndex, decks, topCutDecks, commanderIndex, decks, topCutDecks, ...] }
//   }
//
// Draw rate of a tournament = drawGames / games, from the W/L/D records of ALL its players (a draw is one "D" for every player at
// the pod, a win is one "W" and three "L", so the share of D among every W+L+D is the share of games that were drawn). The front-end
// averages it over tournaments; one with no games recorded is skipped.
//
// Seats: when the standings rows carry `q` (the player's [games at seat 1..4, wins at seat 1..4], written by fetch-data.mjs from the
// rounds), they are added up per commander and tournament into data/seats.json, which only the commander view loads:
//   { schema: 1, t: { <tournament id>: [commanderIndex, g1, g2, g3, g4, w1, w2, w3, w4, commanderIndex, ...] } }
// (the commanderIndex is the same as in meta.json). Tournaments without seat data are simply absent.
//
// Entries: data/c/<commanderIndex>.json lists every deck of that commander, one row per deck, for the Tournaments tab of the commander view:
//   [[tournament id, place (1 = winner), player id, player name, wins, losses, draws], ...]   (the place is the row in the standings)
// The folder is wiped and rewritten on every build, because the commander indexes change from build to build.
//
// Spicy cards: data/s/<commanderIndex>.json holds what the Spicy cards tab needs, built from the card lists in .cache/decks/ (see decks.mjs):
//   { v: 1, m: decks with a card list, avg: average play rate of a card in a list (0-1), miss: [row of c/<id>.json without a card list, ...],
//     cards: [[card name, [row of c/<id>.json that plays it, ...]], ...] }
// The rows are positions in data/c/<commanderIndex>.json, so the browser can apply its own filters (period, players, region) to them.
// Only the cards that could be "spicy" are listed (at least SPICY_MIN_DECKS decks, in at most SPICY_MAX_RATE of the lists); a card that is
// in most lists only counts towards `avg`. Commanders with fewer than SPICY_MIN_LISTS card lists get no file. The folder is rewritten
// on every build, like data/c/.
//
// Conversion = decks that made the top cut / decks played, counting only tournaments that had a top cut (hasTopCut = 1). A deck
// is in the top cut when its player is among the first `topCut` rows of the standings (kept in final-placement order by
// fetch-data.mjs). In a tournament without a top cut every topCutDecks is 0 and the front-end leaves its decks out of the rate.

import { readFile, writeFile, appendFile, mkdir, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../site/data/', import.meta.url));
const DECKS = fileURLToPath(new URL('../.cache/decks/', import.meta.url)); // raw card lists written by fetch-data.mjs
const SCHEMA = 9; // bump when the layout or the counting rules change, so cached files get rebuilt
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
let haveSpicy = true; // card lists were cached but data/s/ was never written (e.g. meta.json was built before this existed): rebuild
const listCount = (await readdir(DECKS).catch(() => [])).length;
if (listCount) haveSpicy = (await readdir(OUT + 's/').catch(() => [])).length > 0;
if (!process.env.FULL && haveSpicy && previous?.schema === SCHEMA && previous.generated === index.generated && !previous.bordersMissing && !previous.colorsPending) {
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
const seatsOut = {};
const entriesOut = new Map(); // commander id -> rows of data/c/<id>.json
const listsOut = new Map();   // commander id -> { m, miss: [rows], cards: Map(name -> [rows]) }, for data/s/<id>.json
const SPICY_MIN_DECKS = 3, SPICY_MAX_RATE = 0.35, SPICY_MIN_LISTS = 20;
let withLists = 0;
let seatTournaments = 0;
let decks = 0, noCommander = 0, noStandings = 0, withCut = 0, cutDecks = 0;
const unplaced = [];
// Unique players per tournament (for the "unique players per week" chart on the methodology page): every player gets a small number, and each
// tournament lists the numbers of its players, sorted and stored as differences (so the file stays small). A player is TopDeck's player id
// (the name when there is none). The browser applies the name filter and the size filter itself, so it can count weeks any way it needs.
const playerNum = new Map();
const playersOut = {};
for (const tour of index.tournaments) {
  let rows;
  try { rows = JSON.parse(await readFile(`${OUT}t/${tour.f}.json`, 'utf8')); }
  catch { noStandings++; continue; }

  const nums = new Set();
  for (const p of rows) {
    const key = p.i || (p.n ? `n:${String(p.n).trim().toLowerCase()}` : '');
    if (!key) continue;
    if (!playerNum.has(key)) playerNum.set(key, playerNum.size);
    nums.add(playerNum.get(key));
  }
  let prevNum = 0;
  playersOut[tour.id] = [...nums].sort((a, b) => a - b).map((n) => { const d = n - prevNum; prevNum = n; return d; });

  let lists = null; // this tournament's card lists: { n: [names], d: { player id: [indexes] } }
  try { lists = JSON.parse(await readFile(`${DECKS}${tour.f}.json`, 'utf8')); } catch { /* none for this one */ }
  if (lists) withLists++;
  const counts = new Map(); // commander id -> [decks, top cut decks]
  const seatCounts = new Map(); // commander id -> [games at seat 1..4, wins at seat 1..4]
  const cutSize = tour.tc > 0 ? tour.tc : 0;
  let unknown = 0, drawGames = 0, games = 0;
  for (const [place, p] of rows.entries()) {
    drawGames += +p.d || 0; games += (+p.w || 0) + (+p.l || 0) + (+p.d || 0);
    const names = [...new Set((p.c || []).map((s) => String(s).split(' // ')[0].trim()).filter(Boolean))].sort(); // double-faced: "A // B" and "A" are one commander // sorted: A/B and B/A are the same deck
    if (!names.length) { unknown++; continue; }
    const id = idOf(names);
    const rowsOf = entriesOut.get(id) || entriesOut.set(id, []).get(id);
    rowsOf.push([tour.id, place + 1, p.i ?? '', p.n ?? '', +p.w || 0, +p.l || 0, +p.d || 0]);
    const acc = listsOut.get(id) || listsOut.set(id, { m: 0, miss: [], cards: new Map() }).get(id);
    const mine = lists?.d?.[p.i];
    if (mine) {
      acc.m++;
      for (const ix of mine) { const name = lists.n[ix]; const at = acc.cards.get(name); if (at) at.push(rowsOf.length - 1); else acc.cards.set(name, [rowsOf.length - 1]); }
    } else acc.miss.push(rowsOf.length - 1);
    if (Array.isArray(p.q) && p.q.length === 8) {
      const s = seatCounts.get(id) || seatCounts.set(id, [0, 0, 0, 0, 0, 0, 0, 0]).get(id);
      p.q.forEach((v, i) => { s[i] += +v || 0; });
    }
    const c = counts.get(id) || counts.set(id, [0, 0]).get(id);
    c[0]++;
    if (place < cutSize) { c[1]++; cutDecks++; }
    decks++;
  }
  noCommander += unknown;

  const f = locate(tour.lat, tour.lng);
  let k = -1;
  if (f >= 0) {
    if (!countryIdx.has(f)) { countryIdx.set(f, countries.length); countries.push({ code: codeOf(features[f].properties), name: nameOf(features[f].properties), continent: continentOf(features[f].properties) }); }
    k = countryIdx.get(f);
  } else if (features) unplaced.push(`${tour.n} (${tour.lat.toFixed(2)}, ${tour.lng.toFixed(2)})`);

  if (cutSize) withCut++;
  const entry = [k, unknown, cutSize ? 1 : 0, drawGames, games];
  for (const [id, [n, cut]] of [...counts].sort((a, b) => b[1][0] - a[1][0] || a[0] - b[0])) entry.push(id, n, cut);
  t[tour.id] = entry;
  if (seatCounts.size) {
    seatsOut[tour.id] = [...seatCounts].flatMap(([id, s]) => [id, ...s]);
    seatTournaments++;
  }
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
await rm(OUT + 'c/', { recursive: true, force: true });
await rm(OUT + 's/', { recursive: true, force: true });
await mkdir(OUT + 's/', { recursive: true });
let spicyFiles = 0, spicyBytes = 0;
for (const [id, a] of listsOut) {
  if (a.m < SPICY_MIN_LISTS) continue;
  // average play rate of a card slot: sum(p^2) / sum(p) over every card, i.e. the play rate of the card an average list card is
  let sp = 0, sp2 = 0;
  for (const rows of a.cards.values()) { const p = rows.length / a.m; sp += p; sp2 += p * p; }
  const cards = [...a.cards].filter(([, rows]) => rows.length >= SPICY_MIN_DECKS && rows.length / a.m <= SPICY_MAX_RATE).sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));
  const text = JSON.stringify({ v: 1, m: a.m, avg: +(sp ? sp2 / sp : 0).toFixed(4), miss: a.miss, cards });
  await writeFile(`${OUT}s/${id}.json`, text);
  spicyFiles++; spicyBytes += text.length;
}
await mkdir(OUT + 'c/', { recursive: true });
for (const [id, list] of entriesOut) await writeFile(`${OUT}c/${id}.json`, JSON.stringify(list));
await writeFile(OUT + 'players.json', JSON.stringify({ schema: 1, generated: index.generated, t: playersOut }));
if (seatTournaments) await writeFile(OUT + 'seats.json', JSON.stringify({ schema: 1, generated: index.generated, t: seatsOut }));

const tournaments = Object.keys(t).length;
console.log(`Wrote meta.json: ${tournaments} tournaments, ${decks} decks, ${commanders.length} commanders, ${countries.length} countries`);
console.log(`Entries: ${entriesOut.size} commander files in data/c/`);
console.log(`Players: ${playerNum.size} distinct players in ${Object.keys(playersOut).length} tournaments (data/players.json)`);
console.log(`Spicy cards: ${withLists} tournaments with card lists, ${spicyFiles} commander files in data/s/ (${(spicyBytes / 1e6).toFixed(1)} MB)${withLists ? '' : ' (none yet: they appear after a full fetch-data run)'}`);
console.log(`Seats: ${seatTournaments} tournaments with per-commander seat data${seatTournaments ? '' : ' (none yet: they appear after a full fetch-data run)'}`);
console.log(`${withCut} of ${tournaments} tournaments have a top cut (${cutDecks} decks in it)`);
console.log(`${colors.filter((c) => c === null).length} commanders without color identity${colorsFailed ? ` (${colorsFailed} lookups failed, will retry)` : ''}`);
console.log(`${noCommander} players without a listed commander, ${noStandings} tournaments without standings, ${unplaced.length} not placed in a country`);
if (unplaced.length) { console.log('Not placed (first 10):'); unplaced.slice(0, 10).forEach((l) => console.log(`  ${l}`)); }
await summary([
  '### Regional metagame data',
  '| | |', '|---|---|',
  `| Tournaments / decks | ${tournaments} / ${decks} |`,
  `| Commanders (and partner pairs) | ${commanders.length} |`,
  `| Tournaments with seat data | ${seatTournaments} |`,
  `| Tournaments with card lists / commander files for Spicy cards | ${withLists} / ${spicyFiles} |`,
  `| Countries | ${countries.length} |`,
  `| Tournaments with a top cut / decks in it | ${withCut} / ${cutDecks} |`,
  `| Commanders without color data | ${colors.filter((c) => c === null).length} |`,
  `| Not placed in a country | ${unplaced.length} |`,
  `| Players without a listed commander | ${noCommander} |`,
  '',
]);
