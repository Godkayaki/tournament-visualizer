// The tournament popup: banner with the winner's art and the standings, one row per player.
import { $, esc, fmtDate, place, ord } from './utils.js';
import { getRows, loadArt } from './data.js';
import { openPanel, closePanel } from './panels.js';

// If topdeck's deck URL pattern differs, change it here.
const deckUrl = (tid, playerId) => `https://topdeck.gg/deck/${tid}/${playerId}`;
const MEDAL = ['🥇', '🥈', '🥉'];

export const closeModal = () => closePanel($('modal'));

export async function openTournament(t) {
  $('m-title').textContent = t.n;
  $('m-meta').textContent = `${fmtDate(t.d)} · ${place(t)} · ${t.p} players · ${t.sw} Swiss rounds${t.tc ? ` · top ${t.tc}` : ''}`;
  $('m-bracket').href = `https://topdeck.gg/bracket/${encodeURIComponent(t.id)}`;
  $('m-banner').style.removeProperty('--banner-art');
  $('m-list').innerHTML = '<li class="msg">Loading…</li>';
  openPanel($('modal'), $('m-scroll'));
  try {
    const [rows, art] = await Promise.all([getRows(t), loadArt()]);
    const imgs = (p) => p.c.map((n) => (art[n] || [])[0]).filter(Boolean).slice(0, 2); // front face only; partners: 2 arts side by side
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
    $('m-list').innerHTML = '<li class="msg">Could not load standings for this tournament.</li>';
  }
}

export function initTournament() {
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}