// Bottom-right tools.
import { $ } from './utils.js';

// ---- Accessibility menu (bottom-right tools). The choices and what they switch on live in a11y.js; the styles in style.css ----
export function initAccessMenu() {
  const btn = $('tool-access'), menu = $('a11y-menu');
  if (!btn || !menu || !window.EDHA11y) return;
  const A = EDHA11y;
  const sync = () => {
    menu.querySelectorAll('button[data-text]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.text === A.get('text'))));
    menu.querySelectorAll('input[data-k]').forEach((i) => { i.checked = !!A.get(i.dataset.k); });
  };
  const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { sync(); menu.querySelector('button, input').focus(); } };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-text]'); // (not just [data-text]: <html> has that attribute too)
    if (b) { A.set('text', +b.dataset.text); sync(); }
    if (e.target.id === 'a11y-reset') { A.reset(); sync(); }
  });
  menu.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) { A.set(k, e.target.checked); sync(); } });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setOpen(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
}

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