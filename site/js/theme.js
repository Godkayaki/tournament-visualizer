// Accent color: the palette, the saved choice and the CSS variables it drives.
// Loaded in <head> on every page, so a saved color is applied before first paint (no flash of the default).
// The only thing stored in the browser is the NAME of the chosen color (localStorage key below); picking the
// default color removes it again.
(function () {
  var KEY = 'edhglobe.accent';
  var DEFAULT = 'turquoise';
  // `on` = text color used on top of the accent (active filter button, hovered "View bracket")
  var PALETTE = {
    turquoise: { label: 'Turquoise', hex: '#19f5d8', on: '#04201c' },
    purple:    { label: 'Purple',     hex: '#b388ff', on: '#0d1117' },
    blue:      { label: 'Blue',       hex: '#4d8dff', on: '#0d1117' },
    lightblue: { label: 'Light Blue', hex: '#6fd6ff', on: '#0d1117' },
    green:     { label: 'Green',      hex: '#3dff7a', on: '#0d1117' },
    yellow:    { label: 'Yellow',     hex: '#ffe14d', on: '#0d1117' },
    red:       { label: 'Red',        hex: '#ff5c6c', on: '#0d1117' }
  };

  function rgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); }); }
  function hueOf(hex) {
    var c = rgb(hex).map(function (v) { return v / 255; });
    var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]), d = max - min;
    if (!d) return 0;
    var h = max === c[0] ? ((c[1] - c[2]) / d) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return (h * 60 + 360) % 360;
  }
  // The logo is an <img>, so CSS variables can't reach inside it: it is recolored by rotating its hue
  // from the default color (the one its artwork is drawn in) to the chosen one. Approximate, but works for any logo.
  var BASE_HUE = hueOf(PALETTE[DEFAULT].hex);
  var current = DEFAULT;

  function paint(name) {
    if (!PALETTE[name]) name = DEFAULT;
    var c = PALETTE[name], style = document.documentElement.style;
    style.setProperty('--accent', c.hex);
    style.setProperty('--accent-rgb', rgb(c.hex).join(', '));
    style.setProperty('--on-accent', c.on);
    style.setProperty('--logo-hue', Math.round(hueOf(c.hex) - BASE_HUE) + 'deg');
    current = name;
    window.dispatchEvent(new CustomEvent('accentchange', { detail: { name: name, hex: c.hex } })); // js/globe.js recolors the globe
  }
  function save(name) {
    try { if (name === DEFAULT) localStorage.removeItem(KEY); else localStorage.setItem(KEY, name); } catch (e) { /* storage blocked: just not remembered */ }
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  paint(saved);

  window.EDHTheme = {
    PALETTE: PALETTE,
    get current() { return current; },
    hex: function () { return PALETTE[current].hex; },
    apply: function (name) { paint(name); save(current); }
  };
})();