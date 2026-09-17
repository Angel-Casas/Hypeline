/**
 * e2e: the first-visit tour (2026-09-17). A fresh browser (language chosen) lands on the
 * dashboard: the example VOD loads by itself and the tour starts; five steps, each with a
 * hole over its target and a card inside the viewport; Done stores the flag and a reload
 * shows no tour; Settings → "Show the tour" runs it again; on a phone-width viewport the
 * card never leaves the screen and the columns switch tabs as the steps go. The example
 * locks clip and AI actions and its × in the library removes it.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const errors = [];

async function walk(p, width) {
  const card = p.locator('[data-testid="tour-card"]');
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await p.waitForTimeout(550); // the veil settles after the scroll
    const step = await p.locator('[data-testid="tour"]').getAttribute('data-step');
    const r = await card.boundingBox();
    const inside = r.x >= 0 && r.y >= 0 && r.x + r.width <= width + 0.5 && r.y + r.height <= 900.5;
    const target = await p.locator(`[data-tour="${step}"]:visible`).first().boundingBox();
    seen.push(`${step}${inside ? '' : ' (CARD OFF-SCREEN)'}${target ? '' : ' (NO TARGET)'}`);
    if (!inside || !target)
      throw new Error(`step ${step} @${width}: card ${JSON.stringify(r)} target ${!!target}`);
    await p.locator('[data-testid="tour-next"]').click();
  }
  await card.waitFor({ state: 'hidden', timeout: 5000 });
  return seen;
}

// 1. desktop first visit
let ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('hypeline.locale', 'en'));
let p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + '/dashboard');
await p.waitForURL(/\/dashboard\/example$/, { timeout: 15000 });
await p.waitForFunction(
  () => /A sample stream/.test(document.querySelector('h1')?.textContent ?? ''),
  null,
  { timeout: 15000 },
);
console.log('example VOD opened by itself · steps:', await walk(p, 1280));
console.log('stored:', await p.evaluate(() => localStorage.getItem('hypeline.tour.v1')));
const line = (await p.locator('.font-mono.text-\\[11px\\]').first().innerText()).replace(
  /\s+/g,
  ' ',
);
console.log('VOD line:', line);
if (!/example/.test(line) || !/\d+ moments/.test(line))
  throw new Error('example not marked / no moments');
if ((await p.locator('.example-video:visible').count()) !== 1)
  throw new Error('no black example player');
console.log(
  'clip locked:',
  (await p.locator('[data-testid="clip-locked"]').innerText()).slice(0, 40) + '…',
);
// without a NanoGPT key the AI column is the invitation card; with one, the note locks the actions
console.log(
  'ai column:',
  (await p.locator('[data-testid="ai-example"]').count()) === 1 ? 'locked note' : 'no-key card',
);
await p.reload();
await p.waitForTimeout(1200);
if ((await p.locator('[data-testid="tour-card"]').count()) !== 0)
  throw new Error('tour came back after Done');
console.log('no tour on the second visit');
// Settings → show the tour again
await p.locator('aside button', { hasText: 'Settings' }).click();
await p.locator('[data-testid="tour-again"]').click();
await p.locator('[data-testid="tour-card"]').waitFor({ state: 'visible', timeout: 10000 });
console.log(
  'tour again from Settings, step:',
  await p.locator('[data-testid="tour"]').getAttribute('data-step'),
);
await p.keyboard.press('Escape');
await p.locator('[data-testid="tour-card"]').waitFor({ state: 'hidden' });
// the example is in the library and its × removes it, back to the home
const row = p.locator('aside li', { hasText: 'A sample stream' });
if ((await row.count()) !== 1) throw new Error('example not in the library');
await row.locator('button.purge').click();
await p.waitForURL(/\/dashboard$/, { timeout: 5000 });
console.log('example deleted → home; library rows:', await p.locator('aside li').count());
await p.screenshot({ path: 'e2e/last-tour-desktop.png' });
await ctx.close();

// 2. phone width: the card stays on screen, tabs switch with the steps
ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => localStorage.setItem('hypeline.locale', 'en'));
p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + '/dashboard');
await p.locator('[data-testid="tour-card"]').waitFor({ state: 'visible', timeout: 20000 });
await p.waitForTimeout(900);
await p.screenshot({ path: 'e2e/last-tour-phone.png' });
console.log('phone steps:', await walk(p, 390));

// re-taking it from Settings — which on a phone lives inside the open drawer — must close
// that drawer, or the tour would point at the desk from behind it (Angel, 2026-09-17)
const railX = () =>
  p.evaluate(() => Math.round(document.querySelector('aside').getBoundingClientRect().x));
await p.getByRole('button', { name: 'Library' }).click();
await p.waitForTimeout(400);
console.log('drawer open at x =', await railX());
await p.locator('aside button', { hasText: 'Settings' }).click();
await p.waitForTimeout(400);
await p.locator('[data-testid="tour-again"]').click();
await p.locator('[data-testid="tour-card"]').waitFor({ state: 'visible', timeout: 15000 });
await p.waitForTimeout(900);
const back = await railX();
console.log(
  're-taken · step',
  await p.locator('[data-testid="tour"]').getAttribute('data-step'),
  '· drawer x =',
  back,
);
if (back >= 0) throw new Error('the rail drawer stayed open over the tour');
const [hole, heat] = await p.evaluate(() =>
  [
    document.querySelector('.hole').getBoundingClientRect(),
    document.querySelector('[data-tour="heatmap"]').getBoundingClientRect(),
  ].map((r) => [Math.round(r.x), Math.round(r.y)]),
);
if (Math.abs(hole[0] - heat[0]) > 12 || Math.abs(hole[1] - heat[1]) > 12)
  throw new Error(`the hole is not on the heatmap: ${hole} vs ${heat}`);
// the rail step opens it again, Done closes it for good
for (let i = 0; i < 4; i++) {
  await p.locator('[data-testid="tour-next"]').click();
  await p.waitForTimeout(700);
}
console.log('rail step · drawer x =', await railX());
if ((await railX()) < 0) throw new Error('the rail step did not open the drawer');
await p.locator('[data-testid="tour-next"]').click();
await p.waitForTimeout(600);
console.log('after Done · drawer x =', await railX());
if ((await railX()) >= 0) throw new Error('the drawer stayed open after the tour');
await ctx.close();

const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
