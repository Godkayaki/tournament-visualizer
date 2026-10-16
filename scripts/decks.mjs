// Card lists of the decks, for the "Spicy cards" tab of the commander view.
//
// TopDeck returns, for every player, `deckObj` (structured: { Commanders: {...}, Mainboard: {...} }, one key per card name) and the
// decklist as text ("~~Commanders~~\n1 Card\n~~Mainboard~~\n1 Card ..."). We read the mainboard from deckObj and fall back to the text.
// Basic lands are left out: every deck plays them, so they say nothing about a deck.
//
// The raw lists are kept per tournament in .cache/decks/<f>.json (outside site/, so they are not published; the deploy workflow caches
// that folder next to site/data). Each file has its own card dictionary so it stands alone:
//   { n: ["Card A", "Card B", ...], d: { "<player id>": [indexes into n, ...] } }
// scripts/build-meta.mjs turns them into the per-commander files the browser reads (data/s/<commander>.json).

const BASIC = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;
const clean = (s) => String(s).replace(/^\d+x?\s+/, '').replace(/\s*[(\[].*$/, '').trim();

export function cardsOf(p) {
  let names = [];
  const main = p.deckObj?.Mainboard;
  if (main && typeof main === 'object') names = Object.keys(main);
  if (!names.length) {
    const m = /~~Mainboard~~\r?\n([\s\S]*?)(?:\r?\n~~|$)/.exec(p.decklist || '');
    if (m) names = m[1].split(/\r?\n/).map(clean);
  }
  return [...new Set(names.map((n) => String(n).trim()).filter((n) => n && !BASIC.test(n)))];
}

// The file content for one tournament's standings, or null when none of its players has a readable card list
export function encodeDecks(standings) {
  const n = [], at = new Map(), d = {};
  for (const p of standings) {
    if (!p.id) continue;
    const cards = cardsOf(p);
    if (cards.length < 10) continue; // a link or a partial list: not a decklist we can learn anything from
    d[p.id] = cards.map((c) => { if (!at.has(c)) { at.set(c, n.length); n.push(c); } return at.get(c); });
  }
  return Object.keys(d).length ? { n, d } : null;
}
