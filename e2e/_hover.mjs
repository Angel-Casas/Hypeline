/**
 * Audit: does every interactive element answer the pointer? Walks the visible buttons, links
 * and fields on each screen and asks the CSSOM which `:hover` rules would apply to each one —
 * `:hover` cannot be forced from script, so matching the rules is the only way. Reports the
 * elements nothing would happen to, and any whose hover is an ink wash (a grey).
 *
 * Run: npx vite preview --port 4173 & then CHROMIUM=... node e2e/_hover.mjs
 */
import { chromium } from 'playwright';

const PROPS = ['backgroundColor', 'color', 'borderTopColor', 'transform', 'boxShadow', 'opacity'];

/** Selector helpers, defined inside the page callback below (Playwright serialises them). */
const audit = async (p) =>
  p.evaluate((props) => {
    /** Split a selector on a separator that is not inside brackets: `:is(a, b)` stays whole. */
    const splitTop = (str, sep) => {
      const out = [];
      let depth = 0;
      let cur = '';
      for (const ch of str) {
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        if (depth === 0 && (ch === sep || (sep === ' ' && /[>+~]/.test(ch)))) {
          if (cur.trim()) out.push(cur.trim());
          cur = '';
          continue;
        }
        cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    /** Drop the state pseudo-classes so what is left can be matched against the DOM. A hover
          often shares its rule with :focus-visible, and `:is(:hover, :focus-visible)` has to
          survive losing both halves. */
    const clean = (sel) =>
      sel
        .replace(/:hover/g, '')
        .replace(/:focus-visible|:focus-within|:focus|:active/g, '')
        .replace(/:is\(\s*,/g, ':is(')
        .replace(/,\s*\)/g, ')')
        .replace(/:is\(\s*\)/g, '')
        .replace(/::[a-z-]+$/, '')
        .trim();
    const hit = (el, q) => {
      if (!q) return false;
      try {
        return el.matches(q) || !!el.closest(q);
      } catch {
        return false;
      }
    };
    const sel = 'button, a[href], input, select, [role="button"]';
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      // a disabled control is *meant* to be inert: every tier is :not(:disabled)
      return (
        r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden' && !e.disabled
      );
    });
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      const walk = (l) => {
        for (const r of l) {
          if (r.cssRules) walk(r.cssRules);
          if (r.selectorText && r.selectorText.includes(':hover'))
            rules.push([r.selectorText, r.style.cssText]);
        }
      };
      walk(list);
    }
    return els.map((el) => {
      const mine = [];
      for (const [selectorText, css] of rules) {
        for (const one of splitTop(selectorText, ',')) {
          if (!one.includes(':hover')) continue;
          const parts = splitTop(one, ' ');
          const i = parts.findIndex((x) => x.includes(':hover'));
          const head = parts.slice(0, i + 1).join(' ');
          if (hit(el, clean(head))) mine.push([one, css]);
        }
      }
      const label = (
        el.getAttribute('data-testid') ||
        el.getAttribute('aria-label') ||
        el.textContent ||
        el.tagName
      )
        .trim()
        .slice(0, 34);
      return {
        label,
        cls: el.className.toString().slice(0, 56),
        tag: el.tagName.toLowerCase(),
        rules: mine.map((r) => r[0]),
        decls: mine.map((r) => r[1]).join(' ; '),
        style: props.map((k) => getComputedStyle(el)[k]).join('|'),
      };
    });
  }, PROPS);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
const dark = process.env.DARK === '1';
const ctx = await b.newContext({ viewport: { width: 1440, height: 980 } });
await ctx.addInitScript((d) => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
  localStorage.setItem(
    'hypeline.settings.v1',
    JSON.stringify({ theme: d ? 'dark' : 'light', sensitivity: 4 }),
  );
}, dark);
const p = await ctx.newPage();

const screens = [
  ['landing', async () => p.goto('http://localhost:4173/')],
  ['dashboard', async () => p.goto('http://localhost:4173/dashboard/example')],
  [
    'vocabulary',
    async () => {
      await p.locator('[data-testid="vocab-open"]').click();
      await p.waitForTimeout(400);
    },
  ],
  [
    'settings',
    async () => {
      await p.locator('[data-testid="vocab-close"]').click();
      await p
        .getByRole('button', { name: /^Settings$/ })
        .first()
        .click();
      await p.waitForTimeout(400);
    },
  ],
  ['gallery', async () => p.goto('http://localhost:4173/clips')],
];

let bad = 0;
const seen = new Set();
for (const [name, go] of screens) {
  await go();
  await p.waitForTimeout(1200);
  const rows = await audit(p);
  const none = rows.filter((r) => !r.rules.length);
  // an ink wash is a grey; ink mixed *with the accent* is the deliberate warm-up on solids
  const grey = rows.filter((r) =>
    /--color-ink\) (?:[123]?[0-9])%, transparent|ink\/6|rgba\(34, 28, 42/.test(r.decls),
  );
  console.log('\n== ' + name + ': ' + rows.length + ' interactive');
  for (const [kind, set] of [
    ['no hover', none],
    ['ink wash', grey],
  ]) {
    if (!set.length) continue;
    console.log('  ' + kind + ' (' + set.length + '):');
    for (const r of set) {
      const key = kind + r.tag + r.label + r.cls;
      if (!seen.has(key)) bad++;
      seen.add(key);
      console.log('    ' + r.tag + ' "' + r.label + '" .' + r.cls);
    }
  }
}
console.log(bad ? '\n' + bad + ' distinct to fix' : '\nall covered');
await b.close();
