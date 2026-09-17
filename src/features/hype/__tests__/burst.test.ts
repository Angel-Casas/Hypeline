import { describe, expect, it } from 'vitest';
import { burst, lowerBound, normaliseLine } from '../burst';
import type { ChatMessage } from '@/lib/twitch/types';

const msg = (t: number, u: string, m: string): ChatMessage => ({ t, u, m, e: [], b: [] });

describe('burst', () => {
  it('normalises shouting and repeats', () => {
    expect(normaliseLine('CLIP IT!!!')).toBe('clip it');
    expect(normaliseLine('Clip   it')).toBe('clip it');
    expect(normaliseLine('KEKWWWWW')).toBe('kekww');
  });
  it('finds the first message at or after a second', () => {
    const msgs = [msg(1, 'a', 'x'), msg(5, 'b', 'y'), msg(9, 'c', 'z')];
    expect(lowerBound(msgs, 5)).toBe(1);
    expect(lowerBound(msgs, 6)).toBe(2);
    expect(lowerBound(msgs, 10)).toBe(3);
  });
  it('ranks repeated lines in a window and counts users', () => {
    const msgs = [
      msg(10, 'a', 'clip it'),
      msg(11, 'b', 'CLIP IT'),
      msg(12, 'c', 'no way'),
      msg(12, 'a', 'Clip it!'),
      msg(13, 'd', 'no way'),
      msg(14, 'e', 'hello'),
      msg(40, 'f', 'clip it'),
    ];
    const b = burst(msgs, 10, 20);
    expect(b.n).toBe(6);
    expect(b.users).toBe(5);
    expect(b.lines.map((l) => [l.text, l.count])).toEqual([
      ['clip it', 3],
      ['no way', 2],
    ]);
  });
});
