/**
 * e2e: a subscribers-only VOD (2026-09-16). GQL is mocked: the VOD exists, its chat is a
 * small replay, and the playback token says `forbidden: UNAUTHORIZED_ENTITLEMENTS`. The
 * desk must show the notice over the player, mark the VOD line, hide "queue all" and lock
 * the clip actions — while the moments themselves still appear. An open VOD shows none of it.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const VOD = '2875511531';
const LENGTH = 600;

const fixture = [];
for (let t = 2; t < LENGTH; t += 10)
  for (let u = 0; u < (t > 300 && t < 330 ? 20 : 3); u++)
    fixture.push({ t: t + u * 0.1, u: `r${u}`, m: t > 300 && t < 330 ? 'LUL clip it' : `hi ${t}` });
fixture.forEach((m, i) => (m.i = i));
function chunkAt(offset) {
  const start = fixture.findIndex((m) => m.t >= offset);
  if (start < 0) return null;
  const slice = fixture.slice(start, start + 60);
  return {
    edges: slice.map((m) => ({
      cursor: 'c' + m.i,
      node: {
        id: 'id' + m.i,
        contentOffsetSeconds: m.t,
        commenter: { login: m.u, displayName: m.u },
        message: { fragments: [{ text: m.m, emote: null }], userBadges: [] },
      },
    })),
    pageInfo: { hasNextPage: start + 60 < fixture.length },
  };
}

let subOnly = true;
const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (Array.isArray(body)) {
    if (body[0].operationName === 'PlaybackAccessToken') {
      const value = subOnly
        ? {
            authorization: { forbidden: true, reason: 'UNAUTHORIZED_ENTITLEMENTS' },
            chansub: { restricted_bitrates: ['chunked'] },
          }
        : { authorization: { forbidden: false, reason: '' }, chansub: { restricted_bitrates: [] } };
      return route.fulfill({
        json: [
          {
            data: { videoPlaybackAccessToken: { value: JSON.stringify(value), signature: 'sig' } },
          },
        ],
      });
    }
    const c = chunkAt(body[0].variables.contentOffsetSeconds);
    if (!c)
      return route.fulfill({
        json: [{ errors: [{ message: 'service error' }], data: { video: { comments: null } } }],
      });
    return route.fulfill({ json: [{ data: { video: { comments: c } } }] });
  }
  return route.fulfill({
    json: {
      data: {
        video: {
          id: VOD,
          title: 'Sub-only stream',
          lengthSeconds: LENGTH,
          createdAt: '2026-09-16T01:00:00Z',
          viewCount: 1,
          seekPreviewsURL: null,
          status: 'RECORDED',
          owner: { login: 'rabbiilovey', displayName: '兔兔喵' },
          game: { name: 'Just Chatting' },
        },
      },
    },
  });
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.Twitch={Player:class{constructor(){this.l={};setTimeout(()=>this.l.ready?.forEach(f=>f()),10);}seek(){}play(){}pause(){}getCurrentTime(){return 0;}addEventListener(e,f){(this.l[e]||=[]).push(f);}destroy(){}}};window.Twitch.Player.READY='ready';window.Twitch.Player.PLAYING='playing';`,
  }),
);

await p.goto(BASE + `/dashboard/${VOD}`);
await p.waitForFunction(
  () => /Sub-only stream/.test(document.querySelector('h1')?.textContent ?? ''),
  null,
  { timeout: 30000 },
);
await p
  .locator('[data-testid="sub-only"]:visible')
  .first()
  .waitFor({ state: 'visible', timeout: 15000 });
const notice = (await p.locator('[data-testid="sub-only"]:visible').first().innerText()).replace(
  /\s+/g,
  ' ',
);
console.log('notice:', notice);
if (!/兔兔喵 keeps this past broadcast for subscribers/.test(notice))
  throw new Error('notice text');
const href = await p.locator('[data-testid="sub-only"]:visible a').first().getAttribute('href');
if (href !== `https://www.twitch.tv/videos/${VOD}`) throw new Error('bad Twitch link: ' + href);
const line = (await p.locator('.font-mono.text-\\[11px\\]').first().innerText()).replace(
  /\s+/g,
  ' ',
);
console.log('VOD line:', line);
if (!/subscribers only/.test(line)) throw new Error('VOD line not marked');
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 30000,
});
console.log('queue-all hidden:', (await p.getByText(/queue all \d+ as clips/).count()) === 0);
if ((await p.getByText(/queue all \d+ as clips/).count()) !== 0)
  throw new Error('queue all still offered');
// pick the burst as a range: the clip actions must be locked
await p
  .locator('.moment-card, [data-moment]')
  .first()
  .click()
  .catch(() => {});
await p
  .locator('svg.hl-timeline')
  .first()
  .click({ position: { x: 700, y: 60 } });
await p.waitForTimeout(200);
const exportBtn = p.getByRole('button', { name: 'Export clip' });
console.log(
  'Export disabled:',
  await exportBtn.isDisabled(),
  '· + Queue disabled:',
  await p.getByRole('button', { name: '+ Queue' }).isDisabled(),
);
if (!(await exportBtn.isDisabled())) throw new Error('export not locked');
console.log(
  'lock line:',
  (await p.locator('[data-testid="clip-locked"]').innerText()).slice(0, 60) + '…',
);
await p.screenshot({ path: 'e2e/last-subonly.png' });

// an open VOD: nothing of this
subOnly = false;
await p.goto(BASE + `/dashboard/${VOD}?x=1`);
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 30000,
});
await p.waitForTimeout(500);
const open =
  (await p.locator('[data-testid="sub-only"]').count()) === 0 &&
  (await p.locator('[data-testid="clip-locked"]').count()) === 0;
console.log('open VOD shows no notice:', open);
if (!open) throw new Error('notice shown on an open VOD');
const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
