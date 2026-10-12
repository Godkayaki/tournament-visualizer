// Diagnostic: prints the Regional Metagame numbers for some commanders under the different ways of counting, so they can be
// compared with another site (edhtop16.com) for the SAME tournaments.
//
//   node scripts/check-meta.mjs [--months 12] [--players 0] [--commander "kraum"] [--top 10] [--country ES] [--all-names]
//   --all-names  skips the cEDH name filter (Casual, Budget, Bracket 1-4...), like a site that keeps every tournament
//
// Needs site/data/tournaments.json and meta.json (npm run fetch, npm run meta). It applies the same cEDH name filter, players
// and period filters as the site. "months 0" = all time.
import { readFile } from 'node:fs/promises';
import { blockedBy } from '../site/js/filters.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const months = +arg('months', 6), minPlayers = +arg('players', 50), top = +arg('top', 10), query = (arg('commander', '') || '').toLowerCase(), country = arg('country', null);
const dir = new URL('../site/data/', import.meta.url);
const index = JSON.parse(await readFile(new URL('tournaments.json', dir), 'utf8'));
const meta = JSON.parse(await readFile(new URL('meta.json', dir), 'utf8'));
const allNames = process.argv.includes('--all-names');
const cutoff = months ? Date.now() / 1000 - months * 30.44 * 86400 : 0;

const per = new Map(); // commander -> { decks, cut, eligDecks, eligCut }
let announced = 0, noRow = 0, tournaments = 0, withCut = 0, known = 0, unknown = 0, eligKnown = 0, cutKnown = 0;
for (const t of index.tournaments) {
  if ((!allNames && blockedBy(t.n)) || t.p < minPlayers || t.d < cutoff) continue;
  announced += t.p;
  const row = meta.t[t.id]; if (!row) { noRow++; continue; }
  if (country && meta.countries[row[0]]?.code !== country) continue;
  tournaments++; unknown += row[1]; const hasCut = row[2] === 1; if (hasCut) withCut++;
  for (let i = 5; i < row.length; i += 3) {
    const [id, n, cut] = [row[i], row[i + 1], row[i + 2]];
    const c = per.get(id) || { decks: 0, cut: 0, eligDecks: 0 }; per.set(id, c);
    c.decks += n; c.cut += cut; known += n;
    if (hasCut) { c.eligDecks += n; eligKnown += n; cutKnown += cut; }
  }
}
const all = known + unknown, pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '–');
console.log(`${allNames ? 'NO name filter · ' : ''}Window: ${months ? months + ' months' : 'all time'}, ${minPlayers}+ players${country ? ', ' + country : ''}`);
console.log(`${tournaments} tournaments (${withCut} with a top cut) · ${all} players: ${known} with a commander, ${unknown} without`);
console.log(`Players announced by the tournaments (sum of their player counts): ${announced}; tournaments missing from meta.json: ${noRow}`);
console.log(`Players without a commander are ${pc(unknown, all)} of everyone, so shares over known decks are inflated by x${(all / known).toFixed(2)} compared with shares over all players.\n`);
const rows = [...per.entries()].map(([id, c]) => ({ name: meta.commanders[id].join(' / '), ...c })).sort((a, b) => b.decks - a.decks);
const shown = (query ? rows.filter((r) => r.name.toLowerCase().includes(query)) : rows).slice(0, top);
console.log('commander'.padEnd(46), 'decks'.padStart(6), 'share(known)'.padStart(13), 'share(all)'.padStart(11), 'conv(cut events)'.padStart(17), 'conv(all events)'.padStart(17));
for (const r of shown) console.log(r.name.slice(0, 45).padEnd(46), String(r.decks).padStart(6), pc(r.decks, known).padStart(13), pc(r.decks, all).padStart(11), pc(r.cut, r.eligDecks).padStart(17), pc(r.cut, r.decks).padStart(17));
