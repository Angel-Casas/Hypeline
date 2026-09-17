/**
 * Thumbnail: one frame grabbed from the VOD segments with ffmpeg.wasm, framed
 * exactly like the clip export (16:9 / crop / split) and optionally stamped
 * with a title through libass (same font path as captions). Output is PNG.
 *
 * Only the segment containing the target second is downloaded (~1 MB at 720p);
 * TS segments start on a keyframe, so input seeking inside one is exact.
 */
import type { Segment } from '@/lib/twitch/hls';
import { runJob } from './ffmpeg';
import {
  cropFilter,
  DEFAULT_SPLIT,
  downloadSegments,
  ensureFont,
  splitFilter,
  type Aspect,
  type CutProgress,
  type SplitLayout,
} from './cut';
import { outputSize, titleAss } from './captions';
import { t } from '@/i18n';

export interface ThumbnailRequest {
  /** Segments covering `atSec` (usually exactly one). */
  segments: Segment[];
  /** Absolute VOD seconds. */
  atSec: number;
  aspect: Aspect;
  cropCenterX: number;
  split?: SplitLayout;
  width: number;
  height: number;
  /** Optional title burned into the frame (empty = none). */
  title?: string;
  resolveUrl: (url: string) => string;
  signal?: AbortSignal;
  onProgress?: (p: CutProgress) => void;
}

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
  bytesDownloaded: number;
}

export async function grabThumbnail(req: ThumbnailRequest): Promise<ThumbnailResult> {
  const { segments, atSec, onProgress, signal } = req;
  if (!segments.length) throw new Error(t('video.noSegmentCovers'));

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
    const inName = 'thumb-in.ts';
    const outName = 'thumb.png';
    await ff.writeFile(inName, joined);

    const offset = Math.max(0, atSec - segments[0]!.start);
    const crop = cropFilter(req.aspect, req.width, req.height, req.cropCenterX);
    const split =
      req.aspect === 'split'
        ? splitFilter(req.width, req.height, req.split ?? DEFAULT_SPLIT)
        : null;
    const size = split
      ? { width: split.width, height: split.height }
      : outputSize(req.width, req.height, crop);
    const title = req.title?.trim() ?? '';
    const filters: string[] = [];
    if (crop) filters.push(crop);
    if (title) {
      await ensureFont(ff);
      await ff.writeFile('title.ass', titleAss(title, size.width, size.height));
      filters.push('subtitles=title.ass:fontsdir=/fonts');
    }

    onProgress?.({ stage: 'cutting', ratio: 0 });
    const args = ['-ss', offset.toFixed(3), '-i', inName, '-frames:v', '1'];
    if (split) {
      const tail = filters.length ? ',' + filters.join(',') : '';
      args.push('-filter_complex', `${split.graph}${tail}[v]`, '-map', '[v]');
    } else if (filters.length) {
      args.push('-vf', filters.join(','));
    }
    args.push('-update', '1', outName);
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(t('video.ffmpegExited', { code }));

    const data = (await ff.readFile(outName)) as Uint8Array;
    await ff.deleteFile(inName).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
    if (title) await ff.deleteFile('title.ass').catch(() => {});
    onProgress?.({ stage: 'done', ratio: 1 });
    return {
      blob: new Blob([data.buffer as ArrayBuffer], { type: 'image/png' }),
      width: size.width,
      height: size.height,
      bytesDownloaded: bytes,
    };
  }, onLoad);
}
