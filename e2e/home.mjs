/**
 * e2e: the dashboard home (ADR-19). Not connected → the invitation; connected (a token is
 * seeded in localStorage, Helix is mocked) → live channels and latest VODs; a VOD card opens
 * that VOD; the rail's home button goes back to the home and clears it; `/dashboard` never
 * shows the last VOD by itself. The sign-in return (`#access_token=…`) is exercised too.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const VOD = '2871164819';

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => { localStorage.setItem('hypeline.locale', 'en'); localStorage.setItem('hypeline.tour.v1', 'done'); });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.route('https://id.twitch.tv/oauth2/validate', (route) =>
  route.fulfill({ json: { client_id: 'x', login: 'angel', user_id: '42', expires_in: 5000000, scopes: ['user:read:follows'] } }),
);
await p.route('https://api.twitch.tv/helix/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith('/channels/followed'))
    return route.fulfill({
      json: {
        data: [
          { broadcaster_id: '1', broadcaster_login: 'tokyosims', broadcaster_name: 'tokyosims' },
          { broadcaster_id: '2', broadcaster_login: 'quiet', broadcaster_name: 'Quiet' },
        ],
      },
    });
  if (u.pathname.endsWith('/users'))
    return route.fulfill({ json: { data: [{ id: '1', profile_image_url: 'https://static-cdn.jtvnw.net/x.png' }] } });
  if (u.pathname.endsWith('/streams/followed'))
    return route.fulfill({
      json: {
        data: [
          {
            user_id: '2',
            user_login: 'quiet',
            user_name: 'Quiet',
            title: 'live right now',
            game_name: 'Just Chatting',
            viewer_count: 321,
            started_at: new Date(Date.now() - 3600_000).toISOString(),
            thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_quiet-{width}x{height}.jpg',
          },
        ],
      },
    });
  if (u.pathname.endsWith('/videos')) {
    if (u.searchParams.get('user_id') === '2') return route.fulfill({ json: { data: [] } });
    return route.fulfill({
      json: {
        data: [
          {
            id: VOD,
            title: 'Fixture VOD',
            created_at: new Date(Date.now() - 7200_000).toISOString(),
            duration: '6h24m2s',
            view_count: 10,
            thumbnail_url: 'https://static-cdn.jtvnw.net/cf_vods/x/thumb/thumb-%{width}x%{height}.jpg',
          },
        ],
      },
    });
  }
  return route.fulfill({ status: 404, body: '{}' });
});
await p.route('https://static-cdn.jtvnw.net/**', (route) =>
  route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }),
);
await p.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (!Array.isArray(body))
    return route.fulfill({ json: { data: { video: { id: VOD, title: 'Fixture VOD', lengthSeconds: 600, createdAt: '2026-09-11T11:49:00Z', viewCount: 1, seekPreviewsURL: null, status: 'RECORDED', owner: { login: 'tokyosims', displayName: 'tokyosims' }, game: { name: 'Just Chatting' } } } } });
  return route.fulfill({ json: [{ errors: [{ message: 'x' }], data: { video: { comments: null } } }] });
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({ contentType: 'application/javascript', body: `window.Twitch={Player:class{constructor(){this.l={};setTimeout(()=>this.l.ready?.forEach(f=>f()),10);}seek(){}play(){}pause(){}getCurrentTime(){return 0;}addEventListener(e,f){(this.l[e]||=[]).push(f);}destroy(){}}};window.Twitch.Player.READY='ready';window.Twitch.Player.PLAYING='playing';` }),
);

// 1. not connected: the invitation
await p.goto(BASE + '/dashboard');
await p.waitForTimeout(500);
const invite = (await p.locator('.home-invite').innerText()).replace(/\s+/g, ' ');
console.log('invitation:', invite.slice(0, 90) + '…');
const hasConnect = (await p.getByRole('button', { name: 'Connect Twitch' }).count()) === 1;
console.log('Connect Twitch button:', hasConnect, '(absent when the build has no client id)');

// 2. back from Twitch with a token in the hash → connected home
// (a hash-only change is not a navigation: come from another page, as Twitch's redirect does)
await p.goto(BASE + '/clips');
await p.evaluate(() => sessionStorage.setItem('hypeline.twitch.state', 's1'));
await p.goto(BASE + '/dashboard#access_token=tok123&scope=user%3Aread%3Afollows&state=s1&token_type=bearer');
await p.waitForFunction(() => /Your Twitch · angel/i.test(document.body.innerText), null, { timeout: 15000 });
await p.waitForFunction(() => /Latest VODs · 1/i.test(document.body.innerText), null, { timeout: 15000 });
console.log('hash cleared:', (await p.evaluate(() => location.hash)) === '');
console.log('headline:', (await p.locator('h1').first().innerText()).replace(/\s+/g, ' '));
const cards = await p.locator('.home-card').allInnerTexts();
console.log('cards:', cards.map((c) => c.replace(/\s+/g, ' ')));
if (!cards.some((c) => /LIVE/.test(c)) || !cards.some((c) => /Fixture VOD/.test(c))) throw new Error('home cards missing');
await p.screenshot({ path: 'e2e/last-home.png' });

// 3. a VOD card opens the VOD; the rail's home button comes back to an empty home
await p.locator('.home-card', { hasText: 'Fixture VOD' }).click();
await p.waitForURL(new RegExp(`/dashboard/${VOD}$`), { timeout: 10000 });
await p.waitForFunction(() => /Fixture VOD/.test(document.querySelector('h1')?.textContent ?? ''), null, { timeout: 30000 });
console.log('opened the VOD from its card');
await p.getByRole('button', { name: 'Dashboard home' }).click();
await p.waitForURL(/\/dashboard$/, { timeout: 5000 });
await p.waitForFunction(() => /Your Twitch · angel/i.test(document.body.innerText), null, { timeout: 5000 });
console.log('home again, VOD cleared:', (await p.locator('svg.hl-timeline').count()) === 0);

// 4. reload of /dashboard stays the home (token persisted)
await p.reload();
await p.waitForFunction(() => /Your Twitch · angel/i.test(document.body.innerText), null, { timeout: 15000 });
console.log('reload keeps the home');
const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
