/**
 * e2e: two fingers zoom and pan the ribbon (2026-09-17). A spread narrows the window, a
 * squeeze widens it back to the whole VOD, and two fingers moving together pan it; a pinch
 * never seeks, never picks the moment pin under a finger and never leaves a clip range.
 * Touches are dispatched over CDP (Playwright's own API is single-touch).
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({
  viewport: { width: 412, height: 890 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + '/dashboard/example');
await p.waitForFunction(() => /moments/.test(document.body.innerText), null, { timeout: 25000 });
await p.waitForTimeout(600);
const cdp = await ctx.newCDPSession(p);

/** The window the ribbon is showing, in seconds. */
const window_ = () =>
  p.evaluate(() => {
    const card = document.querySelector('svg.hl-timeline').closest('.glass');
    const hms = [...card.innerText.matchAll(/(\d+):(\d\d):(\d\d)/g)].map(
      (m) => +m[1] * 3600 + +m[2] * 60 + +m[3],
    );
    return { from: hms[hms.length - 2], to: hms[hms.length - 1] };
  });
const span = async () => {
  const w = await window_();
  return w.to - w.from;
};

async function pinch(from, to, steps = 8) {
  const box = await p.locator('svg.hl-timeline').first().boundingBox();
  if (!box || box.y < 0)
    throw new Error('the ribbon scrolled out of reach: ' + JSON.stringify(box));
  const y = box.y + box.height / 2;
  const pt = (x, id) => ({ x: box.x + x, y, id });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [pt(from[0], 1), pt(from[1], 2)],
  });
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [pt(from[0] + (to[0] - from[0]) * k, 1), pt(from[1] + (to[1] - from[1]) * k, 2)],
    });
    await p.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(450);
}

const whole = await span();
console.log('whole VOD span:', whole, 's');
await pinch([150, 210], [40, 340]);
const zoomed = await span();
console.log('after a spread:', zoomed, 's ·', await window_());
if (zoomed > whole * 0.7) throw new Error('the spread did not zoom in');
if ((await p.evaluate(() => Math.round(scrollY))) !== 0)
  throw new Error('the pinch scrolled the page');

const before = await window_();
await pinch([120, 240], [40, 160]);
const panned = await window_();
console.log('two fingers moving together pan:', before, '→', panned);
if (Math.abs(panned.to - panned.from - zoomed) > zoomed * 0.35)
  throw new Error('the pan changed the zoom');
if (Math.abs(panned.from - before.from) < 5) throw new Error('the pan did not move the window');

await pinch([60, 330], [195, 205]);
const out = await span();
console.log('after a squeeze:', out, 's');
if (out < whole * 0.9) throw new Error('the squeeze did not zoom back out');

// nothing was picked or clipped on the way
const tabState = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')]
      .find((t) => /clip/i.test(t.textContent))
      ?.getAttribute('aria-selected'),
  );
console.log('still on the Moments tab (no pin was clicked):', (await tabState()) === 'false');
if ((await tabState()) !== 'false') throw new Error('a pinch behaved like a pin tap');

// and one finger still works right after a pinch: a tap on a pin picks that moment
const pin = await p
  .locator('svg.hl-timeline circle[r="4.5"], svg.hl-timeline .cursor-pointer')
  .first()
  .boundingBox();
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: pin.x + pin.width / 2, y: pin.y + pin.height / 2, id: 9 }],
});
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

await p.waitForTimeout(600);
console.log('a tap after the pinch still picks a moment:', (await tabState()) === 'true');
if ((await tabState()) !== 'true') throw new Error('taps stopped working after a pinch');
const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
