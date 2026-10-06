// Geography: country borders, and naming an area ("Barcelona, Spain") from the tournaments in it.
import { state } from './state.js';

// Country borders: local file first (drop a countries.geojson into site/static/ for offline/hi-res), then CDNs.
// Returns the GeoJSON features, or [] if none could be loaded.
export async function loadCountries() {
  const urls = [
    'static/countries.geojson',
    'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson',
    'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson',
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      return (await r.json()).features;
    } catch { /* try next */ }
  }
  console.warn('Could not load country borders');
  return [];
}

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
  if (!state.countries.length) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (countryCache.has(key)) return countryCache.get(key);
  let name = null;
  for (const f of state.countries) {
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
export function areaName(list) {
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