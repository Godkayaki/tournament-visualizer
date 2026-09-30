// If topdeck's deck URL pattern differs, change it here.
const deckUrl = (tid, playerId) => `https://topdeck.gg/deck/${tid}/${playerId}`;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const place = (t) => [t.c, t.s].filter(Boolean).join(', ') || 'Unknown location';

// Hex bin resolution follows zoom: coarse from far away, finer as you get close.
const resFor = (alt) => (alt > 1.6 ? 3 : alt > 0.7 ? 4 : 5);
let res = 3;

const world = Globe()($('globe'))
  .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
  .atmosphereColor('#5b8cff')
  .hexBinPointLat('lat')
  .hexBinPointLng('lng')
  .hexBinPointWeight(() => 1)
  .hexBinResolution(res)
  .hexMargin(0.2)
  .hexTopColor((d) => heat(d.sumWeight))
  .hexSideColor((d) => heat(d.sumWeight))
  .hexAltitude((d) => Math.min(0.3, 0.01 + d.sumWeight * 0.004))
  .hexLabel((d) => `<b>${d.points.length}</b> tournament${d.points.length > 1 ? 's' : ''}`)
  .onHexClick(showArea);

// yellow (few) -> red (many)
function heat(n) {
  const t = Math.min(1, Math.log10(n + 1) / 2);
  return `hsl(${48 - 48 * t}, 95%, ${62 - 10 * t}%)`;
}

world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.35;
world.controls().addEventListener('start', () => (world.controls().autoRotate = false));
world.onZoom(({ altitude }) => {
  const r = resFor(altitude);
  if (r !== res) { res = r; world.hexBinResolution(r); }
});
addEventListener('resize', () => world.width(innerWidth).height(innerHeight));

fetch('data/tournaments.json')
  .then((r) => r.json())
  .then(({ tournaments }) => {
    world.hexBinPointsData(tournaments);
    const years = tournaments.length ? `${new Date(tournaments.at(-1).d * 1000).getFullYear()}–${new Date(tournaments[0].d * 1000).getFullYear()}` : '';
    $('stats').textContent = `${tournaments.length.toLocaleString()} tournaments ${years}. Drag to rotate, scroll to zoom, click a column.`;
  })
  .catch(() => ($('stats').textContent = 'Could not load tournament data. Run the fetch script first.'));

function showArea(hex) {
  const list = [...hex.points].sort((a, b) => b.d - a.d);
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
addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('modal').hidden = true; } });
