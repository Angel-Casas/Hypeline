/**
 * The emotion layer's guarantees, held against the same real chat the spike measured
 * (S7 / S7c, docs/05-research.md). The interesting assertions here are not "the function
 * returns a number" but the three claims the feature rests on:
 *
 *   1. a pole's share is not a copy of the volume curve,
 *   2. a small chat still produces moments once the bucket widens,
 *   3. the layer finds moments where chat agreed while saying *less* than usual.
 *
 * If a lexicon edit or a scoring change breaks one of those, the feature has quietly
 * stopped being worth its pixels, and these tests are how we find out.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { ChatMessage } from '@/lib/twitch/types';
import { dropBotsAndAnnouncements } from '../scoring';
import {
  AXES,
  AXIS_KEYS,
  BASE_BUCKET_SEC,
  MIN_CHATTERS,
  axisOf,
  axisScale,
  confidentShare,
  emotionMoments,
  emotionSeries,
  isUpper,
  pickBucketSec,
  polesOf,
  tokensOf,
  type AxisKey,
  type PoleKey,
} from '../emotion';

function load(name: string): ChatMessage[] {
  const p = join(process.cwd(), 'src/features/hype/__tests__/fixtures', name);
  const text = name.endsWith('.gz')
    ? gunzipSync(readFileSync(p)).toString('utf8')
    : readFileSync(p, 'utf8');
  return dropBotsAndAnnouncements(
    text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChatMessage),
  );
}

const msg = (m: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  t: 0,
  u: 'u1',
  m,
  e: [],
  b: [],
  ...extra,
});

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

describe('the lexicon', () => {
  it('gives every token exactly one pole', () => {
    // a token on two poles would manufacture a correlation between them
    const seen = new Map<string, PoleKey>();
    for (const a of AXES)
      for (const p of [a.up, a.down])
        for (const w of p.words) {
          expect(seen.has(w), `"${w}" is in both ${seen.get(w)} and ${p.key}`).toBe(false);
          seen.set(w, p.key);
        }
  });

  it('keeps ez on hype, where S7c found it belongs', () => {
    // it sat in the lower pole of dread-payoff on the assumption that it meant relief;
    // in one xqc VOD it is 2,801 taunts. This test is the tombstone.
    expect(tokensOf('hype')).toContain('ez');
    expect(tokensOf('payoff')).not.toContain('ez');
  });

  it('draws the warm pole of each axis above the line', () => {
    for (const a of AXES) {
      expect(isUpper(a.up.key)).toBe(true);
      expect(isUpper(a.down.key)).toBe(false);
    }
    expect(AXIS_KEYS).toEqual(['joy-sorrow', 'hype-letdown', 'dread-payoff']);
    expect(axisOf('dread-payoff').down.key).toBe('payoff');
  });
});

describe('polesOf', () => {
  it('reads emote names as well as words', () => {
    expect(polesOf(msg('that was something', { e: ['PepeHands'] }))).toEqual(['sorrow']);
    expect(polesOf(msg('OMEGALUL'))).toEqual(['joy']);
    expect(polesOf(msg('monkaS'))).toEqual(['dread']);
  });

  it('votes once per pole however hard someone leans on the key', () => {
    expect(polesOf(msg('LOL LOL LOL LOL LOL'))).toEqual(['joy']);
  });

  it('lets one message vote on two axes at once', () => {
    // "KEKW W" is laughing *and* approving; both are true and both should count
    expect(polesOf(msg('KEKW W')).sort()).toEqual(['hype', 'joy']);
  });

  it('matches emoji and is not fooled by substrings', () => {
    expect(polesOf(msg('😭'))).toEqual(['sorrow']);
    expect(polesOf(msg('hello world'))).toEqual([]);
    // "lolling" is not "lol"; whole tokens only
    expect(polesOf(msg('lolling about'))).toEqual([]);
  });
});

describe('pickBucketSec', () => {
  it('leaves a busy chat at the heatmap resolution', () => {
    expect(pickBucketSec(load('caseoh_2871808638.jsonl.gz'), 14400)).toBe(BASE_BUCKET_SEC);
  });

  it('widens for a chat too sparse to hold a crowd in 15 s', () => {
    // tokyosims has ~3 chatters per 15 s; at 15 s S7 found nothing on any pole
    const wide = pickBucketSec(load('tokyosims_2871164819.jsonl'), 23057);
    expect(wide).toBeGreaterThan(BASE_BUCKET_SEC);
    expect(wide % BASE_BUCKET_SEC).toBe(0);
  });

  it('never widens past the ceiling, however dead the chat', () => {
    expect(pickBucketSec([msg('hi', { t: 10 })], 36000)).toBeLessThanOrEqual(
      BASE_BUCKET_SEC * 8,
    );
  });
});

describe('emotionSeries on a big real chat', () => {
  const msgs = load('caseoh_2871808638.jsonl.gz');
  const s = emotionSeries(msgs, 14400);

  it('measures a share, not a volume', () => {
    // the claim the whole feature rests on: if this correlation were high, the layer
    // would be a fatter copy of the heatmap. S7 measured -0.14..+0.19 here.
    for (const key of ['joy', 'sorrow', 'hype', 'letdown'] as PoleKey[]) {
      const r = Math.abs(pearson(s.poles[key].share, s.msgs));
      expect(r, `${key} share vs volume r=${r.toFixed(2)}`).toBeLessThan(0.4);
    }
  });

  it('counts chatters, so one spammer is one vote', () => {
    for (let i = 0; i < s.count; i++) {
      for (const key of ['joy', 'hype'] as PoleKey[]) {
        expect(s.poles[key].cnt[i]!).toBeLessThanOrEqual(s.chatters[i]!);
      }
      expect(s.poles.joy.share[i]!).toBeLessThanOrEqual(1);
    }
  });

  it('finds the "W MOM" moment the rate scorer misses', () => {
    // 00:24:30, 90 of 130 chatters, volume *below* baseline (S7)
    const i = Math.floor((24 * 60 + 30) / s.bucketSec);
    expect(s.poles.hype.cnt[i]!).toBeGreaterThan(60);
    expect(s.rate[i]!).toBeLessThan(0.3);
  });
});

describe('emotionMoments', () => {
  it('surfaces moments on a chat that found none at 15 s', () => {
    const msgs = load('tokyosims_2871164819.jsonl');
    const s = emotionSeries(msgs, 23057);
    const found = emotionMoments(s, 'joy-sorrow');
    expect(found.length).toBeGreaterThan(0);
    for (const m of found) expect(m.cnt).toBeGreaterThanOrEqual(MIN_CHATTERS);
  });

  it('includes moments where chat agreed while going quiet', () => {
    const s = emotionSeries(load('caseoh_2871808638.jsonl.gz'), 14400);
    const found = emotionMoments(s, 'hype-letdown', { top: 40 });
    // the category the heatmap cannot see: consensus without a rate spike
    expect(found.some((m) => m.rate < 0)).toBe(true);
  });

  it('keeps moments apart and ranks the strongest first', () => {
    const s = emotionSeries(load('caseoh_2871808638.jsonl.gz'), 14400);
    const found = emotionMoments(s, 'joy-sorrow', { minGapSec: 300, top: 8 });
    expect(found.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < found.length; i++) {
      // ranked by how tall the peak stands on the ribbon — the same number it is drawn at
      expect(found[i - 1]!.height).toBeGreaterThanOrEqual(found[i]!.height);
      for (let j = 0; j < i; j++) {
        expect(Math.abs(found[i]!.t - found[j]!.t)).toBeGreaterThanOrEqual(300);
      }
    }
  });

  it('reports both poles firing at once', () => {
    // one bucket, half the room laughing and half of it mourning
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 40; i++) msgs.push(msg(i % 2 ? 'KEKW' : 'Sadge', { t: 600, u: `u${i}` }));
    // quiet on either side so the baseline share is low
    for (let i = 0; i < 40; i++) msgs.push(msg('hello', { t: i * 15, u: `q${i}` }));
    const s = emotionSeries(msgs, 1200, 15);
    const found = emotionMoments(s, 'joy-sorrow');
    expect(found.some((m) => m.both)).toBe(true);
  });

  it('returns nothing when nobody agrees', () => {
    const msgs = Array.from({ length: 200 }, (_, i) =>
      msg('talking about the weather', { t: i * 15, u: `u${i}` }),
    );
    const s = emotionSeries(msgs, 3000, 15);
    for (const axis of AXIS_KEYS) expect(emotionMoments(s, axis)).toEqual([]);
  });

  it('survives an empty VOD', () => {
    const s = emotionSeries([], 600, 15);
    expect(s.count).toBeGreaterThan(0);
    expect(emotionMoments(s, 'joy-sorrow')).toEqual([]);
    expect(s.peak.joy).toBe(0);
  });
});

describe('confidentShare', () => {
  it('discounts a proportion measured on almost nobody', () => {
    // the same 50 %, and the difference between "someone said it" and "the room agreed"
    const oneOfTwo = confidentShare(1, 2);
    const fifteenOfThirty = confidentShare(15, 30);
    expect(oneOfTwo).toBeLessThan(fifteenOfThirty / 1.5);
    expect(confidentShare(0, 50)).toBe(0);
    expect(confidentShare(1, 0)).toBe(0);
  });

  it('rises with agreement and never exceeds the share itself', () => {
    let prev = 0;
    for (const k of [1, 2, 4, 8, 16]) {
      const v = confidentShare(k, 20);
      expect(v).toBeGreaterThan(prev);
      expect(v).toBeLessThanOrEqual(k / 20);
      prev = v;
    }
  });
});

describe('what is drawn is what is offered', () => {
  /*
   * The invariant Angel's bug report bought us (2026-09-21). Before this, the ribbon drew
   * `share` while the list picked on `lift` with a hard four-chatter floor, so a quiet
   * channel could show a three-quarter-height swell of hype with nothing to click, and a
   * whole axis could draw peaks and offer zero moments. Peaks are now found on the same
   * curve the ribbon is drawn from, so the two cannot drift apart again.
   */
  const msgs = load('tokyosims_2871164819.jsonl');
  const s = emotionSeries(msgs, 23057);

  for (const axis of AXIS_KEYS as AxisKey[]) {
    it(`offers a moment at the tallest peak of ${axis}`, () => {
      const a = axisOf(axis);
      const scale = axisScale(s, axis);
      let best = { v: 0, t: 0 };
      for (const key of [a.up.key, a.down.key]) {
        const d = s.poles[key];
        for (let i = 0; i < s.count; i++) {
          // only peaks a crowd could stand behind: one chatter is never a mood
          if (d.cnt[i]! < MIN_CHATTERS) continue;
          if (d.curve[i]! > best.v) best = { v: d.curve[i]!, t: i * s.bucketSec };
        }
      }
      if (!best.v) return; // this axis is silent on this VOD, and draws nothing
      const found = emotionMoments(s, axis, { top: 20 });
      expect(found.length, `${axis} draws a peak at ${(best.v / scale) * 100}% and offers nothing`)
        .toBeGreaterThan(0);
      // the tallest drawn peak is inside one thinning window of an offered moment
      const near = found.some((m) => Math.abs(m.t - best.t) <= 120);
      expect(near, `${axis}: nothing offered near its tallest peak at ${best.t}s`).toBe(true);
    });
  }

  it('still refuses a peak only one person made', () => {
    // 1 of 2 chatters is 50 % and means nothing; it must not become a moment
    const msgs2: ChatMessage[] = [];
    for (let t = 0; t < 1200; t += 30) {
      msgs2.push(msg(`chatting ${t}`, { t, u: `a${t}` }));
      msgs2.push(msg(`chatting too ${t}`, { t, u: `b${t}` }));
    }
    msgs2.push(msg('monkaS', { t: 600, u: 'lonely' }));
    const s2 = emotionSeries(msgs2, 1200);
    expect(emotionMoments(s2, 'dread-payoff')).toEqual([]);
  });
});
