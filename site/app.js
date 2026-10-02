// If topdeck's deck URL pattern differs, change it here.
const deckUrl = (tid, playerId) => `https://topdeck.gg/deck/${tid}/${playerId}`;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const place = (t) => [t.c, t.s].filter(Boolean).join(', ') || 'Unknown location';

const state = { minPlayers: 30, months: 6 }; // defaults; must match the .on buttons in index.html
let all = [];
let countries = []; // country polygons (GeoJSON features): drawn as borders and used to name areas
let tier = -1;

// Cluster radius in degrees for each zoom tier (camera altitude in globe radii).
const RADII = [5, 3, 1.6, 0.8, 0.3, 0.08]; // smaller = more, less-merged bubbles
const tierOf = (alt) => (alt > 2.2 ? 0 : alt > 1.6 ? 1 : alt > 1.0 ? 2 : alt > 0.6 ? 3 : alt > 0.3 ? 4 : 5);

const world = Globe()($('globe'))
  .backgroundColor('rgba(0,0,0,0)') // transparent: the starfield lives in #stars behind the canvas
  .atmosphereColor('#19f5d8')
  .atmosphereAltitude(0.16)
  .enablePointerInteraction(false) // we only use DOM bubbles; skips costly raycasting on borders
  .polygonCapColor(() => 'rgba(0,0,0,0)')
  .polygonSideColor(() => 'rgba(0,0,0,0)')
  .polygonStrokeColor(() => '#19f5d8')
  .polygonAltitude(0.003)
  .polygonsTransitionDuration(0)
  .htmlLat('lat')
  .htmlLng('lng')
  .htmlAltitude(0.004)
  .htmlTransitionDuration(0)
  .htmlElement(bubble);

// Plain dark sphere: no terrain texture, only the neon borders
const mat = world.globeMaterial();
mat.color.set('#000000');   // flat fill: the color comes only from the emissive channel
mat.emissive.set('#0d1117');
mat.specular.set('#000000');

// Country borders: local file first (drop a countries.geojson next to index.html for offline/hi-res), then CDNs
(async () => {
  const urls = [
    'countries.geojson',
    'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson',
    'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson',
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      countries = (await r.json()).features;
      world.polygonsData(countries);
      return;
    } catch { /* try next */ }
  }
  console.warn('Could not load country borders');
})();

world.renderer().setPixelRatio(Math.min(devicePixelRatio, 1.5)); // big win on hi-dpi screens
world.pointOfView({ lat: 38, lng: -39, altitude: 2.5 }); // initial view: mid-Atlantic, between Spain and the US
world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.2;
// Auto-rotate: stops on any drag/zoom, resumes after IDLE_MS of no movement,
// but only while looking at the bare globe (no bubble list or tournament popup open).
const IDLE_MS = 5000;
let lastActivity = Date.now();
const ctl = world.controls();
ctl.addEventListener('start', () => { ctl.autoRotate = false; lastActivity = Date.now(); });
ctl.addEventListener('end', () => { lastActivity = Date.now(); });
setInterval(() => {
  if (!$('area').hidden || !$('modal').hidden) { // a bubble list or popup is open: stay still, restart the idle clock
    ctl.autoRotate = false;
    lastActivity = Date.now();
  } else if (!ctl.autoRotate && Date.now() - lastActivity > IDLE_MS) {
    ctl.autoRotate = true; // same speed as the initial spin
  }
}, 300);
// ---- Starfield: seamless tiles drawn at device resolution, shifted slightly as the camera moves (parallax) ----
const TILE = 1024;
function starTile(count, maxR, seed) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.width = cv.height = TILE * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; // seeded: same sky every load
  for (let i = 0; i < count; i++) {
    const x = rnd() * TILE, y = rnd() * TILE;
    const r = 0.5 + rnd() ** 3 * maxR; // mostly tiny, a few bigger
    const a = 0.4 + rnd() * 0.6;
    const t = rnd();
    const col = t < 0.15 ? '170,200,255' : t < 0.3 ? '255,226,185' : '255,255,255';
    for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) { // wrap so the tile repeats seamlessly
      const px = x + dx, py = y + dy;
      if (px < -12 || px > TILE + 12 || py < -12 || py > TILE + 12) continue;
      if (r > 1.1) { // soft glow on the brighter stars
        const gr = g.createRadialGradient(px, py, 0, px, py, r * 4);
        gr.addColorStop(0, `rgba(${col},${a * 0.35})`);
        gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr;
        g.fillRect(px - r * 4, py - r * 4, r * 8, r * 8);
      }
      g.fillStyle = `rgba(${col},${a})`;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return `url(${cv.toDataURL()})`;
}
$('stars-far').style.backgroundImage = starTile(260, 0.7, 12345);
$('stars-near').style.backgroundImage = starTile(70, 1.6, 98765);
const starLayers = [[$('stars-far'), 0.5], [$('stars-near'), 1.2]];
const wrap = (v) => -(((v % TILE) + TILE) % TILE);
function parallax() {
  const { lat, lng } = world.pointOfView();
  for (const [el, k] of starLayers) el.style.transform = `translate3d(${wrap(lng * k * 6)}px, ${wrap(lat * k * 4)}px, 0)`;
}
world.controls().addEventListener('change', parallax);
parallax();

world.onZoom(({ altitude }) => {
  const t = tierOf(altitude);
  if (t !== tier) { tier = t; render(); }
});
addEventListener('resize', () => world.width(innerWidth).height(innerHeight));

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
const heat = (n) => { const t = Math.min(1, Math.log10(n) / 1.6); return `hsl(${46 - 46 * t}, 95%, ${60 - 8 * t}%)`; };

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

function visible() {
  const cutoff = state.months ? Date.now() / 1000 - state.months * 30.44 * 86400 : 0;
  return all.filter((t) => t.p >= state.minPlayers && t.d >= cutoff);
}

function render() {
  const items = visible();
  world.htmlElementsData(cluster(items, RADII[Math.max(tier, 0)]));
  $('stats').textContent = `${items.length.toLocaleString()} tournaments shown`;
}

// ---- cEDH-only filter, by tournament name (TopDeck's API has no bracket field) ----
// A name matching KEEP is always shown. Otherwise a name matching any BLOCK pattern is hidden.
// Edit these lists freely: it's a browser-side filter, so just refresh the page.
const KEEP = [/\bc\s?edh/i, /bracket\s*5\b/i];
const BLOCK = [/bracket\s*[1-4]\b/i,
  /b\s*[1-4]\b/i, 
  /budget/i, 
  /casual/i, 
  /precon/i, 
  /pauper/i, 
  /commander\sparty/i, 
  /infrefest/i, 
  /gg\scommander\sclash/i, 
  /commander\s500/i, 
  /c500/i, 
  /pre-con/i, 
  /bcedh/i, 
  /2\scabezas\s/i, 
  /2\shead\s/i, 
  /Liga\sMesão\s/i, 
];
const blockedBy = (name) => (KEEP.some((r) => r.test(name)) ? null : BLOCK.find((r) => r.test(name)) || null);

fetch('data/tournaments.json')
  .then((r) => r.json())
  .then(({ tournaments }) => {
    const hidden = [];
    all = tournaments.filter((t) => {
      const rule = blockedBy(t.n);
      if (rule) hidden.push(`${t.n}   [${rule.source}]`);
      return !rule;
    });
    console.groupCollapsed(`[EDHGlobe] ${hidden.length} of ${tournaments.length} tournaments hidden by name filter`);
    hidden.forEach((h) => console.log(h));
    console.groupEnd();
    tier = tierOf(world.pointOfView().altitude);
    render();
  })
  .catch(() => ($('stats').textContent = 'Could not load tournament data. Run the fetch script first.'));

$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const g = b.parentElement;
  g.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
  b.classList.add('on');
  b.setAttribute('aria-pressed', 'true');
  state[g.dataset.key] = +b.dataset.v;
  closeArea();
  render();
});

// ---- Naming an area from its tournaments ----
// Which country a point is in: point-in-polygon on the border data we already load (offline, consistent names)
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPoly = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole));
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const bboxOf = (g) => {
  const b = [180, 90, -180, -90];
  for (const p of polysOf(g)) for (const [x, y] of p[0]) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  return b;
};
const countryCache = new Map();
function countryAt(lat, lng) {
  if (!countries.length) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (countryCache.has(key)) return countryCache.get(key);
  let name = null;
  for (const f of countries) {
    const bb = f.__bb || (f.__bb = bboxOf(f.geometry));
    if (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]) continue;
    if (polysOf(f.geometry).some((p) => inPoly(lng, lat, p))) { name = f.properties.NAME || f.properties.ADMIN || f.properties.name || null; break; }
  }
  countryCache.set(key, name);
  return name;
}

const tally = (values) => {
  const m = new Map();
  for (const v of values) if (v) { const k = v.trim().toLowerCase(); const e = m.get(k) || { label: v.trim(), n: 0 }; e.n++; m.set(k, e); }
  return [...m.values()].sort((a, b) => b.n - a.n);
};

// One city -> "Barcelona, Spain"; a tight group -> "Barcelona area, Spain"; one country -> "Catalonia, Spain" if one
// region dominates, else "Spain"; several countries -> "Spain, France & 3 more".
function areaName(list) {
  const cities = tally(list.map((t) => t.c));
  const regions = tally(list.map((t) => t.s));
  const nations = tally(list.map((t) => countryAt(t.lat, t.lng)));
  const lats = list.map((t) => t.lat), lngs = list.map((t) => t.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lngs) - Math.min(...lngs)) * Math.cos((midLat * Math.PI) / 180));
  const country = nations[0]?.label;
  const withCountry = (s) => (country ? `${s}, ${country}` : s);

  if (nations.length > 1) {
    const [a, b, ...rest] = nations.map((x) => x.label);
    return rest.length === 0 ? `${a} & ${b}` : rest.length === 1 ? `${a}, ${b} & ${rest[0]}` : `${a}, ${b} & ${rest.length} more`;
  }
  if (cities.length === 1) return withCountry(cities[0].label);
  if (span < 1.5 && cities.length) return withCountry(`${cities[0].label} area`);
  if (country) return regions.length && regions[0].n / list.length >= 0.6 ? `${regions[0].label}, ${country}` : country;
  // borders not loaded: fall back to the most common places
  return cities.slice(0, 2).map((c) => c.label).join(' / ') || 'Unknown location';
}

// Open/close for the tournament list and the tournament popup: CSS animates them (see "open/close" in style.css);
// closing waits for the animation to finish before the element is really hidden.
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function openPanel(el) {
  clearTimeout(el._closeTimer);
  el.classList.remove('closing');
  el.hidden = false;
}
function closePanel(el, ms = 180) {
  if (el.hidden || el.classList.contains('closing')) return;
  if (reduceMotion()) { el.hidden = true; return; }
  el.classList.add('closing');
  el._closeTimer = setTimeout(() => { el.hidden = true; el.classList.remove('closing'); }, ms);
}
const openArea = () => openPanel($('area'));
const closeArea = () => { hidePeek(); closePanel($('area')); };
const openModal = () => openPanel($('modal'));
const closeModal = () => closePanel($('modal'));

let areaItems = [];

function showArea(items) {
  areaItems = items;
  $('area-title').innerHTML = `${esc(areaName(items))}<small style="display:block;margin-top:2px;font-size:13px;font-weight:400;color:var(--dim)">${items.length} tournament${items.length > 1 ? 's' : ''} found</small>`;
  $('order-by').value = 'date'; // every new list starts from the most recent...
  $('order-dir').value = 'desc'; // ...first
  syncDirLabels();
  $('order').hidden = items.length < 2; // nothing to sort with a single tournament
  renderList();
  openArea();
}

// The direction dropdown says what it means for the chosen order: dates or player counts
const DIR_LABELS = { date: ['Newest', 'Oldest'], players: ['Most', 'Fewest'] };
function syncDirLabels() {
  const [desc, asc] = DIR_LABELS[$('order-by').value];
  $('order-dir').options[0].text = desc;
  $('order-dir').options[1].text = asc;
}

function renderList() {
  hidePeek();
  const byPlayers = $('order-by').value === 'players';
  const dir = $('order-dir').value === 'asc' ? -1 : 1; // 1 = descending (most recent / most players first)
  const list = [...areaItems].sort(byPlayers ? (a, b) => dir * (b.p - a.p) || b.d - a.d : (a, b) => dir * (b.d - a.d)); // ties: most recent first
  shownList = list;
  $('area-list').innerHTML = list.map((t, i) =>
    `<li><button data-i="${i}">${esc(t.n)}<div class="sub">${fmtDate(t.d)} · <span class="loc">${esc(place(t))}</span> · ${t.p} players</div></button></li>`).join('');
  $('area-list').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { hidePeek(); openTournament(list[+b.dataset.i]); }
  };
  $('area-list').scrollTop = 0;
  preloadRows(0, 10);
}
$('order-by').addEventListener('change', () => { $('order-dir').value = 'desc'; syncDirLabels(); renderList(); }); // a new order always starts at Newest / Most
$('order-dir').addEventListener('change', renderList);

const artReq = fetch('data/art.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const MEDAL = ['🥇', '🥈', '🥉'];
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// ---- Winner preview: hovering a tournament in the list shows its winning commander ----
// 'row'  = the winner's art fades in as the background of the hovered tournament (no extra info)
// 'card' = a floating card to the left of the list with art, commander and winner
const HOVER_PREVIEW = 'row';
// Standings load lazily on hover and are cached, so opening the leaderboard afterwards is instant too.
const rowsCache = new Map();
function getRows(t) {
  if (!rowsCache.has(t.f)) {
    rowsCache.set(t.f, fetch(`data/t/${t.f}.json`).then((r) => r.json()).catch((err) => { rowsCache.delete(t.f); throw err; }));
  }
  return rowsCache.get(t.f);
}

let shownList = [], peekFor = null, peekTimer;
function hidePeek() {
  clearTimeout(peekTimer);
  peekFor?.querySelector('.row-art')?.classList.remove('on');
  peekFor = null;
  $('peek').classList.remove('on');
}

const picsOf = (names, art) => names.map((n) => (art[n] || [])[0]).filter(Boolean).slice(0, 2);

// Preload winner art for the rows the mouse is likely to reach next, so the hover shows up instantly.
// Skipped on touch screens (no hover there) and staggered so it doesn't compete with other requests.
let artMap = {};
artReq.then((m) => { artMap = m; });
const preloaded = new Set();
function preloadArt(t) {
  if (!t?.w) return;
  for (const url of picsOf(t.w, artMap)) {
    if (preloaded.has(url)) continue;
    preloaded.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}
function preloadRows(from, count) {
  if (!matchMedia('(hover: hover)').matches) return;
  shownList.slice(from, from + count).forEach((t, i) => setTimeout(() => preloadArt(t), i * 60));
}

// 'row' mode: put the winner's art behind the hovered tournament and fade it in (the row keeps its size and text)
function showRowArt(btn, pics) {
  if (!pics.length) return;
  let el = btn.querySelector('.row-art');
  if (!el) {
    el = document.createElement('span');
    el.className = 'row-art';
    el.innerHTML = pics.map((u) => `<img src="${esc(u)}" alt="" fetchpriority="high" decoding="async">`).join('');
    btn.prepend(el);
  }
  void el.offsetWidth; // flush styles so the fade-in runs even on a freshly added element
  const img = el.querySelector('img');
  const go = () => { if (peekFor === btn) el.classList.add('on'); };
  if (img.complete) go(); else img.addEventListener('load', go, { once: true }); // fade in once the art is there, no pop-in
}
async function showPeek(btn) {
  const t = shownList[+btn.dataset.i];
  if (!t) return;
  const art = await artReq;
  if (HOVER_PREVIEW === 'row' && t.w) { // winners come with the index (see addWinners in fetch-data.mjs): no request needed
    if (peekFor === btn && t.w.length) showRowArt(btn, picsOf(t.w, art));
    return;
  }
  let rows;
  try { rows = await getRows(t); } catch { return; } // older data without winners, or 'card' mode: read the standings file
  if (peekFor !== btn) return; // the mouse moved on while loading
  const w = rows[0]; // the API lists standings in placement order, so the first row is the winner
  if (!w || !w.c.length) return; // no commander submitted: nothing to show, the list works as before
  const pics = picsOf(w.c, art);
  if (HOVER_PREVIEW === 'row') return showRowArt(btn, pics);
  $('peek-art').hidden = !pics.length;
  $('peek-art').innerHTML = pics.map((u) => `<img src="${esc(u)}" alt="">`).join('');
  $('peek-cmd').textContent = w.c.join(' / ');
  $('peek-player').textContent = `${w.n || 'Unknown Player'} · ${w.w}-${w.l}-${w.d}`;
  const peek = $('peek'), pr = $('area').getBoundingClientRect(), br = btn.getBoundingClientRect();
  const left = pr.left - 12 - peek.offsetWidth;
  if (left < 8) return; // not enough room beside the list (small screens)
  const minTop = innerWidth <= 900 ? 120 : 72; // stay below the filter bar
  peek.style.left = `${left}px`;
  peek.style.top = `${Math.max(minTop, Math.min(innerHeight - peek.offsetHeight - 8, br.top + br.height / 2 - peek.offsetHeight / 2))}px`;
  peek.classList.add('on');
}
$('area-list').addEventListener('mouseover', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b || b === peekFor) return;
  hidePeek();
  peekFor = b;
  const i = +b.dataset.i;
  peekTimer = setTimeout(() => showPeek(b), shownList[i]?.w ? 40 : 120); // short delay so skimming across rows stays calm
  preloadRows(i + 1, 3);
});
$('area-list').addEventListener('mouseleave', hidePeek);
$('area-list').addEventListener('scroll', hidePeek);

async function openTournament(t) {
  $('m-title').textContent = t.n;
  $('m-meta').textContent = `${fmtDate(t.d)} · ${place(t)} · ${t.p} players · ${t.sw} Swiss rounds${t.tc ? ` · top ${t.tc}` : ''}`;
  $('m-bracket').href = `https://topdeck.gg/bracket/${encodeURIComponent(t.id)}`;
  $('m-banner').style.removeProperty('--banner-art');
  $('m-list').innerHTML = '<li class="msg">Loading…</li>';
  $('m-scroll').scrollTop = 0;
  openModal();
  try {
    const [rows, art] = await Promise.all([getRows(t), artReq]);
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

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) { if (c.dataset.close === 'area') closeArea(); else closeModal(); }
  else if (e.target === $('modal')) closeModal();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Clicking empty map or starry background closes the tournament list (but not after dragging the globe, and never when a bubble is clicked)
let pressAt = null;
addEventListener('pointerdown', (e) => { pressAt = [e.clientX, e.clientY]; }, true);
document.addEventListener('click', (e) => {
  if (!e.target.closest('#globe') || e.target.closest('.bubble')) return;
  if (pressAt && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 5) return; // it was a drag
  closeArea();
});

// Touch screens have no scroll wheel: say "pinch" in the hint under the title
if (matchMedia('(hover: none)').matches) document.querySelector('#title p').textContent = 'Drag to rotate, pinch to zoom.';