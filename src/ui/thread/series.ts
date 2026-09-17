/**
 * Turns scored chat buckets into the data the hype-thread shader samples:
 * a smoothed 0..1 hype series and a per-sample hue offset that gives each
 * top moment its own colour family (petal → apricot → sky → lilac …).
 * Pure functions, unit-tested.
 */

export interface ThreadSeries {
  /** Samples, length N, 0..1. */
  hype: Float32Array;
  /** Palette offset per sample, 0..1 (fraction of the palette cycle). */
  hue: Float32Array;
  /** RGBA8 texture data: R = hype, G = hue, B/A unused. */
  rgba: Uint8Array;
  n: number;
}

export interface SeriesOptions {
  /** Output sample count (texture width). */
  n?: number;
  /** Gaussian smoothing radius in output samples. */
  sigma?: number;
  /** Power curve after normalising: > 1 keeps the baseline thin and lets only real peaks swell. */
  gamma?: number;
  /** Peak positions (0..1) and strengths; each top peak gets a hue family. */
  peaks?: { t: number; weight: number }[];
}

/** Hue families in palette-cycle units, in the order top moments are assigned. */
export const HUE_FAMILIES = [0.0, 0.36, 0.55, 0.08, 0.72, 0.2];
/** Hue of the quiet stretches between moments. */
export const HUE_REST = 0.0;

/** Resample scores (any length, any scale) to N samples, normalise to 0..1, gaussian-smooth. */
export function buildSeries(scores: ArrayLike<number>, opts: SeriesOptions = {}): ThreadSeries {
  const n = Math.max(2, Math.min(4096, opts.n ?? 512));
  const sigma = opts.sigma ?? 2.5;
  const gamma = opts.gamma ?? 1.6;
  const src = Array.from(scores, (v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const hype = new Float32Array(n);
  if (src.length) {
    // box-resample: average source values covering each output sample
    for (let i = 0; i < n; i++) {
      const a = (i / n) * src.length;
      const b = ((i + 1) / n) * src.length;
      let sum = 0;
      let cnt = 0;
      for (let j = Math.floor(a); j < Math.max(Math.floor(a) + 1, Math.ceil(b)); j++) {
        const v = src[Math.min(src.length - 1, j)]!;
        sum += v;
        cnt++;
      }
      hype[i] = cnt ? sum / cnt : 0;
    }
    // gaussian smoothing
    const r = Math.ceil(sigma * 3);
    const k = new Float32Array(2 * r + 1);
    let ks = 0;
    for (let i = -r; i <= r; i++) {
      k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
      ks += k[i + r]!;
    }
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += hype[Math.max(0, Math.min(n - 1, i + j))]! * k[j + r]!;
      sm[i] = s / ks;
    }
    // normalise: the typical (55th percentile) level becomes 0 so the baseline stays thin,
    // the strongest moment becomes 1, then a power curve
    const sorted = Array.from(sm).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.55)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const range = max - floor;
    // taper the first/last 3% so the thread enters and leaves quietly
    const taper = (i: number) => {
      const e = Math.min(i, n - 1 - i) / (n * 0.03);
      return e >= 1 ? 1 : e * e * (3 - 2 * e);
    };
    for (let i = 0; i < n; i++)
      hype[i] = range > 0 ? Math.pow(Math.max(0, (sm[i]! - floor) / range), gamma) * taper(i) : 0;
  }
  const hue = hueField(n, opts.peaks ?? []);
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    // hype in 16 bits (R = high byte, B = low byte): 8 bits made the ribbon's edge visibly stepped
    const q = Math.round(Math.max(0, Math.min(1, hype[i]!)) * 65535);
    rgba[i * 4] = q >> 8;
    rgba[i * 4 + 1] = Math.round(hue[i]! * 255);
    rgba[i * 4 + 2] = q & 255;
    rgba[i * 4 + 3] = 255;
  }
  return { hype, hue, rgba, n };
}

/** Per-sample hue offset: a wide gaussian bump of each peak's family (widths as in the prototype). */
export function hueField(n: number, peaks: { t: number; weight: number }[]): Float32Array {
  const hue = new Float32Array(n);
  const sorted = [...peaks].sort((a, b) => b.weight - a.weight).slice(0, HUE_FAMILIES.length);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let acc = 0;
    let wsum = 0;
    sorted.forEach((p, idx) => {
      const d = (t - p.t) * (6 + 3 * (1 - p.weight));
      const w = Math.exp(-(d * d));
      acc += w * HUE_FAMILIES[idx]!;
      wsum += w;
    });
    const rest = Math.max(0, 1 - wsum);
    hue[i] = (acc + rest * HUE_REST) / (wsum + rest);
  }
  return hue;
}

/**
 * The thread as the prototype drew it: one smooth gaussian swell per moment
 * (height = relative score, width ~3% of the VOD) over a whisper of noise.
 * This is what the landing page and the VOD timeline use — the raw bucket
 * series is too jagged to read as silk (see docs/08-design-system.md).
 */
export function seriesFromPeaks(
  peaks: { t: number; weight: number }[],
  opts: { n?: number; width?: number; noise?: number } = {},
): ThreadSeries {
  const n = Math.max(2, Math.min(4096, opts.n ?? 768));
  const width = opts.width ?? 0.05; // 1/e half-width in VOD fractions
  const noiseAmp = opts.noise ?? 0.07;
  const hype = new Float32Array(n);
  const top = [...peaks].sort((a, b) => b.weight - a.weight).slice(0, 8);
  const maxW = Math.max(0.001, ...top.map((p) => p.weight));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let h = 0;
    for (const p of top) {
      const w = width * (0.75 + 0.5 * (p.weight / maxW));
      const d = (t - p.t) / w;
      h += 0.95 * (p.weight / maxW) * Math.exp(-(d * d));
    }
    // gentle deterministic ripple so quiet stretches still breathe
    h += noiseAmp * (0.5 + 0.5 * Math.sin(t * 61.7 + Math.sin(t * 23.1) * 2.0)) * 0.6;
    hype[i] = h;
  }
  // normalise to the tallest point instead of clipping: where moments cluster the sum used to
  // exceed 1 and the ribbon showed a flat top (Angel, 2026-09-14)
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, hype[i]!);
  if (peak > 1) for (let i = 0; i < n; i++) hype[i] = hype[i]! / peak;
  const hue = hueField(n, top);
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    // hype in 16 bits (R = high byte, B = low byte): 8 bits made the ribbon's edge visibly stepped
    const q = Math.round(Math.max(0, Math.min(1, hype[i]!)) * 65535);
    rgba[i * 4] = q >> 8;
    rgba[i * 4 + 1] = Math.round(hue[i]! * 255);
    rgba[i * 4 + 2] = q & 255;
    rgba[i * 4 + 3] = 255;
  }
  return { hype, hue, rgba, n };
}

/** Peaks for the hue field from moments (seconds) over a VOD length. */
export function peaksFromMoments(
  moments: { t: number; score: number }[],
  lengthSeconds: number,
): { t: number; weight: number }[] {
  const max = Math.max(0.01, ...moments.map((m) => m.score));
  return moments.map((m) => ({
    t: lengthSeconds > 0 ? m.t / lengthSeconds : 0,
    weight: m.score / max,
  }));
}
