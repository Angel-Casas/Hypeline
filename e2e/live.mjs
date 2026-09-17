/**
 * e2e: a live channel on the dashboard (ADR-18) with a mocked Twitch — GQL says the channel
 * is live and its VOD is recording, the chat replay is synthetic, the IRC WebSocket is served
 * by the test. The page's clock is faked. Checks: the channel resolves to its VOD, the VOD
 * is marked live with a live edge, appended chat is scored (a burst becomes a "new while
 * live" entry and a notification while hidden, with the tab-title count), the clip range
 * from a feed entry lands on the burst, and the end of the stream turns live mode off.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const VOD = '2875113048';
const T0 = Date.now();
const STARTED = T0 - 600_000; // the stream began 10 min ago; the VOD 5 s later
const VOD_START = STARTED + 5000;
const LENGTH = 590;

// a steady replay: 4 messages every 15 s
const fixture = [];
for (let t = 2; t < LENGTH; t += 15)
  for (let u = 0; u < 4; u++) fixture.push({ t: t + u * 0.1, u: `r${u}`, m: `replay ${t}` });
fixture.forEach((m, i) => (m.i = i));
function chunkAt(offset) {
  let start = fixture.findIndex((m) => m.t >= offset);
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

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => { localStorage.setItem('hypeline.locale', 'en'); localStorage.setItem('hypeline.tour.v1', 'done'); });
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.live.notify', '1');
  window.__notes = [];
  class N {
    static permission = 'granted';
    static requestPermission = async () => 'granted';
    constructor(t, o) {
      window.__notes.push(t + ' | ' + o.body);
    }
    close() {}
  }
  window.Notification = N;
  Object.defineProperty(document, 'hidden', { get: () => window.__hidden ?? false });
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.clock.install({ time: T0 });

let streaming = true;
await p.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (Array.isArray(body)) {
    const off = body[0].variables.contentOffsetSeconds;
    const c = off > LENGTH + 200 ? null : chunkAt(off);
    if (!c)
      return route.fulfill({
        json: [{ errors: [{ message: 'service error' }], data: { video: { comments: null } } }],
      });
    return route.fulfill({ json: [{ data: { video: { comments: c } } }] });
  }
  if (body.query.includes('user(login')) {
    return route.fulfill({
      json: {
        data: {
          user: {
            id: '1',
            login: 'fixture',
            displayName: 'Fixture',
            stream: streaming
              ? { id: 's', createdAt: new Date(STARTED).toISOString(), viewersCount: 1234, title: 'Mock stream', game: { name: 'Just Chatting' } }
              : null,
            videos: { edges: [{ node: { id: VOD, createdAt: new Date(VOD_START).toISOString(), status: streaming ? 'RECORDING' : 'RECORDED' } }] },
          },
        },
      },
    });
  }
  return route.fulfill({
    json: {
      data: {
        video: {
          id: VOD,
          title: 'Mock stream',
          lengthSeconds: LENGTH,
          createdAt: new Date(VOD_START).toISOString(),
          viewCount: 1,
          seekPreviewsURL: null,
          status: streaming ? 'RECORDING' : 'RECORDED',
          owner: { login: 'fixture', displayName: 'Fixture' },
          game: { name: 'Just Chatting' },
        },
      },
    },
  });
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.__players=[];window.Twitch={Player:class{constructor(el,o){window.__players.push(this);this.o=o;this.l={};this.t=0;setTimeout(()=>this.l.ready?.forEach(f=>f()),10);}seek(s){this.t=s;}play(){this.l.playing?.forEach(f=>f());}pause(){}getCurrentTime(){return this.t;}getDuration(){return ${LENGTH};}addEventListener(e,f){(this.l[e]||=[]).push(f);}destroy(){}}};window.Twitch.Player.READY='ready';window.Twitch.Player.PLAYING='playing';`,
  }),
);
let server = null;
const joined = [];
await p.routeWebSocket('wss://irc-ws.chat.twitch.tv:443', (ws) => {
  server = ws;
  ws.onMessage((m) => {
    if (m.startsWith('JOIN')) joined.push(m);
    if (m.startsWith('PING')) ws.send('PONG');
  });
  ws.send(':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!\r\n');
});
function burst(n, at, text = 'hello chat', emotes = '') {
  for (let i = 0; i < n; i++) {
    const u = `user${i}`;
    server.send(
      `@badges=;display-name=${u};emotes=${emotes};tmi-sent-ts=${at} :${u}!${u}@${u}.tmi.twitch.tv PRIVMSG #fixture :${text}\r\n`,
    );
  }
}

// a channel resolves to the VOD that is recording it
await p.goto(BASE + '/dashboard?channel=fixture');
await p.waitForURL(new RegExp(`/dashboard/${VOD}$`), { timeout: 20000 });
await p.waitForFunction(() => /chat connected/.test(document.body.innerText), null, { timeout: 60000 });
await p.waitForTimeout(200);
console.log('resolved to', new URL(p.url()).pathname, '· joined:', joined);
if (!joined.includes('JOIN #fixture')) throw new Error('did not join the channel chat');
const line = (await p.locator('.font-mono.text-\\[11px\\]').first().innerText()).replace(/\s+/g, ' ');
console.log('VOD line:', line);
if (!/\blive\b/.test(line)) throw new Error('VOD not marked live');
if ((await p.locator('svg.hl-timeline .live-edge').count()) !== 1) throw new Error('no live edge on the ribbon');

// hide the tab; a wall of LUL arrives just past the live edge
await p.evaluate(() => {
  window.__hidden = true;
});
let v = T0;
burst(60, v + 3000, 'LUL LUL clip it', '425618:0-2,4-6');
await p.waitForTimeout(80);
v += 15000;
await p.clock.runFor(15000);
await p.waitForTimeout(50);
burst(4, v + 2000, 'calm again');
await p.waitForTimeout(80);
v += 15000;
await p.clock.runFor(15000);
await p.waitForTimeout(100);
await p.clock.runFor(4000);
await p.waitForTimeout(150);

const feed = await p.locator('ol li:has(button.tabular-nums)').allInnerTexts();
console.log('new while live:', feed.map((t) => t.replace(/\s+/g, ' ')));
if (!feed.length) throw new Error('the burst did not become a live moment');
const notes = await p.evaluate(() => window.__notes);
console.log('notifications:', notes);
if (!notes.length) throw new Error('no notification while hidden');
console.log('title while hidden:', await p.title());
if (!/^\(\d+\) /.test(await p.title())) throw new Error('title has no unseen count');
await p.evaluate(() => {
  window.__hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(100);
console.log('title after return:', await p.title());
await p.locator('ol li button.tabular-nums').first().click();
const inVal = await p.locator('input[placeholder="h:mm:ss"]').nth(0).inputValue();
console.log('clip range from the feed: In =', inVal);
// the range starts before the embed's loaded end (590 s); playback then reaches that end
// and the embed is recreated there so the new moment plays
await p.evaluate(() => {
  const pl = window.__players[window.__players.length - 1];
  pl.t = 589.6;
});
await p.clock.runFor(600);
await p.waitForTimeout(200);
const players = await p.evaluate(() => window.__players.map((pl) => pl.o.time ?? '-'));
console.log('embed loads:', players);
if (players.length < 2 || !/^0h9m50s$/.test(players[players.length - 1])) throw new Error('embed was not reloaded at the live edge');
// and a seek straight past the loaded end reloads there too
await p.locator('svg.hl-timeline').first().click({ position: { x: 900, y: 60 } });
await p.waitForTimeout(200);
const last = await p.evaluate(() => window.__players[window.__players.length - 1].o.time);
console.log('seek past the end → embed at', last);
await p.screenshot({ path: 'e2e/last-live.png' });

// the stream ends: coming back to the tab re-checks; live mode turns off, the VOD stays
streaming = false;
await p.evaluate(() => {
  window.__hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  window.__hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForFunction(() => !/chat connected/.test(document.body.innerText), null, { timeout: 10000 });
const after = (await p.locator('.font-mono.text-\\[11px\\]').first().innerText()).replace(/\s+/g, ' ');
console.log('after the stream ended:', after, '· live edge gone:', (await p.locator('svg.hl-timeline .live-edge').count()) === 0);
if (/\blive\b/.test(after)) throw new Error('still marked live after the stream ended');
const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
