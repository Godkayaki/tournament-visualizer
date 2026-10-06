// Bottom-right tools.
import { $ } from './utils.js';

// ---- Accent color picker (bottom-right tools). The palette and the saved choice live in theme.js ----
export function initColorPicker() {
  const btn = $('tool-color'), menu = $('color-menu');
  if (!btn || !menu || !window.EDHTheme) return;
  menu.innerHTML = Object.entries(EDHTheme.PALETTE).map(([key, c]) =>
    `<button type="button" class="opt" role="menuitemradio" data-color="${key}" style="--c:${c.hex}" aria-label="${c.label}" title="${c.label}"></button>`).join('');
  const sync = () => menu.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-checked', String(o.dataset.color === EDHTheme.current)));
  const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) sync(); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  menu.addEventListener('click', (e) => {
    const o = e.target.closest('.opt');
    if (!o) return;
    EDHTheme.apply(o.dataset.color); // repaints the whole page (CSS variables) and the globe (accentchange)
    sync();
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setOpen(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
}