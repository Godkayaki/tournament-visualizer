// The "Regional Metagame" window: commander ranking for a region (the world, a continent or a country), optionally compared
// with another one, and optionally filtered by color identity.
import { $, esc } from './utils.js';
import { state } from './state.js';
import { pick } from './filters.js';
import { loadMeta, loadArt } from './data.js';
import { openPanel, closePanel } from './panels.js';
import { tally, rank, scopeFor, regionExists, regionLabel, CONTINENTS, colorFilter, colorName, colorTotals } from './regional.js';

const PAGE = 20; // rows added by each "Show more"

// What the window shows. Players and period start from the filter bar every time it opens; the rest is remembered.
// region / vs are region keys (see regional.js); vs can also be 'none'.
const view = { region: 'world', vs: 'world', players: 30, months: 6, sort: 'most', colors: new Set(), query: '' };
let meta = null;       // data/meta.json
let art = {};          // commander -> art URLs
let counts = null;     // tally() of the tournaments that pass view.players / view.months
let rows = [];         // ranked commanders for the current view
let matching = [];     // rows that pass the search box
let shown = 0;         // how many of `matching` are on screen
let maxPct = 1;        // the longest bar, so bars keep their scale while paging
let baseName = '';     // label of the comparison, for the rows

export const closeRegional = () => closePanel($('rg-modal'));

const fmtPct = (v) => (v >= 0.1 ? `${v.toFixed(1)}%` : v > 0 ? '<0.1%' : '0%');
const fmtDiff = (d) => (Math.abs(d) < 0.05 ? '±0.0 pp' : `${d > 0 ? '+' : '\u2212'}${Math.abs(d).toFixed(1)} pp`);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const sentence = (key) => (key === 'world' ? 'the world' : regionLabel(meta, key)); // "...compared with the world"

const baselineScope = () => (view.vs === 'none' || view.vs === view.region ? null : scopeFor(counts, view.vs));

function rowHtml(r) {
  const pics = r.names.map((n) => (art[n] || [])[0]).filter(Boolean).slice(0, 2) // partners: both arts side by side
    .map((u) => `<img src="${esc(u)}" alt="" loading="lazy" decoding="async">`).join('');
  const bar = (cls, v) => `<i class="${cls}" style="width:${((v / maxPct) * 100).toFixed(1)}%${v > 0 ? ';min-width:3px' : ''}"></i>`;
  const compare = r.basePct != null;
  return `<li class="rg-row">
    <span class="rg-art">${pics}</span>
    <span class="rg-rank">${r.rank}</span>
    <span class="rg-who"><b>${esc(r.name)}</b><span class="rg-bars">${bar('a', r.pct)}${compare ? bar('w', r.basePct) : ''}</span></span>
    <span class="rg-num"><b>${fmtPct(r.pct)}</b><small>${plural(r.n, 'deck')}</small>${compare ? `<small>${esc(baseName)} ${fmtPct(r.basePct)} <em class="${r.diff >= 0 ? 'up' : 'down'}">${fmtDiff(r.diff)}</em></small>` : ''}</span>
  </li>`;
}

// Adds the next page of rows (or starts the list over)
function drawList(reset) {
  const list = $('rg-list');
  if (reset) { list.innerHTML = ''; shown = 0; }
  if (!matching.length) {
    const where = esc(sentence(view.region));
    list.innerHTML = `<li class="msg">${rows.length ? 'No commander matches that search.' : view.colors.size ? `No commanders with these colors in ${where}.` : `No decks match these filters in ${where}.`}</li>`;
  } else {
    const next = matching.slice(shown, shown + PAGE);
    list.insertAdjacentHTML('beforeend', next.map(rowHtml).join(''));
    shown += next.length;
  }
  const left = matching.length - shown;
  $('rg-more').hidden = left <= 0;
  $('rg-more').textContent = `Show more (${Math.min(left, PAGE)} of ${left.toLocaleString()} left)`;
}

function filterRows() {
  const q = view.query.trim().toLowerCase();
  matching = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
}

function drawColors() {
  const key = colorFilter(view.colors);
  document.querySelectorAll('#rg-colors button').forEach((b) => b.setAttribute('aria-pressed', String(view.colors.has(b.dataset.c))));
  $('rg-colortext').textContent = key === null ? 'All colors' : colorName(key);
  $('rg-colorclear').hidden = key === null;
}

// Ranks the current view and redraws everything under the controls
function rebuild() {
  const scope = scopeFor(counts, view.region);
  const base = baselineScope();
  const colorKey = colorFilter(view.colors);
  if (!base) view.sort = 'most'; // nothing to compare with
  rows = rank(meta, scope, base, view.sort, colorKey);
  maxPct = Math.max(1, ...rows.map((r) => Math.max(r.pct, r.basePct || 0)));
  baseName = base ? regionLabel(meta, view.vs) : '';
  filterRows();

  $('rg-sub').textContent = `Share of ${view.region === 'world' ? 'all decks played worldwide' : `decks played in ${regionLabel(meta, view.region)}`}${base ? `, compared with ${sentence(view.vs)}` : ''}.`;
  $('rg-diff').hidden = !base;
  $('rg-most').setAttribute('aria-pressed', String(view.sort === 'most'));
  $('rg-diff').setAttribute('aria-pressed', String(view.sort === 'diff'));
  $('rg-legend').hidden = !base;
  $('rg-legend-a').textContent = regionLabel(meta, view.region);
  $('rg-legend-b').textContent = base ? baseName : '';
  drawColors();

  const totals = colorTotals(meta, scope, colorKey);
  const stats = [[totals.decks.toLocaleString(), 'decks'], [scope.tournaments.toLocaleString(), 'tournaments'], [totals.commanders.toLocaleString(), 'commanders']];
  if (colorKey !== null) stats.push([scope.decks ? `${((totals.decks / scope.decks) * 100).toFixed(1)}%` : '0%', 'of all decks']);
  $('rg-stats').innerHTML = stats.map(([n, label]) => `<div><b>${n}</b>${label}</div>`).join('');

  const notes = [];
  if (scope.unknown) notes.push(`${plural(scope.unknown, 'player')} without a listed commander ${scope.unknown === 1 ? "isn't" : "aren't"} counted.`);
  if (counts.unplaced && (view.region === 'world' || view.vs === 'world')) notes.push(`${plural(counts.unplaced, 'tournament')} couldn't be placed in a country, so ${counts.unplaced === 1 ? 'it only appears' : 'they only appear'} under World.`);
  if (colorKey !== null) {
    notes.push(`Percentages are a share of all decks in ${sentence(view.region)}, not only of the selected colors.`);
    if (totals.unknownDecks) notes.push(`${plural(totals.unknownDecks, 'deck')} with no color data ${totals.unknownDecks === 1 ? 'is' : 'are'} left out.`);
  }
  if (view.sort === 'diff') notes.push('Only commanders with enough decks to compare are ranked.');
  $('rg-note').textContent = notes.join(' ');
  $('rg-scroll').scrollTop = 0;
  drawList(true);
}

// <option>s for a region <select>: World, the continents, then the countries with decks (or the one currently selected)
function regionOptions(selected, withNone) {
  const opt = (key, name, decks) => `<option value="${key}">${esc(name)} · ${plural(decks, 'deck')}</option>`;
  const continents = CONTINENTS.map((n) => opt(`cont:${n}`, n, counts.continents.get(n).decks)).join('');
  const countries = counts.countries
    .map((s, i) => ({ key: `country:${i}`, name: meta.countries[i].name, decks: s.decks }))
    .filter((c) => c.decks > 0 || c.key === selected)
    .sort((a, b) => b.decks - a.decks || a.name.localeCompare(b.name))
    .map((c) => opt(c.key, c.name, c.decks)).join('');
  return (withNone ? '<option value="none">No comparison</option>' : '') + opt('world', 'World', counts.world.decks)
    + `<optgroup label="Continents">${continents}</optgroup>` + (countries ? `<optgroup label="Countries">${countries}</optgroup>` : '');
}

// Re-adds up the tournaments (new filters) and refreshes both region lists, which show how many decks each region has
function recount() {
  counts = tally(meta, pick(view.players, view.months));
  $('rg-region').innerHTML = regionOptions(view.region, false);
  $('rg-vs').innerHTML = regionOptions(view.vs, true);
  $('rg-region').value = view.region;
  $('rg-vs').value = view.vs;
  rebuild();
}

export async function openRegional() {
  view.players = state.minPlayers; // start from the filter bar
  view.months = state.months;
  view.query = '';
  $('rg-search').value = '';
  $('rg-players').value = String(view.players);
  $('rg-months').value = String(view.months);
  $('rg-list').innerHTML = '<li class="msg">Loading…</li>';
  $('rg-more').hidden = true;
  openPanel($('rg-modal'), $('rg-scroll'), document.querySelector('.rg-card')); // on phones the whole card scrolls
  try {
    [meta, art] = await Promise.all([loadMeta(), loadArt()]);
    if (!regionExists(meta, view.region)) view.region = 'world'; // the data changed since last time
    if (view.vs !== 'none' && !regionExists(meta, view.vs)) view.vs = 'world';
    $('rg-colorbar').hidden = !meta.colors || meta.colors.every((c) => c === null); // no color data: no color filter
    if ($('rg-colorbar').hidden) view.colors.clear();
    recount();
  } catch {
    $('rg-list').innerHTML = "<li class=\"msg\">Regional data isn't available right now.</li>";
  }
}

export function initRegional() {
  document.querySelectorAll('.regional-open').forEach((b) => b.addEventListener('click', openRegional));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRegional(); });
  $('rg-region').addEventListener('change', (e) => { view.region = e.target.value; rebuild(); });
  $('rg-vs').addEventListener('change', (e) => { view.vs = e.target.value; rebuild(); });
  $('rg-swap').addEventListener('click', () => {
    if (view.vs === 'none') return;
    [view.region, view.vs] = [view.vs, view.region];
    recount();
  });
  $('rg-players').addEventListener('change', (e) => { view.players = +e.target.value; recount(); });
  $('rg-months').addEventListener('change', (e) => { view.months = +e.target.value; recount(); });
  for (const [id, sort] of [['rg-most', 'most'], ['rg-diff', 'diff']]) {
    $(id).addEventListener('click', () => { if (view.sort !== sort) { view.sort = sort; rebuild(); } });
  }
  // Colors: W U B R G pick the exact identity; colorless excludes the rest (no deck is both)
  $('rg-colors').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const c = b.dataset.c;
    if (view.colors.has(c)) view.colors.delete(c);
    else { if (c === 'C') view.colors.clear(); else view.colors.delete('C'); view.colors.add(c); }
    rebuild();
  });
  $('rg-colorclear').addEventListener('click', () => { view.colors.clear(); rebuild(); });
  $('rg-search').addEventListener('input', (e) => { view.query = e.target.value; filterRows(); drawList(true); });
  $('rg-more').addEventListener('click', () => drawList(false));
}