// The list panel on the right: a bubble's tournaments, the "Recent tournaments" list or the "Featured" list.
import { $, esc, fmtDate, place } from './utils.js';
import { state } from './state.js';
import { areaName } from './geo.js';
import { openPanel, closePanel } from './panels.js';
import { openTournament } from './tournament.js';
import { hidePeek, preloadRows, setShownList } from './preview.js';

// Tournament size tiers (by number of players): the colored strip on the left of each tournament in the list.
// Colors live in style.css (#area li button[data-tier=...]); the thresholds are here.
const TIERS = [[250, 'diamond'], [100, 'platinum'], [50, 'gold'], [30, 'silver'], [16, 'bronze'], [0, 'grey']];
const tierName = (players) => TIERS.find(([min]) => players >= min)[1];

let areaItems = [];
let areaKind = ''; // what the list panel is showing: '' = a bubble, 'recent' = "Recent tournaments", 'featured' = "Featured"

// Highlights the button (Recent / Featured) whose list is open
const syncBtns = () => {
  $('recent').setAttribute('aria-pressed', String(areaKind === 'recent'));
  $('featured').setAttribute('aria-pressed', String(areaKind === 'featured'));
};

// opts.kind / opts.title / opts.sub: used by the Recent and Featured lists to replace the default heading
// (location name + "N tournaments found")
export function showArea(items, opts = {}) {
  areaItems = items;
  areaKind = opts.kind || '';
  syncBtns();
  const sub = opts.sub ?? `${items.length} tournament${items.length > 1 ? 's' : ''} found`;
  $('area-title').innerHTML = `${esc(opts.title ?? areaName(items))}<small style="display:block;margin-top:2px;font-size:13px;font-weight:400;color:var(--dim)">${esc(sub)}</small>`;
  $('order-by').value = 'date'; // every new list starts from the most recent...
  $('order-dir').value = 'desc'; // ...first
  syncDirLabels();
  $('order').hidden = items.length < 2 || areaKind === 'featured'; // nothing to sort with a single tournament; featured events are always by date
  if (areaKind === 'featured') renderFeatured(); else renderList();
  openPanel($('area'), $('area-list'));
}

// The direction dropdown says what it means for the chosen order: dates or player counts
const DIR_LABELS = { date: ['Newest', 'Oldest'], players: ['Most', 'Fewest'] };
function syncDirLabels() {
  const [desc, asc] = DIR_LABELS[$('order-by').value];
  $('order-dir').options[0].text = desc;
  $('order-dir').options[1].text = asc;
}

function renderList() {
  hidePeek();
  const byPlayers = $('order-by').value === 'players';
  const dir = $('order-dir').value === 'asc' ? -1 : 1; // 1 = descending (most recent / most players first)
  const list = [...areaItems].sort(byPlayers ? (a, b) => dir * (b.p - a.p) || b.d - a.d : (a, b) => dir * (b.d - a.d)); // ties: most recent first
  setShownList(list);
  $('area-list').innerHTML = list.map((t, i) =>
    `<li><button data-i="${i}" data-tier="${tierName(t.p)}">${esc(t.n)}<div class="sub">${fmtDate(t.d)} · <span class="loc">${esc(place(t))}</span> · ${t.p} players</div></button></li>`).join('');
  $('area-list').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { hidePeek(); openTournament(list[+b.dataset.i]); }
  };
  $('area-list').scrollTop = 0;
  preloadRows(0, 10);
}

export const closeArea = () => { hidePeek(); closePanel($('area')); areaKind = ''; syncBtns(); };

// "Recent tournaments": the latest RECENT_COUNT tournaments anywhere on the globe. It follows the players filter
// but ignores the period filter and the location; the list itself works exactly like a bubble's.
const RECENT_COUNT = 20;
export function showRecent() {
  const items = state.all.filter((t) => t.p >= state.minPlayers).sort((a, b) => b.d - a.d).slice(0, RECENT_COUNT);
  if (!items.length) return;
  const size = state.minPlayers ? `${state.minPlayers}+ players` : 'all sizes';
  showArea(items, { kind: 'recent', title: 'Recent tournaments', sub: `${items.length} most recent · ${size}` });
}

// ---- Featured tournaments (loaded by data.js; main.js hands them over). The button stays hidden while there are none. ----
let featured = [];
export function setFeatured(list) {
  featured = list;
  $('featured').hidden = !featured.length;
}
function showFeatured() {
  if (!featured.length) return;
  showArea(featured, { kind: 'featured', title: 'Featured tournaments', sub: `${featured.length} upcoming` });
}
function renderFeatured() {
  hidePeek();
  setShownList([]);
  $('area-list').onclick = null; // rows are plain links
  $('area-list').innerHTML = areaItems.map((f) => {
    const price = f.price != null && f.price !== '' ? ` · <span class="price">${esc(f.price)}</span>` : '';
    const where = f.location ? ` · <span class="loc">${esc(f.location)}</span>` : '';
    return `<li><a class="feat" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)} ↗<div class="sub">${fmtDate(f.ts)}${where}${price}</div></a></li>`;
  }).join('');
  $('area-list').scrollTop = 0;
}

// The filter bar changed: the Recent and Featured lists stay open (Recent follows the players filter,
// Featured doesn't depend on filters); a bubble's list closes, since its bubbles are about to change.
export function onFiltersChanged() {
  const stays = !$('area').hidden && (areaKind === 'recent' || areaKind === 'featured');
  if (!stays) closeArea();
  else if (areaKind === 'recent') showRecent();
}

export function initList() {
  // Clicking a list button opens its list; clicking it again while that list is open closes it
  const toggleList = (kind, show) => () => {
    if (areaKind === kind && !$('area').hidden && !$('area').classList.contains('closing')) closeArea();
    else show();
  };
  $('recent').addEventListener('click', toggleList('recent', showRecent));
  $('featured').addEventListener('click', toggleList('featured', showFeatured));

  $('order-by').addEventListener('change', () => { $('order-dir').value = 'desc'; syncDirLabels(); renderList(); }); // a new order always starts at Newest / Most
  $('order-dir').addEventListener('change', renderList);
}