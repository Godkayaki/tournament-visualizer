// Looks up, on Moxfield, the commanders of the decks that players submitted as a Moxfield link. Run it from your own computer:
//
//   $env:MOXFIELD_USER_AGENT = "<the user agent Moxfield gave you>"      (PowerShell; never put it in a file or in the repository)
//   node scripts/backfill-moxfield.mjs probe https://www.moxfield.com/decks/<id>   try ONE deck and show what the API returns
//   node scripts/backfill-moxfield.mjs                                              look up every link not looked up yet
//   LIMIT=500 node scripts/backfill-moxfield.mjs                                    ...but at most 500 in this run
//
// Needs the deck links: run `FULL=1 node scripts/fetch-data.mjs` first (it writes .cache/links/). Safe to stop (Ctrl+C) and run again:
// progress is saved every 50 decks and nothing already looked up is repeated. Results go to scripts/data/moxfield-commanders.json,
// which you commit. See moxfield.mjs for why this is not done by the GitHub Action.
//
// Moxfield's rules: 1 request per second at most (a firewall bans the IP and revokes the user agent otherwise), the user agent is a secret,
// and nothing built from the data may be paid. This script waits 1.2 s between requests, stops at the first sign of a block, and never
// prints the user agent.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LINKS, deckIdOf, loadCache, saveCache, record, extractCommanders } from './moxfield.mjs';

const UA = process.env.MOXFIELD_USER_AGENT;
if (!UA) { console.error('Set MOXFIELD_USER_AGENT first (see the top of this file).'); process.exit(1); }
const API = (process.env.MOXFIELD_API || 'https://api2.moxfield.com/v3/decks/all').replace(/\/$/, '');
const GAP = 1200; // ms between the start of two requests (the limit is 1 per second, so there is a margin)
const LIMIT = +process.env.LIMIT || Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = Date.now(); // the first request also waits: another run (e.g. the probe) may have just made one
async function get(id) {
  const wait = last + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`${API}/${id}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  const json = /json/i.test(res.headers.get('content-type') || '') ? await res.json().catch(() => null) : null;
  return { status: res.status, json };
}

// ---- probe: one deck, shows the shape of the answer (without ever showing the user agent) ----
if (process.argv[2] === 'probe') {
  const id = deckIdOf(process.argv[3]) || process.argv[3];
  if (!id) { console.error('Give a Moxfield deck link or id'); process.exit(1); }
  // Checks on the user agent that never reveal it: a stray quote, space or line break is the usual reason for a block
  const odd = /^["'\s]|["'\s]$|[\r\n]/.test(UA);
  console.log(`user agent: ${UA.length} characters${odd ? ', WARNING: it starts or ends with a quote or space, or has a line break' : ''}${/MoxKey/i.test(UA) ? '' : ', WARNING: it does not contain "MoxKey"'}`);
  console.log(`GET ${API}/${id}`);
  const res = await fetch(`${API}/${id}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  console.log('HTTP', res.status, type || '(no content-type)', json ? '' : '(not JSON)');
  for (const h of ['server', 'cf-ray', 'cf-mitigated', 'retry-after']) if (res.headers.get(h)) console.log(`${h}: ${res.headers.get(h)}`);
  if (json) {
    console.log('top-level keys:', Object.keys(json).join(', '));
    if (json.boards) console.log('boards:', Object.keys(json.boards).join(', '));
    const { names, recognized } = extractCommanders(json);
    console.log('recognized:', recognized, ' commanders found:', names.join(' / ') || '(none)');
    if (!recognized) console.log('The answer has a shape this script does not know: send me the keys above.');
  } else {
    console.log('start of the answer:', text.replace(/\s+/g, ' ').slice(0, 300));
  }
  await sleep(200); // lets the connection close before Node exits (an immediate exit can crash it on Windows)
  process.exit(0);
}

// ---- the ids still to look up, newest tournaments first ----
let files;
try { files = (await readdir(LINKS)).filter((f) => f.endsWith('.json')); }
catch { console.error('No .cache/links/ yet: run `FULL=1 node scripts/fetch-data.mjs` first.'); process.exit(1); }
let dates = new Map();
try { for (const t of JSON.parse(await readFile(fileURLToPath(new URL('../site/data/tournaments.json', import.meta.url)), 'utf8')).tournaments) dates.set(`${t.f}.json`, t.d); } catch { /* order by name then */ }
files.sort((a, b) => (dates.get(b) ?? 0) - (dates.get(a) ?? 0));

const cache = await loadCache();
const todo = [], queued = new Set();
for (const f of files) {
  for (const id of Object.values(JSON.parse(await readFile(LINKS + f, 'utf8')))) {
    if (id in cache.ids || queued.has(id)) continue;
    queued.add(id); todo.push(id);
  }
}
const total = Math.min(todo.length, LIMIT);
console.log(`${Object.keys(cache.ids).length} decks already looked up, ${todo.length} to go${total < todo.length ? ` (this run: ${total})` : ''}. About ${Math.ceil(total * GAP / 60000)} minutes.`);

let done = 0, found = 0, gone = 0, unknownShape = 0, weak = 0, failures = 0, stopReason = '';
const started = Date.now();
const save = () => saveCache(cache);
process.on('SIGINT', async () => { await save(); console.log(`\nStopped. Saved ${done} lookups.`); process.exit(0); });

for (const id of todo.slice(0, total)) {
  let r;
  try { r = await get(id); } catch (e) { failures++; if (failures >= 5) { stopReason = `5 failed requests in a row (${e.cause?.code || e.message})`; break; } continue; }
  if (r.status === 429) { stopReason = 'Moxfield answered 429 (rate limit). Waiting before trying again is up to you; do not hurry.'; break; }
  if (!r.json && r.status !== 404 && r.status !== 410) { stopReason = `Non-JSON answer (HTTP ${r.status}): this looks like a firewall block. Stopping so the user agent is not revoked.`; break; }
  if (r.status >= 500) { failures++; if (failures >= 5) { stopReason = `HTTP ${r.status} five times in a row`; break; } continue; }
  failures = 0;
  if (r.status === 404 || r.status === 410) { record(cache, id, null); gone++; weak = 0; }
  else if (r.status === 401 || r.status === 403) { record(cache, id, null); gone++; if (++weak >= 10) { stopReason = '10 answers of 401/403 in a row: probably blocked, not private decks.'; break; } }
  else {
    weak = 0;
    const { names, recognized } = extractCommanders(r.json);
    if (!recognized) { if (++unknownShape >= 3) { stopReason = 'The answers have an unknown shape (the API may have changed). Run the probe command and send me its output.'; break; } continue; }
    unknownShape = 0;
    record(cache, id, names);
    names.length ? found++ : gone++;
  }
  done++;
  if (done % 50 === 0) {
    await save();
    const per = (Date.now() - started) / done;
    console.log(`${done}/${total}  with commander: ${found}, gone/none: ${gone}  ~${Math.ceil(per * (total - done) / 60000)} min left`);
  }
}
await save();
console.log(`\nDone: ${done} lookups (${found} with a commander, ${gone} gone or without one). ${Object.keys(cache.ids).length} decks in scripts/data/moxfield-commanders.json.`);
if (stopReason) { console.log(`STOPPED: ${stopReason}`); process.exitCode = 2; }
else if (todo.length > total) console.log('Run it again to continue.');
else console.log('Everything is looked up. Run `node scripts/fetch-data.mjs` (or the Action) to put the commanders in the data, and commit scripts/data/moxfield-commanders.json.');
