/**
 * Emotion axes — what chat *felt*, as distinct from how much it said (ADR-43, S7).
 *
 * The heatmap measures volume: a bucket is hot when many messages arrive. That misses two
 * whole categories of moment. Chat can agree completely without typing more than usual —
 * 90 of 130 chatters posting "W MOM" while the rate sat *below* baseline — and chat can
 * react to tension by going **quieter**, which a rate scorer cannot see by construction
 * because it is looking for the opposite sign.
 *
 * So each pole is measured as a **share of the people talking**, not a count of messages.
 * That quantity is close to independent of volume (r ≈ 0.0–0.35 depending on chat size,
 * S7/S7c), which is the whole reason this layer earns its place.
 *
 * Three axes, drawn mirrored: the warm pole above the centre line, the cool pole below.
 * **The poles are never subtracted.** A bucket where chat is both hysterical and gutted is
 * the most interesting bucket on the stream; a difference would render it as a flat line,
 * and since joy outnumbers sorrow four or five to one, subtraction would erase the rare
 * pole in every bucket it appeared in.
 *
 * Why these three, and why no others: S7 measured six poles against four VODs.
 * joy ↔ sorrow fires everywhere; hype ↔ letdown is the W/L culture of a big chat;
 * dread ↔ payoff needed a 353-messages-a-minute chat before it showed anything, and its
 * lower pole is *not* relief-from-fear — `phew` and `survived` are near zero even there.
 * It is `finally`: the wait paying off. The axis is named for what it measures.
 */
import type { ChatMessage } from '@/lib/twitch/types';
import { t } from '@/i18n';

export type PoleKey = 'joy' | 'sorrow' | 'hype' | 'letdown' | 'dread' | 'payoff';
export type AxisKey = 'joy-sorrow' | 'hype-letdown' | 'dread-payoff';

export interface Pole {
  key: PoleKey;
  /** Lower-case tokens; emote names are lower-cased before matching. */
  words: Set<string>;
}
export interface Axis {
  key: AxisKey;
  /** Drawn above the centre line, in the warm ink. */
  up: Pole;
  /** Drawn below, in the cool ink. */
  down: Pole;
}

const pole = (key: PoleKey, words: string): Pole => ({
  key,
  words: new Set(words.split(/\s+/).filter(Boolean)),
});

/**
 * The lexicon. Every token belongs to exactly one pole — a token counted on two poles
 * would manufacture a correlation between them.
 *
 * A warning learned the hard way (S7c): a token's pole has to be checked against a large,
 * reactive chat before it is trusted. `ez` sat in the lower pole here on the reasonable
 * assumption that it meant relief; in one xqc VOD it appears 2,801 times and is a taunt
 * every time ("EZ loot", "EZ YOINK"). It lives in `hype` now. Anyone extending these lists,
 * or writing the per-language packs M7 still needs, should run `spikes/s7-sentiment` over a
 * big VOD and read the lines a token actually matched rather than trusting the dictionary.
 */
export const AXES: readonly Axis[] = [
  {
    key: 'joy-sorrow',
    up: pole(
      'joy',
      `lol lmao lmfao lmaoo lmfaoo kekw kek kekl kekwait lul lulw omegalul icant
       pepelaugh haha hahaha ahah xd jaja jajaja 😂 🤣 laughing crying`,
    ),
    down: pole(
      'sorrow',
      `sadge pepehands feelsbadman widepeeposad peepocry sadcat 😭 😢 🥺 💔
       rip cry heartbroken awww aww nooo restinpeace`,
    ),
  },
  {
    key: 'hype-letdown',
    up: pole(
      'hype',
      `pog poggers pogchamp pogu pogcrazy letsgo lfg gg hype goat wooo sheesh
       insane clutch cracked 🔥 w ww www dub ez ezclap`,
    ),
    down: pole(
      'letdown',
      `l ll lll copium aware notlikethis choke choked unlucky malding yikes oof
       washed mid cope sadgechamp`,
    ),
  },
  {
    key: 'dread-payoff',
    up: pole(
      'dread',
      `monkas monkaw monkahmm monkaeyes pausechamp 😬 uhoh ohno scared nervous
       sweating terrifying creepy`,
    ),
    // not relief-from-fear, which barely exists in chat: this is the wait ending
    down: pole('payoff', `finally phew whew saved survived thankgod exhale atlast`),
  },
] as const;

export const AXIS_KEYS = AXES.map((a) => a.key);
export const POLES: readonly Pole[] = AXES.flatMap((a) => [a.up, a.down]);
const POLE_OF = new Map<PoleKey, Pole>(POLES.map((p) => [p.key, p]));

export function axisOf(key: AxisKey): Axis {
  return AXES.find((a) => a.key === key) ?? AXES[0]!;
}

/** Words, emoji and CJK runs; emote names arrive separately and are matched whole. */
const TOKEN_RE = /[\p{L}\p{N}]+|\p{Extended_Pictographic}/gu;

/**
 * Which poles a message votes for. A message votes at most once per pole however many
 * matching tokens it contains, so `LOL LOL LOL LOL` is one vote for joy.
 */
export function polesOf(m: ChatMessage): PoleKey[] {
  const toks = new Set<string>(m.m.toLowerCase().match(TOKEN_RE) ?? []);
  for (const e of m.e) toks.add(e.toLowerCase());
  const hit: PoleKey[] = [];
  for (const p of POLES) {
    for (const tok of toks) {
      if (p.words.has(tok)) {
        hit.push(p.key);
        break;
      }
    }
  }
  return hit;
}

/**
 * The floor: below two chatters there is no *agreement*, only a person. Everything above
 * that is handled by confidence rather than by a threshold — see `strength` below. A hard
 * count was the original design and it was wrong: on a chat with six people talking, a
 * moment where two of them are hyped is a third of the room, and the ribbon drew it as a
 * three-quarter-height peak while the list refused to offer it (Angel, 2026-09-21).
 */
export const MIN_CHATTERS = 2;
const TARGET_CHATTERS = 12;
/** The heatmap's own resolution. The emotion layer starts here and widens if it must. */
export const BASE_BUCKET_SEC = 15;
const MAX_WIDEN = 8;

/**
 * The bucket has to hold a crowd, and how long that takes is entirely a property of the
 * channel: a big chat has ~97 distinct chatters every 15 s, a small one has 2 (S7). At 15 s
 * the small channels produced *nothing* on every pole — not because their chat had no
 * feelings but because four people cannot agree inside fifteen seconds when only three are
 * talking. So the window widens until it holds enough people to vote.
 *
 * The hype heatmap is not widened with it: that only needs messages, and one person can
 * supply those.
 */
export function pickBucketSec(msgs: ChatMessage[], lengthSeconds: number): number {
  const med = medianChatters(msgs, lengthSeconds, BASE_BUCKET_SEC);
  if (med >= TARGET_CHATTERS) return BASE_BUCKET_SEC;
  const mult = Math.min(MAX_WIDEN, Math.max(1, Math.round(TARGET_CHATTERS / Math.max(med, 0.5))));
  return BASE_BUCKET_SEC * mult;
}

function medianChatters(msgs: ChatMessage[], lengthSeconds: number, bucketSec: number): number {
  const count = bucketCount(msgs, lengthSeconds, bucketSec);
  const users: Set<string>[] = Array.from({ length: count }, () => new Set());
  for (const m of msgs) {
    const i = Math.floor(m.t / bucketSec);
    if (i >= 0 && i < count) users[i]!.add(m.u);
  }
  const sizes = users.map((s) => s.size).sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor(sizes.length / 2)]! : 0;
}

function bucketCount(msgs: ChatMessage[], lengthSeconds: number, bucketSec: number): number {
  const maxT = Math.max(lengthSeconds, msgs.length ? msgs[msgs.length - 1]!.t : 0);
  return Math.floor(maxT / bucketSec) + 1;
}

/** Rolling median, unclamped — a pole's share is legitimately 0 for long stretches. */
function rollingMedian(v: number[], half: number): number[] {
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    const w = v.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    out[i] = w.length ? w[Math.floor(w.length / 2)]! : 0;
  }
  return out;
}

export interface PoleSeries {
  /** Distinct chatters who took this pole, per bucket. */
  cnt: number[];
  /** `cnt / chatters` — the raw proportion. */
  share: number[];
  /**
   * The share, discounted for how few people it was measured on: the lower bound of a
   * Wilson score interval. One chatter of two is 50 % and means almost nothing; fifteen of
   * thirty is the same 50 % and means a great deal, and `strength` is 0.21 against 0.41.
   * This is what both the ribbon and the moment list use, so a peak you can see is a peak
   * you can click — which a raw share could not promise, because on a quiet axis it let one
   * person paint a full-height peak.
   */
  strength: number[];
  /** `strength`, gaussian-smoothed: the curve as drawn, and as peaks are picked off it. */
  curve: number[];
  /** log2 of share against this channel's own rolling median share. */
  lift: number[];
}

export interface EmotionSeries {
  bucketSec: number;
  count: number;
  /** Distinct chatters per bucket. */
  chatters: number[];
  msgs: number[];
  /** log2 of volume against its own baseline — the quantity the heatmap already draws. */
  rate: number[];
  poles: Record<PoleKey, PoleSeries>;
  /** The largest share any pole reaches, so a drawing can scale every axis alike. */
  peak: Record<PoleKey, number>;
}

/** Half-width of the baseline window, matching the heatmap's own (`DEFAULT_OPTIONS`). */
const BASELINE_HALF_SEC = 600;
/**
 * Damping for the lift ratio. Without it a bucket whose baseline share is zero returns an
 * unbounded lift, so a single chatter in a quiet stretch would outrank a crowd (S7).
 */
const LIFT_FLOOR = 0.02;

/**
 * Lower bound of the Wilson score interval for `k` of `n`, at z = 1 (~84 % one-sided).
 * Small samples are pulled towards zero, large ones barely move; 0 of anything is 0.
 */
export function confidentShare(k: number, n: number): number {
  if (n <= 0 || k <= 0) return 0;
  const p = k / n;
  const z2 = 1; // z = 1
  const lo = (p + z2 / (2 * n) - Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return Math.max(0, lo);
}

/** Gaussian blur over buckets, in bucket units. The drawing samples the same kernel. */
export const SMOOTH_SIGMA = 1.25;
function blur(v: readonly number[], sigma: number): number[] {
  const r = Math.max(1, Math.ceil(sigma * 4));
  const k: number[] = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(w);
    ks += w;
  }
  return v.map((_, i) => {
    let acc = 0;
    for (let j = -r; j <= r; j++)
      acc += (v[Math.max(0, Math.min(v.length - 1, i + j))] ?? 0) * k[j + r]!;
    return acc / ks;
  });
}

/**
 * What counts as a ribbon at full height when an axis has nothing much to show. Without a
 * floor the ribbon normalises to its own maximum, so an axis whose best moment is one
 * chatter in six still fills the frame — the other half of the same bug. With it, a quiet
 * axis draws quietly, which is the truth.
 */
export const FULL_HEIGHT = 0.15;

/** The scale the axis is drawn against: its own tallest smoothed point, but never less. */
export function axisScale(s: EmotionSeries, axis: AxisKey): number {
  const a = axisOf(axis);
  let peak = 0;
  for (const key of [a.up.key, a.down.key])
    for (const v of s.poles[key].curve) if (v > peak) peak = v;
  return Math.max(peak, FULL_HEIGHT);
}

/**
 * One pass over the messages for all six poles. Computing every pole rather than only the
 * selected axis costs one pass instead of three and lets the dropdown switch with no
 * recompute — the expensive part is reading the messages, not counting the tokens.
 *
 * Feed this the same filtered messages the scoring gets (bots already dropped).
 */
export function emotionSeries(
  msgs: ChatMessage[],
  lengthSeconds: number,
  bucketSec = pickBucketSec(msgs, lengthSeconds),
): EmotionSeries {
  const count = bucketCount(msgs, lengthSeconds, bucketSec);
  const chatterSets: Set<string>[] = Array.from({ length: count }, () => new Set());
  const poleSets = {} as Record<PoleKey, Set<string>[]>;
  for (const p of POLES) poleSets[p.key] = Array.from({ length: count }, () => new Set());
  const msgCount = new Array<number>(count).fill(0);

  for (const m of msgs) {
    const i = Math.floor(m.t / bucketSec);
    if (i < 0 || i >= count) continue;
    msgCount[i]!++;
    chatterSets[i]!.add(m.u);
    for (const key of polesOf(m)) poleSets[key][i]!.add(m.u);
  }

  const chatters = chatterSets.map((s) => s.size);
  const half = Math.max(1, Math.floor(BASELINE_HALF_SEC / bucketSec));
  const volBase = rollingMedian(msgCount, half);
  const rate = msgCount.map((n, i) => Math.log2((n + 0.5) / (volBase[i]! + 0.5)));

  const poles = {} as Record<PoleKey, PoleSeries>;
  const peak = {} as Record<PoleKey, number>;
  for (const p of POLES) {
    const cnt = poleSets[p.key].map((s) => s.size);
    const share = cnt.map((c, i) => (chatters[i]! > 0 ? c / chatters[i]! : 0));
    const strength = cnt.map((c, i) => confidentShare(c, chatters[i]!));
    const curve = blur(strength, SMOOTH_SIGMA);
    const base = rollingMedian(share, half);
    const lift = share.map((s, i) => Math.log2((s + LIFT_FLOOR) / (base[i]! + LIFT_FLOOR)));
    poles[p.key] = { cnt, share, strength, curve, lift };
    peak[p.key] = curve.reduce((a, b) => (b > a ? b : a), 0);
  }
  return { bucketSec, count, chatters, msgs: msgCount, rate, poles, peak };
}

export interface EmotionMoment {
  /** Bucket start, seconds. */
  t: number;
  pole: PoleKey;
  /** Chatters who took this pole, and how many were talking at all. */
  cnt: number;
  users: number;
  share: number;
  lift: number;
  /** How tall the peak stands, 0..1 of the drawn ribbon — the number peaks are ranked by. */
  height: number;
  /** Both poles of the axis are high at once — the best kind of moment there is. */
  both: boolean;
  /** How far the volume was above its own baseline here; negative means chat went quiet. */
  rate: number;
}

export interface EmotionMomentOptions {
  minChatters?: number;
  /** How tall a peak must stand, as a fraction of the drawn ribbon's height. */
  minHeight?: number;
  /** ...or, for a quiet axis, as a fraction of that axis's own tallest peak. */
  minRelative?: number;
  /** Minimum seconds between two emotion moments. */
  minGapSec?: number;
  top?: number;
}

/**
 * How high the curve must stand for a bump to count as a peak, in the drawn units.
 *
 * Two bars, and a peak only has to clear one (Angel, 2026-09-21: "although they might be
 * negligible, it was still highlighted in the heatmap as a peak ... could be something
 * interesting in the VOD for people to clip").
 *
 * The first is absolute — a quarter of the ribbon's height — and catches everything on an
 * axis with real signal. The second is relative to the axis's own tallest point, and is what
 * an axis that never gets loud needs: on a stream where dread peaks at two chatters in
 * eleven, those two chatters are still the most frightened this chat ever got, and they are
 * worth a click. `minChatters` is what keeps that from becoming noise: one person is never a
 * mood, whatever fraction of a quiet minute they are.
 *
 * Exported because the moment list asks the same question of the rate-scored moments: one
 * that sits on a swell this tall is *about* the chosen mood, and dimming it would be a lie.
 */
export function peakBar(
  s: EmotionSeries,
  axis: AxisKey,
  opts: { minHeight?: number; minRelative?: number } = {},
): number {
  const { minHeight = 0.25, minRelative = 0.5 } = opts;
  const a = axisOf(axis);
  let own = 0;
  for (const key of [a.up.key, a.down.key])
    for (const v of s.poles[key].curve) if (v > own) own = v;
  return Math.min(minHeight * axisScale(s, axis), minRelative * own);
}

/** The taller pole's curve at a second, in the same units as `peakBar`. */
export function moodHeightAt(s: EmotionSeries, axis: AxisKey, t: number): number {
  const a = axisOf(axis);
  const i = Math.max(0, Math.min(s.count - 1, Math.round(t / s.bucketSec)));
  return Math.max(s.poles[a.up.key].curve[i] ?? 0, s.poles[a.down.key].curve[i] ?? 0);
}

/**
 * How many mood peaks may surface at once. Deliberately generous and *not* the sensitivity
 * slider's `top`: the slider still governs mood density through `minGapSec`, which is the
 * honest control — two peaks a minute apart are one moment whatever the budget — while a
 * hard count simply left real peaks on the ribbon unclaimed. On a 6-hour VOD the gap alone
 * yields about thirty; this is the safety net, not the policy (Angel, 2026-09-21).
 */
export const MAX_MOOD_MOMENTS = 60;

/**
 * The moments on one axis, best first — **the peaks of the curve the ribbon draws**.
 *
 * This is the whole design, and the first version got it wrong: the ribbon drew `share`
 * while the list selected on `lift` against a rolling baseline with a hard four-chatter
 * floor. The two disagreed constantly, so a chat could show a three-quarter-height swell of
 * hype with nothing to click on it, which is exactly what Angel found on 2026-09-21 — a raid
 * landing, the whole room hyped, and no moment offered. On that VOD the dread axis drew
 * full-height peaks and offered *nothing at all*.
 *
 * So peaks are now found on `curve`, the same smoothed, confidence-weighted series the
 * ribbon is drawn from, and measured against the same scale. If you can see a bump, it is
 * in this list. The only remaining bar is `minChatters`, because one person is not a mood
 * however loud they are.
 */
export function emotionMoments(
  s: EmotionSeries,
  axis: AxisKey,
  opts: EmotionMomentOptions = {},
): EmotionMoment[] {
  const {
    minChatters = MIN_CHATTERS,
    minHeight = 0.25,
    minRelative = 0.5,
    minGapSec = 120,
    top = MAX_MOOD_MOMENTS,
  } = opts;
  const a = axisOf(axis);
  const scale = axisScale(s, axis);
  const bar = peakBar(s, axis, { minHeight, minRelative });
  const found: EmotionMoment[] = [];
  for (const p of [a.up, a.down]) {
    const d = s.poles[p.key];
    const other = s.poles[p.key === a.up.key ? a.down.key : a.up.key];
    for (let i = 0; i < s.count; i++) {
      const v = d.curve[i]!;
      if (v < bar) continue;
      // a local maximum, so one swell yields one moment rather than one per bucket
      if (v < (d.curve[i - 1] ?? 0) || v < (d.curve[i + 1] ?? 0)) continue;
      // the peak of the smoothed curve can sit a bucket off the bucket that caused it, so
      // the crowd is counted over the neighbours too — otherwise the reason line reads "2 of
      // 9" for a swell whose own bucket had 6
      const near = [i - 1, i, i + 1].filter((j) => j >= 0 && j < s.count);
      const cnt = Math.max(...near.map((j) => d.cnt[j]!));
      if (cnt < minChatters) continue;
      const at = near.reduce((b, j) => (d.cnt[j]! > d.cnt[b]! ? j : b), i);
      found.push({
        t: at * s.bucketSec,
        pole: p.key,
        cnt,
        users: s.chatters[at]!,
        share: d.share[at]!,
        lift: d.lift[at]!,
        height: v / scale,
        both: other.curve[i]! >= bar && Math.max(...near.map((j) => other.cnt[j]!)) >= minChatters,
        rate: s.rate[at]!,
      });
    }
  }
  // tallest first, then thin out so two buckets of the same laugh are one moment
  found.sort((x, y) => y.height - x.height || y.cnt - x.cnt);
  const kept: EmotionMoment[] = [];
  for (const m of found) {
    if (kept.every((k) => Math.abs(k.t - m.t) >= minGapSec)) kept.push(m);
    if (kept.length >= top) break;
  }
  return kept;
}

/** The message key for each pole's name, e.g. "laughing". */
export const POLE_KEY: Record<PoleKey, string> = {
  joy: 'emotion.pole.joy',
  sorrow: 'emotion.pole.sorrow',
  hype: 'emotion.pole.hype',
  letdown: 'emotion.pole.letdown',
  dread: 'emotion.pole.dread',
  payoff: 'emotion.pole.payoff',
};
export const AXIS_LABEL_KEY: Record<AxisKey, string> = {
  'joy-sorrow': 'emotion.axis.joy-sorrow',
  'hype-letdown': 'emotion.axis.hype-letdown',
  'dread-payoff': 'emotion.axis.dread-payoff',
};

/**
 * Why this moment is in the list, in the user's language. Three shapes, because the
 * interesting cases deserve their own sentence: chat split between both poles, chat
 * agreeing while *saying less than usual*, and the ordinary case.
 */
export function reasonFor(m: EmotionMoment): string {
  const what = t(POLE_KEY[m.pole]);
  if (m.both) return t('emotion.reason.both', { n: m.cnt, of: m.users });
  if (m.rate < -0.3) return t('emotion.reason.quiet', { what, n: m.cnt, of: m.users });
  return t('emotion.reason.plain', { what, n: m.cnt, of: m.users });
}

/** Is this pole drawn above the centre line? */
export function isUpper(p: PoleKey): boolean {
  return AXES.some((a) => a.up.key === p);
}

/** Every token we know, for the vocabulary overlay and for tests that guard the lexicon. */
export function tokensOf(p: PoleKey): string[] {
  return [...(POLE_OF.get(p)?.words ?? [])].sort();
}
