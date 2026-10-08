// Everything fetched from the site's own static files (data/ is generated at build time, content/ is edited by hand).

// The tournament index: { tournaments, generated, version }
export const loadTournaments = () =>
  fetch('data/tournaments.json', { cache: 'no-cache' }) // always revalidate, so a fresh deploy shows up without a hard refresh
    .then((r) => r.json());

// Commander name -> art URLs. Fetched once, on first use; a missing file just means no art.
let artPromise;
export const loadArt = () => (artPromise ??= fetch('data/art.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

// Regional metagame counts (built by scripts/build-meta.mjs). Fetched the first time the window opens; a failure can be retried.
let metaPromise;
export const loadMeta = () => (metaPromise ??= fetch('data/meta.json')
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .catch((err) => { metaPromise = null; throw err; }));

// Standings load lazily on hover and are cached, so opening the leaderboard afterwards is instant too.
const rowsCache = new Map();
export function getRows(t) {
  if (!rowsCache.has(t.f)) {
    rowsCache.set(t.f, fetch(`data/t/${t.f}.json`).then((r) => r.json()).catch((err) => { rowsCache.delete(t.f); throw err; }));
  }
  return rowsCache.get(t.f);
}

// ---- Featured tournaments: upcoming events added by hand in content/featured.json ----
// Each entry: { "name": "...", "location": "...", "date": "YYYY-MM-DD", "url": "https://topdeck.gg/...", "price": "€35" }
// Past events are dropped here (the day of the event still counts). Returns [] if the file is missing or invalid.
const dayTs = (iso) => { // "2026-11-14" -> local midnight, in seconds
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() / 1000 : NaN;
};
export async function loadFeatured() {
  try {
    const r = await fetch('content/featured.json', { cache: 'no-cache' }); // always revalidate, so an edit shows up without a hard refresh
    const list = r.ok ? await r.json() : [];
    const now = Date.now() / 1000;
    return (Array.isArray(list) ? list : [])
      .map((f) => ({ ...f, ts: dayTs(f?.date) }))
      .filter((f) => {
        const ok = f.name && Number.isFinite(f.ts) && /^https?:\/\//i.test(f.url || '');
        if (!ok) console.warn('[EDHGlobe] featured.json: skipped an entry (needs name, date as YYYY-MM-DD and an http(s) url)', f);
        return ok;
      })
      .filter((f) => f.ts + 86400 > now)
      .sort((a, b) => a.ts - b.ts); // soonest first
  } catch { return []; }
}