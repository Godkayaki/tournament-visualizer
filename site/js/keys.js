// Keyboard shortcuts and the window that lists them (the keyboard button in the bottom-right tools).
import { $ } from './utils.js';
import { openPanel, closePanel } from './panels.js';
import { panBy, zoomBy, toggleSpin } from './globe.js';
import { closeArea } from './list.js';

const modals = () => ['modal', 'rg-modal', 'keys-modal'].map($);
const anyModalOpen = () => modals().some((m) => !m.hidden);

// Shortcuts that press a button of the page, so they behave exactly like a click
const click = (id) => { const b = $(id); if (b && !b.hidden && !b.disabled) b.click(); };
function cycle(key) { // next option of a filter group (Players, Period), back to the first after the last
  const btns = [...document.querySelectorAll(`#filters .group[data-key="${key}"] button`)];
  const i = btns.findIndex((b) => b.classList.contains('on'));
  btns[(i + 1) % btns.length]?.click();
}

export function initKeys() {
  const dlg = $('keys-modal'), btn = $('tool-keys');
  const open = () => { openPanel(dlg); $('keys-close').focus(); };
  const close = () => { closePanel(dlg); btn.focus(); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (dlg.hidden) open(); else close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('#keys-close')) close(); });

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.closest?.('input, select, textarea, [contenteditable="true"]')) return; // typing: leave the keys alone
    const key = e.key;
    if (key === 'Escape') {
      if (!dlg.hidden) close();
      else if (!anyModalOpen() && !$('area').hidden) closeArea(); // the tournament popup and Regional Metagame handle their own Esc
      return;
    }
    if (key === '?') { e.preventDefault(); if (dlg.hidden) open(); else close(); return; }
    if (anyModalOpen()) return; // behind a window: only ? and Esc
    const onControl = t.closest?.('button, a, summary'); // Space and Enter belong to a focused button or link
    const lower = key.length === 1 ? key.toLowerCase() : key;
    switch (lower) {
      case 'ArrowLeft': panBy(0, -1); break;
      case 'ArrowRight': panBy(0, 1); break;
      case 'ArrowUp': panBy(1, 0); break;
      case 'ArrowDown': panBy(-1, 0); break;
      case '+': case '=': zoomBy(0.7); break;
      case '-': case '_': zoomBy(1 / 0.7); break;
      case ' ': if (onControl) return; toggleSpin(); break;
      case 'r': click('recent'); break;
      case 'f': click('featured'); break;
      case 'm': click('regional'); break; // the same function opens it whichever of the two buttons is on screen
      case 'p': cycle('minPlayers'); break;
      case 'd': cycle('months'); break;
      default: return;
    }
    e.preventDefault();
  });
}