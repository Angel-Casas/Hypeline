/**
 * e2e: whole-VOD transcription + search with NanoGPT mocked. Audio extraction runs for real in
 * ffmpeg.wasm (needs e2e/fixtures/segments — `npm run e2e:fixtures`).
 * Run: npx vite preview --port 4173 &  then  node e2e/search.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const SEG_DIR = process.env.SEG_DIR ?? 'e2e/fixtures/segments';
const SHIM = 'https://shim.test';
const VOD = '2871164819';
const LENGTH = 23042;

const fixture = readFileSync(
  new URL('../src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((l, i) => ({ i, ...JSON.parse(l) }));
function chunkAt(offset) {
  let start = fixture.findIndex((m) => m.t >= offset);
  if (start < 0) return null;
  start = Math.max(0, start - 3);
  const slice = fixture.slice(start, start + 60);
  return {
    edges: slice.map((m) => ({
      cursor: 'c' + m.i,
      node: {
        id: 'id' + m.i,
        contentOffsetSeconds: m.t,
        commenter: { login: m.u, displayName: m.u },
        message: {
          fragments: [{ text: m.m, emote: null }],
          userBadges: m.b.map((b) => ({ setID: b, version: '1' })),
        },
      },
    })),
    pageInfo: { hasNextPage: start + 60 < fixture.length },
  };
}
const master = readFileSync(join(SEG_DIR, 'master.m3u8'), 'utf8').replace(
  /https:\/\/[^/]+\/[^/]+\/(\w+)\/index-dvr\.m3u8/g,
  'https://cdn.test/vod/$1/index-dvr.m3u8',
);
const variant720 = readFileSync(join(SEG_DIR, 'variant.m3u8'), 'utf8');

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => {
  localStorage.setItem('hypeline.locale', 'en');
  localStorage.setItem('hypeline.tour.v1', 'done');
});
await ctx.addInitScript((shim) => {
  localStorage.setItem(
    'hypeline.settings.v1',
    JSON.stringify({ shimUrl: shim, preferredHeight: 720, aiApiKey: 'test-key', chatModel: '' }),
  );
}, SHIM);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

const seen = { models: 0, balance: 0, stt: null, chat: null };
await p.route('https://nano-gpt.com/api/**', async (route) => {
  const req = route.request();
  const u = req.url();
  if (u.includes('/v1/models')) {
    seen.models++;
    return route.fulfill({
      json: {
        data: [
          { id: 'openai/gpt-5.1', name: 'GPT-5.1', pricing: { prompt: 2.5, completion: 10 } },
          { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', pricing: { prompt: 0.25, completion: 2 } },
        ],
      },
    });
  }
  if (u.endsWith('/check-balance')) {
    seen.balance++;
    return route.fulfill({ json: { usd_balance: '9.87' } });
  }
  if (u.includes('/v1/audio/transcriptions')) {
    seen.stt = (seen.stt ?? 0) + 1;
    // hold the answer a moment so the timeline's transcription scan can be checked
    await new Promise((r) => setTimeout(r, 1500));
    const body = req.postDataBuffer();
    seen.lastBytes = body.length;
    seen.isMp3 = body.includes('filename="a.mp3"');
    return route.fulfill({
      json: {
        text: `chunk ${seen.stt}: grandma pulls up and chat loses it`,
        language: 'en',
        duration: 40,
      },
    });
  }
  if (u.includes('/v1/chat/completions')) {
    const j = JSON.parse(req.postData());
    seen.chat = {
      model: j.model,
      schema: j.response_format?.json_schema?.name,
      prompt: j.messages[1].content,
    };
    return route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                hits: [
                  {
                    t: 2040,
                    endT: 2070,
                    quote: 'grandma pulls up',
                    why: 'matches the request',
                    confidence: 5,
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 80 },
        nanoGPT: { cost: 0.0003 },
      },
    });
  }
  return route.fulfill({ status: 404, body: 'unmocked ' + u });
});
await p.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (!Array.isArray(body))
    return route.fulfill({
      json: {
        data: {
          video: {
            id: VOD,
            title: 'Fixture VOD',
            lengthSeconds: LENGTH,
            createdAt: '2026-09-11T11:49:00Z',
            viewCount: 1,
            seekPreviewsURL: null,
            owner: { login: 'tokyosims', displayName: 'tokyosims' },
            game: { name: 'Just Chatting' },
          },
        },
      },
    });
  if (body[0].operationName === 'PlaybackAccessToken')
    return route.fulfill({
      json: [{ data: { videoPlaybackAccessToken: { value: '{"tok":1}', signature: 'sig' } } }],
    });
  const off = body[0].variables.contentOffsetSeconds;
  const c = off > LENGTH + 200 ? null : chunkAt(off);
  if (!c)
    return route.fulfill({
      json: [{ errors: [{ message: 'service error' }], data: { video: { comments: null } } }],
    });
  return route.fulfill({ json: [{ data: { video: { comments: c } } }] });
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.Twitch = { Player: class { constructor(el,o){ this.t=0; this.l={}; setTimeout(()=>this.l['ready']?.forEach(f=>f()),10);} seek(s){this.t=s} play(){} pause(){} getCurrentTime(){return this.t} addEventListener(e,f){(this.l[e] ||= []).push(f)} } }; window.Twitch.Player.READY='ready'; window.Twitch.Player.PLAYING='playing';`,
  }),
);
await p.route(`${SHIM}/**`, async (route) => {
  const u = new URL(route.request().url()).searchParams.get('u') ?? '';
  if (u.startsWith('https://usher.ttvnw.net/'))
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: master });
  // Every variant (incl. the smallest one used for audio) is served from the same 720p segments in this test.
  if (u.endsWith('index-dvr.m3u8'))
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: variant720 });
  const f = join(SEG_DIR, u.split('/').pop());
  if (!existsSync(f)) return route.fulfill({ status: 404, body: 'segment missing' });
  return route.fulfill({ contentType: 'video/MP2T', body: readFileSync(f) });
});

await p.goto(BASE + '/vod/' + VOD);
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, {
  timeout: 60000,
});
await p.waitForFunction(() => document.body.innerText.includes('$9.87'), null, { timeout: 15000 });

// Bulk-transcribe a range inside the fixture segments (2042.8–2082.8 s): chunks are 120 s aligned → [1920,2040) has no
// segments, so use 2040–2082 → one chunk [2040,2082).
const search = p.locator('section', { has: p.locator('h2', { hasText: /^AI$/ }) }).last();
await search.getByLabel('From').fill('0:34:00');
await search.getByLabel('To').fill('0:34:42');
const bulkBtn = search.getByRole('button', { name: /Transcribe VOD/ });
console.log('bulk estimate:', (await bulkBtn.innerText()).replace(/\s+/g, ' ').trim());
await bulkBtn.click();
// while it runs: the scanning light over the chunk and the breathing band segment
await p.locator('svg.hl-timeline rect.scan').waitFor({ timeout: 20000 });
console.log(
  'transcription scan shown over the chunk:',
  (await p.locator('svg.hl-timeline rect.scan-band').count()) === 1,
);
await p.screenshot({
  path: 'e2e/last-transcribing.png',
  clip: { x: 290, y: 10, width: 980, height: 340 },
});
try {
  await p.waitForFunction(() => /0:00:42 \/ /.test(document.body.innerText), null, {
    timeout: 60000,
  });
} catch (e) {
  console.log('PANEL:', (await search.innerText()).replace(/\s+/g, ' ').slice(0, 600));
  console.log('seen:', JSON.stringify(seen));
  throw e;
}
const bands = await p.locator('svg.hl-timeline rect[opacity="0.85"]').count();
console.log(
  'transcribed band segments after:',
  bands,
  '· scan gone:',
  (await p.locator('svg.hl-timeline rect.scan').count()) === 0,
);
if (bands < 1) throw new Error('no transcript coverage band on the timeline');
console.log(
  'bulk done: STT calls =',
  seen.stt,
  '· upload bytes ≈',
  seen.lastBytes,
  '(expected ≈ 42 s × 4 KB = 168 KB, mp3:',
  seen.isMp3 + ')',
);
if (seen.stt !== 1 || !seen.isMp3 || seen.lastBytes < 120_000 || seen.lastBytes > 260_000)
  throw new Error('unexpected bulk transcription');

// Re-running the same range must be a no-op (cached): the button is disabled with "0 chunks".
await p.waitForFunction(() => /0 chunks/.test(document.body.innerText), null, { timeout: 5000 });
console.log('cached: button now reports 0 chunks to do');

// Search.
await search.getByLabel('Search the transcript').fill('grandma moment');
const sBtn = search.getByRole('button', { name: /^Search/ });
console.log('search estimate:', (await sBtn.innerText()).trim());
await sBtn.click();
await p.waitForFunction(() => document.body.innerText.includes('matches the request'), null, {
  timeout: 30000,
});
console.log(
  'search prompt had chunk label:',
  seen.chat.prompt.includes('[0:34:00–0:34:42 | 2040s]'),
  '· schema:',
  seen.chat.schema,
);
if (!seen.chat.prompt.includes('| 2040s]')) throw new Error('search prompt missing chunk labels');
const hit = search.locator('ol li').first();
console.log('hit:', (await hit.innerText()).replace(/\s+/g, ' ').trim());
await hit.getByRole('button', { name: 'clip this' }).click();
const inVal = await p.locator('input[placeholder="h:mm:ss"]').nth(0).inputValue();
console.log('clip this from a search hit set In =', inVal);
if (inVal !== '0:33:50')
  throw new Error('expected In 0:33:50 (hit 2040 + 15 − 15 − 10 s chat lag): ' + inVal);

// The hit is pinned as an AI moment: a chip tagged AI in the grid and a hollow accent pin.
const aiChips = p.locator('ol li.chip.is-ai');
console.log(
  'AI chips:',
  await aiChips.count(),
  '· tag:',
  await aiChips.first().locator('.aitag').innerText(),
);
if ((await aiChips.count()) !== 1) throw new Error('expected one AI chip');
const aiPins = await p
  .locator('svg.hl-timeline ellipse.pin-dot')
  .evaluateAll(
    (els) =>
      els.filter((e) => getComputedStyle(e).stroke !== 'none' && e.style.stroke.includes('accent'))
        .length,
  );
console.log('AI pins on the timeline:', aiPins);
if (aiPins !== 1) throw new Error('expected one accent pin');
console.log(
  'header:',
  (await p.locator('text=/from your questions/').first().innerText()).replace(/\s+/g, ' '),
);
await aiChips.first().hover();
await p.waitForTimeout(300);
console.log('card:', (await p.locator('.moment-card').innerText()).replace(/\s+/g, ' '));
await p.screenshot({ path: 'e2e/last-ai-moments.png' });
await aiChips.first().click();
const inAi = await p.locator('input[placeholder="h:mm:ss"]').nth(0).inputValue();
console.log('clicking the AI chip set In =', inAi);
if (inAi !== '0:33:45') throw new Error('expected In 0:33:45 (2040 + 10 − 15 − 10): ' + inAi);

// Reload: bulk chunks reload from IndexedDB.
await p.reload();
await p.waitForFunction(() => /0:00:42 \/ /.test(document.body.innerText), null, {
  timeout: 60000,
});
console.log('bulk transcript persisted across reload');

await p.screenshot({ path: process.env.SHOT ?? 'e2e/last-search.png', fullPage: true });
const real = errors.filter((e) => !/ResizeObserver|favicon|ERR_CONNECTION|fonts.g/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
