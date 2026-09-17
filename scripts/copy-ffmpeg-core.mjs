// Copies ffmpeg.wasm's core (JS + ~31 MB wasm) from node_modules into public/ffmpeg/
// so it is served from our own origin (PWA/offline friendly, no CDN dependency).
// Runs on `npm install` (postinstall). public/ffmpeg is gitignored.
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const out = join(process.cwd(), 'public', 'ffmpeg');
mkdirSync(out, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const src = join(dir, f);
  if (!existsSync(src)) throw new Error('missing ' + src + ' — is @ffmpeg/core installed?');
  copyFileSync(src, join(out, f));
}

// Keep the size the loader uses for its progress bar in step with the core we just copied:
// production serves the wasm gzipped, so its Content-Length is the compressed size and
// cannot measure the download (see src/lib/video/ffmpeg.ts).
const sizeFile = join(process.cwd(), 'src', 'lib', 'video', 'coreSize.ts');
const bytes = statSync(join(out, 'ffmpeg-core.wasm')).size;
const cur = readFileSync(sizeFile, 'utf8');
const next = cur.replace(/CORE_WASM_BYTES = \d+/, `CORE_WASM_BYTES = ${bytes}`);
if (next !== cur) {
  writeFileSync(sizeFile, next);
  console.log(`coreSize.ts updated to ${bytes} bytes`);
}

console.log('ffmpeg core copied to public/ffmpeg/');
