// What does TopDeck return in `decklist` / `deckObj`, month by month? Run it when commanders are missing for a period:
//   node scripts/diagnose-decklists.mjs                       (one month every 3 months since 2023-01)
//   MONTHS=2024-03,2025-05 node scripts/diagnose-decklists.mjs
//   TID=2Msf62J6B4LNrDVjwBvK MONTHS=2024-03 node scripts/diagnose-decklists.mjs   (also print that tournament's raw players)
// It needs TOPDECK_API_KEY, like fetch-data.mjs, and writes nothing.
const KEY = process.env.TOPDECK_API_KEY;
if (!KEY) { console.error('Set TOPDECK_API_KEY first'); process.exit(1); }
const FORMAT = process.env.FORMAT || 'EDH';

const months = process.env.MONTHS ? process.env.MONTHS.split(',') : (() => {
  const out = [], d = new Date(Date.UTC(2023, 0, 1)), now = new Date();
  for (; d < now; d.setUTCMonth(d.getUTCMonth() + 3)) out.push(d.toISOString().slice(0, 7));
  return out;
})();

async function query(start, end) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://topdeck.gg/api/v2/tournaments', {
      method: 'POST',
      headers: { Authorization: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'Magic: The Gathering', format: FORMAT, start, end, columns: ['name', 'id', 'decklist', 'wins', 'draws', 'losses'] }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 429) { const j = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, (j.retryAfterSeconds || 30) * 1000 + 500)); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }
  throw new Error('rate limited');
}

const kind = (p) => {
  const dl = typeof p.decklist === 'string' ? p.decklist.trim() : '';
  const hasObj = !!(p.deckObj && p.deckObj.Commanders && Object.keys(p.deckObj.Commanders).length);
  if (hasObj) return 'deckObj with commanders';
  if (/~~Commanders~~/.test(dl)) return 'text with ~~Commanders~~';
  if (/^https?:\/\//i.test(dl)) { try { return 'link: ' + new URL(dl).hostname.replace(/^www\./, ''); } catch { return 'link: (unparsable)'; } }
  if (!dl && !p.deckObj) return 'empty';
  if (dl) return 'other text';
  return 'deckObj without commanders';
};

for (const m of months) {
  const [y, mo] = m.split('-').map(Number);
  const start = Math.floor(Date.UTC(y, mo - 1, 1) / 1000), end = Math.floor(Date.UTC(y, mo, 1) / 1000) - 1;
  let list;
  try { list = await query(start, end); } catch (e) { console.log(`${m}: ${e.message}`); continue; }
  const tally = new Map(); let players = 0, samples = [];
  for (const t of list) for (const p of t.standings || []) {
    players++;
    const k = kind(p); tally.set(k, (tally.get(k) || 0) + 1);
    if (samples.length < 2 && !k.startsWith('deckObj with') && !k.startsWith('text with') && !samples.some((s) => s.k === k)) samples.push({ k, decklist: String(p.decklist ?? '').slice(0, 120), deckObjKeys: p.deckObj ? Object.keys(p.deckObj) : null });
    if (process.env.TID && t.TID === process.env.TID) console.log(JSON.stringify({ TID: t.TID, name: t.tournamentName, player: p.name, decklist: p.decklist, deckObj: p.deckObj }, null, 1).slice(0, 1500));
  }
  console.log(`\n${m}: ${list.length} tournaments, ${players} players`);
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${(100 * n / players).toFixed(1).padStart(5)}%  ${k}`);
  for (const s of samples) console.log('  e.g.', JSON.stringify(s));
  await new Promise((r) => setTimeout(r, 2000));
}
