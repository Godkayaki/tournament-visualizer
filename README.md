# <img src="site/static/logo.svg" width="22"> **EDHGlobe** ─ Tournament data visualizer for **cEDH**

**3D globe of past cEDH tournaments (data from [TopDeck.gg](https://topdeck.gg), images from [Scryfall](https://scryfall.com/)) that brings regional metagame share and data to the table.**

## How it works

- `scripts/fetch-data.mjs` calls the TopDeck API at **build time** and writes `site/data/tournaments.json` (index) and `site/data/t/<tid>.json` (standings per tournament).
- Currently **filters out casual tournaments**, a big problem I personally had with [edhtop16](https://edhtop16.com) that I wanted to fix. It does this by basically blocking out specific keywords, kinda simple and breakable but as easily to revert;
```js
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
```
- The workflow runs on every push and daily at **05:00 AM UTC (12:00 AM EST)**.

## Run locally

```bash
git clone https://github.com/Godkayaki/tournament-visualizer
TOPDECK_API_KEY=your_key
node scripts/fetch-data.mjs # Node 18+
npx serve site
```
- You can get your `TOPDECK_API_KEY` at [Topdeck Dev](https://topdeck.gg/developers)
- Optional env vars: 
  - `START_DATE` (default `2023-01-01`)
  - `FORMAT` (default `EDH`).

## To-do list

- Tournaments without coordinates (online events) are skipped right now. My idea is to have a sepparate list that is somehow accesible (thinking about adding the moon and be clickable lol)
- Based on this I want to add local/regional meta information of what is being played where. This was the original idea but I needed the rest of the page first.
- Still reasearching for other cEDH platforms were tournaments are organized, to see if we can also add that data, these are the ones I'm currently looking at;
  - **Shuffleup** -> Still in beta, no api documentation visible, looks complicated.
  - **God of commander** -> Japanese cEDH tournament from Hareruya, really difficult to actually get the information.
- Set initial view to the middle of the Atlantic, between Spain and the US
- Add small color next to tournament indicating the tiers of each tournament. This will be based of the topdeck ivnitational, but it's not just for the tournaments within the invitational, it will also mark tournaments outside;
  - Bronze -> +16 players
  - Silver -> +30 players
  - Gold -> +50 players
  - Platinum -> +100 players
  - Diamond -> +250 players
- Add Privacy policy