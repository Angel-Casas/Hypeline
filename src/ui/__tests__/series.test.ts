import { describe, expect, it } from 'vitest';
import {
  buildSeries,
  hueField,
  HUE_FAMILIES,
  peaksFromMoments,
  seriesFromPeaks,
} from '../thread/series';

describe('seriesFromPeaks', () => {
  it('draws one gaussian swell per moment, strongest = 0.95 + ripple, thin between', () => {
    const s = seriesFromPeaks(
      [
        { t: 0.3, weight: 1 },
        { t: 0.7, weight: 0.5 },
      ],
      { n: 1000, width: 0.04 },
    );
    expect(s.n).toBe(1000);
    expect(s.hype[300]).toBeGreaterThan(0.94);
    expect(s.hype[700]).toBeGreaterThan(0.45);
    expect(s.hype[700]).toBeLessThan(0.6);
    expect(s.hype[500]).toBeLessThan(0.08); // only the ripple
    expect(Math.max(...s.hype)).toBeLessThanOrEqual(1);
    expect(s.rgba[300 * 4]).toBeGreaterThan(240);
  });
  it('never clips clustered peaks: the tallest point is 1, the shape is kept', () => {
    const s = seriesFromPeaks(
      [
        { t: 0.5, weight: 1 },
        { t: 0.51, weight: 1 },
        { t: 0.52, weight: 1 },
        { t: 0.2, weight: 0.5 },
      ],
      { n: 512, width: 0.03, noise: 0 },
    );
    const max = Math.max(...s.hype);
    expect(max).toBeCloseTo(1, 3);
    // a flat top would have many samples at the max; a proper peak has only a few
    expect(s.hype.filter((v) => v > 0.999).length).toBeLessThan(6);
    // the lone half-weight peak is still clearly lower than the cluster
    expect(s.hype[Math.round(0.2 * 512)]!).toBeLessThan(0.5);
  });
  it('is empty-safe', () => {
    const s = seriesFromPeaks([], { n: 16 });
    expect(Math.max(...s.hype)).toBeLessThan(0.08);
  });
});

describe('buildSeries (raw buckets, kept for analysis views)', () => {
  it('resamples, smooths and normalises to a max of 1', () => {
    const scores = new Array(1500).fill(0);
    scores[400] = 10;
    scores[401] = 12;
    const s = buildSeries(scores, { n: 300, sigma: 2, gamma: 1 });
    expect(Math.max(...s.hype)).toBeCloseTo(1, 5);
    expect(s.hype[0]).toBe(0);
  });
});

describe('hueField', () => {
  it('gives the strongest peak the first family with wide, soft bands', () => {
    const hue = hueField(200, [
      { t: 0.7, weight: 0.5 },
      { t: 0.3, weight: 1 },
    ]);
    expect(hue[60]).toBeCloseTo(HUE_FAMILIES[0]!, 1);
    expect(hue[140]).toBeGreaterThan(HUE_FAMILIES[1]! * 0.8);
  });
  it('maps moments to normalised peaks', () => {
    const p = peaksFromMoments(
      [
        { t: 2055, score: 3.46 },
        { t: 915, score: 1.73 },
      ],
      23042,
    );
    expect(p[0]!.t).toBeCloseTo(0.0892, 3);
    expect(p[0]!.weight).toBe(1);
    expect(p[1]!.weight).toBeCloseTo(0.5, 2);
  });
});
