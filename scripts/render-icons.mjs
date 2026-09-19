/**
 * Render every icon from the one mark (2026-09-19).
 *
 * `src/ui/Logo.vue` is the mark. The favicon, the two PWA icons, the Apple touch icon, the
 * maskable tile and the README's two SVGs were all *copies* of it, made by hand — so when the
 * mark was revised (lower peak, a ramp ending on sky) the app changed and every installed
 * icon kept the old wave, yellow tip and all, which is what Angel spotted a day later.
 *
 * This reads the component's own `<template>`, lifts the gradient and the paths out of it, and
 * writes all seven files. Change `Logo.vue`, run `npm run icons`, commit what changes.
 *
 *   node scripts/render-icons.mjs [--check]
 *
 * `--check` renders to a temp dir and exits non-zero if anything differs from what is
 * committed — for CI, or for a quick "did I forget?".
 *
 * The tile: the mark at 66 % on `#0c0a0f`, rounded 16/64, inside a 2.2-unit silk ring. The
 * maskable one drops the ring and the rounding (Android masks it to its own shape) and keeps
 * the mark inside the 80 % safe circle. Sizes and grounds were measured off the icons this
 * replaces, so the set stays what Angel approved on 2026-09-17 — only the wave moves.
 *
 * **The app icons carry a content hash in their filename** (`icon-512.a1b2c3d4.png`) and the
 * names land in `scripts/icons.generated.json`, which `vite.config.ts` reads for the manifest
 * and for the `<link>` tags it injects into `index.html`. That is the one lever we have over an
 * icon that is already installed (2026-09-19): an installed PWA is re-checked by comparing the
 * **manifest**, and a manifest that still says `icons/icon-512.png` has not changed, however
 * different the bytes behind it are. New names mean a different manifest, which is what Chrome
 * watches for on Android (at most one check a day, then it re-mints the WebAPK) and on the
 * desktop, and it busts the favicon cache for free. iOS is beyond reach either way: Safari
 * copies the icon when the user adds the app and never looks again.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = 'https://hypeline.live';
const INK_DAY = '#221c2a';
const INK_NIGHT = '#f3edf6';
const TILE = '#0c0a0f';
const check = process.argv.includes('--check');

/** The mark's `<defs>` and paths, with Vue's bindings resolved to plain SVG. */
function markFromComponent() {
  const vue = readFileSync(join(ROOT, 'src/ui/Logo.vue'), 'utf8');
  const t = vue.slice(vue.indexOf('<template>') + 10, vue.indexOf('</template>'));
  const inner = t.slice(t.indexOf('>', t.indexOf('<svg')) + 1, t.lastIndexOf('</svg>'));
  return inner
    .replace(/:id="gid"/, 'id="silk"')
    .replace(/:stroke="`url\(#\$\{gid\}\)`"/, 'stroke="url(#silk)"')
    .replace(/\s+(?:class|:class)="[^"]*"/g, '')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

const MARK = markFromComponent();
if (!/linearGradient/.test(MARK) || !/M15 38/.test(MARK)) {
  throw new Error('Logo.vue did not yield a mark — has its template changed shape?');
}

/** The mark as a standalone SVG at a given pixel size, ink = currentColor's value. */
const MARK_SVG = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64" fill="none" color="${INK_NIGHT}">${MARK}</svg>`;

/** The mark alone, ink following the OS theme: the favicon. */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <style>
    svg { color: ${INK_DAY}; }
    @media (prefers-color-scheme: dark) { svg { color: ${INK_NIGHT}; } }
  </style>
${MARK}
</svg>
`;

/** The mark on a tile. `ring` draws the silk hairline; `round` rounds the corners. */
function tileSvg({ ring = true, round = true, bg = TILE, pad = 0 } = {}) {
  const w = ring ? 2.2 : 0;
  // measured off the icons this replaces: the ring's outer edge sits 0.375 units in from the
  // canvas and its outer corner radius is 16.8 of 64
  const m = 0.375;
  const rect = round
    ? `<rect x="${m + w / 2}" y="${m + w / 2}" width="${64 - 2 * m - w}" height="${64 - 2 * m - w}" rx="${16.8 - m - w / 2}" fill="${bg}"${
        ring ? ` stroke="url(#silk)" stroke-width="${w}"` : ''
      } />`
    : `<rect width="64" height="64" fill="${bg}" />`;
  // 0.66 of the tile, centred — measured off the icons this replaces
  const s = 0.66 - pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" color="${INK_NIGHT}">
  ${rect}
  <g transform="translate(32 32) scale(${s}) translate(-32 -32)">
${MARK}
  </g>
</svg>
`;
}

/** A square of solid ground under a rounded tile: iOS masks the corners itself. */
const appleSvg = tileSvg().replace(
  '<rect x=',
  '<rect width="64" height="64" fill="#000" /><rect x=',
);

/** A local woff2 as a data URI: the card must render the same with no network. */
function font(file) {
  const b64 = readFileSync(join(ROOT, 'public/fonts', file)).toString('base64');
  return `url(data:font/woff2;base64,${b64}) format('woff2')`;
}

/**
 * The social card (1200×630, 2026-09-19). What someone sees when the link is pasted into
 * Discord, X or a group chat — which, for a tool you are asked to try on trust, is the whole
 * first impression. Night ground, the mark beside the wordmark, the landing's own line, and
 * the thread as a silk bar along the bottom: the app's three ideas in one still image.
 */
const cardHtml = `<style>
  @font-face { font-family: 'Gloock'; src: ${font('gloock-400-latin.woff2')}; }
  @font-face { font-family: 'Manrope'; font-weight: 500; src: ${font('manrope-500-latin.woff2')}; }
  html, body { margin: 0; }
  body {
    width: 1200px; height: 630px; box-sizing: border-box; padding: 88px 88px 0;
    background: ${TILE}; color: ${INK_NIGHT};
    display: flex; flex-direction: column; justify-content: center;
    -webkit-font-smoothing: antialiased;
  }
  .row { display: flex; align-items: center; gap: 30px; }
  .row svg { width: 132px; height: 132px; display: block; }
  h1 { font-family: 'Gloock', serif; font-size: 116px; font-weight: 400; margin: 0; line-height: 1; }
  p {
    font-family: 'Manrope', sans-serif; font-weight: 500; font-size: 37px; line-height: 1.3;
    margin: 36px 0 0; max-width: 27ch; color: color-mix(in srgb, ${INK_NIGHT} 78%, ${TILE});
  }
  .thread { position: absolute; left: 0; right: 0; bottom: 0; height: 12px;
    background: linear-gradient(90deg, #ffa968, #ff77b5 32%, #b39cff 64%, #7f9cff); }
</style>
<div class="row">${MARK_SVG(132)}<h1>Hypeline</h1></div>
<p>Turn Twitch VODs into memorable moments ready to clip</p>
<div class="thread"></div>`;

const FILES = [
  { role: 'favicon', path: 'public/icons/mark.svg', text: faviconSvg },
  { role: 'icon192', path: 'public/icons/icon-192.png', svg: tileSvg(), size: 192 },
  { role: 'icon512', path: 'public/icons/icon-512.png', svg: tileSvg(), size: 512 },
  {
    role: 'apple',
    path: 'public/icons/apple-touch-icon.png',
    svg: appleSvg,
    size: 180,
    opaque: true,
  },
  // Android masks this to its own shape, so: no rounding, no ring, ground to the edge
  {
    role: 'maskable',
    path: 'public/icons/maskable-512.png',
    svg: tileSvg({ ring: false, round: false, bg: '#000000' }),
    size: 512,
    opaque: true,
  },
  { role: 'og', path: 'public/icons/og.png', html: cardHtml, w: 1200, h: 630, opaque: true },
  // GitHub gives an embedded SVG no page CSS, so the README carries one file per ink
  { path: 'docs/assets/logo-light.svg', text: readmeSvg(INK_DAY) },
  { path: 'docs/assets/logo-dark.svg', text: readmeSvg(INK_NIGHT) },
];

function readmeSvg(ink) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 64 64" fill="none" role="img" aria-label="Hypeline" color="${ink}">
${MARK}
</svg>
`;
}

/** `icons/icon-512.png` + bytes → `icons/icon-512.a1b2c3d4.png`. */
function hashed(path, bytes) {
  const h = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  return path.replace(/\.([^.]+)$/, `.${h}.$1`);
}

const out = check ? mkdtempSync(join(tmpdir(), 'icons-')) : null;
const dest = (p) => (check ? join(out, p.replace(/\//g, '_')) : join(ROOT, p));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
const changed = [];
/** What `vite.config.ts` reads: role → the hashed path, relative to the site root. */
const names = {};
const keep = new Set();
for (const f of FILES) {
  let bytes;
  if (f.text) {
    bytes = Buffer.from(f.text);
  } else {
    const w = f.w ?? f.size;
    const h = f.h ?? f.size;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(
      f.html
        ? `<!doctype html><meta charset="utf-8">${f.html}`
        : `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${f.svg}`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    bytes = await page.screenshot({ omitBackground: !f.opaque });
  }
  const path = f.role ? hashed(f.path, bytes) : f.path;
  if (f.role) {
    names[f.role] = path.replace(/^public\//, '');
    keep.add(path.split('/').pop());
  }
  let before = null;
  try {
    before = readFileSync(join(ROOT, path));
  } catch {
    /* a new file, or a new hash */
  }
  if (!before || !before.equals(bytes)) changed.push(path);
  writeFileSync(dest(path), bytes);
}
await browser.close();

const MAP = 'scripts/icons.generated.json';
// og:image has to be absolute: an unfurler has no page to resolve a relative path against
names.ogAbsolute = `${SITE}/${names.og}`;
const mapText = JSON.stringify(names, null, 2) + '\n';
if (readFileSync(join(ROOT, MAP), 'utf8').trim() !== mapText.trim()) changed.push(MAP);
writeFileSync(dest(MAP), mapText);

// the previous hashes are dead weight in `public/`, and a stale icon a browser could still be
// served from an old manifest — drop them (only when writing for real)
if (!check) {
  for (const name of readdirSync(join(ROOT, 'public/icons'))) {
    if (!keep.has(name)) {
      unlinkSync(join(ROOT, 'public/icons', name));
      changed.push('public/icons/' + name + ' (removed)');
    }
  }
}

if (check) {
  if (changed.length) {
    console.error('icons are out of date with src/ui/Logo.vue:\n  ' + changed.join('\n  '));
    console.error('run: node scripts/render-icons.mjs');
    process.exit(1);
  }
  console.log('icons match the mark');
} else {
  console.log(changed.length ? 'rewrote:\n  ' + changed.join('\n  ') : 'already up to date');
}
