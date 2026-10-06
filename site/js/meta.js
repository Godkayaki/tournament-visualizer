// The "Version" and "Data updated" lines in the bottom-right block.
import { $ } from './utils.js';

// When the data was last refreshed (fetch-data.mjs stamps `generated`; code-only deploys don't touch it)
const ago = (secs) => {
  const m = Math.round(secs / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
};
export function showUpdated(ts) {
  if (!ts) return;
  const utc = new Date(ts * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  $('updated').textContent = `Data updated: ${utc} UTC`; // e.g. "Data updated: 3 Oct 2026, 05:22 UTC" (always UTC, whatever the visitor's timezone)
  $('updated').title = ago(Math.max(0, Date.now() / 1000 - ts)); // hover: "3 hours ago"
  $('updated').hidden = false;
}

// Site version, taken from tournaments.json (fetch-data.mjs stamps it from the repo VERSION file).
export function showVersion(v) {
  if (!v) return;
  const el = $('version');
  el.textContent = `Version: ${v}`;
  el.title = 'EDHGlobe version';
  el.hidden = false;
}