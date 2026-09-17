// Copies ffmpeg.wasm's core (JS + ~31 MB wasm) from node_modules into public/ffmpeg/
// so it is served from our own origin (PWA/offline friendly, no CDN dependency).
// Runs on `npm install` (postinstall). public/ffmpeg is gitignored.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const out = join(process.cwd(), 'public', 'ffmpeg');
mkdirSync(out, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const src = join(dir, f);
  if (!existsSync(src)) throw new Error('missing ' + src + ' — is @ffmpeg/core installed?');
  copyFileSync(src, join(out, f));
}
console.log('ffmpeg core copied to public/ffmpeg/');
