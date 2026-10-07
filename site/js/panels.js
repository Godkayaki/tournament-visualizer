// Open/close for the tournament list and the tournament popup, generic over the element.
// CSS animates them (see "open/close" in style.css);
// closing waits for the animation to finish before the element is really hidden.
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// `scrollers`: the scrollable elements inside the panel, which start from the top on every open. This has to happen
// once the panel is visible: a hidden element ignores scrollTop, and the browser would then restore its old scroll position.
export function openPanel(el, ...scrollers) {
  clearTimeout(el._closeTimer);
  el.classList.remove('closing');
  el.hidden = false;
  for (const s of scrollers) s.scrollTop = 0;
}
export function closePanel(el, ms = 180) {
  if (el.hidden || el.classList.contains('closing')) return;
  if (reduceMotion()) { el.hidden = true; return; }
  el.classList.add('closing');
  el._closeTimer = setTimeout(() => { el.hidden = true; el.classList.remove('closing'); }, ms);
}