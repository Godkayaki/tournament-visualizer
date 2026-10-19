// The commander view inside the Regional Metagame window: opened by clicking a commander's row. A banner with its art, a line chart
// of its meta share (or conversion) over time for the chosen region and an optional second one, and its numbers: conversion, seat
// win rates... It uses the window's own filters (region, compare with, players, min. entries, period), so everything stays in step.
// regional-ui.js owns the state and hands it over through the function given to initCommander().
import { loadSeats, loadEntries, loadSpicy } from './data.js';
import { deckUrl } from './tournament.js';
import { $, esc, fmtDate, place as placeName, ord } from './utils.js';
import { colorName, regionLabel, MIN_CONV_DECKS } from './regional.js';
import { makeBuckets, eventPositions, inRegion, commanderIn, commanderByCountry, spicyCards, SPICY, share, conversion, cutShare, isThin, seatRate, seatOverall } from './commander.js';
import { lineChart } from './chart.js';

const COLOR_A = 'var(--accent)';
const COLOR_B = '#f0a93b'; // a warm amber: far from the accent colors (all cool or green) and from the greys of the grid
const SEATS = ['S1', 'S2', 'S3', 'S4'];
const PP_TIP = 'pp = percentage points: the plain difference between the two percentages';

let getContext = null;  // () => { meta, art, view, tournaments, allowed }
let seats;              // undefined = not asked yet, 'loading', null = no file, or the data
let saved = null;       // scroll positions of the list, restored by "back"

const pct = (v, d = 1) => (v === null ? '–' : `${v.toFixed(d)}%`);
const diff = (d) => (Math.abs(d) < 0.05 ? '±0.0 pp' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pp`);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// "World 5.1% +2.0 pp": the other region's value and the gap, in the style of the list rows. `a`, `b` are numbers or null.
function versus(name, a, b, digits = 1) {
  if (b === null && a === null) return '';
  const gap = a !== null && b !== null ? ` <em class="${a - b >= 0 ? 'up' : 'down'}" title="${PP_TIP}">${diff(a - b)}</em>` : '';
  return `<small>${esc(name)} ${pct(b, digits)}${gap}</small>`;
}

function bannerHtml(meta, art, id) {
  const names = meta.commanders[id];
  const pics = names.map((n) => (art[n] || [])[0]).filter(Boolean).slice(0, 2).map((u) => `<img src="${esc(u)}" alt="" decoding="async">`).join('');
  const colors = meta.colors?.[id]; // identity in WUBRG order, '' = colorless, null = unknown
  const letters = colors == null ? [] : colors === '' ? ['C'] : [...colors];
  const symbols = letters.map((c) => `<img src="static/${c}.svg" alt="" width="22" height="22" draggable="false">`).join('');
  return `<div class="rg-banner"><span class="rg-banner-art">${pics}</span>
    <div class="rg-banner-text"><h3>${esc(names.join(' / '))}</h3>${symbols ? `<span class="rg-symbols" role="img" aria-label="${esc(colorName(colors))}" title="${esc(colorName(colors))}">${symbols}</span>` : ''}</div></div>`;
}

function seatTable(A, B, nameA, nameB) {
  if (seats === 'loading') return '<p class="rg-dnote">Loading seat data…</p>';
  if (!A.seat && !(B && B.seat)) {
    return `<p class="rg-dnote">${seats ? 'No seat results for this commander in the selected tournaments.' : "Seat data isn't in this build yet: it appears after the data is fully rebuilt."}</p>`;
  }
  const cell = (side, k) => {
    const seat = side?.seat;
    const v = k === 4 ? seatOverall(seat) : seatRate(seat, k);
    const games = seat ? (k === 4 ? seat.games.reduce((a, b) => a + b, 0) : seat.games[k]) : 0;
    return { v, games };
  };
  let rows = '';
  for (let k = 0; k <= 4; k++) {
    const a = cell(A, k), b = cell(B, k);
    rows += `<tr class="${k === 4 ? 'tot' : ''}"><th scope="row">${k === 4 ? 'All seats' : `${SEATS[k]} WR`}</th>
      <td><b>${pct(a.v, 2)}</b><small>${plural(a.games, 'game')}</small></td>
      ${B ? `<td><b>${pct(b.v, 2)}</b><small>${plural(b.games, 'game')}</small></td><td>${a.v !== null && b.v !== null ? `<em class="${a.v - b.v >= 0 ? 'up' : 'down'}" title="${PP_TIP}">${diff(a.v - b.v)}</em>` : '–'}</td>` : ''}</tr>`;
  }
  return `<table class="rg-seat"><thead><tr><th></th><th><i class="sw a"></i>${esc(nameA)}</th>${B ? `<th><i class="sw b"></i>${esc(nameB)}</th><th>Gap</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>`;
}

// The "Commander data" tab: chart, numbers and seat win rates. Returns { html, sub, after } (after() draws the chart once the html is in place).
function dataTab({ meta, view, tournaments, allowed }, id) {
  const names = meta.commanders[id];
  const regionA = view.region;
  const regionB = view.vs === 'none' || view.vs === view.region ? null : view.vs;
  const nameA = regionLabel(meta, regionA), nameB = regionB ? regionLabel(meta, regionB) : '';
  const buckets = makeBuckets(tournaments, view.months, view.dGroup);
  const seatData = seats === 'loading' ? null : seats;
  const A = commanderIn(meta, seatData, tournaments, regionA, id, allowed, buckets);
  const B = regionB ? commanderIn(meta, seatData, tournaments, regionB, id, allowed, buckets) : null;

  const byConv = view.dMetric === 'conv';
  const metric = byConv ? conversion : share;
  const series = [{ name: nameA, color: COLOR_A, values: A.buckets.map(metric), data: A.buckets }];
  if (B) series.push({ name: nameB, color: COLOR_B, values: B.buckets.map(metric), data: B.buckets });
  const unitName = byConv ? 'Conversion rate' : 'Meta share';

  const sub = `${names.join(' / ')}: ${unitName.toLowerCase()} in ${nameA}${B ? `, compared with ${nameB}` : ''}.`;

  const tA = A.total, tB = B?.total;
  const cards = `
    <div class="rg-card2"><i>Meta share</i><b>${pct(share(tA))}</b><small>${tA.decks.toLocaleString()} of ${tA.total.toLocaleString()} decks</small>${B ? versus(nameB, share(tA), share(tB)) : ''}</div>
    <div class="rg-card2"><i>Decks played</i><b>${tA.decks.toLocaleString()}</b><small>in ${tA.appearances.toLocaleString()} of ${plural(tA.tournaments, 'tournament')}</small>${B ? `<small>${esc(nameB)} ${tB.decks.toLocaleString()}</small>` : ''}</div>
    <div class="rg-card2${isThin(tA) ? ' thin' : ''}"><i>Conversion</i><b>${pct(conversion(tA))}</b><small>${tA.cut.toLocaleString()} of ${tA.elig.toLocaleString()} decks${isThin(tA) && tA.decks ? ' · small sample' : ''}</small>${B ? versus(nameB, conversion(tA), conversion(tB)) : ''}</div>
    <div class="rg-card2${isThin(tA) ? ' thin' : ''}"><i>Top cut conversion</i><b>${pct(cutShare(tA))}</b><small>${tA.cut.toLocaleString()} of ${tA.cutAll.toLocaleString()} top cut decks</small>${B ? versus(nameB, cutShare(tA), cutShare(tB)) : ''}</div>`;

  const events = eventPositions(buckets);
  const tableRows = A.buckets.map((_, i) => `<tr><th scope="row">${esc(buckets.list[i].title)}</th>${series.map((s) => `<td>${pct(s.values[i])}</td>`).join('')}</tr>`).join('');
  const notes = [];
  if (allowed) notes.push(`Shares are calculated over the decks of commanders with at least ${view.minEntries} entries in the world (Min. entries); change that filter above to widen or narrow them.`);
  notes.push(`Conversion only counts tournaments that had a top cut${byConv ? `; periods with none show a gap, and a commander with fewer than ${MIN_CONV_DECKS} decks in the period has a noisy line` : ''}.`);
  notes.push('Seat win rate is the share of games this commander won from that seat, in four-player games.');

  const html = `
    <div class="rg-dtools">
      <label>Chart <select id="rg-dmetric"><option value="share">Meta share</option><option value="conv">Conversion rate</option></select></label>
      <label>Group by <select id="rg-dgroup"><option value="month">Months</option><option value="week">Weeks</option></select></label>
    </div>
    <p class="rg-legend"><i class="a"></i>${esc(nameA)}${B ? ` <i class="b"></i>${esc(nameB)}` : ''}</p>
    <div class="rg-chart" id="rg-chart"></div>
    <details class="rg-table"><summary>Show the chart as a table</summary>
      <table><thead><tr><th>${buckets.unit === 'week' ? 'Week' : 'Month'}</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></details>
    <div class="rg-cards">${cards}</div>
    <h4 class="rg-dh">Seat win rate</h4>
    ${seatTable(A, B, nameA, nameB)}
    <p class="rg-note">${esc(notes.join(' '))}</p>`;

  const after = () => {
  $('rg-dmetric').value = view.dMetric;
  $('rg-dgroup').value = view.dGroup;
  lineChart($('rg-chart'), {
    labels: buckets.list.map((b) => b.label),
    series,
    events,
    title: `${unitName} of ${names.join(' / ')} over time`,
    tooltip: (i) => `<b>${esc(buckets.list[i].title)}</b>` + series.map((s) => {
      const d = s.data[i];
      const detail = byConv ? `${d.cut} of ${d.elig} decks` : `${d.decks} of ${d.total} decks`;
      return `<div><i class="sw ${s === series[0] ? 'a' : 'b'}"></i>${esc(s.name)}: <b>${pct(s.values[i])}</b> <small>${detail}</small></div>`;
    }).join(''),
  });
  };
  return { html, sub, after };
}

// ---- The "Tournaments" tab: every deck of the commander in the tournaments that pass the filters ----
const PAGE = 40;
const MEDAL = ['🥇', '🥈', '🥉'];
const entriesLoaded = new Map(); // commander id -> rows of data/c/<id>.json, null (no file) or 'loading'
let tList = [];                  // the rows on screen, sorted
let tShown = 0;

// Best finish first; among equal finishes the bigger tournament (more players) first, then the newer one
function sortedEntries({ meta, view, tournaments }, rows) {
  const byId = new Map(tournaments.map((t) => [t.id, t]));
  const out = [];
  rows.forEach(([tid, place, pid, name, w, l, d], idx) => { // idx = the row's position in data/c/<id>.json, which data/s/<id>.json refers to
    const t = byId.get(tid);
    const row = t && meta.t[tid];
    if (!row || !inRegion(meta, view.region, row[0])) return;
    out.push({ t, place, pid, name, w, l, d, idx });
  });
  return out.sort((a, b) => a.place - b.place || b.t.p - a.t.p || b.t.d - a.t.d);
}

function trowHtml(e) {
  const place = e.place <= 3 ? MEDAL[e.place - 1] : ord(e.place);
  return `<li><a class="rg-trow" href="${esc(deckUrl(e.t.id, e.pid))}" target="_blank" rel="noopener" title="Open the decklist on TopDeck.gg">
    <span class="rg-tplace" title="${ord(e.place)} place of ${e.t.p}">${place}<small>of ${e.t.p}</small></span>
    <span class="rg-twho"><b>${esc(e.t.n)}</b><span>${esc(fmtDate(e.t.d))} · ${esc(placeName(e.t))} · ${e.t.p} players</span></span>
    <span class="rg-tplayer"><b>${esc(e.name || 'Unknown Player')}</b><small>${e.w}W ${e.l}L ${e.d}D</small></span>
  </a></li>`;
}

function showMoreTournaments() {
  const next = tList.slice(tShown, tShown + PAGE);
  $('rg-tlist').insertAdjacentHTML('beforeend', next.map(trowHtml).join(''));
  tShown += next.length;
  const left = tList.length - tShown;
  $('rg-tmore').hidden = left <= 0;
  $('rg-tmore').textContent = `Show more (${Math.min(left, PAGE)} of ${left.toLocaleString()} left)`;
}

// The commander's rows of data/c/<id>.json: 'loading' (the tab redraws itself once they arrive), null (no file yet) or the rows
function entriesFor(id) {
  const loaded = entriesLoaded.get(id);
  if (loaded !== undefined) return loaded;
  entriesLoaded.set(id, 'loading');
  loadEntries(id).then((rows) => {
    entriesLoaded.set(id, rows);
    const v = getContext().view;
    if (v.commander === id && (v.dTab === 'tournaments' || v.dTab === 'pilots' || v.dTab === 'spicy')) renderCommander();
  });
  return 'loading';
}

function tournamentsTab(c, id) {
  const { meta, view } = c;
  const names = meta.commanders[id];
  const where = regionLabel(meta, view.region);
  const sub = `${names.join(' / ')}: tournaments in ${where}, best finish first.`;
  const loaded = entriesFor(id);
  if (loaded === 'loading') return { html: '<p class="rg-dnote">Loading tournaments…</p>', sub };
  if (loaded === null) return { html: "<p class=\"rg-dnote\">The tournament list isn't in this build yet: it appears after the data is rebuilt.</p>", sub };
  tList = sortedEntries(c, loaded);
  tShown = 0;
  const count = new Set(tList.map((e) => e.t.id)).size;
  const html = tList.length
    ? `<p class="rg-dnote">${plural(tList.length, 'deck')} in ${plural(count, 'tournament')} in ${esc(where)} with the filters above. Best finish first; for equal finishes, the tournament with more players. Click one to open the decklist on TopDeck.gg.</p>
       <ol id="rg-tlist" class="rg-tlist"></ol><button id="rg-tmore" type="button" class="rg-tmore" hidden>Show more</button>`
    : `<p class="rg-dnote">No tournaments with this commander in ${esc(where)} with the filters above.</p>`;
  return { html, sub, after: tList.length ? showMoreTournaments : null };
}

// ---- The "Top Pilots" tab: the players who did best with the commander, each with all their tournaments ----
const PILOTS_PAGE = 20;
const PREVIEW = 3;      // tournaments listed before "Show all"
const profileUrl = (pid) => `https://topdeck.gg/profile/${encodeURIComponent(pid)}`;
let pList = [];
let pShown = 0;

// One pilot per TopDeck player id: every deck they played with this commander in the filtered tournaments. Only pilots who reached a top
// cut (or won) are listed. Ranked by wins, then top cuts, then best finish (the bigger field first), then decks played.
function pilotsOf({ meta, view, tournaments }, rows) {
  const byPilot = new Map();
  for (const e of sortedEntries({ meta, view, tournaments }, rows)) {
    if (!e.pid) continue;
    let p = byPilot.get(e.pid);
    if (!p) byPilot.set(e.pid, (p = { pid: e.pid, name: e.name, nameDate: 0, decks: [], wins: 0, cuts: 0 }));
    p.decks.push(e);
    if (e.t.d >= p.nameDate && e.name) { p.name = e.name; p.nameDate = e.t.d; } // the name they use most recently
    if (e.place === 1) p.wins++;
    if (e.place === 1 || e.place <= e.t.tc) p.cuts++;
  }
  const best = (p) => p.decks[0]; // sortedEntries puts the best finish first
  return [...byPilot.values()].filter((p) => p.cuts > 0)
    .sort((a, b) => b.wins - a.wins || b.cuts - a.cuts || best(a).place - best(b).place || best(b).t.p - best(a).t.p || b.decks.length - a.decks.length);
}

function deckRowHtml(e) {
  const place = e.place <= 3 ? MEDAL[e.place - 1] : ord(e.place);
  return `<li><a class="rg-prow" href="${esc(deckUrl(e.t.id, e.pid))}" target="_blank" rel="noopener" title="Open this decklist on TopDeck.gg">
    <span class="rg-tplace" title="${ord(e.place)} place of ${e.t.p}">${place}<small>of ${e.t.p}</small></span>
    <span class="rg-twho"><b>${esc(e.t.n)}</b><span>${esc(fmtDate(e.t.d))} · ${esc(placeName(e.t))}</span></span>
    <small class="rg-prec">${e.w}W ${e.l}L ${e.d}D</small>
  </a></li>`;
}

function pilotHtml(p, rank) {
  const name = esc(p.name || 'Unknown Player');
  const facts = [p.wins ? plural(p.wins, 'win') : '', plural(p.cuts, 'top cut'), `best ${ord(p.decks[0].place)}`, plural(p.decks.length, 'tournament')].filter(Boolean).join(' · ');
  const rows = p.decks.map(deckRowHtml);
  const more = rows.length - PREVIEW;
  return `<li class="rg-pilot"><div class="rg-phead"><span class="rg-prank">${rank}</span>
    <span class="rg-pwho"><a href="${esc(profileUrl(p.pid))}" target="_blank" rel="noopener" title="Open the TopDeck.gg profile">${name}</a><small>${facts}</small></span></div>
    <ul class="rg-plist">${rows.slice(0, PREVIEW).join('')}</ul>
    ${more > 0 ? `<details class="rg-pmore"><summary>Show ${more} more ${more === 1 ? 'tournament' : 'tournaments'}</summary><ul class="rg-plist">${rows.slice(PREVIEW).join('')}</ul></details>` : ''}</li>`;
}

function showMorePilots() {
  const next = pList.slice(pShown, pShown + PILOTS_PAGE);
  $('rg-plist').insertAdjacentHTML('beforeend', next.map((p, i) => pilotHtml(p, pShown + i + 1)).join(''));
  pShown += next.length;
  const left = pList.length - pShown;
  $('rg-pmoreb').hidden = left <= 0;
  $('rg-pmoreb').textContent = `Show more (${Math.min(left, PILOTS_PAGE)} of ${left.toLocaleString()} left)`;
}

function pilotsTab(c, id) {
  const { meta, view } = c;
  const where = regionLabel(meta, view.region);
  const sub = `${meta.commanders[id].join(' / ')}: top pilots in ${where}.`;
  const loaded = entriesFor(id);
  if (loaded === 'loading') return { html: '<p class="rg-dnote">Loading pilots…</p>', sub };
  if (loaded === null) return { html: "<p class=\"rg-dnote\">The pilot list isn't in this build yet: it appears after the data is rebuilt.</p>", sub };
  pList = pilotsOf(c, loaded);
  pShown = 0;
  const html = pList.length
    ? `<p class="rg-dnote">${plural(pList.length, 'pilot')} who won or reached a top cut with this commander in ${esc(where)} with the filters above. Ranked by tournament wins, then top cuts, then best finish. A pilot's name opens their TopDeck.gg profile; each tournament opens the decklist they played there.</p>
       <ol id="rg-plist" class="rg-pilots"></ol><button id="rg-pmoreb" type="button" class="rg-tmore" hidden>Show more</button>`
    : `<p class="rg-dnote">No pilot has reached a top cut with this commander in ${esc(where)} with the filters above.</p>`;
  return { html, sub, after: pList.length ? showMorePilots : null };
}

// ---- The "Region performance" tab: a leaderboard of the countries, best conversion first ----
const flagHtml = (code) => `<img class="rg-flag" src="static/flags/${esc(code)}.svg" data-code="${esc(code)}" alt="" width="30" height="20" loading="lazy" decoding="async">`;

function regionsTab({ meta, view, tournaments, allowed }, id) {
  const names = meta.commanders[id];
  const sub = `${names.join(' / ')}: performance by country.`;
  const world = commanderIn(meta, null, tournaments, 'world', id, allowed, makeBuckets(tournaments, view.months, 'auto')).total;
  const base = conversion(world);
  const rows = commanderByCountry(meta, tournaments, id, allowed)
    .map((x, i) => ({ ...x, country: meta.countries[i], conv: conversion(x) }))
    .filter((r) => r.decks > 0 && r.conv !== null);
  // Countries with enough decks to say something first (best conversion first), the small samples after them, dimmed
  rows.sort((a, b) => (isThin(a) - isThin(b)) || b.conv - a.conv || b.elig - a.elig || a.country.name.localeCompare(b.country.name));
  if (!rows.length) return { html: '<p class="rg-dnote">No country has decks of this commander in tournaments with a top cut with the filters above.</p>', sub };
  const body = rows.map((r, i) => {
    const gap = base === null ? '' : ` <em class="${r.conv - base >= 0 ? 'up' : 'down'}" title="${PP_TIP}">(${diff(r.conv - base)})</em>`;
    return `<li class="rg-crow${isThin(r) ? ' thin' : ''}">
      <span class="rg-cpos">${i + 1}</span>
      <span class="rg-cflag" title="${esc(r.country.name)}">${flagHtml(r.country.code)}</span>
      <span class="rg-cname"><b>${esc(r.country.name)}</b><small>${r.cut.toLocaleString()} of ${r.elig.toLocaleString()} decks${isThin(r) ? ' · small sample' : ''}</small></span>
      <span class="rg-cconv" title="Decks that made the top cut ÷ decks played, in tournaments with a top cut"><b>${pct(r.conv)}</b>${gap}</span>
      <span class="rg-cshare" title="Share of the decks with a listed commander in this country"><b>${pct(share(r))}</b><small>meta share</small></span>
    </li>`;
  }).join('');
  const html = `<p class="rg-dnote">${plural(rows.length, 'country', 'countries')} with decks of this commander, best conversion first. In brackets: the difference to its conversion in the whole world (${pct(base)}). Countries with fewer than ${MIN_CONV_DECKS} decks in tournaments with a top cut are listed last, dimmed.</p>
    <ol class="rg-clist">${body}</ol>`;
  return { html, sub };
}

// ---- The "Spicy cards" tab: cards that few lists play but that convert far better than the deck ----
const spicyLoaded = new Map(); // commander id -> data of data/s/<id>.json, null (no file) or 'loading'
function spicyFor(id) {
  const have = spicyLoaded.get(id);
  if (have !== undefined) return have;
  spicyLoaded.set(id, 'loading');
  loadSpicy(id).then((data) => {
    spicyLoaded.set(id, data);
    const v = getContext().view;
    if (v.commander === id && v.dTab === 'spicy') renderCommander();
  });
  return 'loading';
}
const cardImage = (name) => `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.split(' // ')[0])}&format=image&version=normal`;
const scryfallPage = (name) => `https://scryfall.com/search?q=${encodeURIComponent(`!"${name.split(' // ')[0]}"`)}`;

function spicyHtml(card, base) {
  const pilots = card.pilots.slice(0, 3).map((p) => `<li><a href="${esc(deckUrl(p.t.id, p.pid))}" target="_blank" rel="noopener" title="Open this decklist on TopDeck.gg"><b>${esc(p.name || 'Unknown Player')}</b> <span>${p.place <= 3 ? MEDAL[p.place - 1] : ord(p.place)} · ${esc(p.t.n)}</span></a></li>`).join('');
  const more = card.pilots.length - 3;
  return `<li class="rg-spicy">
    <a class="rg-scard" href="${esc(scryfallPage(card.name))}" target="_blank" rel="noopener" aria-label="${esc(card.name)} on Scryfall"><img src="${esc(cardImage(card.name))}" alt="${esc(card.name)}" width="146" height="204" loading="lazy" decoding="async"></a>
    <div class="rg-sbody">
      <h4>${esc(card.name)}</h4>
      <p class="rg-sstat"><i>Play rate</i><b>${pct(card.rate)}</b><small>${plural(card.decks, 'deck')}</small></p>
      <p class="rg-sstat"><i>Conversion</i><b>${pct(card.conv)}</b> <em class="up" title="${PP_TIP}">(${diff(card.lift)})</em><small>${card.cut} of ${card.elig} decks · deck average ${pct(base)}</small></p>
      <div class="rg-spilots"><i>${card.pilots.length === 1 ? 'Pilot' : 'Pilots'}</i><ul>${pilots}</ul>${more > 0 ? `<small>and ${more} more</small>` : ''}</div>
    </div>
  </li>`;
}

function spicyTab(c, id) {
  const { meta, view } = c;
  const where = regionLabel(meta, view.region);
  const sub = `${meta.commanders[id].join(' / ')}: spicy cards in ${where}.`;
  const entries = entriesFor(id);
  const spicy = spicyFor(id);
  if (entries === 'loading' || spicy === 'loading') return { html: '<p class="rg-dnote">Looking for spicy cards…</p>', sub };
  if (entries === null || spicy === null) return { html: "<p class=\"rg-dnote\">Card data isn't available for this commander yet: it needs decklists from at least 20 decks, and it appears after the data is rebuilt.</p>", sub };
  const r = spicyCards(sortedEntries(c, entries), spicy);
  const rule = `Rarely played: in under ${Math.round(r.maxRate * 100)}% of the lists (a third of the average card's play rate) and at least ${SPICY.MIN_DECKS} decks. Spicy: converts at least ${SPICY.MIN_LIFT} pp better than the commander's average (${pct(r.base)}), in at least ${SPICY.MIN_ELIG} decks from tournaments with a top cut, and not by luck alone.`;
  let html;
  if (r.lists < SPICY.MIN_LISTS) html = `<p class="rg-dnote">Only ${plural(r.lists, 'deck')} with a card list in ${esc(where)} with the filters above; at least ${SPICY.MIN_LISTS} are needed.</p>`;
  else if (!r.cards.length) html = `<p class="rg-dnote">No card stands out in ${esc(where)} with the filters above (${plural(r.lists, 'deck')} with a card list). ${esc(rule)}</p>`;
  else html = `<p class="rg-dnote">${r.cards.length === 1 ? 'The spiciest card' : `The ${r.cards.length} spiciest cards`} in ${plural(r.lists, 'list')} in ${esc(where)}: ${esc(rule)} Ranked by how far above average they convert once the small number of decks is taken into account.</p><ol class="rg-spicylist">${r.cards.map((card) => spicyHtml(card, r.base)).join('')}</ol>`;
  return { html, sub };
}

const TABS = [['data', 'Commander data'], ['tournaments', 'Tournaments'], ['pilots', 'Top Pilots'], ['regions', 'Region performance'], ['spicy', 'Spicy cards']];

export function renderCommander() {
  const c = getContext();
  const { meta, art, view } = c;
  const id = view.commander;
  if (id === null || !meta.commanders[id]) return;
  const tab = TABS.some(([key]) => key === view.dTab) ? view.dTab : 'data';
  const body = (tab === 'tournaments' ? tournamentsTab : tab === 'pilots' ? pilotsTab : tab === 'regions' ? regionsTab : tab === 'spicy' ? spicyTab : dataTab)(c, id);
  $('rg-sub').textContent = body.sub;
  // The back button, banner and tab bar are built once per commander; changing tab or filter only swaps the panel under them.
  // (Rebuilding everything made the banner art reload and the whole window flicker.)
  const detail = $('rg-detail');
  if (detail.dataset.id !== String(id)) {
    detail.dataset.id = String(id);
    detail.innerHTML = `
      <button type="button" class="rg-back">← All commanders</button>
      ${bannerHtml(meta, art, id)}
      <div class="rg-tabs" role="tablist">${TABS.map(([key, label]) => `<button type="button" role="tab" data-tab="${key}">${label}</button>`).join('')}</div>
      <div class="rg-panel" role="tabpanel"></div>`;
  }
  detail.querySelectorAll('.rg-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  detail.querySelector('.rg-panel').innerHTML = body.html;
  body.after?.();
}

// Opens the view for commander `id`; the list underneath is kept as it was
export function showCommander(id) {
  const { view } = getContext();
  const scroller = $('rg-scroll'), card = document.querySelector('.rg-card');
  saved = { list: scroller.scrollTop, card: card.scrollTop };
  $('rg-detail').dataset.id = ''; // a new shell for this commander
  view.commander = id;
  view.dTab = 'data'; // every commander opens on its data
  $('rg-modal').classList.add('detail');
  scroller.scrollTop = 0; card.scrollTop = 0;
  renderCommander();
  if (seats === undefined) {
    seats = 'loading';
    loadSeats().then((data) => { seats = data; if (getContext().view.commander !== null) renderCommander(); });
  }
}

// Back to the ranking. `restore` false when the window itself is reopening.
export function hideCommander(restore = true) {
  const { view } = getContext();
  view.commander = null;
  $('rg-modal').classList.remove('detail');
  if (restore && saved) { $('rg-scroll').scrollTop = saved.list; document.querySelector('.rg-card').scrollTop = saved.card; }
  saved = null;
}

export function initCommander(contextFn, onBack) {
  getContext = contextFn;
  // A flag file that isn't there (static/flags/<CODE>.svg) is swapped for the country code, so the row still says where it is
  $('rg-detail').addEventListener('error', (e) => {
    const img = e.target;
    if (!img.classList?.contains('rg-flag')) return;
    const code = document.createElement('span');
    code.className = 'rg-flagcode';
    code.textContent = img.dataset.code;
    img.replaceWith(code);
  }, true);
  // Spicy cards: after a short pause a bigger copy of the card fades in beside it (mouse only; phones can tap through to Scryfall).
  // The new image is loaded first, so the previous card is never shown while the next one is on its way.
  if (matchMedia('(hover: hover)').matches) {
    const big = document.createElement('img');
    big.className = 'rg-bigcard';
    big.alt = '';
    document.body.appendChild(big);
    const W = 300, H = 418, GAP = 14, DELAY = 250;
    let current = null, timer = 0;
    const place = (card) => {
      const r = card.getBoundingClientRect();
      const left = r.right + GAP + W <= innerWidth ? r.right + GAP : Math.max(8, r.left - GAP - W); // beside the card, on whichever side has room
      big.style.left = `${left}px`;
      big.style.top = `${Math.min(Math.max(8, r.top + r.height / 2 - H / 2), Math.max(8, innerHeight - H - 8))}px`;
    };
    const hide = () => { clearTimeout(timer); current = null; big.classList.remove('on'); };
    const show = (card, url) => {
      const img = new Image();
      img.src = url;
      (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => {
        if (current !== card) return; // the pointer has moved on
        big.src = url;
        place(card);
        big.classList.add('on');
      });
    };
    const detail = $('rg-detail');
    detail.addEventListener('pointerover', (e) => {
      const card = e.target.closest('.rg-scard');
      if (!card || card === current) return;
      const src = card.querySelector('img')?.currentSrc;
      if (!src) return;
      hide();
      current = card;
      timer = setTimeout(() => show(card, src.replace('version=normal', 'version=large')), DELAY);
    });
    detail.addEventListener('pointerout', (e) => { if (e.target.closest('.rg-scard') && !e.relatedTarget?.closest?.('.rg-scard')) hide(); });
    detail.addEventListener('scroll', hide, true);
    addEventListener('blur', hide);
  }
  $('rg-detail').addEventListener('click', (e) => {
    if (e.target.closest('.rg-back')) return onBack();
    const tab = e.target.closest('[data-tab]');
    if (tab) { getContext().view.dTab = tab.dataset.tab; renderCommander(); return; }
    if (e.target.closest('#rg-tmore')) showMoreTournaments();
    else if (e.target.closest('#rg-pmoreb')) showMorePilots();
  });
  $('rg-detail').addEventListener('change', (e) => {
    const { view } = getContext();
    if (e.target.id === 'rg-dmetric') view.dMetric = e.target.value;
    else if (e.target.id === 'rg-dgroup') view.dGroup = e.target.value;
    else return;
    renderCommander();
  });
}