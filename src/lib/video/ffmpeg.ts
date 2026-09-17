/**
 * Lazy singleton around ffmpeg.wasm (single-threaded build: no COOP/COEP
 * headers needed, which matters because those would break the Twitch embed
 * iframe). Core files are served from /ffmpeg/ (copied by scripts/copy-ffmpeg-core.mjs).
 *
 * The core is loaded via blob: URLs. ffmpeg's worker does a dynamic
 * `import(coreURL)`; in Vite dev a plain /ffmpeg/ffmpeg-core.js URL gets
 * intercepted as a source module ("This file is in /public …"). Blob URLs
 * sidestep that in dev and are harmless in production.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
/** The core's blob URLs, fetched once; a recycled instance reloads from them for free. */
let urls: { coreURL: string; wasmURL: string } | null = null;
/** Jobs run on the current instance (see `runJob`). */
let jobs = 0;
/**
 * The single-threaded core leaks a little of its heap on every run (ffmpeg.wasm's known
 * behaviour); on a whole-VOD transcription (~100 chunks) that ended in
 * "RuntimeError: memory access out of bounds" (Angel, 2026-09-16). A fresh instance every
 * so often, and after any crash, keeps long jobs alive.
 */
const RECYCLE_AFTER_JOBS = 20;

export interface FfmpegLoadProgress {
  stage: 'downloading-core' | 'ready';
  /** 0..1 of the wasm download where known. */
  ratio?: number;
}

export function getFfmpeg(onProgress?: (p: FfmpegLoadProgress) => void): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;
  loading = (async () => {
    onProgress?.({ stage: 'downloading-core' });
    const ff = new FFmpeg();
    if (!urls) {
      const base = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/ffmpeg`;
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', true, (e) =>
          onProgress?.({
            stage: 'downloading-core',
            ratio: e.total ? e.received / e.total : undefined,
          }),
        ),
      ]);
      urls = { coreURL, wasmURL };
    }
    await ff.load(urls);
    instance = ff;
    jobs = 0;
    onProgress?.({ stage: 'ready' });
    return ff;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export function isFfmpegLoaded(): boolean {
  return instance !== null;
}

/** Drop the current instance (its heap with it); the next `getFfmpeg` loads a fresh one. */
export function recycleFfmpeg(): void {
  try {
    instance?.terminate();
  } catch {
    /* already gone */
  }
  instance = null;
  loading = null;
  jobs = 0;
}

/** Does this error mean the wasm instance is broken (rather than the input)? */
export function isWasmCrash(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return /memory access out of bounds|RuntimeError|unreachable|Aborted\(|table index is out of bounds|null function/i.test(
    msg,
  );
}

/**
 * Run one ffmpeg job: recycles the instance every `RECYCLE_AFTER_JOBS` runs, and once more
 * (with one retry of the job) if the instance crashes mid-way.
 */
export async function runJob<T>(
  job: (ff: FFmpeg) => Promise<T>,
  onProgress?: (p: FfmpegLoadProgress) => void,
): Promise<T> {
  if (instance && jobs >= RECYCLE_AFTER_JOBS) recycleFfmpeg();
  let ff = await getFfmpeg(onProgress);
  jobs++;
  try {
    return await job(ff);
  } catch (e) {
    if (!isWasmCrash(e)) throw e;
    console.warn('[hypeline] ffmpeg crashed; reloading it and retrying once', e);
    recycleFfmpeg();
    ff = await getFfmpeg(onProgress);
    jobs++;
    return await job(ff);
  }
}
