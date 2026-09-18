import { chromium } from 'playwright';
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--no-proxy-server'],
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, ignoreHTTPSErrors: true });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
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
await p.goto('http://localhost:4173/live/' + (process.env.CH ?? 'xqc'));
await p.waitForFunction(
  () => /chat connected|is offline|Could not/.test(document.body.innerText),
  null,
  { timeout: 30000 },
);
await p.evaluate(() => {
  window.__hidden = true;
});
const N = Number(process.env.N ?? 20);
for (let i = 0; i < N; i++) {
  await p.waitForTimeout(15000);
  const line = await p
    .locator('.font-mono.text-\\[11px\\]')
    .first()
    .innerText()
    .catch(() => '');
  const feed = await p.locator('ol li').count();
  console.log(
    `${(i + 1) * 15}s:`,
    line.replace(/\s+/g, ' '),
    '· feed',
    feed,
    '· title',
    await p.title(),
  );
}
console.log('notifications:', await p.evaluate(() => window.__notes));
console.log((await p.locator('section').first().innerText()).replace(/\s+/g, ' ').slice(0, 600));
await p.evaluate(() => {
  window.__hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(300);
console.log('title after return:', await p.title());
await p.screenshot({ path: '/tmp/claude-0/live.png' });
console.log('page errors:', errors.length ? errors : 'none');
await b.close();
