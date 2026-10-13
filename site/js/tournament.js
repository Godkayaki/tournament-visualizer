// The tournament popup: banner with the winner's art and the standings, one row per player.
import { $, esc, fmtDate, place, ord } from './utils.js';
import { getRows, loadArt, loadMeta } from './data.js';
import { pick } from './filters.js';
import { state } from './state.js';
import { avgDrawRateOf } from './regional.js';
import { openPanel, closePanel } from './panels.js';

// If topdeck's deck URL pattern differs, change it here.
export const deckUrl = (tid, playerId) => `https://topdeck.gg/deck/${tid}/${playerId}`;
const MEDAL = ['🥇', '🥈', '🥉'];

export const closeModal = () => closePanel($('modal'));

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

export async function openTournament(t) {
  $('m-title').textContent = t.n;
  $('m-meta').textContent = `${fmtDate(t.d)} · ${place(t)} · ${t.p} players · ${t.sw} Swiss rounds${t.tc ? ` · top ${t.tc}` : ''}`;
  $('m-draw').textContent = 'Draw rate: …';
  const average = loadMeta().then((meta) => avgDrawRateOf(meta, pick(state.minPlayers, state.months))).catch(() => null);
  $('m-bracket').href = `https://topdeck.gg/bracket/${encodeURIComponent(t.id)}`;
  $('m-banner').style.removeProperty('--banner-art');
  $('m-list').innerHTML = '<li class="msg">Loading…</li>';
  openPanel($('modal'), $('m-scroll'));
  try {
    const [rows, art] = await Promise.all([getRows(t), loadArt()]);
    const imgs = (p) => p.c.map((n) => (art[n] || [])[0]).filter(Boolean).slice(0, 2); // front face only; partners: 2 arts side by side
    // Draw rate: drawn games / games played, from every player's W/L/D (a drawn game is one D for each player at the pod)
    let draws = 0, games = 0;
    for (const p of rows) { draws += +p.d || 0; games += (+p.w || 0) + (+p.l || 0) + (+p.d || 0); }
    const own = games ? (draws / games) * 100 : null;
    $('m-draw').innerHTML = drawText(own, null) + seatText(t);
    average.then((avg) => { if ($('m-title').textContent === t.n) $('m-draw').innerHTML = drawText(own, avg) + seatText(t); }); // still the same tournament?
    const winnerArt = rows[0] && imgs(rows[0])[0];
    if (winnerArt) $('m-banner').style.setProperty('--banner-art', `url("${winnerArt}")`);
    $('m-list').innerHTML = rows.map((p, i) => {
      const url = esc(deckUrl(t.id, p.i));
      const pics = imgs(p).map((u) => `<img src="${esc(u)}" alt="" loading="lazy" decoding="async">`).join('');
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
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}