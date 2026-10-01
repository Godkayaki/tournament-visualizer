// If topdeck's deck URL pattern differs, change it here.
const deckUrl = (tid, playerId) => `https://topdeck.gg/deck/${tid}/${playerId}`;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const place = (t) => [t.c, t.s].filter(Boolean).join(', ') || 'Unknown location';

const state = { minPlayers: 50, months: 6 }; // defaults; must match the .on buttons in index.html
let all = [];
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
      world.polygonsData((await r.json()).features);
      return;
    } catch { /* try next */ }
  }
  console.warn('Could not load country borders');
})();

world.renderer().setPixelRatio(Math.min(devicePixelRatio, 1.5)); // big win on hi-dpi screens
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
  return el;
}

function visible() {
  const cutoff = state.months ? Date.now() / 1000 - state.months * 30.44 * 86400 : 0;
  return all.filter((t) => t.p >= state.minPlayers && t.d >= cutoff);
}

function render() {
  const items = visible();
  world.htmlElementsData(cluster(items, RADII[Math.max(tier, 0)]));
  $('stats').textContent = `${items.length.toLocaleString()} tournaments shown. Drag to rotate, scroll to zoom, click a bubble.`;
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
  $('area').hidden = true;
  render();
});

function showArea(items) {
  const list = [...items].sort((a, b) => b.d - a.d);
  const cities = [...new Set(list.map((t) => t.c).filter(Boolean))];
  $('area-title').textContent = `${list.length} tournament${list.length > 1 ? 's' : ''}` + (cities.length ? ` near ${cities.slice(0, 2).join(' / ')}` : '');
  $('area-list').innerHTML = list.map((t, i) =>
    `<li><button data-i="${i}">${esc(t.n)}<div class="sub">${fmtDate(t.d)} · <span class="loc">${esc(place(t))}</span> · ${t.p} players</div></button></li>`).join('');
  $('area-list').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) openTournament(list[+b.dataset.i]);
  };
  $('area').hidden = false;
}

const artReq = fetch('data/art.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const MEDAL = ['🥇', '🥈', '🥉'];
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

async function openTournament(t) {
  $('m-title').textContent = t.n;
  $('m-meta').textContent = `${fmtDate(t.d)} · ${place(t)} · ${t.p} players · ${t.sw} Swiss rounds${t.tc ? ` · top ${t.tc}` : ''}`;
  $('m-bracket').href = `https://topdeck.gg/bracket/${encodeURIComponent(t.id)}`;
  $('m-banner').style.removeProperty('--banner-art');
  $('m-list').innerHTML = '<li class="msg">Loading…</li>';
  $('m-scroll').scrollTop = 0;
  $('modal').hidden = false;
  try {
    const [rows, art] = await Promise.all([fetch(`data/t/${t.f}.json`).then((r) => r.json()), artReq]);
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
  if (c) $(c.dataset.close).hidden = true;
  else if (e.target === $('modal')) $('modal').hidden = true;
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').hidden = true; });