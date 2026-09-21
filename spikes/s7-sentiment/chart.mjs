/**
 * S7 chart — draw the axes the way Angel described them, so we can look instead of argue.
 * (spike, 2026-09-21)
 *
 *   node spikes/s7-sentiment/axes.mjs && node spikes/s7-sentiment/chart.mjs
 *
 * Three panels stacked on one shared time axis, not one panel with two scales: volume is
 * messages, the poles are a share of the people talking, and putting two scales on one frame
 * is the single most misleading thing a chart can do. Stacked small multiples make the same
 * comparison honestly — you read down a vertical line.
 *
 * Each emotion panel is mirrored the way Angel drew it: the warm pole above the centre, the
 * cool pole below, each its own curve. **They are never subtracted.** A bucket where chat is
 * both hysterical and gutted is the most interesting bucket on the stream, and a difference
 * would render it as a flat line.
 *
 * Colours are the thread's own two ends, stepped down until they cleared a six-check
 * validation on the night ground (CVD ΔE 26 protan / 26 tritan, contrast > 3:1).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(join(OUT, 'axes.json'), 'utf8'));
const WANT = process.argv[2] ?? 'caseoh_';
const fx = data.find((d) => d.name === WANT);
if (!fx) throw new Error(`${WANT} missing from axes.json — run axes.mjs first`);

const GROUND = '#0c0a0f';
const INK = '#f3edf6';
const WARM = '#cf7020';
const COOL = '#6b7fe0';
const GRID = 'rgba(243,237,246,0.10)';
const MUTED = 'rgba(243,237,246,0.55)';

const W = 1380;
const PAD_L = 74;
const PAD_R = 26;
const PLOT = W - PAD_L - PAD_R;
const N = fx.msgs.length;
const bucket = fx.span / (N - 1);
const x = (i) => PAD_L + (i / (N - 1)) * PLOT;

/** A 3-bucket moving average: 950 points in 1280px is noise, not a curve. */
function smooth(a, k = 3) {
  return a.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) { s += a[j]; n++; }
    return s / n;
  });
}

/** An area from a baseline y0, going up (dir -1) or down (dir +1) by `scale` per unit. */
function area(vals, y0, scale, dir) {
  let d = `M ${x(0).toFixed(1)} ${y0}`;
  vals.forEach((v, i) => { d += ` L ${x(i).toFixed(1)} ${(y0 + dir * v * scale).toFixed(1)}`; });
  return d + ` L ${x(N - 1).toFixed(1)} ${y0} Z`;
}

const hhmm = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

/* The two moments the spike found: chat unanimous, volume flat. They are the argument. */
const ALL_MARKS = {
  caseoh_: [
    { t: 24 * 60 + 30, label: '“W MOM” — 90 of 130 chatters' },
    { t: 2 * 3600 + 4 * 60 + 15, label: '“L DAD” — 66 of 101 chatters' },
  ],
  'xqc-gta': [
    { t: 1 * 3600 + 14 * 60, label: '“ohno” — 15 of 41, volume at half baseline' },
    { t: 2 * 3600 + 16 * 60, label: '“FINALLY JAIL RP” — 15 of 147' },
    { t: 6 * 3600 + 39 * 60, label: '“Scared” — 7 of 31' },
  ],
};
const MARKS = ALL_MARKS[WANT] ?? [];
const TITLES = {
  caseoh_: ['Chat has feelings the heatmap cannot see', 'caseoh_ · 103,088 messages · 4 h'],
  'xqc-gta': ['Dread and relief are real — on a chat this big', 'xqc · 241,195 messages · 11 h 31 m · 353 messages a minute'],
};

function panel({ y, h, title, unit, up, down, upKey, downKey, single }) {
  const mid = single ? y + h : y + h / 2;
  const half = single ? h : h / 2;
  const peak = Math.max(...up, ...(down ?? [0]));
  const scale = peak > 0 ? (half - 10) / peak : 0;
  let s = '';

  // grid: one line per hour, recessive
  for (let t = 0; t <= fx.span; t += 3600) {
    const px = x(t / bucket);
    s += `<line x1="${px.toFixed(1)}" y1="${y}" x2="${px.toFixed(1)}" y2="${y + h}" stroke="${GRID}" stroke-width="1"/>`;
  }
  s += `<line x1="${PAD_L}" y1="${mid}" x2="${PAD_L + PLOT}" y2="${mid}" stroke="rgba(243,237,246,0.28)" stroke-width="1"/>`;

  s += `<path d="${area(up, mid, scale, -1)}" fill="${single ? 'rgba(243,237,246,0.22)' : WARM}" fill-opacity="${single ? 1 : 0.85}"/>`;
  if (down) s += `<path d="${area(down, mid, scale, 1)}" fill="${COOL}" fill-opacity="0.85"/>`;

  s += `<text x="${PAD_L}" y="${y - 12}" fill="${INK}" font-size="17" font-weight="600">${title}</text>`;
  s += `<text x="${PAD_L + PLOT}" y="${y - 12}" fill="${MUTED}" font-size="13" text-anchor="end">${unit}</text>`;

  // direct labels on the poles — identity never by colour alone
  if (down) {
    s += `<text x="${PAD_L - 12}" y="${mid - half / 2}" fill="${WARM}" font-size="14" font-weight="600" text-anchor="end">${upKey}</text>`;
    s += `<text x="${PAD_L - 12}" y="${mid + half / 2}" fill="${COOL}" font-size="14" font-weight="600" text-anchor="end">${downKey}</text>`;
    const pk = (peak * 100).toFixed(0);
    s += `<text x="${PAD_L - 12}" y="${y + 12}" fill="${MUTED}" font-size="11" text-anchor="end">${pk}%</text>`;
    s += `<text x="${PAD_L - 12}" y="${y + h}" fill="${MUTED}" font-size="11" text-anchor="end">${pk}%</text>`;
  } else {
    s += `<text x="${PAD_L - 12}" y="${y + 12}" fill="${MUTED}" font-size="11" text-anchor="end">${Math.round(peak)}</text>`;
  }
  return s;
}

const joy = smooth(fx.poles.joy.share);
const sorrow = smooth(fx.poles.sorrow.share);
const hype = smooth(fx.poles.hype.share);
const letdown = smooth(fx.poles.letdown.share);
const vol = smooth(fx.msgs);

const dread = smooth(fx.poles.dread.share);
const relief = smooth(fx.poles.relief.share);
const P1 = { y: 132, h: 96 };
const P2 = { y: 300, h: 160 };
const P3 = { y: 532, h: 160 };
const P4 = { y: 764, h: 160 };
const H = 1078;
// (title band leaves room for two staggered rows of marks)

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${GROUND}"/>`;

const [T1, T2] = TITLES[WANT] ?? [WANT, ''];
svg += `<text x="${PAD_L}" y="40" fill="${INK}" font-size="26" font-weight="700">${T1}</text>`;
svg += `<text x="${PAD_L}" y="66" fill="${MUTED}" font-size="15">${T2} · 15 s buckets · poles counted in distinct chatters, never subtracted</text>`;

svg += panel({ ...P1, title: 'Chat volume', unit: 'messages per bucket', up: vol, single: true });
svg += panel({ ...P2, title: 'Joy ↔ Sorrow', unit: 'share of people talking', up: joy, down: sorrow, upKey: 'joy', downKey: 'sorrow' });
svg += panel({ ...P3, title: 'Hype ↔ Letdown', unit: 'share of people talking', up: hype, down: letdown, upKey: 'hype', downKey: 'letdown' });
svg += panel({ ...P4, title: 'Dread ↔ Relief', unit: 'share of people talking', up: dread, down: relief, upKey: 'dread', downKey: 'relief' });

// the guides: read straight down — volume flat, the pole at its loudest
MARKS.forEach((m, mi) => {
  const px = x(m.t / bucket);
  svg += `<line x1="${px.toFixed(1)}" y1="${P1.y - 6}" x2="${px.toFixed(1)}" y2="${P4.y + P4.h}" stroke="${INK}" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3 4"/>`;
  const anchor = px > W - 300 ? 'end' : 'start';
  const dx = anchor === 'end' ? -8 : 8;
  // stagger: two marks an hour apart would print their labels on top of each other
  const ly = P1.y - 46 + (mi % 2) * 19;
  svg += `<text x="${(px + dx).toFixed(1)}" y="${ly}" fill="${INK}" font-size="13" font-weight="600" text-anchor="${anchor}">${m.label}</text>`;
});

// x axis
for (let t = 0; t <= fx.span; t += 3600) {
  const px = x(t / bucket);
  svg += `<text x="${px.toFixed(1)}" y="${P4.y + P4.h + 24}" fill="${MUTED}" font-size="12" text-anchor="middle">${hhmm(t)}</text>`;
}

svg += `<text x="${PAD_L}" y="${H - 22}" fill="${MUTED}" font-size="13">Read down a dashed line: the volume panel is flat where the emotion panel is at its loudest. That moment is invisible to the current scorer.</text>`;
svg += `</svg>`;

writeFileSync(join(OUT, 'curves.svg'), svg);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${GROUND}}</style>${svg}`);
await page.screenshot({ path: join(OUT, 'curves.png') });
await browser.close();
console.log('wrote curves.svg and curves.png');
