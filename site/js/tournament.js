// The tournament popup: banner with the winner's art and the standings, one row per player.
import { $, esc, fmtDate, place, ord } from './utils.js';
import { canon, getRows, loadArt, loadMeta, artImgs, focusY } from './data.js';
import { pick } from './filters.js';
import { state } from './state.js';
import { avgDrawRateOf } from './regional.js';
import { openPanel, closePanel } from './panels.js';

// If topdeck's deck URL pattern differs, change it here.
export const deckUrl = (tid, playerId) => `https://topdeck.gg/deck/${tid}/${playerId}`;
const MEDAL = ['🥇', '🥈', '🥉'];

export const closeModal = () => closePanel($('modal'));

// ---- "View metagame": the commanders of this one tournament ----
// rows = the standings (best finish first); one entry per commander (partners are one commander). entries = decks, cut = decks that
// finished inside the top cut (place <= tc; null when the tournament had none), draw = its decks' drawn games / games played.
// Ordered by entries, then conversion (cut / entries), then draw rate and name so the order never depends on the input.
export function metagameOf(rows, tc) {
  const by = new Map();
  let unlisted = 0;
  rows.forEach((p, i) => {
    if (!p.c.length) { unlisted++; return; }
    const names = [...new Set(p.c.map(canon))].sort(); // partners listed in a different order are still the same commander
    const key = names.join(' / ');
    let c = by.get(key);
    if (!c) by.set(key, (c = { key, names, entries: 0, cut: 0, draws: 0, games: 0 }));
    c.entries++;
    if (tc && i + 1 <= tc) c.cut++;
    c.draws += +p.d || 0;
    c.games += (+p.w || 0) + (+p.l || 0) + (+p.d || 0);
  });
  const list = [...by.values()].map((c) => ({ ...c, conversion: tc ? (c.cut / c.entries) * 100 : null, draw: c.games ? (c.draws / c.games) * 100 : null }));
  list.sort((a, b) => b.entries - a.entries || (b.conversion ?? -1) - (a.conversion ?? -1) || (b.draw ?? -1) - (a.draw ?? -1) || a.key.localeCompare(b.key));
  return { list, unlisted, listed: rows.length - unlisted };
}


// The draw rate line: this tournament's rate and, in brackets, the average of the tournaments the globe shows right now
// (same name, players and period filters). The average needs meta.json; without it the line just has no brackets.
const pct = (v, digits = 1) => `<b>${v.toFixed(digits)}%</b>`; // the number and its % in bold
function drawText(own, avg) {
  const base = `Draw rate: ${own === null ? '<b>–</b>' : pct(own)}`;
  return avg === null ? base : `${base} <span title="Average draw rate of the tournaments shown on the globe with the current filters">(${pct(avg)} avg.)</span>`;
}

// Seat win rate: t.seat = [games, wins of seat 1, 2, 3, 4] (4-player pods only; see scripts/seats.mjs). Each number is the share of
// ALL those games won from that seat, so with the draw rate they add up to 100%.
function seatText(t) {
  if (!t.seat || !t.seat[0]) return '';
  const [games, ...wins] = t.seat;
  const list = wins.map((w, i) => `S${i + 1} WR: ${pct((w / games) * 100, 2)}`).join(' | ');
  return ` · <span title="Win rate (WR) of each seat: share of the ${games} four-player games of this tournament won from seat 1 to 4 (draws count as games nobody won)">${list}</span>`;
}

let shown = null; // { t, rows, art } of the tournament on screen, for the metagame view

// Switches the window between the standings and the metagame list
function setView(meta) {
  const card = document.querySelector('#modal .card');
  if (meta && !card.style.minHeight) card.style.minHeight = `${card.offsetHeight}px`; // the window keeps its height when the (shorter) list replaces the standings
  $('m-list').hidden = meta;
  $('m-meta-list').hidden = !meta;
  $('m-view').textContent = meta ? 'View standings' : 'View metagame';
  $('m-view').setAttribute('aria-pressed', String(meta));
  $('m-scroll').scrollTop = 0;
}

function renderMetagame() {
  const { t, rows, art } = shown;
  const { list, listed } = metagameOf(rows, t.tc);
  const rowHtml = (c, i) => {
    const pics = artImgs(c.names, art, 'loading="lazy" decoding="async"');
    const conv = c.conversion === null ? ['–', 'no top cut'] : [`${c.conversion.toFixed(1)}%`, `${c.cut} of ${c.entries}`];
    return `<li><div class="entry">
      <span class="art">${pics}</span>
      <span class="rank">${i + 1}</span>
      <span class="who"><b>${esc(c.key)}</b><span>${c.entries} ${c.entries === 1 ? 'entry' : 'entries'} · ${((c.entries / listed) * 100).toFixed(1)}% of the field</span></span>
      <span class="mstat" title="Decks that made the top cut ÷ decks played"><b>${conv[0]}</b><small>conv. · ${conv[1]}</small></span>
      <span class="mstat" title="Drawn games ÷ games played by this commander's decks"><b>${c.draw === null ? '–' : `${c.draw.toFixed(1)}%`}</b><small>draw rate</small></span>
    </div></li>`;
  };
  $('m-meta-list').innerHTML = list.length ? list.map(rowHtml).join('') : '<li class="msg">No commanders listed for this tournament.</li>';
}

export async function openTournament(t) {
  shown = null;
  document.querySelector('#modal .card').style.minHeight = '';
  $('m-view').hidden = true;
  $('m-meta-list').hidden = true; $('m-meta-list').innerHTML = '';
  $('m-list').hidden = false;
  $('m-view').textContent = 'View metagame';
  $('m-title').textContent = t.n;
  $('m-meta').textContent = `${fmtDate(t.d)} · ${place(t)} · ${t.p} players · ${t.sw} Swiss rounds${t.tc ? ` · top ${t.tc}` : ''}`;
  $('m-draw').textContent = 'Draw rate: …';
  const average = loadMeta().then((meta) => avgDrawRateOf(meta, pick(state.minPlayers, state.months))).catch(() => null);
  $('m-bracket').href = `https://topdeck.gg/bracket/${encodeURIComponent(t.id)}`;
  $('m-banner').style.removeProperty('--banner-art');
  $('m-banner').style.removeProperty('--banner-pos');
  $('m-list').innerHTML = '<li class="msg">Loading…</li>';
  openPanel($('modal'), $('m-scroll'));
  try {
    const [rows, art] = await Promise.all([getRows(t), loadArt()]);
    shown = { t, rows, art };
    $('m-view').hidden = !rows.length;
    const imgs = (p) => p.c.map((n) => (art[n] || [])[0]).filter(Boolean).slice(0, 2); // front face only; partners: 2 arts side by side
    // Draw rate: drawn games / games played, from every player's W/L/D (a drawn game is one D for each player at the pod)
    let draws = 0, games = 0;
    for (const p of rows) { draws += +p.d || 0; games += (+p.w || 0) + (+p.l || 0) + (+p.d || 0); }
    const own = games ? (draws / games) * 100 : null;
    $('m-draw').innerHTML = drawText(own, null) + seatText(t);
    average.then((avg) => { if ($('m-title').textContent === t.n) $('m-draw').innerHTML = drawText(own, avg) + seatText(t); }); // still the same tournament?
    const winnerArt = rows[0] && imgs(rows[0])[0];
    if (winnerArt) {
      $('m-banner').style.setProperty('--banner-art', `url("${winnerArt}")`);
      const y = focusY(rows[0].c.find((n) => (art[n] || [])[0])); // the commander whose art this is
      if (y !== null) $('m-banner').style.setProperty('--banner-pos', `${y}%`);
    }
    $('m-list').innerHTML = rows.map((p, i) => {
      const url = esc(deckUrl(t.id, p.i));
      const pics = artImgs(p.c, art, 'loading="lazy" decoding="async"');
      return `<li><a class="entry" href="${url}" target="_blank" rel="noopener">
        <span class="art">${pics}</span>
        <span class="rank" title="${ord(i + 1)} place">${MEDAL[i] || ord(i + 1)}</span>
        <span class="who"><b>${esc(p.n || 'Unknown Player')}</b><span>${p.c.length ? esc(p.c.join(' / ')) : 'No commander listed'}</span></span>
        <span class="rec">${p.w}<i>W</i>${p.l}<i>L</i>${p.d}<i>D</i></span>
      </a></li>`;
    }).join('');
  } catch {
    $('m-draw').textContent = 'Draw rate: –';
    $('m-list').innerHTML = '<li class="msg">Could not load standings for this tournament.</li>';
  }
}

export function initTournament() {
  $('m-view').addEventListener('click', () => {
    if (!shown) return;
    const meta = $('m-meta-list').hidden; // currently showing the standings -> switch to the metagame
    if (meta) renderMetagame();
    setView(meta);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}