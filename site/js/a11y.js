// Accessibility settings: the saved choices and the classes they switch on <html> (the styles are in css/style.css).
// Loaded in <head> next to theme.js, so a saved choice is applied before first paint. What is stored in the browser is only the
// list of choices below (localStorage key edhglobe.a11y); with nothing saved, "reduce motion" follows the system setting.
(function () {
  var KEY = 'edhglobe.a11y';
  var DEFAULTS = { text: 0, contrast: false, motion: null, colorblind: false, stars: true }; // motion: null = follow the system
  var root = document.documentElement;
  var s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { s = {}; }
  var v = {};
  Object.keys(DEFAULTS).forEach(function (k) { v[k] = k in s ? s[k] : DEFAULTS[k]; });
  if (![0, 1, 2].includes(v.text)) v.text = 0;

  function systemMotion() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function reduced() { return v.motion === null ? systemMotion() : !!v.motion; }
  function paint() {
    root.dataset.text = String(v.text);
    root.classList.toggle('a11y-contrast', !!v.contrast);
    root.classList.toggle('reduce-motion', reduced());
    root.classList.toggle('a11y-nostars', !v.stars);
    root.classList.toggle('a11y-colorblind', !!v.colorblind);
  }
  function save() {
    try {
      var out = {};
      Object.keys(DEFAULTS).forEach(function (k) { if (v[k] !== DEFAULTS[k]) out[k] = v[k]; });
      if (Object.keys(out).length) localStorage.setItem(KEY, JSON.stringify(out)); else localStorage.removeItem(KEY);
    } catch (e) { /* storage blocked: just not remembered */ }
  }
  paint();

  window.EDHA11y = {
    DEFAULTS: DEFAULTS,
    get: function (k) { return k === 'motion' ? reduced() : v[k]; },
    set: function (k, val) { v[k] = val; paint(); save(); window.dispatchEvent(new CustomEvent('a11ychange', { detail: { key: k } })); },
    reset: function () { Object.keys(DEFAULTS).forEach(function (k) { v[k] = DEFAULTS[k]; }); paint(); save(); window.dispatchEvent(new CustomEvent('a11ychange', { detail: { key: 'all' } })); }
  };
})();