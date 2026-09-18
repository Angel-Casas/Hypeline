/**
 * e2e: chat vocabulary (ADR-29). A Spanish chat whose clip requests the English lists cannot
 * see: the dashboard finds few moments, the overlay's "seen in this VOD" offers the words the
 * chat actually used, adding one re-scores in place (no refetch), the before/after strip moves,
 * the moments list changes, and the choice survives a reload. Detection turns on Español by
 * itself. Run: npx vite preview --port 4173 & then node e2e/vocab.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const VOD = '99887766';
const LENGTH = 3600;

/**
 * A Spanish chat at a flat rate — no volume spikes anywhere — where in four 15-second windows
 * the same number of people say "clipea eso" instead of the usual chatter. Only the *words*
 * differ, so the base scoring cannot see these moments and the vocabulary is the whole reason
 * they surface. Every line is unique: the bot filter drops any (user, text) pair it sees four
 * times.
 */
const BURSTS = [600, 1500, 2400, 3000];
function chat() {
  const out = [];
  let i = 0;
  for (let t = 0; t < LENGTH; t += 3) {
    const asking = BURSTS.some((at) => t >= at && t < at + 15);
    out.push({
      i: i++,
      t,
      u: (asking ? 'clipper' : 'hab') + (t % 45),
      m: asking ? `CLIPEA ESO crack ${t}` : `hablando tranquilo de la vida ${t}`,
      b: [],
    });
  }
  return out;
}
const MESSAGES = chat();

function chunkAt(offset) {
  const start = Math.max(
    0,
    MESSAGES.findIndex((m) => m.t >= offset),
  );
  const slice = MESSAGES.slice(start, start + 120);
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
    pageInfo: { hasNextPage: start + 120 < MESSAGES.length },
  };
}

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
  localStorage.setItem('hypeline.settings.v1', JSON.stringify({ sensitivity: 3 }));
});
await ctx.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  // the info query goes alone; the chat pages come batched
  if (!Array.isArray(body))
    return route.fulfill({
      json: {
        data: {
          video: {
            id: VOD,
            title: 'Una tarde cualquiera',
            lengthSeconds: LENGTH,
            createdAt: '2026-09-01T12:00:00Z',
            viewCount: 1,
            seekPreviewsURL: null,
            owner: { login: 'canalito', displayName: 'canalito' },
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
  timeout: 60000,
});
/** The times on the moment chips: the slider fixes how many surface, so it is *which* ones. */
const momentTimes = async () =>
  (await p.locator('ol.chips li b').allInnerTexts()).map((s) => s.trim()).sort();
const before = await momentTimes();
console.log('moments with the English lists only:', before.length, '·', before.join(' '));

await p.locator('[data-testid="vocab-open"]').click();
await p.locator('[data-testid="vocab-overlay"]').waitFor({ state: 'visible', timeout: 10000 });

// what the chat actually said, ranked by people at once — "clipea" must be in there
const seen = await p.locator('[data-testid="vocab-overlay"] .tok b').allInnerTexts();
console.log('seen in this VOD (top 6):', seen.slice(0, 6).join(', '));
if (!seen.includes('clipea')) throw new Error('"clipea" not offered: ' + seen.slice(0, 12));

// detection should notice this chat is Spanish without being told
await p.locator('[data-testid="vocab-detect"]').click();
await p.waitForTimeout(400);
const packs = await p
  .locator('[data-testid="vocab-overlay"] .pack[aria-pressed="true"]')
  .allInnerTexts();
console.log('packs on after detect:', packs.map((s) => s.split('\n')[0].trim()).join(', '));
if (!packs.some((s) => /Español/.test(s))) throw new Error('Español not detected');
// and it has to *say* so: the button was silent whenever nothing changed (Angel, 2026-09-18)
const note = await p.locator('[data-testid="vocab-detect-note"]').innerText();
console.log('detect said:', note.trim());
if (!/Español/.test(note)) throw new Error('detection did not report what it turned on');
// clicking again, with nothing left to add, must still answer
await p.locator('[data-testid="vocab-detect"]').click();
await p.waitForTimeout(300);
const again = await p.locator('[data-testid="vocab-detect-note"]').innerText();
console.log('and again:', again.trim());
if (!again.trim()) throw new Error('a second detect said nothing at all');

const delta = await p.locator('[data-testid="vocab-delta"]').innerText();
console.log('strip says:', delta.replace(/\s+/g, ' '));
if (/no change/.test(delta)) throw new Error('the before/after strip did not move');

await p.locator('[data-testid="vocab-close"]').click();
await p.waitForTimeout(600);
const after = await momentTimes();
console.log('moments after the Spanish pack:', after.length, '·', after.join(' '));
const AT = ['0:10:00', '0:25:00', '0:40:00', '0:50:00'];
const found = AT.filter((t) => after.includes(t));
const beforeFound = AT.filter((t) => before.includes(t));
console.log('bursts surfaced · before:', beforeFound.length, '· after:', found.length);
if (found.length <= beforeFound.length)
  throw new Error(`the Spanish clip requests did not surface: ${beforeFound} → ${found}`);

// English is a choice now, not a law (ADR-31). Turning it off must reach the scoring — and it
// must leave the other packs alone, which is the whole point of them being separate switches.
await p.locator('[data-testid="vocab-open"]').click();
const en = p.locator('[data-testid="vocab-pack-en"]');
await en.click();
await p.waitForTimeout(500);
if ((await en.getAttribute('aria-pressed')) !== 'false')
  throw new Error('English did not switch off');
const struck = await p
  .locator('[data-testid="vocab-overlay"] [data-list="important"] .vchip.off')
  .count();
if (struck < 5) throw new Error(`the English words should read as off, got ${struck}`);
await p.locator('[data-testid="vocab-close"]').click();
await p.waitForTimeout(700);
const withoutEn = await momentTimes();
const keptBursts = AT.filter((t) => withoutEn.includes(t));
console.log('with English off · bursts still surfaced:', keptBursts.length);
if (keptBursts.length !== found.length)
  throw new Error(`switching English off disturbed Español: ${found} → ${keptBursts}`);
await p.locator('[data-testid="vocab-open"]').click();
await en.click();
await p.waitForTimeout(400);
if ((await en.getAttribute('aria-pressed')) !== 'true')
  throw new Error('English did not come back');
await p.locator('[data-testid="vocab-close"]').click();
await p.waitForTimeout(400);

// a word of one's own, and it survives a reload
await p.locator('[data-testid="vocab-open"]').click();
await p.locator('[data-testid="vocab-add-important"]').fill('tranquilo');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
await p.locator('[data-testid="vocab-close"]').click();
await p.reload();
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 60000,
});
await p.locator('[data-testid="vocab-open"]').click();
await p.locator('[data-testid="vocab-overlay"]').waitFor({ state: 'visible', timeout: 10000 });
const kept = await p.locator('[data-testid="vocab-overlay"] .vchip.mine').allInnerTexts();
console.log('kept across a reload:', kept.map((s) => s.trim().split('\n')[0]).join(', '));
if (!kept.some((s) => /tranquilo/.test(s))) throw new Error('the added word did not persist');

// reset puts everything back
await p.locator('[data-testid="vocab-reset"]').click();
await p.waitForTimeout(500);
if ((await p.locator('[data-testid="vocab-overlay"] .vchip.mine').count()) !== 0)
  throw new Error('reset left words behind');
console.log('reset clears the lists');
await p.locator('[data-testid="vocab-close"]').click();
await p.waitForTimeout(600);
console.log('moments back to:', (await momentTimes()).join(' '));

const real = errors.filter((e) => !/ResizeObserver/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
