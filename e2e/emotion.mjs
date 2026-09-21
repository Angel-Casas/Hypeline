/**
 * e2e: the chat-mood layer (ADR-43, 2026-09-21).
 *
 * The fixture is built so the feature has nowhere to hide: a chat so quiet that the rate
 * scorer scores every bucket zero and finds **no moments at all**. One message every eight
 * seconds, all hour. The only thing that ever changes is *what chat says* — two windows of
 * laughter, one of grief, and, the case that matters most, two where the room tenses up and
 * **halves its message rate**, which is the one shape a rate-based scorer cannot see by
 * construction, because it is looking for the opposite sign.
 *
 * So every moment this test finds is a moment the app could not have found yesterday. It
 * also forces the layer to widen its buckets before it can gather a crowd, which is the
 * other half of what makes the feature work on a small channel.
 *
 * Run: npx vite preview --port 4173 &  then  node e2e/emotion.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const VOD = '44556677';
const LENGTH = 3600;

const LAUGH = [600, 1800];
const GRIEF = [1200];
const TENSE = [2400, 3000];
const WINDOW = 180;

/**
 * A *quiet* chat: one message every 8 seconds. That is under three per 15-second bucket, so
 * the rate scorer scores every bucket zero and finds **no moments at all** — which is the
 * point. It also forces the emotion layer to widen its own buckets before it can gather a
 * crowd, so this fixture exercises the widening path as well.
 *
 * In the tense windows the chat halves its rate, to one message every 16 seconds: volume
 * *falls* while the room agrees. That is the shape no rate scorer can see, and the reason
 * the moment prints should say chat said less.
 */
function chat() {
  const out = [];
  let i = 0;
  for (let t = 0; t < LENGTH; t += 1) {
    const inAny = (xs) => xs.some((at) => t >= at && t < at + WINDOW);
    const laughing = inAny(LAUGH);
    const grieving = inAny(GRIEF);
    const tense = inAny(TENSE);
    const step = tense ? 16 : 8;
    if (t % step !== 0) continue;
    let m = `talking quietly about the stream ${t}`;
    if (laughing) m = `KEKW ${t}`;
    else if (grieving) m = `Sadge ${t}`;
    else if (tense) m = `monkaS ${t}`;
    out.push({ i: i++, t, u: `v${i % 97}`, m, b: [] });
  }
  return out;
}
const MESSAGES = chat();

function chunkAt(offset) {
  const start = Math.max(
    0,
    MESSAGES.findIndex((m) => m.t >= offset),
  );
  const slice = MESSAGES.slice(start, start + 200);
  if (!slice.length) return { edges: [], pageInfo: { hasNextPage: false } };
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
    pageInfo: { hasNextPage: start + 200 < MESSAGES.length },
  };
}

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
await ctx.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (!Array.isArray(body))
    return route.fulfill({
      json: {
        data: {
          video: {
            id: VOD,
            title: 'A perfectly level hour',
            lengthSeconds: LENGTH,
            createdAt: '2026-09-20T12:00:00Z',
            viewCount: 1,
            seekPreviewsURL: null,
            owner: { login: 'flatline', displayName: 'flatline' },
            game: { name: 'Just Chatting' },
          },
        },
      },
    });
  const off = body[0].variables.contentOffsetSeconds;
  if (off > LENGTH + 200)
    return route.fulfill({
      json: [{ errors: [{ message: 'service error' }], data: { video: { comments: null } } }],
    });
  return route.fulfill({ json: [{ data: { video: { comments: chunkAt(off) } } }] });
});
await ctx.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.Twitch = { Player: class { constructor(el, o){ this.t = 0; this.listeners = {}; setTimeout(() => this.listeners['ready']?.forEach(f => f()), 10); }
      seek(s){ this.t = s; } play(){} pause(){} getCurrentTime(){ return this.t; }
      addEventListener(e, f){ (this.listeners[e] ||= []).push(f); } } };
      window.Twitch.Player.READY = 'ready'; window.Twitch.Player.PLAYING = 'playing';`,
  }),
);

const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + `/dashboard/${VOD}`);
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 90000,
});

const axis = p.locator('[data-testid="emotion-axis"]');
const emoChips = p.locator('[data-testid="moment-emo"]');
const times = async () =>
  (await p.locator('ol.chips li b').allInnerTexts()).map((s) => s.trim()).sort();

// --- 1. off by default, and the flat hour gives the rate scorer nothing to say ----------
await axis.waitFor({ state: 'visible', timeout: 20000 });
if ((await axis.inputValue()) !== '') throw new Error('the layer should start off');
if ((await emoChips.count()) !== 0) throw new Error('mood chips before the layer is on');
const flat = await times();
console.log('layer off · moments:', flat.length, '·', flat.join(' '));
if ((await p.locator('.emo-up').count()) !== 0) throw new Error('lobes drawn while off');

// --- 2. joy ↔ sorrow: the laughter and the grief appear, labelled -----------------------
await axis.selectOption('joy-sorrow');
await p.waitForTimeout(700);
if ((await p.locator('.emo-up').count()) !== 1) throw new Error('no upper lobe drawn');
if ((await p.locator('.emo-down').count()) !== 1) throw new Error('no lower lobe drawn');
const labels = [
  (await p.locator('[data-testid="emo-up"]').innerText()).trim(),
  (await p.locator('[data-testid="emo-down"]').innerText()).trim(),
];
console.log('poles labelled:', labels.join(' / '));
if (labels[0] !== 'laughing' || labels[1] !== 'gutted')
  throw new Error('pole labels wrong: ' + labels.join(' / '));

const withJoy = await times();
const added = withJoy.filter((t) => !flat.includes(t));
console.log('joy↔sorrow · moments:', withJoy.length, '· new:', added.join(' ') || 'none');
if ((await emoChips.count()) === 0) throw new Error('no mood moments in the list');
if (withJoy.length <= flat.length) throw new Error('the layer added no moments');

// the lobes must actually have shape — a flat path would pass every check above
const upArea = await p.locator('.emo-up').getAttribute('d');
const ys = [...upArea.matchAll(/L[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
const spread = Math.max(...ys) - Math.min(...ys);
console.log('upper lobe height (viewBox units):', spread.toFixed(1));
if (spread < 5) throw new Error('the upper lobe is flat: ' + spread);

// --- 3. the case the heatmap cannot see: chat tensed up and said *less* -----------------
await axis.selectOption('dread-payoff');
await p.waitForTimeout(700);
const dread = await times();
console.log('dread↔payoff · moments:', dread.length, '·', dread.join(' '));
const reasons = await p.locator('ol.chips li').evaluateAll((els) =>
  els.map((e) => e.getAttribute('aria-label') ?? ''),
);
const quiet = reasons.filter((r) => /said less/.test(r));
console.log('moments where chat went quiet:', quiet.length);
for (const q of quiet.slice(0, 2)) console.log('   ·', q);
if (!quiet.length)
  throw new Error('the quiet-tension moments were missed — that is the whole point');

await p.screenshot({ path: 'e2e/last-emotion.png' });

// --- 4. the choice is remembered -------------------------------------------------------
await p.reload();
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 90000,
});
await axis.waitFor({ state: 'visible', timeout: 20000 });
const kept = await axis.inputValue();
console.log('after reload the axis is:', kept || '(off)');
if (kept !== 'dread-payoff') throw new Error('the axis was not remembered: ' + kept);

// --- 5. turning it off leaves the app exactly as it was --------------------------------
await axis.selectOption('');
await p.waitForTimeout(600);
if ((await p.locator('.emo-up').count()) !== 0) throw new Error('lobes left behind');
const back = await times();
console.log('layer off again · moments:', back.length);
if (back.join(' ') !== flat.join(' ')) throw new Error('turning it off changed the list');

const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
