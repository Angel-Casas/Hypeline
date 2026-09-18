import { describe, expect, it } from 'vitest';
import { speechSignals, speechForBucket } from '../speech';
import { scoreBuckets, reasonsFor } from '../scoring';
import type { ChatMessage } from '@/lib/twitch/types';

describe('speech signals', () => {
  it('dead air damps, excitement lifts', () => {
    const quiet = speechSignals('okay so yeah', 120);
    expect(quiet.boost).toBe(0.85);
    const loud = speechSignals(
      "no way! no way! did you see that?! chat look! let's go! oh my god! hahaha " +
        'this is insane bro. '.repeat(40),
      120,
    );
    expect(loud.boost).toBeGreaterThan(1.1);
    expect(loud.phrases).toContain('no way');
    expect(speechSignals('', 120).boost).toBe(1);
  });
  it('blends into the bucket score with a quoted reason', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 60; i++) msgs.push({ t: 600 + (i % 15), u: 'u' + i, m: 'W', e: [], b: [] });
    const text =
      'no way! are you kidding?! ' + 'we are talking a lot here today friends. '.repeat(30);
    const plain = scoreBuckets(msgs, 1200).find((b) => b.t === 600)!;
    const withSpeech = scoreBuckets(msgs, 1200, undefined, [
      { startSec: 540, endSec: 660, text },
    ]).find((b) => b.t === 600)!;
    expect(withSpeech.score).toBeGreaterThan(plain.score);
    expect(reasonsFor(withSpeech)).toContain('streamer: “no way”');
    expect(speechForBucket([], 600, 15)).toEqual({ boost: 1, phrase: null });
  });
});
