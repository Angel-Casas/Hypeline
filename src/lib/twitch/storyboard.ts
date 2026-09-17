/**
 * Twitch VOD storyboards ("seek previews"): `video.seekPreviewsURL` points at a JSON
 * describing sprite sheets of small frames at a fixed interval. The JSON needs the CORS
 * shim (CDN sends no ACAO header); the sprite images themselves are displayed with
 * `background-image`, which needs no CORS at all.
 *
 * Format (undocumented, observed 2026-09-14): an array, one entry per quality:
 *   { quality, width, height, cols, rows, count, interval, images: ["0.jpg", ...] }
 * Frame k (= floor(t / interval)) lives in images[floor(k / (cols*rows))] at
 * column (k % (cols*rows)) % cols, row floor((k % (cols*rows)) / cols).
 */

import { t } from '@/i18n';
export interface StoryboardLevel {
  quality: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  count: number;
  interval: number;
  images: string[];
}

export interface Storyboard {
  /** Directory the image names are relative to (the JSON's own directory). */
  base: string;
  level: StoryboardLevel;
}

export interface Frame {
  url: string;
  /** Pixel offset of the frame inside the sprite sheet. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pick the level closest to (but preferring at or above) `wantWidth`. */
export function pickLevel(levels: StoryboardLevel[], wantWidth = 160): StoryboardLevel | null {
  const ok = levels.filter((l) => l.images?.length && l.cols > 0 && l.rows > 0 && l.interval > 0);
  if (!ok.length) return null;
  const above = ok.filter((l) => l.width >= wantWidth).sort((a, b) => a.width - b.width);
  return above[0] ?? ok.sort((a, b) => b.width - a.width)[0]!;
}

export function parseStoryboard(json: unknown, url: string, wantWidth = 160): Storyboard | null {
  if (!Array.isArray(json)) return null;
  const level = pickLevel(json as StoryboardLevel[], wantWidth);
  if (!level) return null;
  return { base: url.slice(0, url.lastIndexOf('/') + 1), level };
}

/** The frame showing second `sec`, or null when the storyboard doesn't cover it. */
export function frameAt(sb: Storyboard, sec: number): Frame | null {
  const l = sb.level;
  const k = Math.max(0, Math.floor(sec / l.interval));
  const per = l.cols * l.rows;
  const img = l.images[Math.floor(k / per)];
  if (!img) return null;
  const within = k % per;
  return {
    url: sb.base + img,
    x: (within % l.cols) * l.width,
    y: Math.floor(within / l.cols) * l.height,
    width: l.width,
    height: l.height,
  };
}

/** Fetch and parse a storyboard; `resolve` maps the URL through the shim when one is set. */
export class StoryboardError extends Error {
  constructor(
    public status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'StoryboardError';
  }
}

/** Fetch and parse the storyboard; throws a `StoryboardError` saying why it is not there. */
export async function loadStoryboard(
  seekPreviewsURL: string,
  resolve: (url: string) => string,
  fetchFn: typeof fetch = fetch,
): Promise<Storyboard> {
  const url = resolve(seekPreviewsURL);
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (e) {
    console.warn('[hypeline] storyboard: could not load', url, e);
    throw new StoryboardError(null, t('twitchLib.storyboardRelay'));
  }
  if (!res.ok) {
    console.warn(`[hypeline] storyboard: ${res.status} from ${url}`);
    throw new StoryboardError(res.status, t('twitchLib.storyboardHttp', { status: res.status }));
  }
  const sb = parseStoryboard(await res.json(), seekPreviewsURL);
  if (!sb) {
    console.warn('[hypeline] storyboard: unexpected JSON shape', seekPreviewsURL);
    throw new StoryboardError(null, t('twitchLib.storyboardFormat'));
  }
  return sb;
}

/**
 * CSS for showing the frame at `sec` as an element's background (the sprite sheet sized in
 * whole sheets, positioned in frame steps), or null when the storyboard doesn't cover it.
 */
export function frameBackground(sb: Storyboard, sec: number): Record<string, string> | null {
  const f = frameAt(sb, sec);
  if (!f) return null;
  const l = sb.level;
  const col = f.x / f.width;
  const row = f.y / f.height;
  return {
    backgroundImage: `url(${f.url})`,
    backgroundSize: `${l.cols * 100}% ${l.rows * 100}%`,
    backgroundPosition: `${l.cols > 1 ? (col * 100) / (l.cols - 1) : 0}% ${
      l.rows > 1 ? (row * 100) / (l.rows - 1) : 0
    }%`,
  };
}
