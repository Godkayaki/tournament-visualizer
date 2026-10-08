import { state } from './state.js';

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
export const blockedBy = (name) => (KEEP.some((r) => r.test(name)) ? null : BLOCK.find((r) => r.test(name)) || null);

// The name filter already ran (state.all); this applies a players and a period filter on top of it.
export function pick(minPlayers, months) {
  const cutoff = months ? Date.now() / 1000 - months * 30.44 * 86400 : 0;
  return state.all.filter((t) => t.p >= minPlayers && t.d >= cutoff);
}

// What the globe shows: the filter bar's choices.
export const visible = () => pick(state.minPlayers, state.months);