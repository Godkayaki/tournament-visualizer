// Starfield: seamless tiles drawn at device resolution, shifted slightly as the camera moves (parallax).
import { $ } from './utils.js';

const TILE = 1024;
function starTile(count, maxR, seed) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.width = cv.height = TILE * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; // seeded: same sky every load
  for (let i = 0; i < count; i++) {
    const x = rnd() * TILE, y = rnd() * TILE;
    const r = 0.5 + rnd() ** 3 * maxR; // mostly tiny, a few bigger
    const a = 0.4 + rnd() * 0.6;
    const t = rnd();
    const col = t < 0.15 ? '170,200,255' : t < 0.3 ? '255,226,185' : '255,255,255';
    for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) { // wrap so the tile repeats seamlessly
      const px = x + dx, py = y + dy;
      if (px < -12 || px > TILE + 12 || py < -12 || py > TILE + 12) continue;
      if (r > 1.1) { // soft glow on the brighter stars
        const gr = g.createRadialGradient(px, py, 0, px, py, r * 4);
        gr.addColorStop(0, `rgba(${col},${a * 0.35})`);
        gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr;
        g.fillRect(px - r * 4, py - r * 4, r * 8, r * 8);
      }
      g.fillStyle = `rgba(${col},${a})`;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return `url(${cv.toDataURL()})`;
}
const wrap = (v) => -(((v % TILE) + TILE) % TILE);

export function initStars(world) {
  $('stars-far').style.backgroundImage = starTile(260, 0.7, 12345);
  $('stars-near').style.backgroundImage = starTile(70, 1.6, 98765);
  const layers = [[$('stars-far'), 0.5], [$('stars-near'), 1.2]];
  function parallax() {
    const { lat, lng } = world.pointOfView();
    for (const [el, k] of layers) el.style.transform = `translate3d(${wrap(lng * k * 6)}px, ${wrap(lat * k * 4)}px, 0)`;
  }
  world.controls().addEventListener('change', parallax);
  parallax();
}