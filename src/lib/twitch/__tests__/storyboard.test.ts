import { describe, expect, it } from 'vitest';
import { frameAt, parseStoryboard, pickLevel } from '../storyboard';

const levels = [
  {
    quality: 'low',
    width: 80,
    height: 45,
    cols: 10,
    rows: 10,
    count: 500,
    interval: 10,
    images: ['0.jpg', '1.jpg', '2.jpg', '3.jpg', '4.jpg'],
  },
  {
    quality: 'high',
    width: 160,
    height: 90,
    cols: 5,
    rows: 5,
    count: 500,
    interval: 10,
    images: Array.from({ length: 20 }, (_, i) => `h${i}.jpg`),
  },
];

describe('storyboard', () => {
  it('picks the smallest level at or above the wanted width', () => {
    expect(pickLevel(levels, 160)?.quality).toBe('high');
    expect(pickLevel(levels, 60)?.quality).toBe('low');
    expect(pickLevel(levels, 400)?.quality).toBe('high');
  });
  it('locates a frame inside the sprite sheet', () => {
    const sb = parseStoryboard(levels, 'https://cdn.example/x/y/storyboard.json')!;
    // t = 123 s → frame 12 → sheet 0 (25 per sheet), col 2, row 2
    expect(frameAt(sb, 123)).toEqual({
      url: 'https://cdn.example/x/y/h0.jpg',
      x: 320,
      y: 180,
      width: 160,
      height: 90,
    });
    // frame 27 → sheet 1, within 2 → col 2, row 0
    expect(frameAt(sb, 275)?.url).toBe('https://cdn.example/x/y/h1.jpg');
    expect(frameAt(sb, 275)?.x).toBe(320);
    expect(frameAt(sb, 275)?.y).toBe(0);
    expect(frameAt(sb, 99999)).toBeNull();
  });
  it('rejects junk', () => {
    expect(parseStoryboard({}, 'u')).toBeNull();
    expect(parseStoryboard([], 'u')).toBeNull();
  });
});
