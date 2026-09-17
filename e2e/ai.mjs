/**
 * e2e: the AI panel with NanoGPT mocked. Audio extraction runs for real in
 * ffmpeg.wasm (needs e2e/fixtures/segments — `npm run e2e:fixtures`).
 * Run: npx vite preview --port 4173 &  then  node e2e/ai.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** The clip settings are menus now (ADR-27): open the pill, choose from the paper menu. */
async function pickSetting(page, which, label) {
  await page.click(`[data-testid="pick-${which}"]`);
  // a menu row is "<label><note>", so match on the label as a substring
  await page
    .locator('[data-testid="pick-menu"] [role="menuitemradio"]', { hasText: label })
    .first()
    .click();
  await page.waitForTimeout(120);
}

const BASE = process.env.BASE ?? 'http://localhost:4173';
const EXEC = process.env.CHROMIUM;
const SEG_DIR = process.env.SEG_DIR ?? 'e2e/fixtures/segments';
const SHIM = 'https://shim.test';
const VOD = '2871164819';
const LENGTH = 23042;

const fixture = readFileSync(new URL('../src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l, i) => ({ i, ...JSON.parse(l) }));
function chunkAt(offset) {
  let start = fixture.findIndex((m) => m.t >= offset);
  if (start < 0) return null;
  start = Math.max(0, start - 3);
  const slice = fixture.slice(start, start + 60);
  return {
    edges: slice.map((m) => ({ cursor: 'c' + m.i, node: { id: 'id' + m.i, contentOffsetSeconds: m.t, commenter: { login: m.u, displayName: m.u },
      message: { fragments: [{ text: m.m, emote: null }], userBadges: m.b.map((b) => ({ setID: b, version: '1' })) } } })),
    pageInfo: { hasNextPage: start + 60 < fixture.length },
  };
}
const master = readFileSync(join(SEG_DIR, 'master.m3u8'), 'utf8').replace(/https:\/\/[^/]+\/[^/]+\/(\w+)\/index-dvr\.m3u8/g, 'https://cdn.test/vod/$1/index-dvr.m3u8');
const variant720 = readFileSync(join(SEG_DIR, 'variant.m3u8'), 'utf8');

const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
// the language is chosen already: the first-visit sheet must not cover the page
await ctx.addInitScript(() => { localStorage.setItem('hypeline.locale', 'en'); localStorage.setItem('hypeline.tour.v1', 'done'); });
await ctx.addInitScript((shim) => {
  localStorage.setItem('hypeline.settings.v1', JSON.stringify({ shimUrl: shim, preferredHeight: 720, aiApiKey: 'test-key', chatModel: '' }));
}, SHIM);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const seen = { models: 0, balance: 0, stt: null, chat: null };
await p.route('https://nano-gpt.com/api/**', async (route) => {
  const req = route.request();
  const u = req.url();
  if (u.includes('/v1/models')) { seen.models++; return route.fulfill({ json: { data: [
    { id: 'openai/gpt-5.1', name: 'GPT-5.1', pricing: { prompt: 2.5, completion: 10 } },
    { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', pricing: { prompt: 0.25, completion: 2 } },
  ] } }); }
  if (u.endsWith('/check-balance')) { seen.balance++; return route.fulfill({ json: { usd_balance: '9.87' } }); }
  if (u.includes('/v1/audio/transcriptions')) {
    // Real multipart body from the page: check we got a WAV of the right length.
    const body = req.postDataBuffer();
    seen.stt = { bodyBytes: body.length, isMp3: body.includes('filename="a.mp3"'), hasModel: body.includes('Whisper-Large-V3') };
    return route.fulfill({ json: { text: 'grandma what are you doing', language: 'en', duration: 15 } });
  }
  if (u.includes('/v1/chat/completions')) {
    const j = JSON.parse(req.postData());
    seen.chat = { model: j.model, hasSchema: j.response_format?.type === 'json_schema', promptHasTranscript: j.messages[1].content.includes('grandma what are you doing') };
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ title: 'Grandma pulls up', hook: 'Nobody expected this', why: 'Chat lost it', suggestedInOffset: 2, suggestedOutOffset: 14, clipWorthiness: 5 }) } }], usage: { prompt_tokens: 300, completion_tokens: 60 }, nanoGPT: { cost: 0.00021 } } });
  }
  return route.fulfill({ status: 404, body: 'unmocked ' + u });
});
await p.route('https://gql.twitch.tv/gql', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (!Array.isArray(body)) return route.fulfill({ json: { data: { video: { id: VOD, title: 'Fixture VOD', lengthSeconds: LENGTH, createdAt: '2026-09-11T11:49:00Z', viewCount: 1, seekPreviewsURL: null, owner: { login: 'tokyosims', displayName: 'tokyosims' }, game: { name: 'Just Chatting' } } } } });
  if (body[0].operationName === 'PlaybackAccessToken') return route.fulfill({ json: [{ data: { videoPlaybackAccessToken: { value: '{"tok":1}', signature: 'sig' } } }] });
  const off = body[0].variables.contentOffsetSeconds;
  const c = off > LENGTH + 200 ? null : chunkAt(off);
  if (!c) return route.fulfill({ json: [{ errors: [{ message: 'service error' }], data: { video: { comments: null } } }] });
  return route.fulfill({ json: [{ data: { video: { comments: c } } }] });
});
await p.route('https://player.twitch.tv/**', (route) =>
  route.fulfill({ contentType: 'application/javascript', body: `window.Twitch = { Player: class { constructor(el,o){ this.t=0; this.l={}; setTimeout(()=>this.l['ready']?.forEach(f=>f()),10);} seek(s){this.t=s} play(){} pause(){} getCurrentTime(){return this.t} addEventListener(e,f){(this.l[e] ||= []).push(f)} } }; window.Twitch.Player.READY='ready'; window.Twitch.Player.PLAYING='playing';` }),
);
await p.route(`${SHIM}/**`, async (route) => {
  const u = new URL(route.request().url()).searchParams.get('u') ?? '';
  if (u.startsWith('https://usher.ttvnw.net/')) return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: master });
  // Every variant (incl. the smallest one used for audio) is served from the same 720p segments in this test.
  if (u.endsWith('index-dvr.m3u8')) return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: variant720 });
  const f = join(SEG_DIR, u.split('/').pop());
  if (!existsSync(f)) return route.fulfill({ status: 404, body: 'segment missing' });
  return route.fulfill({ contentType: 'video/MP2T', body: readFileSync(f) });
});

await p.goto(BASE + '/vod/' + VOD);
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, { timeout: 60000 });
await p.waitForFunction(() => document.body.innerText.includes('$9.87'), null, { timeout: 15000 });
console.log('models+balance loaded; default chat model =', await p.getByLabel('Chat model').inputValue());

await p.locator('input[placeholder="h:mm:ss"]').nth(0).fill('0:34:05');
await p.locator('input[placeholder="h:mm:ss"]').nth(0).dispatchEvent('change');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).fill('0:34:20');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).dispatchEvent('change');

const tBtn = p.getByRole('button', { name: /^Transcribe\b(?! VOD)/ });
console.log('estimate label:', (await tBtn.innerText()).trim());
await tBtn.click();
await p.waitForFunction(() => document.body.innerText.includes('grandma what are you doing'), null, { timeout: 120000 });
console.log('transcription request:', JSON.stringify(seen.stt));
// 15 s at 32 kbps ≈ 60 KB (+ multipart overhead); must be well under NanoGPT's 3 MB cap.
if (!seen.stt?.hasModel || !seen.stt.isMp3 || seen.stt.bodyBytes < 40_000 || seen.stt.bodyBytes > 120_000) throw new Error('unexpected transcription upload: ' + JSON.stringify(seen.stt));
console.log(`mp3 upload ≈ ${Math.round(seen.stt.bodyBytes / 1024)} KB (expected ≈ 60 KB for 15 s @ 32 kbps)`);

const eBtn = p.getByRole('button', { name: /^Explain/ });
console.log('explain label:', (await eBtn.innerText()).trim());
await eBtn.click();
await p.waitForFunction(() => document.body.innerText.includes('Grandma pulls up'), null, { timeout: 30000 });
console.log('chat request:', JSON.stringify(seen.chat));
if (!seen.chat?.hasSchema || !seen.chat.promptHasTranscript) throw new Error('explain prompt missing schema or transcript');

await p.getByRole('button', { name: 'apply to in/out' }).click();
const newIn = await p.locator('input[placeholder="h:mm:ss"]').nth(0).inputValue();
const newOut = await p.locator('input[placeholder="h:mm:ss"]').nth(1).inputValue();
console.log('applied suggestion:', newIn, '→', newOut);
if (newIn !== '0:34:07' || newOut !== '0:34:19') throw new Error('suggested range not applied');

// Cached: reload, same range → no new network calls.
const before = { ...seen };
await p.reload();
await p.waitForFunction(() => /\d+ moments/.test(document.body.innerText), null, { timeout: 60000 });
await p.locator('input[placeholder="h:mm:ss"]').nth(0).fill('0:34:05');
await p.locator('input[placeholder="h:mm:ss"]').nth(0).dispatchEvent('change');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).fill('0:34:20');
await p.locator('input[placeholder="h:mm:ss"]').nth(1).dispatchEvent('change');
await p.getByRole('button', { name: /^Transcribe\b(?! VOD)/ }).click();
await p.waitForFunction(() => document.body.innerText.includes('grandma what are you doing'), null, { timeout: 30000 });
console.log('cached transcript served without a new STT call:', seen.stt === before.stt);

// Captions: with a matching transcript, the Captions checkbox is enabled; export a captioned 9:16 clip.
await p.click('[data-testid="pick-captions"]');
await p.locator('[data-testid="pick-menu"] input[type="checkbox"]').first().check();
await p.keyboard.press('Escape');
await pickSetting(p, 'aspect', '9:16');
const vidsBefore = await p.locator('video').count();
await p.getByRole('button', { name: 'Export clip' }).click();
await p.waitForFunction((n) => document.querySelectorAll('video').length > n, vidsBefore, { timeout: 300000 });
const meta = await p.locator('section:has-text("Export clip") ul li').first().innerText();
if (!/captions/.test(meta)) throw new Error('exported clip is not marked as captioned: ' + meta);
const b64 = await p.evaluate(async () => {
  const v = document.querySelector('video');
  const buf = await (await fetch(v.src)).arrayBuffer();
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
const mp4 = `/tmp/hypeline-e2e-captions-${Date.now()}.mp4`;
writeFileSync(mp4, Buffer.from(b64, 'base64'));
// Caption pixels: the bottom band of a frame should contain bright (white) text over the dark outline.
const frame = mp4.replace('.mp4', '.png');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', mp4, '-frames:v', '1', '-vf', 'crop=iw:ih*0.25:0:ih*0.7,format=gray', frame]);
const stats = execFileSync('ffprobe', ['-v', 'error', '-f', 'lavfi', '-i', `movie=${frame},signalstats`, '-show_entries', 'frame=pkt_pts_time:frame_tags=lavfi.signalstats.YMAX,lavfi.signalstats.YAVG', '-of', 'json']).toString();
const tags = JSON.parse(stats).frames[0].tags;
console.log('captioned 9:16 export:', meta.replace(/\s+/g, ' ').slice(0, 90), '· bottom band YMAX', tags['lavfi.signalstats.YMAX'], 'YAVG', tags['lavfi.signalstats.YAVG']);
if (Number(tags['lavfi.signalstats.YMAX']) < 230) throw new Error('no bright caption pixels found in the bottom band');

await p.screenshot({ path: process.env.SHOT ?? 'e2e/last-ai.png', fullPage: true });
const real = errors.filter((e) => !/ResizeObserver|favicon|ERR_CONNECTION|fonts.g/.test(e));
console.log('page errors:', real.length ? real : 'none');
await b.close();
if (real.length) process.exit(1);
