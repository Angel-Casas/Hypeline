/**
 * e2e: storage quota warning. navigator.storage.estimate is stubbed to look
 * nearly full; the banner must show and an export must be refused up front.
 * Run: npx vite preview --port 4173 &  then  node e2e/quota.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const SEG_DIR = process.env.SEG_DIR ?? 'e2e/fixtures/segments';
const SHIM = 'https://shim.test';
const VOD = '2871164819';
const LENGTH = 23042;
const GB = 1073741824;

const master = readFileSync(join(SEG_DIR, 'master.m3u8'), 'utf8').replace(
  /https:\/\/[^/]+\/[^/]+\/(\w+)\/index-dvr\.m3u8/g,
  'https://cdn.test/vod/$1/index-dvr.m3u8',
);
const variant720 = readFileSync(join(SEG_DIR, 'variant.m3u8'), 'utf8');

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
await ctx.addInitScript(
  ({ shim, GB }) => {
    localStorage.setItem(
      'hypeline.settings.v1',
      JSON.stringify({ shimUrl: shim, preferredHeight: 720 }),
    );
    // 9.95 GB of 10 GB used → 'critical' and no room for a clip.
    navigator.storage.estimate = async () => ({ usage: 9.95 * GB, quota: 10 * GB });
    navigator.storage.persisted = async () => false;
  },
  { shim: SHIM, GB },
);
const p = await ctx.newPage();
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
  if (body[0].operationName === 'PlaybackAccessToken') {
    return route.fulfill({
      json: [{ data: { videoPlaybackAccessToken: { value: '{"tok":1}', signature: 'sig' } } }],
    });
  }
  return route.fulfill({
    json: [{ errors: [{ message: 'service error' }], data: { video: { comments: null } } }],
  });
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.Twitch = { Player: class { constructor(){ this.l={}; setTimeout(()=>this.l['ready']?.forEach(f=>f()),10);} seek(){} play(){} pause(){} getCurrentTime(){return 0} addEventListener(e,f){(this.l[e] ||= []).push(f)} } }; window.Twitch.Player.READY='ready'; window.Twitch.Player.PLAYING='playing';`,
  }),
);
await p.route(`${SHIM}/**`, async (route) => {
  const u = new URL(route.request().url()).searchParams.get('u') ?? '';
  if (u.startsWith('https://usher.ttvnw.net/'))
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: master });
  if (u.endsWith('index-dvr.m3u8'))
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: variant720 });
  return route.fulfill({ status: 404, body: 'segments must not be fetched in this test' });
});

await p.goto(BASE + '/dashboard');
await p.waitForSelector('[data-testid="quota-banner"]', { timeout: 20000 });
console.log(
  'dashboard banner:',
  (await p.locator('[data-testid="quota-banner"]').innerText()).replace(/\s+/g, ' '),
);

await p.goto(BASE + '/vod/' + VOD);
await p.waitForFunction(() => document.body.innerText.includes('messages'), null, {
  timeout: 60000,
});
const banner = await p.locator('[data-testid="quota-banner"]').innerText();
if (!/almost full/.test(banner)) throw new Error('expected critical banner, got: ' + banner);

await p.locator('input[placeholder="h:mm:ss"]').nth(0).fill('0:34:05');
await p.locator('input[placeholder="h:mm:ss"]').nth(0).dispatchEvent('change');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).fill('0:34:20');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).dispatchEvent('change');
await p.getByRole('button', { name: 'Export clip' }).click();
await p.waitForFunction(
  () => document.body.innerText.includes('Not enough browser storage'),
  null,
  { timeout: 20000 },
);
console.log(
  'export refused:',
  (await p.locator('text=/Not enough browser storage/').innerText()).replace(/\s+/g, ' '),
);
if (await p.locator('video').count())
  throw new Error('a clip was exported despite the quota check');

// Settings (on the dashboard) shows the quota line and the persist button.
await p.goto(BASE + '/dashboard');
await p.getByRole('button', { name: 'Settings', exact: true }).click();
await p.waitForSelector('section:has-text("Settings")', { timeout: 20000 });
// the key's three steps live here too, with the two links a first-timer needs
const steps = await p.locator('.steps li').allInnerTexts();
if (steps.length !== 3) throw new Error('the NanoGPT key steps are missing: ' + steps.length);
const apiHref = await p.locator('.steps a').nth(1).getAttribute('href');
if (apiHref !== 'https://nano-gpt.com/api') throw new Error('wrong API-keys link: ' + apiHref);
console.log('key steps:', steps.map((x) => x.split(' ').slice(0, 4).join(' ')).join(' / '));

const settings = await p.locator('[data-testid="storage"]').first().innerText();
if (!/(10\.0|9\.9) GB of 10\.0 GB used/.test(settings.replace(/\s+/g, ' ')))
  throw new Error('quota line missing: ' + settings);
console.log(
  'settings quota line ok; persist button:',
  await p.getByRole('button', { name: 'Request persistent storage' }).count(),
);

await p.screenshot({ path: process.env.SHOT ?? 'e2e/last-quota.png', fullPage: true });
const real = errors.filter((e) => !/ResizeObserver|favicon|ERR_CONNECTION|fonts.g/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
