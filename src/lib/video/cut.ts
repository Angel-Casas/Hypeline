/**
 * Cut a clip from Twitch VOD segments (MPEG-TS, H.264 + AAC) with ffmpeg.wasm.
 *
 * Two modes (see docs/05-research.md, "M2 cutting"):
 *  - 'fast'    : stream copy. Instant, but starts on the previous keyframe (≤ 2 s early).
 *  - 'precise' : re-encode with libx264. Frame-accurate, supports cropping; slow in wasm.
 */
import type { Segment } from '@/lib/twitch/hls';
import { fetchBytes } from '@/lib/twitch/hls';
import { getFfmpeg, runJob } from './ffmpeg';
import { outputSize, toAss, type CaptionStyle, type Cue } from './captions';
import { t } from '@/i18n';

const FONT_PATH = '/fonts/DejaVuSans-Bold.ttf';
/** Instances that already have the font (a recycled instance starts with an empty FS). */
const fontLoaded = new WeakSet<object>();

/** Copy the bundled caption font into ffmpeg's FS once per instance. */
export async function ensureFont(ff: Awaited<ReturnType<typeof getFfmpeg>>): Promise<void> {
  if (fontLoaded.has(ff)) return;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}${FONT_PATH}`);
  if (!res.ok) throw new Error(t('video.captionFontMissing'));
  await ff.createDir('/fonts').catch(() => {});
  await ff.writeFile(FONT_PATH, new Uint8Array(await res.arrayBuffer()));
  fontLoaded.add(ff);
}

export type CutMode = 'fast' | 'precise';
/** 'split' = 9:16 with the facecam on top and the game/main view below. */
export type Aspect = '16:9' | '9:16' | '1:1' | 'split';

/** Fractions of the source frame. */
export interface SplitLayout {
  /** Facecam box: top-left corner and width (height follows 16:9). */
  camX: number;
  camY: number;
  camW: number;
  /** Horizontal centre of the main (game) window. */
  gameCenterX: number;
  /** Share of the output height taken by the cam strip (0.25–0.5). */
  camShare: number;
}

export const DEFAULT_SPLIT: SplitLayout = {
  camX: 0.02,
  camY: 0.02,
  camW: 0.28,
  gameCenterX: 0.5,
  camShare: 0.35,
};

export interface CutRequest {
  segments: Segment[];
  /** Absolute VOD seconds. */
  inSec: number;
  outSec: number;
  mode: CutMode;
  aspect: Aspect;
  /** Horizontal centre of the crop window as a fraction of width (0..1). Only for 9:16 / 1:1. */
  cropCenterX: number;
  /** Layout for aspect 'split'. */
  split?: SplitLayout;
  /** Source dimensions of the chosen variant. */
  width: number;
  height: number;
  /** Turns a segment URL into a fetchable (shimmed) URL. */
  resolveUrl: (url: string) => string;
  /** Burned-in captions (forces a re-encode). Cue times are relative to inSec. */
  captions?: { cues: Cue[]; style: CaptionStyle };
  signal?: AbortSignal;
  onProgress?: (p: CutProgress) => void;
}

export interface CutProgress {
  stage: 'loading-ffmpeg' | 'downloading' | 'cutting' | 'done';
  /** 0..1 within the stage where known. */
  ratio?: number;
  detail?: string;
}

export interface CutResult {
  blob: Blob;
  /** Actual start of the clip in VOD seconds (differs from inSec in fast mode). */
  actualInSec: number;
  durationSec: number;
  bytesDownloaded: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * filter_complex for the split layout: two crops scaled and stacked into a
 * 9:16 frame of the source height. Returns the graph (without a final label)
 * and the output size.
 */
export function splitFilter(
  width: number,
  height: number,
  l: SplitLayout,
): { graph: string; width: number; height: number } {
  const outH = height;
  const outW = even(outH * (9 / 16));
  const camH = even(outH * Math.min(0.5, Math.max(0.25, l.camShare)));
  const gameH = outH - camH;
  // Cam crop: 16:9 box at (camX, camY) with width camW of the source.
  const cw = even(Math.min(width, Math.max(64, l.camW * width)));
  const ch = even(Math.min(height, cw * (9 / 16)));
  const cx = even(Math.max(0, Math.min(width - cw, l.camX * width)));
  const cy = even(Math.max(0, Math.min(height - ch, l.camY * height)));
  // Game crop: full source height, width matching the output ratio of the lower strip.
  const gw = even(Math.min(width, height * (outW / gameH)));
  const gx = even(Math.max(0, Math.min(width - gw, l.gameCenterX * width - gw / 2)));
  const graph =
    `[0:v]split=2[c][g];` +
    `[c]crop=${cw}:${ch}:${cx}:${cy},scale=${outW}:${camH}[cam];` +
    `[g]crop=${gw}:${height}:${gx}:0,scale=${outW}:${gameH}[game];` +
    `[cam][game]vstack`;
  return { graph, width: outW, height: outH };
}

/** Crop filter for the requested aspect; returns null when no crop is needed. */
export function cropFilter(
  aspect: Aspect,
  width: number,
  height: number,
  centerX: number,
): string | null {
  if (aspect === '16:9' || aspect === 'split') return null;
  const targetRatio = aspect === '9:16' ? 9 / 16 : 1;
  let w = Math.round(height * targetRatio);
  if (w % 2) w -= 1;
  w = Math.min(w, width);
  const maxX = width - w;
  let x = Math.round(centerX * width - w / 2);
  x = Math.max(0, Math.min(maxX, x));
  if (x % 2) x -= 1;
  return `crop=${w}:${height}:${x}:0`;
}

/** Download segments (4 in parallel) and concatenate them (TS is byte-concatenable). */
export async function downloadSegments(
  segments: Segment[],
  resolveUrl: (url: string) => string,
  signal?: AbortSignal,
  onProgress?: (ratio: number, detail: string) => void,
): Promise<{ joined: Uint8Array; bytes: number }> {
  const buffers: Uint8Array[] = new Array(segments.length);
  let done = 0;
  let bytes = 0;
  const queue = segments.map((s, i) => ({ s, i }));
  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const buf = await fetchBytes(resolveUrl(job.s.url), fetch, signal);
      buffers[job.i] = buf;
      bytes += buf.byteLength;
      done++;
      onProgress?.(
        done / segments.length,
        t('video.downloadedMb', { mb: (bytes / 1048576).toFixed(1) }),
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, segments.length) }, worker));
  const total = buffers.reduce((a, b) => a + b.byteLength, 0);
  const joined = new Uint8Array(total);
  let off = 0;
  for (const b of buffers) {
    joined.set(b, off);
    off += b.byteLength;
  }
  return { joined, bytes };
}

export async function cutClip(req: CutRequest): Promise<CutResult> {
  const { segments, inSec, outSec, mode, onProgress, signal } = req;
  if (!segments.length) throw new Error(t('video.noSegments'));
  if (outSec <= inSec) throw new Error(t('video.outAfterIn'));

  onProgress?.({ stage: 'loading-ffmpeg' });
  const onLoad = (p: { stage: string; ratio?: number }) => {
    if (p.stage === 'downloading-core') onProgress?.({ stage: 'loading-ffmpeg', ratio: p.ratio });
  };

  const { joined, bytes } = await downloadSegments(
    segments,
    req.resolveUrl,
    signal,
    (ratio, detail) => onProgress?.({ stage: 'downloading', ratio, detail }),
  );
  // the ffmpeg part alone: retried on a fresh instance if the wasm crashes
  return runJob(async (ff) => {
    const inName = 'in.ts';
    const outName = 'out.mp4';
    await ff.writeFile(inName, joined);

    const firstStart = segments[0]!.start;
    const offset = Math.max(0, inSec - firstStart);
    const duration = outSec - inSec;

    onProgress?.({ stage: 'cutting', ratio: 0 });
    const onLog = ({ message }: { message: string }) => {
      const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(message);
      if (m) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        onProgress?.({ stage: 'cutting', ratio: Math.min(1, t / duration) });
      }
    };
    ff.on('log', onLog);

    const crop = cropFilter(req.aspect, req.width, req.height, req.cropCenterX);
    const split =
      req.aspect === 'split'
        ? splitFilter(req.width, req.height, req.split ?? DEFAULT_SPLIT)
        : null;
    const withCaptions = !!req.captions && req.captions.cues.length > 0;
    const filters: string[] = [];
    if (crop) filters.push(crop);
    if (withCaptions) {
      await ensureFont(ff);
      const size = split
        ? { width: split.width, height: split.height }
        : outputSize(req.width, req.height, crop);
      await ff.writeFile(
        'subs.ass',
        toAss(req.captions!.cues, size.width, size.height, req.captions!.style),
      );
      filters.push('subtitles=subs.ass:fontsdir=/fonts');
    }
    let args: string[];
    if (mode === 'fast' && filters.length === 0 && !split) {
      args = [
        '-ss',
        offset.toFixed(3),
        '-i',
        inName,
        '-t',
        duration.toFixed(3),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        outName,
      ];
    } else {
      // Input seeking (-ss before -i): filter timestamps start at 0 at the cut, so cues are clip-relative (verified in the S5 spike).
      args = ['-ss', offset.toFixed(3), '-i', inName, '-t', duration.toFixed(3)];
      if (split) {
        const tail = filters.length ? ',' + filters.join(',') : '';
        args.push('-filter_complex', `${split.graph}${tail}[v]`, '-map', '[v]', '-map', '0:a?');
      } else if (filters.length) {
        args.push('-vf', filters.join(','));
      }
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outName,
      );
    }
    let code: number;
    try {
      code = await ff.exec(args);
    } finally {
      ff.off('log', onLog);
    }
    if (code !== 0) throw new Error(t('video.ffmpegExited', { code }));

    const data = (await ff.readFile(outName)) as Uint8Array;
    await ff.deleteFile(inName).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
    if (withCaptions) await ff.deleteFile('subs.ass').catch(() => {});
    const blob = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' });
    onProgress?.({ stage: 'done', ratio: 1 });
    return { blob, actualInSec: inSec, durationSec: duration, bytesDownloaded: bytes };
  }, onLoad);
}
