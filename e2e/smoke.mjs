/**
 * e2e smoke test with a mocked Twitch: serves the tokyosims fixture through
 * request interception and stubs the embed player. Run against `vite preview`:
 *   npx vite preview --port 4173 &   then   node e2e/smoke.mjs
 * (Playwright must be installed: npm i -D playwright, npx playwright install chromium)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM; // optional executablePath
const VOD = '2871164819';
const LENGTH = 23042;

const fixture = readFileSync(
  new URL('../src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((l, i) => ({ i, ...JSON.parse(l) }));

function chunkAt(offset) {
  // Twitch-like: ~60 messages, chunk may start before the offset.
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
          fragments: [
            { text: m.m, emote: null },
            ...m.e.map((e) => ({ text: e, emote: { emoteID: '1' } })),
          ],
          userBadges: m.b.map((b) => ({ setID: b, version: '1' })),
        },
      },
    })),
    pageInfo: { hasNextPage: start + 60 < fixture.length },
  };
}

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
// the language is chosen already: the first-visit sheet must not cover the page
await p.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));

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
    body: `window.Twitch = { Player: class { constructor(el, o){ window.__player = this; this.t = 0; this.listeners = {}; this.opts = o; setTimeout(() => this.listeners['ready']?.forEach(f => f()), 10); }
      seek(s){ this.t = s; window.__seeks = (window.__seeks||[]).concat(s); } play(){} pause(){} getCurrentTime(){ return this.t; }
      addEventListener(e, f){ (this.listeners[e] ||= []).push(f); } } };
      window.Twitch.Player.READY = 'ready'; window.Twitch.Player.PLAYING = 'playing';`,
  }),
);

await p.goto(BASE + '/');
await p.fill('input[type=text]', `https://www.twitch.tv/videos/${VOD}`);
await p.click('button[type=submit]');
const t0 = Date.now();
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 60000,
});
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
console.log(await p.locator('text=/messages.*moments/').first().innerText());

const items = await p.locator('ol li').allInnerTexts();
console.log(items.length, 'moments');
for (const it of items.slice(0, 4)) console.log('  ', it.replace(/\s+/g, ' '));
if (!items.some((t) => t.includes('0:34:15')))
  throw new Error('expected the grandma moment at 0:34:15');

await p.locator('ol li').nth(1).click();
await p.waitForTimeout(300);
const seeks = await p.evaluate(() => window.__seeks);
console.log('player.seek calls:', seeks);
if (!seeks?.length) throw new Error('clicking a moment did not seek the player');
const parent = await p.evaluate(() => window.__player.opts.parent);
console.log('embed parent:', parent);

await p
  .locator('svg.hl-timeline')
  .first()
  .click({ position: { x: 640, y: 60 } });
await p.waitForTimeout(300);
console.log('after timeline click, seeks:', await p.evaluate(() => window.__seeks));

await p.screenshot({ path: process.env.SHOT ?? 'e2e/last.png' });

await p.reload();
await p.waitForFunction(() => document.body.innerText.includes('(cached)'), null, {
  timeout: 30000,
});
console.log('IndexedDB cache hit on reload: OK');

// Settings → Storage: the cached VOD is listed by kind, "Clear" empties it and sends the desk home
await p.locator('aside button', { hasText: 'Settings' }).click();
const storage = p.locator('[data-testid="storage"]');
await storage.waitFor({ state: 'visible' });
await p.waitForFunction(
  () =>
    /1 item/.test(
      document.querySelector('[data-testid="storage"] [data-kind="vods"]')?.textContent ?? '',
    ),
  null,
  { timeout: 10000 },
);
console.log(
  'storage rows:',
  (await storage.locator('li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')),
);
await storage.locator('[data-kind="vods"] button').click();
await p.waitForURL(/\/dashboard$/, { timeout: 10000 });
await p.waitForFunction(
  () =>
    /nothing/.test(
      document.querySelector('[data-testid="storage"] [data-kind="vods"]')?.textContent ?? '',
    ),
  null,
  { timeout: 10000 },
);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
console.log(
  'after clearing VODs: library rows =',
  await p.locator('aside li').count(),
  '· url =',
  new URL(p.url()).pathname,
);
if ((await p.locator('aside li').count()) !== 0) throw new Error('library not emptied');

const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
