// Commanders of decks that players submitted as a Moxfield link (TopDeck only reads the card lists itself since June 2025).
//
// The lookups are slow on purpose (Moxfield allows 1 request per second) and need a private user agent that Moxfield issued, so they are
// NOT made by the GitHub Action. They are done once from your own computer with scripts/backfill-moxfield.mjs, which fills
// scripts/data/moxfield-commanders.json. That file is committed (it only holds public deck ids and commander names) and fetch-data.mjs uses it
// to fill in the commanders, so the Action never calls Moxfield and the user agent never leaves your machine.
//
// Layout of the cache file: { v: 1, sets: [["Commander A", "Commander B"], ...], ids: { "<moxfield deck id>": index into sets, or -1 } }
// -1 = looked up, but the deck is gone, private or has no commander: it is not tried again.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const CACHE_FILE = fileURLToPath(new URL('./data/moxfield-commanders.json', import.meta.url));
export const LINKS = fileURLToPath(new URL('../.cache/links/', import.meta.url)); // per tournament: { player id: moxfield deck id }, written by fetch-data.mjs

export const deckIdOf = (url) => /moxfield\.com\/decks\/([A-Za-z0-9_-]{6,})/i.exec(String(url ?? ''))?.[1] ?? null;

export async function loadCache() {
  try {
    const j = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    return { sets: Array.isArray(j.sets) ? j.sets : [], ids: j.ids && typeof j.ids === 'object' ? j.ids : {} };
  } catch { return { sets: [], ids: {} }; }
}

export async function saveCache(cache) {
  await mkdir(fileURLToPath(new URL('./data/', import.meta.url)), { recursive: true });
  // one id per line, so the file diffs and compresses well in git
  const lines = Object.entries(cache.ids).map(([id, i]) => `${JSON.stringify(id)}:${i}`).join(',\n');
  await writeFile(CACHE_FILE, `{"v":1,"sets":${JSON.stringify(cache.sets)},"ids":{\n${lines}\n}}\n`);
}

export const commandersOfDeck = (cache, id) => {
  const i = cache.ids[id];
  return Number.isInteger(i) && i >= 0 ? cache.sets[i] : null;
};

export function record(cache, id, names) {
  if (!names?.length) { cache.ids[id] = -1; return; }
  const key = JSON.stringify(names);
  let i = cache.sets.findIndex((s) => JSON.stringify(s) === key);
  if (i < 0) i = cache.sets.push(names) - 1;
  cache.ids[id] = i;
}

// Moxfield's API is undocumented and may change, so this accepts the shapes seen so far:
//   v3: { boards: { commanders: { cards: { "<id>": { card: { name } } } } } }      v2: { commanders: { "<name>": { card: { name } } } }
// `recognized` is false when the response has neither, so a changed API is noticed instead of being cached as "no commander".
export function extractCommanders(json) {
  const out = [];
  const cards = json?.boards?.commanders?.cards;
  if (cards && typeof cards === 'object') for (const v of Object.values(cards)) if (v?.card?.name) out.push(String(v.card.name));
  if (!out.length && json?.commanders && typeof json.commanders === 'object') {
    for (const [k, v] of Object.entries(json.commanders)) out.push(String(v?.card?.name || k));
  }
  return { names: [...new Set(out)], recognized: !!(json?.boards || json?.commanders) };
}

// Fills the commanders of the standings files (site/data/t/<f>.json) from the cache, for the players whose decks were links.
// Needs no network. Returns { patched, tournaments } counts.
export async function applyCache(OUT) {
  const cache = await loadCache();
  let files;
  try { files = await readdir(LINKS); } catch { return { patched: 0, tournaments: 0, links: 0 }; }
  let patched = 0, tournaments = 0, links = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    let map, rows;
    try {
      map = JSON.parse(await readFile(LINKS + file, 'utf8'));
      rows = JSON.parse(await readFile(`${OUT}t/${file}`, 'utf8'));
    } catch { continue; }
    let changed = 0;
    for (const row of rows) {
      const id = map[row.i];
      if (!id) continue;
      links++;
      if (row.c?.length) continue;
      const names = commandersOfDeck(cache, id);
      if (names) { row.c = names; changed++; }
    }
    if (changed) { await writeFile(`${OUT}t/${file}`, JSON.stringify(rows)); patched += changed; tournaments++; }
  }
  return { patched, tournaments, links };
}
