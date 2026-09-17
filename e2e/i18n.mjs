/**
 * e2e: languages (ADR-20). A first visit with a German browser opens the sheet in German
 * with Deutsch pre-selected; tapping Español previews it at once; Continue stores it and the
 * dashboard is in Spanish after a reload; the rail's globe switches to 日本語 and back to
 * English, and `<html lang>` follows. A returning visitor never sees the sheet. Portuguese
 * of Portugal and Chinese of Hong Kong land on pt-BR / zh-TW. All ten catalogs are complete
 * (scripts/check-locales.mjs is run first).
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;

console.log(
  execFileSync('node', ['scripts/check-locales.mjs'], { encoding: 'utf8' }).trim().split('\n')
    .length,
  'locales validated',
);

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const errors = [];

// 1. first visit, German browser
let ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
await ctx.addInitScript(() => localStorage.setItem('hypeline.tour.v1', 'done'));
let p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + '/dashboard');
const sheet = p.locator('[data-testid="language-sheet"]');
await sheet.waitFor({ state: 'visible', timeout: 15000 });
let title = await sheet.locator('h2').innerText();
console.log('sheet title (de):', title);
if (!/Wähle deine Sprache/.test(title)) throw new Error('sheet not in German');
const checked = await sheet.locator('[role="radio"][aria-checked="true"]').innerText();
if (!/Deutsch/.test(checked)) throw new Error('German not pre-selected: ' + checked);
console.log('html lang:', await p.evaluate(() => document.documentElement.lang));
// preview Spanish, then keep it
await sheet.locator('[role="radio"]', { hasText: 'Español' }).click();
title = await sheet.locator('h2').innerText();
console.log('sheet title after tapping Español:', title);
if (!/Elige tu idioma/.test(title)) throw new Error('preview did not switch');
await p.locator('[data-testid="language-continue"]').click();
await sheet.waitFor({ state: 'hidden', timeout: 5000 });
console.log('stored:', await p.evaluate(() => localStorage.getItem('hypeline.locale')));
await p.reload();
await p.waitForTimeout(500);
if ((await sheet.count()) !== 0) throw new Error('sheet came back after a choice');
const body = await p.locator('body').innerText();
console.log('dashboard in Spanish:', /Buscar los momentos|En este navegador/i.test(body));
if (!/Buscar los momentos/i.test(body))
  throw new Error('dashboard not in Spanish: ' + body.slice(0, 200));

// 2. the globe: to Japanese and back to English
await p.locator('[data-testid="language-button"]:visible').first().click();
const menu = p.locator('[data-testid="language-menu"]');
await menu.waitFor({ state: 'visible', timeout: 5000 });
await menu.locator('[role="menuitemradio"]', { hasText: '日本語' }).click();
await menu.waitFor({ state: 'hidden', timeout: 5000 });
await p.waitForTimeout(100);
console.log(
  'ja button:',
  (await p.getByRole('button', { name: /モーメントを探す|ハイライトを探す|モーメント/ }).count()) >
    0,
  '· lang:',
  await p.evaluate(() => document.documentElement.lang),
);
if ((await p.evaluate(() => document.documentElement.lang)) !== 'ja')
  throw new Error('lang not ja');
await p.screenshot({ path: 'e2e/last-i18n-ja.png' });
await p.locator('[data-testid="language-button"]:visible').first().click();
await menu.locator('[role="menuitemradio"]', { hasText: 'English' }).click();
await p.waitForTimeout(100);
if ((await p.getByRole('button', { name: 'Find the moments' }).count()) === 0)
  throw new Error('not back in English');
console.log('back in English; Escape closes the menu:');
await p.locator('[data-testid="language-button"]:visible').first().click();
await p.keyboard.press('Escape');
await menu.waitFor({ state: 'hidden', timeout: 2000 });
await ctx.close();

// 3. regional fallbacks: pt-PT → pt-BR, zh-HK → zh-TW; and the landing page shows the sheet too
for (const [loc, want, text] of [
  ['pt-PT', 'pt-BR', /Escolha o seu idioma|Escolha seu idioma/],
  ['zh-HK', 'zh-TW', /選擇你的語言/],
]) {
  ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: loc });
  await ctx.addInitScript(() => localStorage.setItem('hypeline.tour.v1', 'done'));
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/');
  await p.locator('[data-testid="language-sheet"]').waitFor({ state: 'visible', timeout: 15000 });
  const t = await p.locator('[data-testid="language-sheet"] h2').innerText();
  const lang = await p.evaluate(() => document.documentElement.lang);
  console.log(`${loc} → ${lang}: ${t}`);
  if (lang !== want || !text.test(t)) throw new Error(`${loc} did not land on ${want}`);
  if (loc === 'zh-HK') await p.screenshot({ path: 'e2e/last-i18n-sheet.png' });
  await ctx.close();
}

// 4. a returning visitor with a stored choice: no sheet, straight to that language
ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
await ctx.addInitScript(() => localStorage.setItem('hypeline.tour.v1', 'done'));
await ctx.addInitScript(() => localStorage.setItem('hypeline.locale', 'fr'));
p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(BASE + '/clips');
await p.waitForTimeout(400);
console.log(
  'returning (fr): sheet absent =',
  (await p.locator('[data-testid="language-sheet"]').count()) === 0,
  '· lang =',
  await p.evaluate(() => document.documentElement.lang),
);
if ((await p.evaluate(() => document.documentElement.lang)) !== 'fr')
  throw new Error('stored choice not applied');
await ctx.close();

const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
