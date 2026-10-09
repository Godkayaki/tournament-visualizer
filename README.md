# [**EDHGlobe**](https://edhglobe.com/) ─ Tournament data visualizer for **cEDH**

[![EDH Globe Status](https://img.shields.io/website?url=https%3A%2F%2Fedhglobe.com&label=EDH%20Globe&up_message=online&up_color=brightgreen&down_message=offline&down_color=red)](https://edhglobe.com)
![Version](https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2FGodkayaki%2Ftournament-visualizer%2Frefs%2Fheads%2Fmain%2Fversion-number&search=.*&label=Version%3A)
[![Deploy](https://github.com/Godkayaki/tournament-visualizer/actions/workflows/deploy.yml/badge.svg)](https://github.com/Godkayaki/tournament-visualizer/actions/workflows/deploy.yml)
![Scryfall API status](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.scryfall.com%2Fsets&query=%24.object&label=Scryfall%20API%20Status&color=brightgreen&prefix=accesible%20%28&suffix=%29&headers%5BUser-Agent%5D=EDHGlobeApp%2F1.0)  
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js\&logoColor=white)](https://nodejs.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://github.com/Godkayaki/tournament-visualizer/blob/main/LICENSE)


**3D globe of past cEDH tournaments (data from [TopDeck.gg](https://topdeck.gg), images from [Scryfall](https://scryfall.com/)) that brings regional metagame share and data to the table.**
 
**How does it work?** -> `scripts/fetch-data.mjs` calls the [TopDeck API](https://topdeck.gg/docs/tournaments-v2) at **build time** and writes `site/data/tournaments.json` (index) and `site/data/t/<tid>.json` (standings per tournament).
 
**Why?** -> Well, since I started playing cEDH I've always been surrounded by what seems to be a sentiment of "*my region is the best*" or "*my region has the worst meta*". And well, what best way to check meta diversity per region than just looking at the numbers, am I right?
 
## Features
 
- It displays cEDH tournaments all around the globe, represented in a 3D world map that is rotatable.
- You can also click on the bubbles where these tournaments happened, displaying a list with all the tournaments in that specific area, with the number of players. Clicking on a tournament will also display another view of all the players and their respective decks and scores during that tournament.
- There are direct filters for the data being shown; these are:
  - **Nº of players** -> Starting at all tournaments to filtering up to tournaments with +100 players.
  - **Time** -> Period of time, going from the last 3 months to all time.
- Currently **filters out casual tournaments**, a big problem I personally had with [edhtop16](https://edhtop16.com) that I wanted to fix. It does this by basically blocking out specific keywords, kinda simple and breakable but as easily to revert. *Note: Even if topdeck was about to add a tag-per-bracket we still would need this for data before that*;
```js
const KEEP = [/\bc\s?edh/i, /bracket\s*5\b/i];
const BLOCK = [/bracket\s*[1-4]\b/i,
  /b\s*[1-4]\b/i, 
  /budget/i, 
];
const blockedBy = (name) => (KEEP.some((r) => r.test(name)) ? null : BLOCK.find((r) => r.test(name)) || null);
```
- Tournament display with viewable commanders and player records.
- The workflow runs on every push (*on push data does not get updated*) and daily at **05:00 AM UTC (12:00 AM EST)**, keeping cacheed data and updating the last month with newer data. This also applies for Scryfall art. I've also added a visual timestamp on the down-right corner that points the last time the data was updated.
- Zero runtime dependencies + Cached data that improves loading speed.
- Accent color picker.
- **Regional metagame data with;**
  - Direct comparison between countries, continents and the world
  - Color filtering
  - *(To-do)* Order by either conversion rate or most played
  - *(To-do)* In-depth data for each commander 
    - *(To-do)* (CR%, recent lists, Seat Win%, tendencies...)
    - *(To-do)* Floor vs Ceiling data for each commander

## Run locally
 
```bash
git clone https://github.com/Godkayaki/tournament-visualizer
TOPDECK_API_KEY=your_key      # In windows; $env:TOPDECK_API_KEY=your_key
npm run fetch                 # Node 18+ (same as: node scripts/fetch-data.mjs)
npm run meta                  # Regional Metagame data (needs the fetch above; downloads country borders)
npm start                     # Start local server (same as: npx serve site)
```
- You can get your `TOPDECK_API_KEY` at [Topdeck Dev](https://topdeck.gg/developers).
- Optional env vars: 
  - `START_DATE` (default `2023-01-01`)
  - `FORMAT` (default `EDH`).
Usually accessible through `http://localhost:3000`
 
The first time `node scripts/fetch-data.mjs` is run it fetches data once, storing it on `data/t/art.json` and `data/t/tournaments.json`. After that you don't need to run it again for testing purposes.
 
As a side note, I've also added a `check-recent.mjs` file that you can run to check the recent tournament status of the last 4-5 days, where you can check the number of players and the reason why it's included or not and if it will be added on the next `fetch-data.mjs` you run. You can also check the current cached data on `actions -> caches`.
 
## Regional Metagame
 
The **Regional Metagame** button opens a window with the share of decks played per commander. Comparison between regions available (the world, a continent or a country) as well as filters by color. Percentages are always a share of all the decks in the region, so a color filter only hides commanders.
 
A tournament belongs to the country whose borders contain its coordinates (a point just offshore goes to the nearest country, within 50 km), and the continent comes from the same borders file. `scripts/build-meta.mjs` writes `data/meta.json` with the counts per tournament, plus each commander's color identity from Scryfall (cached in `data/colors.json`, so only new commanders are looked up). The browser adds up the tournaments that pass the filters, so the Players and Period choices work like on the globe. Players without a listed commander are left out of the percentages.
 
## Featured tournaments
 
`site/content/featured.json` is a list of upcoming events, shown under the **★ Featured** button. Past events disappear on their own and the button hides itself when none are left.
 
```json
[
  { 
  "name": "Example Open", 
  "location": "Barcelona, Spain", 
  "date": "2026-12-12", 
  "url": "https://topdeck.gg/...", 
  "price": "€35" 
  }
]
```
#
Check the current ["Roadmap"](ROADMAP.md) (it's just really a way for me to track what is still to be done and what I've already done).
# 
 
### **<p align="center"> [EDHGlobe.com](https://edhglobe.com/) </p>**
<p align="center"> <img src="site/static/logo.svg" width="180"> </p>
