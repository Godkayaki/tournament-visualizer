// If topdeck's deck URL pattern differs, change it here.
const deckUrl = (tid, playerId) => `https://topdeck.gg/deck/${tid}/${playerId}`;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const place = (t) => [t.c, t.s].filter(Boolean).join(', ') || 'Unknown location';

const state = { minPlayers: 50, months: 3 }; // defaults; must match the .on buttons in index.html
let all = [];
let tier = -1;

// Cluster radius in degrees for each zoom tier (camera altitude in globe radii).
const RADII = [14, 8, 4, 1.8, 0.7, 0.15];
const tierOf = (alt) => (alt > 2.2 ? 0 : alt > 1.6 ? 1 : alt > 1.0 ? 2 : alt > 0.6 ? 3 : alt > 0.3 ? 4 : 5);

const world = Globe()($('globe'))
  .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
  .atmosphereColor('#7fb2ff')
  .htmlLat('lat')
  .htmlLng('lng')
  .htmlAltitude(0.004)
  .htmlTransitionDuration(0)
  .htmlElement(bubble);

world.renderer().setPixelRatio(Math.min(devicePixelRatio, 1.5)); // big win on hi-dpi screens
world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.35;
world.controls().addEventListener('start', () => (world.controls().autoRotate = false));
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

const heat = (n) => { const t = Math.min(1, Math.log10(n) / 1.6); return `hsl(${46 - 46 * t}, 95%, ${60 - 8 * t}%)`; };

function bubble(d) {
  const n = d.items.length;
  const size = 26 + Math.min(34, Math.log2(n) * 7);
  const el = document.createElement('button');
  el.className = 'bubble';
  el.textContent = n;
  el.title = `${n} tournament${n > 1 ? 's' : ''}`;
  el.style.cssText = `width:${size}px;height:${size}px;background:${heat(n)};color:${n < 10 ? '#1a1206' : '#fff'};font-size:${size > 40 ? 15 : 13}px`;
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

fetch('data/tournaments.json')
  .then((r) => r.json())
  .then(({ tournaments }) => {
    all = tournaments;
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
    `<li><button data-i="${i}">${esc(t.n)}<div class="sub">${fmtDate(t.d)} · ${esc(place(t))} · ${t.p} players</div></button></li>`).join('');
  $('area-list').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) openTournament(list[+b.dataset.i]);
  };
  $('area').hidden = false;
}

async function openTournament(t) {
  $('m-title').textContent = t.n;
  $('m-meta').textContent = `${fmtDate(t.d)} · ${place(t)} · ${t.p} players · ${t.sw} Swiss rounds${t.tc ? ` · top ${t.tc}` : ''}`;
  $('m-body').innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
  $('modal').hidden = false;
  try {
    const rows = await (await fetch(`data/t/${t.f}.json`)).json();
    $('m-body').innerHTML = rows.map((p, i) => {
      const url = deckUrl(t.id, p.i);
      const cmd = p.c.length
        ? p.c.map((c) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(c)}</a>`).join(' / ')
        : `<a href="${esc(url)}" target="_blank" rel="noopener">View list</a>`;
      return `<tr><td>${i + 1}</td><td>${esc(p.n)}</td><td>${cmd}</td><td>${p.w}-${p.l}-${p.d}</td></tr>`;
    }).join('');
  } catch {
    $('m-body').innerHTML = '<tr><td colspan="4">Could not load standings for this tournament.</td></tr>';
  }
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) $(c.dataset.close).hidden = true;
  else if (e.target === $('modal')) $('modal').hidden = true;
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').hidden = true; });
