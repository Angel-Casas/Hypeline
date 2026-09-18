/**
 * e2e: the chat-file fallback. Twitch's comments endpoint is made to fail; the user
 * imports a TwitchDownloader-shaped JSON of the fixture and gets the same moments.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const VOD = '2871164819';
const LENGTH = 23042;
const fixture = readFileSync(
  new URL('../src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const tdJson = JSON.stringify({
  streamer: { name: 'tokyosims', id: 1 },
  video: { id: VOD, title: 'Fixture VOD (imported)', start: 0, end: LENGTH },
  comments: fixture.map((m) => ({
    content_offset_seconds: m.t,
    commenter: { name: m.u, display_name: m.u },
    message: {
      body: m.m,
      fragments: [
        { text: m.m, emoticon: null },
        ...m.e.map((e) => ({ text: e, emoticon: { emoticon_id: '1' } })),
      ],
      user_badges: m.b.map((b) => ({ _id: b, version: '1' })),
    },
  })),
});

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
  return route.fulfill({ status: 500, body: 'broken' }); // comments endpoint down
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.Twitch = { Player: class { constructor(el,o){ this.l={}; setTimeout(()=>this.l.ready?.forEach(f=>f()),10);} seek(){} play(){} pause(){} getCurrentTime(){return 0;} addEventListener(e,f){(this.l[e]||=[]).push(f);} } }; window.Twitch.Player.READY='ready'; window.Twitch.Player.PLAYING='playing';`,
  }),
);

await p.goto(BASE + '/dashboard');
await p.fill('input[type=text]', `https://www.twitch.tv/videos/${VOD}`);
await p.click('button[type=submit]');
await p.getByRole('button', { name: 'Import a chat file' }).waitFor({ timeout: 60000 });
console.log(
  'error shown:',
  (await p.locator('text=Import a chat file').first().locator('..').innerText())
    .replace(/\s+/g, ' ')
    .slice(0, 120),
);

await p
  .locator('input[type=file]')
  .setInputFiles({ name: 'chat.json', mimeType: 'application/json', buffer: Buffer.from(tdJson) });
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 30000,
});
console.log(await p.locator('text=/messages.*moments/').first().innerText());
const items = await p.locator('ol li').allInnerTexts();
if (!items.some((t) => t.includes('0:34:15')))
  throw new Error('expected the grandma moment at 0:34:15 after import');
console.log('moments after import:', items.length, '— url:', new URL(p.url()).pathname);

await p.reload();
await p.waitForFunction(() => document.body.innerText.includes('(cached)'), null, {
  timeout: 30000,
});
console.log('imported chat cached: OK');
await p.screenshot({ path: 'e2e/last-import.png' });
const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
