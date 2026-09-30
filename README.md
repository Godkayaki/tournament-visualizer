# cEDH Tournament Globe

3D globe of past cEDH tournaments (data from [TopDeck.gg](https://topdeck.gg)). Static site, deployed on GitHub Pages.

## How it works

- `scripts/fetch-data.mjs` calls the TopDeck API at **build time** and writes `site/data/tournaments.json` (index) and `site/data/t/<tid>.json` (standings per tournament).
- `site/` is plain HTML/JS using [globe.gl](https://globe.gl). Hex columns show tournament density; resolution gets finer as you zoom in. Click a column for the list, click a tournament for its leaderboard.
- The API key lives in a GitHub secret, never in the browser.

## Deploy

1. Get a free API key at https://topdeck.gg/developers
2. Push this folder to a GitHub repo (branch `main`).
3. Repo Settings > Secrets and variables > Actions: add `TOPDECK_API_KEY`.
4. Repo Settings > Pages: set Source to **GitHub Actions**.
5. The workflow runs on every push and daily at 05:00 UTC.

## Run locally

```bash
TOPDECK_API_KEY=your_key node scripts/fetch-data.mjs   # Node 18+
npx serve site
```

Optional env vars: `START_DATE` (default `2023-01-01`), `FORMAT` (default `EDH`).

## Notes

- Tournaments without coordinates (online events) are skipped.
- TopDeck requires a visible credit; it's in the page footer.
