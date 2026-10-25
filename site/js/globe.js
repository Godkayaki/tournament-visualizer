// The 3D globe: the sphere and its borders, auto-rotate, and the clustered tournament bubbles.
import { $ } from './utils.js';
import { state } from './state.js';
import { visible } from './filters.js';
import { loadCountries } from './geo.js';
import { showArea } from './list.js';

// `Globe` is the global from the globe.gl <script> in index.html (it loads before the modules run)
const accentHex = () => window.EDHTheme?.hex() ?? '#19f5d8'; // current accent (theme.js); the globe takes its neon color from it

// Cluster radius in degrees for each zoom tier (camera altitude in globe radii).
const RADII = [5, 3, 1.6, 0.8, 0.3, 0.08]; // smaller = more, less-merged bubbles
const tierOf = (alt) => (alt > 2.2 ? 0 : alt > 1.6 ? 1 : alt > 1.0 ? 2 : alt > 0.6 ? 3 : alt > 0.3 ? 4 : 5);

let world;
let spinPaused = false; // the Space shortcut: auto-rotate stays off until pressed again

export function initGlobe() {
  world = Globe()($('globe'))
    .backgroundColor('rgba(0,0,0,0)') // transparent: the starfield lives in #stars behind the canvas
    .atmosphereColor(accentHex())
    .atmosphereAltitude(0.16)
    .enablePointerInteraction(false) // we only use DOM bubbles; skips costly raycasting on borders
    .polygonCapColor(() => 'rgba(0,0,0,0)')
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => accentHex())
    .polygonAltitude(0.003)
    .polygonsTransitionDuration(0)
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude(0.004)
    .htmlTransitionDuration(0)
    .htmlElement(bubble);

  // The globe's neon (atmosphere + country borders) follows the accent color picked in the bottom-right menu
  addEventListener('accentchange', (e) => {
    world.atmosphereColor(e.detail.hex);
    world.polygonStrokeColor(() => e.detail.hex);
  });

  // Plain dark sphere: no terrain texture, only the neon borders
  const mat = world.globeMaterial();
  mat.color.set('#000000');   // flat fill: the color comes only from the emissive channel
  mat.emissive.set('#0d1117');
  mat.specular.set('#000000');

  loadCountries().then((features) => { // borders and area names (geo.js)
    state.countries = features;
    world.polygonsData(features);
  });

  world.renderer().setPixelRatio(Math.min(devicePixelRatio, 1.5)); // big win on hi-dpi screens
  world.pointOfView({ lat: 38, lng: -39, altitude: 2.5 }); // initial view: mid-Atlantic, between Spain and the US
  world.controls().autoRotate = !window.EDHA11y?.get('motion');
  world.controls().autoRotateSpeed = 0.2;
  // Auto-rotate: stops on any drag/zoom, resumes after IDLE_MS of no movement,
  // but only while looking at the bare globe (no bubble list or tournament popup open).
  const IDLE_MS = 5000;
  let lastActivity = Date.now();
  const ctl = world.controls();
  ctl.addEventListener('start', () => { ctl.autoRotate = false; lastActivity = Date.now(); });
  ctl.addEventListener('end', () => { lastActivity = Date.now(); });
  setInterval(() => {
    if (window.EDHA11y?.get('motion')) { // "reduce motion": the globe never turns by itself
      ctl.autoRotate = false;
      lastActivity = Date.now();
    } else if (!$('area').hidden || !$('modal').hidden) { // a bubble list or popup is open: stay still, restart the idle clock
      ctl.autoRotate = false;
      lastActivity = Date.now();
    } else if (spinPaused) {
      ctl.autoRotate = false;
    } else if (!ctl.autoRotate && Date.now() - lastActivity > IDLE_MS) {
      ctl.autoRotate = true; // same speed as the initial spin
    }
  }, 300);

  world.onZoom(({ altitude }) => {
    const t = tierOf(altitude);
    if (t !== state.tier) { state.tier = t; render(); }
  });
  addEventListener('resize', () => world.width(innerWidth).height(innerHeight));
  addEventListener('a11ychange', render); // the color-blind palette changes the bubbles
  return world;
}

// Keyboard controls (see keys.js): rotate, zoom, pause the spin
export function panBy(dLat, dLng) {
  const { lat, lng, altitude } = world.pointOfView();
  const k = Math.min(25, 4 + 10 * altitude) / 15; // bigger steps when zoomed out, finer when close
  let nl = lng + dLng * 15 * k;
  if (nl > 180) nl -= 360; else if (nl < -180) nl += 360;
  world.pointOfView({ lat: Math.max(-85, Math.min(85, lat + dLat * 15 * k)), lng: nl, altitude }, 250);
}
export function zoomBy(factor) {
  const { lat, lng, altitude } = world.pointOfView();
  world.pointOfView({ lat, lng, altitude: Math.max(0.12, Math.min(4, altitude * factor)) }, 250);
}
export function toggleSpin() {
  spinPaused = !spinPaused;
  world.controls().autoRotate = false;
  return spinPaused;
}

// What the zoom level was when the data arrived (the first render needs it before any zoom event)
export const updateTier = () => { state.tier = tierOf(world.pointOfView().altitude); };

// Greedy proximity clustering: each tournament joins the nearest cluster within `r` degrees.
function cluster(items, r) {
  const cs = [];
  for (const t of items) {
    let hit = null, best = r;
    for (const c of cs) {
      let dl = Math.abs(c.lng - t.lng);
      if (dl > 180) dl = 360 - dl;
      const dist = Math.hypot(dl * Math.cos((t.lat * Math.PI) / 180), c.lat - t.lat);
      if (dist < best) { best = dist; hit = c; }
    }
    if (!hit) { cs.push({ lat: t.lat, lng: t.lng, items: [t] }); continue; }
    hit.items.push(t);
    const n = hit.items.length;
    let lng = t.lng;
    if (lng - hit.lng > 180) lng -= 360; else if (hit.lng - lng > 180) lng += 360; // antimeridian
    hit.lat += (t.lat - hit.lat) / n;
    hit.lng += (lng - hit.lng) / n;
    if (hit.lng > 180) hit.lng -= 360; else if (hit.lng < -180) hit.lng += 360;
  }
  return cs;
}

// yellow (few tournaments) -> red (many)
const heat = (n) => {
  const t = Math.min(1, Math.log10(n) / 1.6);
  if (window.EDHA11y?.get('colorblind')) return `hsl(${52 + 173 * t}, ${95 - 25 * t}%, ${62 - 27 * t}%)`; // yellow -> blue: also reads as light -> dark for any color vision
  return `hsl(${46 - 46 * t}, 95%, ${60 - 8 * t}%)`;
};

function bubble(d) {
  const n = d.items.length;
  const size = 26 + Math.min(34, Math.log2(n) * 7);
  // Outer element is positioned by globe.gl; the inner .dot is what scales on hover.
  const el = document.createElement('button');
  el.className = 'bubble';
  el.title = `${n} tournament${n > 1 ? 's' : ''}`;
  el.style.cssText = `width:${size}px;height:${size}px;font-size:${size > 40 ? 15 : 13}px;--c:${heat(n)};--fg:${n < 10 ? '#1a1206' : '#fff'}`;
  el.innerHTML = `<span class="dot">${n}</span>`;
  el.onclick = (e) => { e.stopPropagation(); showArea(d.items); };
  // Bubbles sit above the canvas and would swallow the wheel: hand it to the globe's controls so zoom still works
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    world.renderer().domElement.dispatchEvent(new WheelEvent('wheel', e));
  }, { passive: false });
  return el;
}

export function render() {
  const items = visible();
  world.htmlElementsData(cluster(items, RADII[Math.max(state.tier, 0)]));
  $('stats').textContent = `${items.length.toLocaleString()} tournaments shown`;
}