// A small responsive SVG line chart (no libraries): thin lines, gaps where there is no data, a crosshair and a tooltip on hover or
// touch. Colors are CSS values (the accent is a var(), so it follows the color the visitor picked). Used by the commander view.
import { esc } from './utils.js';

const NS = 'http://www.w3.org/2000/svg';

// A "nice" top for the y axis and the tick step, so the gridlines fall on round numbers
function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const raw = max / ticks, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { top: Math.ceil(max / step) * step, step };
}
const tickLabel = (v, step) => `${Number(v.toFixed(step < 1 ? 2 : step < 10 ? 1 : 0))}%`;

// options: { labels: string[] (x axis), series: [{ name, color, values: (number|null)[] }], tooltip: (index) => html,
//            title: string (accessible name), format: (value) => string }
export function lineChart(el, options) {
  el._chartObserver?.disconnect();
  let drawnWidth = 0;
  const draw = () => {
    const width = Math.max(260, Math.round(el.clientWidth || 640));
    if (width === drawnWidth) return;
    drawnWidth = width;
    render(el, options, width);
  };
  draw();
  if (typeof ResizeObserver === 'function') {
    el._chartObserver = new ResizeObserver(draw);
    el._chartObserver.observe(el);
  }
}

function render(el, { labels, series, tooltip, title, format = (v) => `${v.toFixed(1)}%` }, width) {
  const height = width < 520 ? 230 : 290;
  const m = { l: 46, r: 14, t: 14, b: 30 };
  const w = width - m.l - m.r, h = height - m.t - m.b;
  const n = labels.length;
  const values = series.flatMap((s) => s.values).filter((v) => v !== null);
  const { top, step } = niceScale(Math.max(0, ...values) * 1.05);
  const x = (i) => m.l + (n > 1 ? (i * w) / (n - 1) : w / 2);
  const y = (v) => m.t + h - (v / top) * h;

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title || 'Line chart')}">`;
  for (let v = 0; v <= top + step / 2; v += step) { // grid + y labels (the baseline is a little stronger)
    svg += `<line class="ch-grid${v === 0 ? ' base' : ''}" x1="${m.l}" x2="${m.l + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    svg += `<text class="ch-y" x="${m.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${tickLabel(v, step)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72)))); // thin the x labels so they never collide
  labels.forEach((label, i) => {
    if (i % every === 0) svg += `<text class="ch-x" x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(label)}</text>`;
  });
  for (const s of series) { // one path per run of consecutive values, so empty periods leave a gap instead of a fake line
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    svg += `<path class="ch-line" d="${d}" style="stroke:${s.color}"/>`;
    if (n <= 40) s.values.forEach((v, i) => { if (v !== null) svg += `<circle class="ch-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" style="fill:${s.color}"/>`; });
  }
  svg += '<g class="ch-hover" hidden><line class="ch-cross" y1="' + m.t + '" y2="' + (m.t + h) + '"/>';
  for (const s of series) svg += `<circle class="ch-dot big" r="5.5" style="fill:${s.color}" hidden/>`;
  svg += `</g><rect class="ch-hit" x="${m.l}" y="${m.t}" width="${w}" height="${h}" fill="transparent"/></svg><div class="ch-tip" hidden></div>`;
  el.innerHTML = svg;

  const hover = el.querySelector('.ch-hover'), cross = el.querySelector('.ch-cross'), dots = [...el.querySelectorAll('.ch-dot.big')];
  const tip = el.querySelector('.ch-tip');
  const show = (e) => {
    const box = el.querySelector('svg').getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const i = n > 1 ? Math.min(n - 1, Math.max(0, Math.round(((px - m.l) / w) * (n - 1)))) : 0;
    hover.hidden = false; tip.hidden = false;
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    series.forEach((s, k) => {
      const v = s.values[i];
      dots[k].hidden = v === null;
      if (v !== null) { dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); }
    });
    tip.innerHTML = tooltip(i);
    const tx = (x(i) / width) * box.width;
    tip.style.left = `${tx > box.width * 0.6 ? tx - tip.offsetWidth - 12 : tx + 12}px`;
    tip.style.top = '8px';
  };
  const hide = () => { hover.hidden = true; tip.hidden = true; };
  const hit = el.querySelector('.ch-hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}