// Maths for the commander view of the Regional Metagame: one commander over time and in one or two regions. Pure functions, no DOM
// (the window is commander-ui.js, the line chart chart.js). `meta` is data/meta.json (layout: top of scripts/build-meta.mjs),
// `seats` is data/seats.json (or null), `tournaments` are the ones that pass the Players / Period filters.

import { MIN_CONV_DECKS } from './regional.js';

const DAY = 86400;

// Does a tournament in country `idx` (-1 = not placed in a country) belong to region `key`? ('world', 'cont:Europe', 'country:3')
export function inRegion(meta, key, idx) {
  if (key === 'world') return true;
  if (idx < 0) return false;
  return key.startsWith('cont:') ? meta.countries[idx].continent === key.slice(5) : idx === +key.slice(8);
}

// ---- Time buckets ----
const weekStart = (ts) => { const d = Math.floor(ts / DAY); return (d - ((d + 3) % 7)) * DAY; }; // the Monday (UTC) of that week
const monthStart = (ts) => { const d = new Date(ts * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; };
const nextMonth = (ts) => { const d = new Date(ts * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000; };

// The buckets covering the period: [{ start, label }], plus bucketOf(ts) -> index. `group` is 'auto' | 'week' | 'month';
// auto uses weeks while the period is about four months or shorter, months for anything longer.
export function makeBuckets(tournaments, months, group, now = Date.now() / 1000) {
  const first = tournaments.length ? Math.min(...tournaments.map((t) => t.d)) : now;
  const from = months ? now - months * 30.44 * DAY : first;
  const unit = group === 'auto' ? (now - from <= 130 * DAY ? 'week' : 'month') : group;
  const startOf = unit === 'week' ? weekStart : monthStart;
  const step = unit === 'week' ? (s) => s + 7 * DAY : nextMonth;
  const list = [];
  for (let s = startOf(from); s <= now; s = step(s)) list.push({ start: s });
  const index = new Map(list.map((b, i) => [b.start, i]));
  const opts = unit === 'week' ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' };
  for (const b of list) {
    b.label = new Date(b.start * 1000).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
    b.title = unit === 'week' ? `Week of ${b.label}` : b.label;
  }
  const bucketOf = (ts) => Math.min(list.length - 1, Math.max(0, index.get(startOf(ts)) ?? 0));
  return { unit, list, bucketOf };
}

// ---- One commander in one region ----
// `allowed`: Set of commander ids that pass "Min. entries" (null = all). The commander itself always counts, so its share stays a
// real share even when it is below the filter.
// Returns { buckets: [{ decks, total, cut, elig, cutAll }], total: { ..., tournaments, appearances }, seat }. cutAll = top cut decks of every
// commander (that passes `allowed`) in the same tournaments, the denominator of the commander's share of the top cut.
// seat = { games: [4], wins: [4] } or null when there is no seat data for these tournaments.
export function commanderIn(meta, seats, tournaments, region, id, allowed, buckets) {
  const blank = () => ({ decks: 0, total: 0, cut: 0, elig: 0, cutAll: 0 });
  const per = buckets.list.map(blank);
  const all = { ...blank(), tournaments: 0, appearances: 0 };
  const seat = { games: [0, 0, 0, 0], wins: [0, 0, 0, 0] };
  let seatSeen = false;
  for (const t of tournaments) {
    const row = meta.t[t.id];
    if (!row || !inRegion(meta, region, row[0])) continue;
    const b = per[buckets.bucketOf(t.d)];
    const hasCut = row[2] === 1;
    all.tournaments++;
    for (let i = 5; i < row.length; i += 3) {
      const [cid, n, cut] = [row[i], row[i + 1], row[i + 2]];
      if (allowed && cid !== id && !allowed.has(cid)) continue;
      b.total += n; all.total += n; b.cutAll += cut; all.cutAll += cut;
      if (cid !== id) continue;
      b.decks += n; all.decks += n; b.cut += cut; all.cut += cut; all.appearances++;
      if (hasCut) { b.elig += n; all.elig += n; }
    }
    const s = seats?.t?.[t.id];
    if (s) for (let i = 0; i < s.length; i += 9) {
      if (s[i] !== id) continue;
      seatSeen = true;
      for (let k = 0; k < 4; k++) { seat.games[k] += s[i + 1 + k]; seat.wins[k] += s[i + 5 + k]; }
    }
  }
  return { buckets: per, total: all, seat: seatSeen ? seat : null };
}

// ---- One commander in every country ----
// One pass over the tournaments: for each country (same order as meta.countries) the commander's decks, the decks of every commander that
// passes `allowed` (for its meta share), and the conversion figures (cut decks / decks in tournaments that had a top cut).
// Tournaments that couldn't be placed in a country are left out.
export function commanderByCountry(meta, tournaments, id, allowed) {
  const per = meta.countries.map(() => ({ decks: 0, total: 0, cut: 0, elig: 0 }));
  for (const t of tournaments) {
    const row = meta.t[t.id];
    if (!row || row[0] < 0 || !per[row[0]]) continue;
    const c = per[row[0]];
    const hasCut = row[2] === 1;
    for (let i = 5; i < row.length; i += 3) {
      const [cid, n, cut] = [row[i], row[i + 1], row[i + 2]];
      if (allowed && cid !== id && !allowed.has(cid)) continue;
      c.total += n;
      if (cid !== id) continue;
      c.decks += n; c.cut += cut;
      if (hasCut) c.elig += n;
    }
  }
  return per;
}

// ---- Numbers the view shows ----
export const share = (x) => (x.total ? (x.decks / x.total) * 100 : null);      // meta share, %
export const conversion = (x) => (x.elig ? (x.cut / x.elig) * 100 : null);      // conversion rate, %
export const cutShare = (x) => (x.cutAll ? (x.cut / x.cutAll) * 100 : null);    // share of all top cut spots, %
export const isThin = (x) => x.elig < MIN_CONV_DECKS;                            // too few decks to trust the conversion
// Seat win rate (%) of seat k (0-3) and overall; null when the commander never sat there
export const seatRate = (seat, k) => (seat && seat.games[k] ? (seat.wins[k] / seat.games[k]) * 100 : null);
export const seatOverall = (seat) => {
  const g = seat ? seat.games.reduce((a, b) => a + b, 0) : 0;
  return g ? (seat.wins.reduce((a, b) => a + b, 0) / g) * 100 : null;
};