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
 */
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
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

const FILES = [
  { path: 'public/icons/mark.svg', text: faviconSvg },
  { path: 'public/icons/icon-192.png', svg: tileSvg(), size: 192 },
  { path: 'public/icons/icon-512.png', svg: tileSvg(), size: 512 },
  { path: 'public/icons/apple-touch-icon.png', svg: appleSvg, size: 180, opaque: true },
  // Android masks this to its own shape, so: no rounding, no ring, ground to the edge
  {
    path: 'public/icons/maskable-512.png',
    svg: tileSvg({ ring: false, round: false, bg: '#000000' }),
    size: 512,
    opaque: true,
  },
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

const out = check ? mkdtempSync(join(tmpdir(), 'icons-')) : null;
const dest = (p) => (check ? join(out, p.replace(/\//g, '_')) : join(ROOT, p));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
const changed = [];
for (const f of FILES) {
  let bytes;
  if (f.text) {
    bytes = Buffer.from(f.text);
  } else {
    await page.setViewportSize({ width: f.size, height: f.size });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${f.size}px;height:${f.size}px}</style>${f.svg}`,
    );
    await page.waitForTimeout(80);
    bytes = await page.screenshot({ omitBackground: !f.opaque });
  }
  let before = null;
  try {
    before = readFileSync(join(ROOT, f.path));
  } catch {
    /* a new file */
  }
  if (!before || !before.equals(bytes)) changed.push(f.path);
  writeFileSync(dest(f.path), bytes);
}
await browser.close();

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
