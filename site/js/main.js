// Entry point: wires the modules together. The code for each part lives in its own file next to this one.
import { $ } from './utils.js';
import { state } from './state.js';
import { loadTournaments, loadFeatured, loadArt } from './data.js';
import { blockedBy } from './filters.js';
import { showUpdated, showVersion } from './meta.js';
import { initGlobe, render, updateTier } from './globe.js';
import { initStars } from './stars.js';
import { initList, closeArea, onFiltersChanged, setFeatured } from './list.js';
import { initPreview } from './preview.js';
import { initTournament, closeModal } from './tournament.js';
import { initColorPicker } from './tools.js';

loadArt(); // start the commander-art request right away; the list and the popup reuse it
const world = initGlobe();
initStars(world);
initPreview();
initList();
initTournament();
initColorPicker();

// Touch screens have no scroll wheel: say "pinch" in the hint under the title
if (matchMedia('(hover: none)').matches) document.querySelector('#title p').textContent = 'Drag to rotate, pinch to zoom.';

// ---- Data ----
loadTournaments()
  .then(({ tournaments, generated, version }) => {
    showVersion(version);
    showUpdated(generated);
    const hidden = [];
    state.all = tournaments.filter((t) => {
      const rule = blockedBy(t.n);
      if (rule) hidden.push(`${t.n}   [${rule.source}]`);
      return !rule;
    });
    console.groupCollapsed(`[EDHGlobe] ${hidden.length} of ${tournaments.length} tournaments hidden by name filter`);
    hidden.forEach((h) => console.log(h));
    console.groupEnd();
    updateTier();
    render();
    $('recent').disabled = !state.all.length;
  })
  .catch(() => ($('stats').textContent = 'Could not load tournament data. Run the fetch script first.'));

loadFeatured().then(setFeatured);

// ---- Filter bar ----
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const g = b.parentElement;
  g.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
  b.classList.add('on');
  b.setAttribute('aria-pressed', 'true');
  state[g.dataset.key] = +b.dataset.v;
  onFiltersChanged();
  render();
});

// ---- Closing things ----
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) { if (c.dataset.close === 'area') closeArea(); else closeModal(); }
  else if (e.target === $('modal')) closeModal();
});

// Clicking empty map or starry background closes the tournament list (but not after dragging the globe, and never when a bubble is clicked)
let pressAt = null;
addEventListener('pointerdown', (e) => { pressAt = [e.clientX, e.clientY]; }, true);
document.addEventListener('click', (e) => {
  if (!e.target.closest('#globe') || e.target.closest('.bubble')) return;
  if (pressAt && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 5) return; // it was a drag
  closeArea();
});