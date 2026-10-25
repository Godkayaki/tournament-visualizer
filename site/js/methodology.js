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

function draw() {
  const min = +select.value;
  const now = Date.now() / 1000;
  const mine = tournaments.filter((t) => t.p >= min);
  if (!mine.length) { box.textContent = 'No tournaments to show.'; return; }
  const { list, bucketOf } = makeBuckets(mine, 0, 'week', now);
  while (list.length && list[list.length - 1].start + 7 * DAY > now) list.pop(); // the current week isn't over: it would show a false dip
  const counts = list.map(() => 0);
  for (const t of mine) { const i = bucketOf(t.d); if (i < counts.length && list[i].start <= t.d && t.d < list[i].start + 7 * DAY) counts[i]++; } // bucketOf clamps to the last bucket, so tournaments of the unfinished week (removed above) must not fall into the week before it
  const fitted = trend(counts);
  lineChart(box, {
    labels: list.map((b) => fmt(b.start, { month: 'short', year: 'numeric' })),
    series: [
      { name: 'Tournaments', color: 'var(--accent)', values: counts },
      { name: 'Trend', color: '#f0a93b', values: fitted, width: 2.5, noDots: true },
    ],
    title: 'Tournaments per week',
    integer: true,
    yLabel: (v) => String(Math.round(v)),
    tooltip: (i) => `<b>Week of ${esc(fmt(list[i].start, { day: 'numeric', month: 'short', year: 'numeric' }))}</b><div><i class="sw a"></i>${counts[i].toLocaleString()} ${counts[i] === 1 ? 'tournament' : 'tournaments'}</div>${fitted[i] === null ? '' : `<div><i class="sw b"></i>Trend: about ${fitted[i].toFixed(1)}</div>`}`,
  });
  const total = counts.reduce((a, b) => a + b, 0);
  document.getElementById('tpw-note').textContent = `${total.toLocaleString()} tournaments from ${fmt(list[0].start, { day: 'numeric', month: 'short', year: 'numeric' })} to ${fmt(list[list.length - 1].start + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}.`;
}

try {
  const r = await fetch('data/tournaments.json');
  if (!r.ok) throw new Error(r.status);
  const { tournaments: all } = await r.json();
  tournaments = all.filter((t) => !blockedBy(t.n));
  draw();
  select.addEventListener('change', draw);
} catch {
  box.textContent = 'Could not load the tournament data.';
}