/**
 * e2e: the "?" in the rail (2026-09-17). Opens the help sheet; its three doors are prefilled
 * GitHub new-issue links (template + label + title), the bug one carrying the context block
 * with the version and the open VOD; Escape closes it and returns focus to the button.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + '/dashboard');
await p.waitForTimeout(400);
await p.locator('aside [data-testid="support-button"]').click();
const sheet = p.locator('[data-testid="support-sheet"]');
await sheet.waitFor({ state: 'visible', timeout: 5000 });
console.log('headline:', await sheet.locator('h2').innerText());
const doors = await sheet
  .locator('a.door')
  .evaluateAll((as) => as.map((a) => ({ kind: a.dataset.kind, href: a.href, target: a.target })));
for (const d of doors) {
  const u = new URL(d.href);
  console.log(
    d.kind,
    '→',
    u.pathname,
    u.searchParams.get('template'),
    u.searchParams.get('labels'),
  );
  if (!u.pathname.endsWith('/issues/new') || d.target !== '_blank')
    throw new Error('door is not a new-issue link');
}
const bug = new URL(doors.find((d) => d.kind === 'bug').href).searchParams.get('context');
console.log('bug context:', bug.replace(/\n/g, ' | '));
if (!/Hypeline \d+\.\d+\.\d+ · dashboard/.test(bug) || !/language en/.test(bug))
  throw new Error('bug context missing');
if (/https?:\/\//.test(bug)) throw new Error('bug context leaks a URL');
await p.keyboard.press('Escape');
await sheet.waitFor({ state: 'hidden', timeout: 3000 });
console.log(
  'Escape closed it; focus back on the button:',
  await p.evaluate(() => document.activeElement?.dataset.testid),
);
// backdrop click closes too
await p.locator('aside [data-testid="support-button"]').click();
await sheet.waitFor({ state: 'visible' });
await p.mouse.click(20, 850);
await sheet.waitFor({ state: 'hidden', timeout: 3000 });
console.log('backdrop closed it');
const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
