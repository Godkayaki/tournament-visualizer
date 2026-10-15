// Meta share maths for the Regional Metagame window. Pure functions, no DOM (that is regional-ui.js).
// `meta` is data/meta.json; its layout is described at the top of scripts/build-meta.mjs.

// "Biggest differences" only ranks commanders with at least this many decks, counting the decks the comparison would
// predict for this region too, so one lucky deck in a small region can't top the list.
export const MIN_EVIDENCE = 3;

// Conversion (decks that made the top cut / decks played) is only a fair ranking with enough decks behind it: a commander
// with 2 decks and 1 top cut is not "50%". Below this many decks (in tournaments that had a top cut) a commander is still
// listed, but after all the others when sorting by conversion.
export const MIN_CONV_DECKS = 10;

export const CONTINENTS = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];

// ---- Regions. A region is named by a key: 'world', 'cont:Europe' or 'country:12' (position in meta.countries) ----
export function regionExists(meta, key) {
  if (key === 'world') return true;
  if (key.startsWith('cont:')) return CONTINENTS.includes(key.slice(5));
  if (key.startsWith('country:')) return !!meta.countries[+key.slice(8)];
  return false;
}
export const regionLabel = (meta, key) => (key === 'world' ? 'World' : key.startsWith('cont:') ? key.slice(5) : meta.countries[+key.slice(8)].name);

// counts: commander -> decks. cuts: commander -> decks that made the top cut. eligible: commander -> decks played in tournaments
// that HAD a top cut (the denominator of the conversion rate). eligibleDecks / cutDecks are the same sums for the whole scope.
const newScope = () => ({ drawRateSum: 0, drawTournaments: 0, hiddenDecks: 0, tournaments: 0, cutTournaments: 0, unknown: 0, decks: 0, eligibleDecks: 0, cutDecks: 0, counts: new Map(), cuts: new Map(), eligible: new Map() });
const bump = (map, key, n) => { if (n) map.set(key, (map.get(key) || 0) + n); };

// Adds up the given tournaments: one scope for the whole world, one per continent and one per country
// (same order as meta.countries). A scope's `decks` counts players with a listed commander; `unknown` counts the others.
export function tally(meta, tournaments, minEntries = 0) {
  const world = newScope();
  const countries = meta.countries.map(newScope);
  const continents = new Map(CONTINENTS.map((c) => [c, newScope()]));
  let unplaced = 0; // tournaments outside every country: they only count for the world
  for (const t of tournaments) {
    const row = meta.t[t.id];
    if (!row) continue;
    const scopes = [world];
    if (row[0] >= 0) {
      scopes.push(countries[row[0]]);
      const continent = continents.get(meta.countries[row[0]].continent);
      if (continent) scopes.push(continent);
    } else unplaced++;
    const hasCut = row[2] === 1;
    const [drawGames, games] = [row[3], row[4]];
    for (const s of scopes) { if (games > 0) { s.drawRateSum += drawGames / games; s.drawTournaments++; } s.tournaments++; s.unknown += row[1]; if (hasCut) s.cutTournaments++; }
    for (let i = 5; i < row.length; i += 3) {
      const [id, n, cut] = [row[i], row[i + 1], row[i + 2]];
      for (const s of scopes) {
        bump(s.counts, id, n); s.decks += n;
        bump(s.cuts, id, cut); s.cutDecks += cut;
        if (hasCut) { bump(s.eligible, id, n); s.eligibleDecks += n; }
      }
    }
  }
  const result = { world, countries, continents, unplaced };
  if (minEntries > 0) restrictAll(result, minEntries);
  return result;
}

// "Min. entries": commanders with fewer decks than `minEntries` in the WORLD (same tournaments) are dropped from every region, so
// casual or very rarely played decks don't count, and a compared pair of regions always has the same set of commanders to work
// with. Shares and conversion are then recalculated over the commanders that are left (decks, eligibleDecks, cutDecks).
function restrictAll(result, minEntries) {
  const allowed = new Set([...result.world.counts].filter(([, n]) => n >= minEntries).map(([id]) => id));
  const sum = (map) => { let t = 0; for (const n of map.values()) t += n; return t; };
  for (const s of [result.world, ...result.countries, ...result.continents.values()]) {
    const before = s.decks;
    for (const map of [s.counts, s.cuts, s.eligible]) for (const id of [...map.keys()]) if (!allowed.has(id)) map.delete(id);
    s.decks = sum(s.counts); s.eligibleDecks = sum(s.eligible); s.cutDecks = sum(s.cuts);
    s.hiddenDecks = before - s.decks;
  }
}

export const scopeFor = (counts, key) =>
  key === 'world' ? counts.world : key.startsWith('cont:') ? counts.continents.get(key.slice(5)) : counts.countries[+key.slice(8)];

// ---- Colors. A deck's identity is a string in WUBRG order ('' = colorless); the filter matches it exactly ----
export const COLOR_ORDER = 'WUBRG';
const NAMES = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
  WU: 'Azorius', UB: 'Dimir', BR: 'Rakdos', RG: 'Gruul', WG: 'Selesnya', WB: 'Orzhov', UR: 'Izzet', BG: 'Golgari', WR: 'Boros', UG: 'Simic',
  WUG: 'Bant', WUB: 'Esper', UBR: 'Grixis', BRG: 'Jund', WRG: 'Naya', WBG: 'Abzan', WUR: 'Jeskai', UBG: 'Sultai', WBR: 'Mardu', URG: 'Temur',
  UBRG: 'Glint-Eye', WBRG: 'Dune-Brood', WURG: 'Ink-Treader', WUBG: 'Witch-Maw', WUBR: 'Yore-Tiller', WUBRG: 'Five-color',
};
export const colorName = (key) => (key === '' ? 'Colorless' : NAMES[key] || key);

// The selection ('W', 'U', ..., 'C' for colorless or '5' for five-color) as a color key, or null when nothing is selected (= no filter)
export function colorFilter(selection) {
  if (!selection.size) return null;
  if (selection.has('5')) return COLOR_ORDER; // the five-color button: all of WUBRG in one go
  return selection.has('C') ? '' : [...COLOR_ORDER].filter((c) => selection.has(c)).join('');
}
const hasColor = (meta, id, colorKey) => colorKey === null || meta.colors?.[id] === colorKey;

// What a color filter leaves of a scope: decks, distinct commanders, and decks whose colors are unknown
export function colorTotals(meta, scope, colorKey) {
  let decks = 0, commanders = 0, unknownDecks = 0;
  for (const [id, n] of scope.counts) {
    if (meta.colors?.[id] == null) unknownDecks += n;
    if (hasColor(meta, id, colorKey)) { decks += n; commanders++; }
  }
  return { decks, commanders, unknownDecks };
}

// ---- Ranking ----
const share = (scope, id) => (scope.decks ? ((scope.counts.get(id) || 0) / scope.decks) * 100 : 0); // % of ALL decks of the scope

// Conversion rate of a commander (or of the whole scope when `id` is null), as a percentage; null when it has no decks in
// tournaments with a top cut.
const conversion = (scope, id) => {
  const elig = id === null ? scope.eligibleDecks : scope.eligible.get(id) || 0;
  const cut = id === null ? scope.cutDecks : scope.cuts.get(id) || 0;
  return elig ? (cut / elig) * 100 : null;
};
// Average draw rate per tournament, as a percentage of games; null when no tournament has games recorded.
export const avgDrawRate = (scope) => (scope.drawTournaments ? (scope.drawRateSum / scope.drawTournaments) * 100 : null);
// Average draw rate (%) over a list of tournaments, straight from meta.json (schema 4+): the mean of each tournament's own rate.
// null when none of them has games recorded.
export function avgDrawRateOf(meta, tournaments) {
  if (!(meta.schema >= 4)) return null; // older files don't have the draw numbers
  let sum = 0, n = 0;
  for (const t of tournaments) {
    const row = meta.t[t.id];
    if (row && row[4] > 0) { sum += row[3] / row[4]; n++; }
  }
  return n ? (sum / n) * 100 : null;
}
export const fieldConversion = (scope) => conversion(scope, null);

// Every commander of `scope`, ranked. `baseline` (a scope, or null) adds the baseline's share and the gap in percentage points.
// A color filter only hides commanders: the percentages stay a share of all the scope's decks.
//   sort 'most': by decks played in the scope (all of them, no grouping)
//   sort 'conv': by conversion rate; commanders with fewer than MIN_CONV_DECKS decks to measure it come last (row.thin)
//   sort 'diff': by the size of the gap to the baseline, including commanders the scope doesn't play at all
export function rank(meta, scope, baseline, sort, colorKey = null) {
  const byDiff = sort === 'diff' && !!baseline;
  const ids = byDiff ? new Set([...scope.counts.keys(), ...baseline.counts.keys()]) : scope.counts.keys();
  const rows = [];
  for (const id of ids) {
    if (!hasColor(meta, id, colorKey)) continue;
    const n = scope.counts.get(id) || 0;
    const pct = share(scope, id);
    const basePct = baseline ? share(baseline, id) : null;
    if (byDiff && Math.max(n, (basePct / 100) * scope.decks) < MIN_EVIDENCE) continue;
    const names = meta.commanders[id];
    const elig = scope.eligible.get(id) || 0;
    const conv = conversion(scope, id);
    const baseConv = baseline ? conversion(baseline, id) : null;
    rows.push({
      id, names, name: names.join(' / '), n, pct, basePct, diff: baseline ? pct - basePct : null,
      cut: scope.cuts.get(id) || 0, elig, conv, thin: elig < MIN_CONV_DECKS,
      baseConv, convDiff: conv !== null && baseConv !== null ? conv - baseConv : null,
    });
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  rows.sort(byDiff ? (a, b) => Math.abs(b.diff) - Math.abs(a.diff) || byName(a, b)
    : sort === 'conv' ? (a, b) => a.thin - b.thin || (b.conv ?? -1) - (a.conv ?? -1) || b.n - a.n || byName(a, b)
    : (a, b) => b.n - a.n || byName(a, b));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}