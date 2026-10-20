// "Back to top" button for the long text pages (privacy policy, methodology). It appears once the page has been scrolled a bit.
(() => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'totop';
  btn.setAttribute('aria-label', 'Back to top');
  btn.title = 'Back to top';
  btn.hidden = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(btn);

  const THRESHOLD = 400;
  let shown = false;
  const update = () => {
    const want = (window.scrollY || document.documentElement.scrollTop) > THRESHOLD;
    if (want === shown) return;
    shown = want;
    if (want) { btn.hidden = false; void btn.offsetWidth; btn.classList.add('on'); } // the reflow makes the browser draw the hidden state first, so it fades in
    else { btn.classList.remove('on'); setTimeout(() => { if (!shown) btn.hidden = true; }, 200); }
  };
  addEventListener('scroll', update, { passive: true });
  update();

  btn.addEventListener('click', () => {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    btn.blur();
  });
})();