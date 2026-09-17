/**
 * e2e: cutting with ffmpeg.wasm in a real browser, Twitch mocked.
 * Needs real .ts segments + playlists in $SEG_DIR — run `node scripts/fetch-e2e-segments.mjs` first:
 *   master.m3u8, variant.m3u8 (the 720p one), and the segments listed for the test range.
 * Run: npx vite preview --port 4173 &  then  node e2e/cut.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const SEG_DIR = process.env.SEG_DIR ?? 'e2e/fixtures/segments';
const SHIM = 'https://shim.test';
const VOD = '2871164819';
const LENGTH = 23042;

/** The clip settings are menus now (ADR-27): open the pill, choose from the paper menu. */
async function pickSetting(page, which, label) {
  await page.click(`[data-testid="pick-${which}"]`);
  // a menu row is "<label><note>", so match on the label as a substring
  await page
    .locator('[data-testid="pick-menu"] [role="menuitemradio"]', { hasText: label })
    .first()
    .click();
  await page.waitForTimeout(120);
}

const fixture = readFileSync(
  new URL('../src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((l, i) => ({ i, ...JSON.parse(l) }));
function chunkAt(offset) {
  let start = fixture.findIndex((m) => m.t >= offset);
  if (start < 0) return null;
  start = Math.max(0, start - 3);
  const slice = fixture.slice(start, start + 60);
  return {
    edges: slice.map((m) => ({
      cursor: 'c' + m.i,
      node: {
        id: 'id' + m.i,
        contentOffsetSeconds: m.t,
        commenter: { login: m.u, displayName: m.u },
        message: {
          fragments: [{ text: m.m, emote: null }],
          userBadges: m.b.map((b) => ({ setID: b, version: '1' })),
        },
      },
    })),
    pageInfo: { hasNextPage: start + 60 < fixture.length },
  };
}

// Rewrite the real playlists so every URL points at our fake CDN host.
const master = readFileSync(join(SEG_DIR, 'master.m3u8'), 'utf8').replace(
  /https:\/\/[^/]+\/[^/]+\/(\w+)\/index-dvr\.m3u8/g,
  'https://cdn.test/vod/$1/index-dvr.m3u8',
);
const variant720 = readFileSync(join(SEG_DIR, 'variant.m3u8'), 'utf8');

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => { localStorage.setItem('hypeline.locale', 'en'); localStorage.setItem('hypeline.tour.v1', 'done'); });
await ctx.addInitScript((shim) => {
  localStorage.setItem(
    'hypeline.settings.v1',
    JSON.stringify({ shimUrl: shim, preferredHeight: 720 }),
  );
}, SHIM);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await p.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (!Array.isArray(body)) {
    return route.fulfill({
      json: {
        data: {
          video: {
            id: VOD,
            title: 'Fixture VOD',
            lengthSeconds: LENGTH,
            createdAt: '2026-09-11T11:49:00Z',
            viewCount: 1,
            seekPreviewsURL: null,
            owner: { login: 'tokyosims', displayName: 'tokyosims' },
            game: { name: 'Just Chatting' },
          },
        },
      },
    });
  }
  if (body[0].operationName === 'PlaybackAccessToken') {
    return route.fulfill({
      json: [{ data: { videoPlaybackAccessToken: { value: '{"tok":1}', signature: 'sig' } } }],
    });
  }
  const off = body[0].variables.contentOffsetSeconds;
  const c = off > LENGTH + 200 ? null : chunkAt(off);
  if (!c)
    return route.fulfill({
      json: [{ errors: [{ message: 'service error' }], data: { video: { comments: null } } }],
    });
  return route.fulfill({ json: [{ data: { video: { comments: c } } }] });
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.Twitch = { Player: class { constructor(el,o){ this.t=0; this.l={}; setTimeout(()=>this.l['ready']?.forEach(f=>f()),10);} seek(s){this.t=s; window.__t=s} play(){} pause(){} getCurrentTime(){return this.t} addEventListener(e,f){(this.l[e] ||= []).push(f)} } }; window.Twitch.Player.READY='ready'; window.Twitch.Player.PLAYING='playing';`,
  }),
);
// The shim: decode ?u= and serve playlists / segments from disk.
await p.route(`${SHIM}/**`, async (route) => {
  const u = new URL(route.request().url()).searchParams.get('u') ?? '';
  if (u.startsWith('https://usher.ttvnw.net/'))
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: master });
  if (u.includes('/720p30/index-dvr.m3u8'))
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: variant720 });
  if (u.endsWith('index-dvr.m3u8'))
    return route.fulfill({ status: 404, body: 'only the 720p variant is available in this test' });
  const name = u.split('/').pop();
  const f = join(SEG_DIR, name);
  if (!existsSync(f))
    return route.fulfill({ status: 404, body: 'segment not in SEG_DIR: ' + name });
  return route.fulfill({ contentType: 'video/MP2T', body: readFileSync(f) });
});

await p.goto(BASE + '/vod/' + VOD);
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 60000,
});
console.log('heatmap ready');

// Range inside the downloaded segments (202–205 = 2042.8..2082.8 s).
await p.locator('input[placeholder="h:mm:ss"]').nth(0).fill('0:34:05');
await p.locator('input[placeholder="h:mm:ss"]').nth(0).dispatchEvent('change');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).fill('0:34:20');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).dispatchEvent('change');
console.log('range:', await p.locator('text=/\\d+\\.\\d s/').first().innerText());

async function exportAndWait(label) {
  const before = await p.locator('video').count();
  const t0 = Date.now();
  await p.getByRole('button', { name: 'Export clip' }).click();
  await p.waitForFunction((n) => document.querySelectorAll('video').length > n, before, {
    timeout: 300000,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const meta = await p.locator('section:has-text("Export clip") ul li').first().innerText();
  // Playwright's Chromium has no H.264 decoder, so verify the MP4 with ffprobe instead of <video> metadata.
  const b64 = await p.evaluate(async () => {
    const v = document.querySelector('video');
    const buf = await (await fetch(v.src)).arrayBuffer();
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const file = `/tmp/hypeline-e2e-${Date.now()}.mp4`;
  writeFileSync(file, Buffer.from(b64, 'base64'));
  const probe = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v',
    '-show_entries',
    'stream=width,height,codec_name:format=duration',
    '-of',
    'json',
    file,
  ]).toString();
  const j = JSON.parse(probe);
  const info = {
    duration: Number(j.format.duration),
    w: j.streams[0].width,
    h: j.streams[0].height,
    codec: j.streams[0].codec_name,
    file,
  };
  console.log(
    `${label}: ${secs}s wall ·`,
    meta.replace(/\s+/g, ' ').slice(0, 120),
    '·',
    JSON.stringify(info),
  );
  return info;
}

// 'exact' is the default now (Angel, 2026-09-17); the stream-copy path needs asking for
await pickSetting(p, 'mode', 'fast');
const fast = await exportAndWait('fast 16:9');
if (!(fast.duration > 13 && fast.duration < 18))
  throw new Error('fast cut duration off: ' + fast.duration);

await pickSetting(p, 'aspect', '9:16');
await pickSetting(p, 'mode', 'exact');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).fill('0:34:10');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).dispatchEvent('change');
const vert = await exportAndWait('precise 9:16 (5 s)');
if (!(vert.w === 404 && vert.h === 720))
  throw new Error('vertical crop wrong: ' + JSON.stringify(vert));
if (!(vert.duration > 4.8 && vert.duration < 5.3))
  throw new Error('precise duration off: ' + vert.duration);

await pickSetting(p, 'aspect', 'cam + game');
const split = await exportAndWait('precise split cam+game (5 s)');
if (!(split.w === 406 && split.h === 720))
  throw new Error('split output wrong: ' + JSON.stringify(split));

// Thumbnail: grab a titled frame at In with the split framing still selected; decode the PNG in-page.
// Title and both grab buttons live in the Thumbnail menu now.
await p.click('[data-testid="pick-thumbnail"]');
await p.locator('input[placeholder="Title on the image (optional)"]').fill('HE ACTUALLY DID IT');
await p.getByRole('button', { name: 'Use In frame' }).click();
await p.waitForSelector('img[data-testid="thumbnail"]', { timeout: 300000 });
const thumb = await p.evaluate(async () => {
  const img = document.querySelector('img[data-testid="thumbnail"]');
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  // Yellow title pixels (R,G high, B low) should exist in the bottom 25% of the frame.
  const d = g.getImageData(
    0,
    Math.floor(c.height * 0.75),
    c.width,
    Math.ceil(c.height * 0.25),
  ).data;
  let yellow = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] < 80) yellow++;
  return { w: img.naturalWidth, h: img.naturalHeight, yellow, png: c.toDataURL('image/png') };
});
writeFileSync('e2e/last-thumb.png', Buffer.from(thumb.png.split(',')[1], 'base64'));
console.log(
  'thumbnail:',
  JSON.stringify({ w: thumb.w, h: thumb.h, yellow: thumb.yellow }),
  '→ e2e/last-thumb.png',
);
if (!(thumb.w === 406 && thumb.h === 720))
  throw new Error('thumbnail size wrong: ' + JSON.stringify(thumb));
if (thumb.yellow < 200)
  throw new Error('title text not found in the thumbnail: ' + JSON.stringify(thumb));

// Persistence: all clips must survive a reload.
await p.reload();
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 60000,
});
await p.waitForFunction(() => document.querySelectorAll('video').length === 3, null, {
  timeout: 10000,
});
console.log('clips persisted across reload: 3');

// Timeline handles: "clip this" on a moment shows the zoomed strip; dragging the In handle moves the In field.
await p.locator('ol li').nth(1).click(); // 0:34:15 → clip mode, range 0:33:50–0:34:35 (10 s chat lag)
await p.waitForFunction(() => document.querySelectorAll('svg.hl-timeline').length === 2, null, {
  timeout: 5000,
});
await p.waitForTimeout(1600); // the timeline glides to the clip (up to 1.4 s)
const inBefore = await p.locator('input[placeholder="h:mm:ss"]').nth(0).inputValue();
const zoom = p.locator('svg.hl-timeline').nth(0); // the main timeline zooms around the clip; nth(1) is the minimap
await zoom.scrollIntoViewIfNeeded();
const box = await zoom.boundingBox();
// In handle sits at (in - viewStart)/span of the width; viewStart = in - 30, span = 45 + 60 → 30/105 ≈ 0.2857
const hx = box.x + box.width * (30 / 105);
await p.mouse.move(hx, box.y + box.height / 2);
await p.waitForTimeout(200); // headless WebGL runs at a few fps; let the frame settle before the drag
await p.mouse.down();
await p.waitForTimeout(200);
await p.mouse.move(hx + box.width * 0.1, box.y + box.height / 2, { steps: 10 });
await p.waitForTimeout(200);
await p.mouse.up();
const inAfter = await p.locator('input[placeholder="h:mm:ss"]').nth(0).inputValue();
console.log('drag In handle:', inBefore, '→', inAfter);
if (inAfter === inBefore) throw new Error('dragging the In handle did not change the In point');

// Keyboard: O sets Out at the playhead (stubbed player reports the last seek).
await p.waitForTimeout(700); // let the 500 ms time poll run
console.log('stub player time =', await p.evaluate(() => window.__t));
await p.keyboard.press('o');
console.log(
  'after O key, Out =',
  await p.locator('input[placeholder="h:mm:ss"]').nth(1).inputValue(),
);

await p.screenshot({ path: process.env.SHOT ?? 'e2e/last-cut.png', fullPage: true });
const real = errors.filter((e) => !/ResizeObserver|favicon|ERR_CONNECTION|fonts.g/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
