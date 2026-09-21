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
 * Two volume spikes, far from every mood window. The first is ordinary chatter: a moment the
 * rate scorer owns alone. The second is a **raid** — a flood of messages that is *also* the
 * room going hyped, which is the case Angel hit on 2026-09-21. It has to end up with a pin
 * and an undimmed chip, because both things are true of it; the first version of this layer
 * discarded the mood peak as a duplicate and then hid the rate pin, leaving a visible swell
 * on the ribbon with nothing on it at all.
 */
const BURST = [180, 3300];
const RAID = 3300;
const BURST_LEN = 30;

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
  // the bursts: plain chatter, but a lot of it, so the heatmap has peaks of its own to dim
  for (const at of BURST) {
    for (let t = at; t < at + BURST_LEN; t += 1) {
      for (let k = 0; k < 4; k++) {
        const m = at === RAID ? `POGGERS raid ${t}.${k}` : `wow look at that ${t}.${k}`;
        out.push({ i: i++, t, u: `b${(t * 5 + k) % 120}`, m, b: [] });
      }
    }
  }
  out.sort((a, b) => a.t - b.t || a.i - b.i);
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
// short enough that the page scrolls and the second row of chips sits below the fold: the
// scroll guard in chooseAxis needs a chip that is off screen to catch a jump (2a)
const ctx = await b.newContext({ viewport: { width: 1440, height: 500 } });
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

/*
 * The control is a MenuButton (ADR-27), not a `<select>`: a silk pill that opens the same
 * paper menu the clip pills use. So the test clicks it like a person would, which also means
 * every run exercises the teleported menu, the outside-click close and the pill's own label.
 */
const LABEL = {
  '': 'Off',
  'joy-sorrow': 'Joy ↔ Sorrow',
  'hype-letdown': 'Hype ↔ Letdown',
  'dread-payoff': 'Dread ↔ Payoff',
};
const axisValue = async () => (await axis.locator('.pick-v').innerText()).trim();
async function chooseAxis(key) {
  // choosing a mood rewrites the moments, which can silently move the "active" one, whose
  // keep-in-view used to scroll the *page* (Angel, 2026-09-21). The page must not move.
  const before = await p.evaluate(() => window.scrollY);
  await axis.click();
  const menu = p.locator('[data-testid="pick-menu"]');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  await menu.locator('[role="menuitemradio"]', { hasText: LABEL[key] }).first().click();
  await menu.waitFor({ state: 'hidden', timeout: 5000 });
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => window.scrollY);
  if (Math.abs(after - before) > 1)
    throw new Error(`choosing ${LABEL[key]} scrolled the page from ${before} to ${after}`);
}
const times = async () =>
  (await p.locator('ol.chips li b').allInnerTexts()).map((s) => s.trim()).sort();

// --- 1. off by default, and the flat hour gives the rate scorer nothing to say ----------
await axis.waitFor({ state: 'visible', timeout: 20000 });
// a little down, with the pill still in view — so a jump either way is measurable and the
// browser has no reason of its own to move (a click on an off-screen pill would)
await p.evaluate(() => window.scrollTo(0, 60));
await p.waitForTimeout(200);
console.log('page scrolled to', await p.evaluate(() => window.scrollY), 'before any choice');
if ((await axisValue()) !== LABEL['']) throw new Error('the layer should start off');
// it is our own pill, and it says so to a screen reader
if ((await axis.getAttribute('aria-haspopup')) !== 'menu')
  throw new Error('the mood control is not announced as a menu');
if ((await axis.getAttribute('aria-expanded')) !== 'false')
  throw new Error('the menu claims to be open before it is');
if ((await emoChips.count()) !== 0) throw new Error('mood chips before the layer is on');
const flat = await times();
console.log('layer off · moments:', flat.length, '·', flat.join(' '));
if (!flat.length) throw new Error('the rate scorer should find the two bursts');
const pinsOff = await p.locator('.pin-dot').count();
console.log('pins on the thread:', pinsOff);
if ((await p.locator('ol.chips li.is-dim').count()) !== 0)
  throw new Error('moments dimmed with no mood chosen');
if ((await p.locator('[data-testid="emo-ribbon"]').count()) !== 0)
  throw new Error('mood ribbon drawn while off');

// --- 2. joy ↔ sorrow: the laughter and the grief appear, labelled -----------------------
await chooseAxis('joy-sorrow');
if ((await p.locator('[data-testid="emo-ribbon"]').count()) !== 1)
  throw new Error('no mood ribbon drawn');
// it wears the thread's own three layers, not a flat fill
if ((await p.locator('[data-testid="emo-ribbon"] path').count()) !== 3)
  throw new Error('the mood ribbon is not drawn like the thread');
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

// The ribbon must have shape, and it must be *asymmetric* about the spine — that
// asymmetry is the whole reading, and a symmetric one would just be the thread again.
const d = await p.locator('[data-testid="emo-ribbon"] path').first().getAttribute('d');
const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
const mid = 60; // H / 2
const up = mid - Math.min(...ys);
const down = Math.max(...ys) - mid;
console.log(`ribbon reach — up ${up.toFixed(1)}, down ${down.toFixed(1)} (viewBox units)`);

/*
 * It has to be a *curve*, not a polyline (Angel, 2026-09-21). The second difference of the
 * top edge measures that directly: for a smooth function sampled evenly it is f''·h², small
 * and evenly spread, while a corner spikes it whatever the sampling. This exact number is
 * how the three causes were found and killed — linear interpolation between bucket centres
 * (2.74), then the sampling density (1.31), then clipping the peak flat at a percentile
 * (0.82). A true gaussian at this amplitude and step predicts 0.22; we measure 0.20.
 */
const top = ys.slice(0, 481);
let kink = 0;
for (let i = 1; i < top.length - 1; i++)
  kink = Math.max(kink, Math.abs(top[i - 1] - 2 * top[i] + top[i + 1]));
console.log('sharpest turn in the curve:', kink.toFixed(3), '(a polyline scored 2.74)');
if (kink > 0.45) throw new Error(`the ribbon has corners in it: ${kink.toFixed(3)}`);
if (up < 5 || down < 5) throw new Error(`a pole is flat: up ${up} down ${down}`);
if (Math.abs(up - down) < 1) throw new Error('the ribbon is symmetric — poles are not separate');

// the thread is still there, as a ghost, and it has given up its colour
const ghost = await p
  .locator('.thread-muted')
  .evaluate((el) => [el.getAttribute('opacity'), getComputedStyle(el).filter].join(' '));
console.log('thread underneath:', ghost);
if (!/grayscale/.test(ghost)) throw new Error('the thread kept its colour under the layer');

// the pins on the ribbon belong to the mood now; the rate peaks stay in the list, dimmed.
// Every row is one of exactly two kinds: the mood's (bright, pinned) or the heatmap's (dim).
const pinCount = await p.locator('.pin-dot').count();
const dimmed = await p.locator('ol.chips li.is-dim').count();
const emoCount = await emoChips.count();
const bright = await p.locator('ol.chips li:not(.is-dim)').count();
console.log(
  `pins on the ribbon: ${pinCount} (mood moments ${emoCount}) · bright ${bright} · dimmed ${dimmed}`,
);
if (pinCount !== emoCount)
  throw new Error(`the rate peaks still have pins: ${pinCount} pins for ${emoCount} moments`);
if (bright !== emoCount) throw new Error(`bright ${bright} but mood moments ${emoCount}`);
// and bright means *warm*: a mood chip carries its height as heat (0..1). A stale divisor
// once left every one of them at a tenth of its colour, undimmed and yet dark.
const heats = await p
  .locator('ol.chips li:not(.is-dim)')
  .evaluateAll((els) => els.map((e) => Number(e.style.getPropertyValue('--h'))));
console.log('mood chip heat:', heats.map((h) => h.toFixed(2)).join(' '));
if (Math.max(...heats) < 0.6) throw new Error('mood chips are cold: ' + heats.join(' '));
if (dimmed !== flat.length)
  throw new Error(`expected ${flat.length} dimmed rate chips, got ${dimmed}`);
// dimmed, not gone, and still clickable. Polled rather than read once: the dim is a 140ms
// fade, and reading it the instant the class lands catches the transition mid-flight.
const box = await p.locator('ol.chips li.is-dim').first().boundingBox();
if (!box || box.width < 10) throw new Error('a dimmed chip is not on screen');
await p.waitForFunction(
  () => {
    const el = document.querySelector('ol.chips li.is-dim');
    if (!el) return false;
    const o = Number(getComputedStyle(el).opacity);
    return o > 0.15 && o < 0.6;
  },
  null,
  { timeout: 5000 },
);
const op = await p
  .locator('ol.chips li.is-dim')
  .first()
  .evaluate((el) => Number(getComputedStyle(el).opacity));
console.log('a dimmed chip settles at opacity', op);
// and a click on it still selects that moment
await p.locator('ol.chips li.is-dim').first().click();
await p.waitForTimeout(300);
if ((await p.locator('ol.chips li.is-on').count()) === 0)
  throw new Error('a dimmed moment is not clickable');
console.log('a dimmed moment is still selectable');

// --- 2a. the page must not move when a choice silently changes the "active" moment -----
// The active moment is derived from the list (first in the clip range, else near the
// playhead). Select a joy moment in the grid's second row — below the fold at this viewport —
// switch to hype (it vanishes, active → none), switch back (it reappears, active → it
// again): the list's keep-in-view fires, and it used to scroll the *page* to the chip
// (Angel, 2026-09-21). chooseAxis measures window.scrollY around every choice; with the old
// scrollIntoView this step fails (60 → 127), with the grid-only scroll the page stays put.
await p.evaluate(() => window.scrollTo(0, 60));
await p.locator('ol.chips li', { hasText: '0:30:45' }).first().click();
await p.waitForTimeout(400);
await p.evaluate(() => window.scrollTo(0, 60));
await p.waitForTimeout(150);
await chooseAxis('hype-letdown');
await chooseAxis('joy-sorrow');
console.log('active moment came and went; page still at', await p.evaluate(() => window.scrollY));

// --- 2b. the raid: a volume spike that is also a mood peak ------------------------------
// clicking a moment zooms the timeline to it, so start from a clean view: otherwise the
// pins we are about to count are simply outside the window (which cost me twenty minutes)
await p.reload();
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 90000,
});
await axis.waitFor({ state: 'visible', timeout: 20000 });
await chooseAxis('hype-letdown');
const raidAt = '0:55:00';
const chip = p.locator('ol.chips li', { hasText: raidAt }).first();
await chip.waitFor({ state: 'visible', timeout: 10000 });
const raidLabel = await chip.getAttribute('aria-label');
const raidDim = await chip.evaluate((el) => el.classList.contains('is-dim'));
const raidIsMood = (await chip.locator('[data-testid="moment-emo"]').count()) === 1;
const hypePins = await p.locator('.pin-dot').count();
const hypeMoods = await emoChips.count();
const hypeBright = await p.locator('ol.chips li:not(.is-dim)').count();
console.log(`raid chip @${raidAt}: dimmed=${raidDim} mood-chip=${raidIsMood} · "${raidLabel}"`);
console.log(
  `hype↔letdown · pins ${hypePins} · mood chips ${hypeMoods} · bright chips ${hypeBright}`,
);
if (raidDim) throw new Error('the raid was dimmed — the mood claimed it, it is not context');
if (!raidIsMood) throw new Error('the raid the mood claimed is not shown as a mood moment');
if (!/hyped/.test(raidLabel ?? ''))
  throw new Error('the raid chip does not say the room was hyped: ' + raidLabel);
// the whole rule in one line: with a mood chosen, bright rows and pinned peaks are one set
if (hypeBright !== hypeMoods || hypePins !== hypeMoods)
  throw new Error(`bright ${hypeBright}, mood ${hypeMoods}, pins ${hypePins} — these must agree`);
// its pin has to be on the ribbon: a peak you can see is a peak you can click
if (hypePins < 1) throw new Error('the raid peak has no pin on the ribbon');
// and it is the *only* pin: the other rate peak was not a mood peak, so it steps aside
if (hypePins !== 1)
  throw new Error(`expected just the raid pinned on the mood ribbon, got ${hypePins}`);

// --- 2c. hovering a menu entry previews that mood on the ribbon, animated ---------------
// joy is the choice; rest the pointer on hype in the open menu and the ribbon *becomes*
// hype for as long as it is there, morphing rather than swapping; the pins step aside; the
// pill and the list keep the choice. Leave, and it slides back.
await chooseAxis('joy-sorrow');
const ribbonD = async () =>
  (await p.locator('[data-testid="emo-ribbon"] path').first().getAttribute('d')) ?? '';
const d0 = await ribbonD();
await axis.click();
const menu = p.locator('[data-testid="pick-menu"]');
await menu.waitFor({ state: 'visible', timeout: 5000 });
await menu.locator('[role="menuitemradio"]', { hasText: LABEL['hype-letdown'] }).first().hover();
await p.waitForTimeout(140);
const dMid = await ribbonD();
const labelMid = (await p.locator('[data-testid="emo-up"]').innerText()).trim();
const asideMid = await p.locator('.pin.is-aside').count();
await p.waitForTimeout(700);
const d1 = await ribbonD();
const pillMid = await axisValue();
console.log(
  `preview: label "${labelMid}" · pins aside ${asideMid} · pill still "${pillMid}" · frames differ: ` +
    `${d0 !== dMid && dMid !== d1 && d0 !== d1}`,
);
if (labelMid !== 'hyped') throw new Error('hovering hype did not preview hype: ' + labelMid);
if (pillMid !== LABEL['joy-sorrow']) throw new Error('a preview changed the choice');
if (asideMid === 0) throw new Error("the chosen mood's pins stayed up during a preview");
if (d0 === d1) throw new Error('the ribbon did not change under the pointer');
if (dMid === d0 || dMid === d1) throw new Error('the ribbon swapped instead of morphing');
// leaving the menu slides it back to the choice
await p.mouse.move(5, 5);
await menu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
await p.keyboard.press('Escape');
await p.waitForTimeout(800);
const backLabel = (await p.locator('[data-testid="emo-up"]').innerText()).trim();
console.log(
  `after leaving: label "${backLabel}" · pins aside ${await p.locator('.pin.is-aside').count()}`,
);
if (backLabel !== 'laughing')
  throw new Error('the ribbon did not return to the choice: ' + backLabel);
if ((await p.locator('.pin.is-aside').count()) !== 0) throw new Error('pins still aside');

// --- 3. the case the heatmap cannot see: chat tensed up and said *less* -----------------
await chooseAxis('dread-payoff');
const dread = await times();
console.log('dread↔payoff · moments:', dread.length, '·', dread.join(' '));
const reasons = await p
  .locator('ol.chips li')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
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
const kept = await axisValue();
console.log('after reload the pill reads:', kept);
if (kept !== LABEL['dread-payoff']) throw new Error('the axis was not remembered: ' + kept);

// --- 5. turning it off leaves the app exactly as it was --------------------------------
await chooseAxis('');
if ((await p.locator('.emo-up').count()) !== 0) throw new Error('lobes left behind');
const back = await times();
console.log('layer off again · moments:', back.length);
if (back.join(' ') !== flat.join(' ')) throw new Error('turning it off changed the list');

const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
