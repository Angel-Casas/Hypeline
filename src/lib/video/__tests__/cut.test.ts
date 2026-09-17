import { describe, expect, it } from 'vitest';
import { cropFilter, splitFilter, DEFAULT_SPLIT } from '../cut';

describe('cropFilter', () => {
  it('returns null for 16:9', () => {
    expect(cropFilter('16:9', 1280, 720, 0.5)).toBeNull();
  });
  it('centres a 9:16 window and keeps even dimensions', () => {
    expect(cropFilter('9:16', 1280, 720, 0.5)).toBe('crop=404:720:438:0');
    expect(cropFilter('9:16', 1920, 1080, 0.5)).toBe('crop=608:1080:656:0');
  });
  it('clamps the window to the frame', () => {
    expect(cropFilter('9:16', 1280, 720, 0)).toBe('crop=404:720:0:0');
    expect(cropFilter('9:16', 1280, 720, 1)).toBe('crop=404:720:876:0');
  });
  it('squares', () => {
    expect(cropFilter('1:1', 1280, 720, 0.25)).toBe('crop=720:720:0:0');
  });
});

describe('splitFilter', () => {
  it('builds a 9:16 stack of the source height with even dimensions', () => {
    const r = splitFilter(1280, 720, DEFAULT_SPLIT);
    expect(r).toMatchObject({ width: 406, height: 720 });
    expect(r.graph).toContain('[0:v]split=2[c][g]');
    expect(r.graph).toMatch(/\[c\]crop=358:202:26:14,scale=406:252\[cam\]/); // 0.28*1280=358.4→358, 16:9 → 201→202
    expect(r.graph).toMatch(/\[g\]crop=\d+:720:\d+:0,scale=406:468\[game\]/);
    expect(r.graph.endsWith('[cam][game]vstack')).toBe(true);
    const nums = [...r.graph.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].flatMap((m) =>
      m.slice(1).map(Number),
    );
    expect(nums.every((n) => n % 2 === 0)).toBe(true);
  });
  it('clamps boxes to the frame', () => {
    const r = splitFilter(1280, 720, {
      ...DEFAULT_SPLIT,
      camX: 0.99,
      camY: 0.99,
      camW: 0.5,
      gameCenterX: 1,
    });
    expect(r.graph).toMatch(/\[c\]crop=640:360:640:360/);
    expect(r.graph).toMatch(/\[g\]crop=(\d+):720:(\d+):0/);
  });
});
