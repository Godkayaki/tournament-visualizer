// Winner preview: hovering a tournament in the list shows its winning commander.
import { $, esc } from './utils.js';
import { getRows, loadArt } from './data.js';

// ---- Winner preview: hovering a tournament in the list shows its winning commander ----
// 'row'  = the winner's art fades in as the background of the hovered tournament (no extra info)
// 'card' = a floating card to the left of the list with art, commander and winner
const HOVER_PREVIEW = 'row';

let shownList = [], peekFor = null, peekTimer;
export function hidePeek() {
  clearTimeout(peekTimer);
  peekFor?.querySelector('.row-art')?.classList.remove('on');
  peekFor = null;
  $('peek').classList.remove('on');
}

const picsOf = (names, art) => names.map((n) => (art[n] || [])[0]).filter(Boolean).slice(0, 2);

// Preload winner art for the rows the mouse is likely to reach next, so the hover shows up instantly.
// Skipped on touch screens (no hover there) and staggered so it doesn't compete with other requests.
let artMap = {};
const preloaded = new Set();
function preloadArt(t) {
  if (!t?.w) return;
  for (const url of picsOf(t.w, artMap)) {
    if (preloaded.has(url)) continue;
    preloaded.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}
export function preloadRows(from, count) {
  if (!matchMedia('(hover: hover)').matches) return;
  shownList.slice(from, from + count).forEach((t, i) => setTimeout(() => preloadArt(t), i * 60));
}

// 'row' mode: put the winner's art behind the hovered tournament and fade it in (the row keeps its size and text)
function showRowArt(btn, pics) {
  if (!pics.length) return;
  let el = btn.querySelector('.row-art');
  if (!el) {
    el = document.createElement('span');
    el.className = 'row-art';
    el.innerHTML = pics.map((u) => `<img src="${esc(u)}" alt="" fetchpriority="high" decoding="async">`).join('');
    btn.prepend(el);
  }
  void el.offsetWidth; // flush styles so the fade-in runs even on a freshly added element
  const img = el.querySelector('img');
  const go = () => { if (peekFor === btn) el.classList.add('on'); };
  if (img.complete) go(); else img.addEventListener('load', go, { once: true }); // fade in once the art is there, no pop-in
}
async function showPeek(btn) {
  const t = shownList[+btn.dataset.i];
  if (!t) return;
  const art = await loadArt();
  if (HOVER_PREVIEW === 'row' && t.w) { // winners come with the index (see addWinners in fetch-data.mjs): no request needed
    if (peekFor === btn && t.w.length) showRowArt(btn, picsOf(t.w, art));
    return;
  }
  let rows;
  try { rows = await getRows(t); } catch { return; } // older data without winners, or 'card' mode: read the standings file
  if (peekFor !== btn) return; // the mouse moved on while loading
  const w = rows[0]; // the API lists standings in placement order, so the first row is the winner
  if (!w || !w.c.length) return; // no commander submitted: nothing to show, the list works as before
  const pics = picsOf(w.c, art);
  if (HOVER_PREVIEW === 'row') return showRowArt(btn, pics);
  $('peek-art').hidden = !pics.length;
  $('peek-art').innerHTML = pics.map((u) => `<img src="${esc(u)}" alt="">`).join('');
  $('peek-cmd').textContent = w.c.join(' / ');
  $('peek-player').textContent = `${w.n || 'Unknown Player'} · ${w.w}-${w.l}-${w.d}`;
  const peek = $('peek'), pr = $('area').getBoundingClientRect(), br = btn.getBoundingClientRect();
  const left = pr.left - 12 - peek.offsetWidth;
  if (left < 8) return; // not enough room beside the list (small screens)
  const minTop = innerWidth <= 900 ? 120 : 72; // stay below the filter bar
  peek.style.left = `${left}px`;
  peek.style.top = `${Math.max(minTop, Math.min(innerHeight - peek.offsetHeight - 8, br.top + br.height / 2 - peek.offsetHeight / 2))}px`;
  peek.classList.add('on');
}

// The list panel tells us which tournaments it is showing (rows are matched by their data-i index)
export const setShownList = (list) => { shownList = list; };

export function initPreview() {
  loadArt().then((m) => { artMap = m; });
  $('area-list').addEventListener('mouseover', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b || b === peekFor) return;
    hidePeek();
    peekFor = b;
    const i = +b.dataset.i;
    peekTimer = setTimeout(() => showPeek(b), shownList[i]?.w ? 40 : 120); // short delay so skimming across rows stays calm
    preloadRows(i + 1, 3);
  });
  $('area-list').addEventListener('mouseleave', hidePeek);
  $('area-list').addEventListener('scroll', hidePeek);
}