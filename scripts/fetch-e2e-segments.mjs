// Downloads the master playlist, the 720p variant playlist and the segments
// covering a time range of a VOD into e2e/fixtures/segments/ (gitignored).
// Runs in Node (no CORS), straight from Twitch — no shim needed.
//   node scripts/fetch-e2e-segments.mjs [vodId] [inSec] [outSec]
// Defaults: 2871164819 2035 2075 (the "grandma" moment used by e2e/cut.mjs, ai.mjs, search.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [vod = '2871164819', inSec = '2035', outSec = '2075'] = process.argv.slice(2);
const CID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const out = join(process.cwd(), 'e2e', 'fixtures', 'segments');
mkdirSync(out, { recursive: true });

const gql = async (body) =>
  (await fetch('https://gql.twitch.tv/gql', { method: 'POST', headers: { 'Client-Id': CID, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

const tok = (
  await gql([{ operationName: 'PlaybackAccessToken', variables: { isLive: false, login: '', isVod: true, vodID: vod, playerType: 'site' },
    extensions: { persistedQuery: { version: 1, sha256Hash: '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712' } } }])
)[0].data.videoPlaybackAccessToken;
const masterUrl = `https://usher.ttvnw.net/vod/${vod}.m3u8?sig=${tok.signature}&token=${encodeURIComponent(tok.value)}&allow_source=true`;
const master = await (await fetch(masterUrl)).text();
writeFileSync(join(out, 'master.m3u8'), master);
const lines = master.split('\n');
const idx = lines.findIndex((l) => l.includes('VIDEO="720p'));
const variantUrl = lines[idx + 1];
const variant = await (await fetch(variantUrl)).text();
writeFileSync(join(out, 'variant.m3u8'), variant);
const base = variantUrl.slice(0, variantUrl.lastIndexOf('/') + 1);
const vl = variant.split('\n');
let t = 0;
const want = [];
for (let i = 0; i < vl.length; i++) {
  const m = /^#EXTINF:([\d.]+)/.exec(vl[i]);
  if (!m) continue;
  const d = parseFloat(m[1]);
  const name = vl[i + 1];
  if (t + d > Number(inSec) && t < Number(outSec)) want.push({ name, start: t });
  t += d;
}
for (const s of want) {
  const buf = Buffer.from(await (await fetch(base + s.name)).arrayBuffer());
  writeFileSync(join(out, s.name), buf);
  console.log(s.name, `start ${s.start.toFixed(1)}s`, `${(buf.length / 1048576).toFixed(1)} MB`);
}
console.log(`done → ${out}`);
