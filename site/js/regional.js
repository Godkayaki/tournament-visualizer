// Meta share maths for the Regional Metagame window. Pure functions, no DOM (that is regional-ui.js).
// `meta` is data/meta.json; its layout is described at the top of scripts/build-meta.mjs.

// "Biggest differences" only ranks commanders with at least this many decks, counting the decks the comparison would
// predict for this region too, so one lucky deck in a small region can't top the list.
export const MIN_EVIDENCE = 3;

export const CONTINENTS = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];

// ---- Regions. A region is named by a key: 'world', 'cont:Europe' or 'country:12' (position in meta.countries) ----
export function regionExists(meta, key) {
  if (key === 'world') return true;
  if (key.startsWith('cont:')) return CONTINENTS.includes(key.slice(5));
  if (key.startsWith('country:')) return !!meta.countries[+key.slice(8)];
  return false;
}
export const regionLabel = (meta, key) => (key === 'world' ? 'World' : key.startsWith('cont:') ? key.slice(5) : meta.countries[+key.slice(8)].name);

const newScope = () => ({ tournaments: 0, unknown: 0, decks: 0, counts: new Map() });

// Adds up the given tournaments: one scope for the whole world, one per continent and one per country
// (same order as meta.countries). A scope's `decks` counts players with a listed commander; `unknown` counts the others.
export function tally(meta, tournaments) {
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
    for (const s of scopes) { s.tournaments++; s.unknown += row[1]; }
    for (let i = 2; i < row.length; i += 2) {
      for (const s of scopes) { s.counts.set(row[i], (s.counts.get(row[i]) || 0) + row[i + 1]); s.decks += row[i + 1]; }
    }
  }
  return { world, countries, continents, unplaced };
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

// The selection ('W', 'U', ..., or 'C' for colorless) as a color key, or null when nothing is selected (= no filter)
export function colorFilter(selection) {
  if (!selection.size) return null;
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

// Every commander of `scope`, ranked. `baseline` (a scope, or null) adds the baseline's share and the gap in percentage points.
// A color filter only hides commanders: the percentages stay a share of all the scope's decks.
//   sort 'most': by decks played in the scope (all of them, no grouping)
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
    rows.push({ id, names, name: names.join(' / '), n, pct, basePct, diff: baseline ? pct - basePct : null });
  }
  rows.sort(byDiff
    ? (a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name)
    : (a, b) => b.n - a.n || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}