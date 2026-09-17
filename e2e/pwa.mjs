/**
 * e2e: the two app-shell signals (2026-09-17). The install line appears in the rail only
 * when the browser offers an install (`beforeinstallprompt`, faked here), asks once and
 * remembers a "not now"; the update toast appears when the service worker has a new build
 * waiting and only reloads when the user says so.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
  // Chromium only fires this for a real installable app over https, so the test plays browser
  window.__fireInstall = () => {
    const e = new Event('beforeinstallprompt');
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: window.__choice ?? 'accepted' });
    window.dispatchEvent(e);
  };
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + '/dashboard');
await p.waitForTimeout(600);
console.log(
  'nothing offered yet:',
  (await p.locator('[data-testid="install-chip"]').count()) === 0,
);
if ((await p.locator('[data-testid="install-chip"]').count()) !== 0)
  throw new Error('install line shown unprompted');

await p.evaluate(() => window.__fireInstall());
await p.locator('[data-testid="install-chip"]').waitFor({ state: 'visible', timeout: 5000 });
console.log(
  'offered:',
  (await p.locator('[data-testid="install-chip"]').innerText()).replace(/\s+/g, ' '),
);
await p.locator('[data-testid="install-go"]').click();
await p.waitForTimeout(300);
console.log(
  'after accepting, the line is gone:',
  (await p.locator('[data-testid="install-chip"]').count()) === 0,
);

// "not now" is remembered: a fresh load with the same offer says nothing
await p.evaluate(() => window.__fireInstall());
await p.waitForTimeout(200);
if ((await p.locator('[data-testid="install-chip"]').count()) === 1) {
  await p.locator('[data-testid="install-no"]').click();
  await p.waitForTimeout(200);
}
await p.reload();
await p.waitForTimeout(600);
await p.evaluate(() => window.__fireInstall());
await p.waitForTimeout(300);
const again = await p.locator('[data-testid="install-chip"]').count();
console.log(
  'after "not now", it stays quiet on the next visit:',
  again === 0,
  '· flag:',
  await p.evaluate(() => localStorage.getItem('hypeline.install.dismissed')),
);
if (again !== 0) throw new Error('the dismissal was not remembered');

// the update toast: the app tells, never reloads by itself
const toast = p.locator('[data-testid="update-toast"]');
console.log('no toast while the build is current:', (await toast.count()) === 0);
await p.evaluate(() => (window.__stamp = Math.random()));
await p.evaluate(() => window.dispatchEvent(new Event('hypeline:update-ready')));
await toast.waitFor({ state: 'visible', timeout: 5000 });
console.log('toast:', (await toast.innerText()).replace(/\s+/g, ' '));
const alive = await p.evaluate(() => window.__stamp !== undefined);
console.log('the page did not reload by itself:', alive);
if (!alive) throw new Error('the app reloaded without being asked');
// "Later" hides it until the next visit
await toast.locator('button[title="Later"]').click();
await toast.waitFor({ state: 'hidden', timeout: 3000 });
console.log('Later dismisses it');
await p.evaluate(() => window.dispatchEvent(new Event('hypeline:update-ready')));
await toast.waitFor({ state: 'visible', timeout: 5000 });
await p.locator('[data-testid="update-reload"]').click();
await p.waitForFunction(() => window.__stamp === undefined, null, { timeout: 10000 });
console.log('Reload reloads the page');
const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
