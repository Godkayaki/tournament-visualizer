# [**EDHGlobe**](https://godkayaki.github.io/tournament-visualizer/) ─ Tournament data visualizer for **cEDH**

**3D globe of past cEDH tournaments (data from [TopDeck.gg](https://topdeck.gg), images from [Scryfall](https://scryfall.com/)) that brings regional metagame share and data to the table.**

**How does it work?** -> `scripts/fetch-data.mjs` calls the [TopDeck API](https://topdeck.gg/docs/tournaments-v2) at **build time** and writes `site/data/tournaments.json` (index) and `site/data/t/<tid>.json` (standings per tournament).

**Why?** -> Well, since I started playing cEDH I've always been surrounded by what seems to be a sentiment of "*my region is the best*" or "*my region has the better meta*". And well, what best way to check meta diversity per region than just looking at the numbers, am I right?

## Features

- It displays cEDH tournaments all around the globe, represented in a 3D world map that is rotatable.
- You can also click on the bubbles where these tournaments happened, displaying a list with all the tournaments in that specific area, with the number of players. Clicking on a tournament will also display another view of all the players and their respective decks and scores during that tournament.
- There are direct filters for the data being shown; these are:
  - **Nº of players** -> Starting at all tournaments to filtering up to tournaments with +100 players.
  - **Time** -> Period of time, going from the last 3 months to all time.
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
- The workflow runs on every push and daily at **05:00 AM UTC (12:00 AM EST)**, keeping cacheed data and updating the last month with newer data.

## Run locally

```bash
git clone https://github.com/Godkayaki/tournament-visualizer
TOPDECK_API_KEY=your_key      # In windows; $env:TOPDECK_API_KEY=your_key
node scripts/fetch-data.mjs   # Node 18+
npx serve site
```
- You can get your `TOPDECK_API_KEY` at [Topdeck Dev](https://topdeck.gg/developers).
- Optional env vars: 
  - `START_DATE` (default `2023-01-01`)
  - `FORMAT` (default `EDH`).

Usually accessible through `http://localhost:3000`

## To-do list

- Tournaments without coordinates (online events) are skipped right now. My idea is to have a separate list that is somehow accessible (thinking about adding the moon and be clickable lol).
- Based on this I want to add local/regional meta information of what is being played where. This was the original idea, but I needed the rest of the page first. This might be a bit hard to do still, since I've noticed localization issues for the same location, like, for example, calling *Catalunya*, *Catalonia*. These are the same exact location but with different names.
- Still researching for other cEDH platforms where tournaments are organized, to see if we can also add that data. These are the ones I'm currently looking at;
  - **Shuffleup** -> Still in beta, no API documentation visible, it looks complicated.
  - **God of commander** -> Japanese cEDH tournament from Hareruya. It's really difficult to actually get the information.
- ~~Set the initial view to the middle of the Atlantic, between Spain and the US.~~
- From the tournament list view when selecting a bubble;
  - ~~Add order when showing a list of tournaments that lets you also order by number of players. Default will always be from the most recent to the oldest.~~
  - ~~Change the name of the title to better suit the bubble you clicked. Right now it's just printing one of the locations if you are zoomed out. Then move the number of tournaments below that title in a smaller font.~~ *(can be improved)*
  - ~~Clicking on an empty space on the map (or the stars background) should close the tournament listing.~~
  - Add a small color next to the tournament indicating the tiers of each tournament. This will be based of the topdeck invitational, but it's not just for the tournaments within the invitational, it will also mark tournaments outside. This will also be added to the most recent "big" tournaments later on;
    - Bronze -> +16 players
    - Silver -> +30 players
    - Gold -> +50 players
    - Platinum -> +100 players
    - Diamond -> +250 players
- ~~Right now, you can not zoom in while having your cursor on top of a Bubbgle, this should be fixed.~~
- ~~Center off number of tournaments shown.~~
- ~~Add Privacy policy.~~
- In a perfect world where I am either bored or there are no other priorities in this development I might start adding both easter egges mtg-related in the world view or the background. Hopefully.

# 

### **<p align="center"> [EDHGlobe.com](https://godkayaki.github.io/tournament-visualizer/) </p>**
<p align="center"> <img src="site/static/logo.svg" width="180"> </p>