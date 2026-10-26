// The chart on the methodology page: tournaments per week, from the same data (and the same name filter) as the globe.
import { blockedBy } from './filters.js';
import { makeBuckets } from './commander.js';
import { lineChart } from './chart.js';
import { esc } from './utils.js';

const box = document.getElementById('tpw-chart');
const select = document.getElementById('tpw-players');
const DAY = 86400;
const SPAN = 0.3; // share of the weeks that each point of the trend is fitted from
// A smooth trend line (LOESS): each week gets a straight line fitted by weighted least squares to its nearest weeks, closer weeks
// counting more, and the line's value there. It follows the gradual rise or fall without copying the week-to-week noise.
function trend(values) {
  const n = values.length;
  if (n < 8) return values.map(() => null);
  const k = Math.max(5, Math.ceil(SPAN * n));
  return values.map((_, i) => {
    const from = Math.min(Math.max(0, i - (k >> 1)), n - k);
    const dmax = Math.max(i - from, from + k - 1 - i) + 1;
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let j = from; j < from + k; j++) {
      const u = Math.abs(j - i) / dmax, w = (1 - u ** 3) ** 3;
      sw += w; sx += w * j; sy += w * values[j]; sxx += w * j * j; sxy += w * j * values[j];
    }
    const den = sw * sxx - sx * sx;
    const b = den > 1e-9 ? (sw * sxy - sx * sy) / den : 0;
    return Math.max(0, (sy - b * sx) / sw + b * i);
  });
}
const fmt = (ts, opts) => new Date(ts * 1000).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

let tournaments = [];
let players = null; // data/players.json: { tournament id: [player numbers as differences] }, null until loaded / when missing

function draw() {
  const min = +select.value;
  const now = Date.now() / 1000;
  const mine = tournaments.filter((t) => t.p >= min);
  if (!mine.length) { box.textContent = 'No tournaments to show.'; return; }
  const { list, bucketOf } = makeBuckets(mine, 0, 'week', now);
  while (list.length && list[list.length - 1].start + 7 * DAY > now) list.pop(); // the current week isn't over: it would show a false dip
  const counts = list.map(() => 0);
  for (const t of mine) { const i = bucketOf(t.d); if (i < counts.length && list[i].start <= t.d && t.d < list[i].start + 7 * DAY) counts[i]++; } // bucketOf clamps to the last bucket, so tournaments of the unfinished week (removed above) must not fall into the week before it
  drawChart(box, $('tpw-note'), { name: 'Tournaments', title: 'Tournaments per week', unit: ['tournament', 'tournaments'], list, counts });
  drawPlayers(mine, list);
}

// Unique players per week: the same weeks as above, each week counting every player once, whatever the number of tournaments they played
function drawPlayers(mine, list) {
  const out = $('upl-chart'), note = $('upl-note');
  if (!players) { out.textContent = "The player data isn't available yet. It appears after the next data update."; note.textContent = ''; return; }
  const sets = list.map(() => new Set());
  for (const t of mine) {
    const i = bucketIndex(list, t.d);
    const nums = players.t?.[t.id];
    if (i < 0 || !nums) continue;
    let n = 0;
    for (const d of nums) { n += d; sets[i].add(n); }
  }
  drawChart(out, note, { name: 'Unique players', title: 'Unique players per week', unit: ['player', 'players'], list, counts: sets.map((x) => x.size) });
}
const $ = (id) => document.getElementById(id);
// The week a time falls in, or -1 (the weeks of `list` are consecutive Mondays; the unfinished week isn't in it)
const bucketIndex = (list, ts) => { const i = Math.floor((ts - list[0].start) / (7 * DAY)); return i >= 0 && i < list.length ? i : -1; };

function drawChart(el, noteEl, { name, title, unit, list, counts }) {
  const fitted = trend(counts);
  lineChart(el, {
    labels: list.map((b) => fmt(b.start, { month: 'short', year: 'numeric' })),
    series: [
      { name, color: 'var(--accent)', values: counts },
      { name: 'Trend', color: '#f0a93b', values: fitted, width: 2.5, noDots: true },
    ],
    title,
    integer: true,
    yLabel: (v) => String(Math.round(v)),
    tooltip: (i) => `<b>Week of ${esc(fmt(list[i].start, { day: 'numeric', month: 'short', year: 'numeric' }))}</b><div><i class="sw a"></i>${counts[i].toLocaleString()} ${counts[i] === 1 ? unit[0] : unit[1]}</div>${fitted[i] === null ? '' : `<div><i class="sw b"></i>Trend: about ${fitted[i].toFixed(1)}</div>`}`,
  });
  const total = counts.reduce((a, b) => a + b, 0);
  const span = `from ${fmt(list[0].start, { day: 'numeric', month: 'short', year: 'numeric' })} to ${fmt(list[list.length - 1].start + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  noteEl.textContent = unit[1] === 'players'
    ? `${list.length} weeks ${span}; the busiest had ${Math.max(...counts).toLocaleString()} unique players.` // summing players of different weeks would count people twice
    : `${total.toLocaleString()} tournaments ${span}.`;
}

try {
  const r = await fetch('data/tournaments.json');
  if (!r.ok) throw new Error(r.status);
  const { tournaments: all } = await r.json();
  tournaments = all.filter((t) => !blockedBy(t.n));
  try { const pr = await fetch('data/players.json'); if (pr.ok) players = await pr.json(); } catch { /* the chart says the data isn't there yet */ }
  draw();
  select.addEventListener('change', draw);
} catch {
  box.textContent = 'Could not load the tournament data.';
}