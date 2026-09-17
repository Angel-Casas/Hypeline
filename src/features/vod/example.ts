/**
 * The example VOD (2026-09-17): a made-up 90-minute stream with a synthetic chat, so the
 * tour has a real desk to point at and a newcomer can click around before pasting a link.
 * There is no video behind it — the player shows a black card — and nothing is fetched. It
 * is cached like any VOD so it appears under "In this browser" and its × removes it.
 */
import type { ChatMessage, VodInfo } from '@/lib/twitch/types';
import { t } from '@/i18n';

export const EXAMPLE_ID = 'example';
export const isExampleId = (id: string | null | undefined) => id === EXAMPLE_ID;

const LENGTH = 90 * 60;

export function exampleInfo(): VodInfo {
  return {
    id: EXAMPLE_ID,
    title: t('example.title'),
    lengthSeconds: LENGTH,
    createdAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
    ownerLogin: 'hypeline',
    ownerDisplayName: 'Hypeline',
    gameName: 'Just Chatting',
    viewCount: 0,
    seekPreviewsURL: null,
    status: 'RECORDED',
  };
}

/** A small deterministic generator so the example is the same every time. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const CALM = [
  'hi chat',
  'gg',
  'nice',
  'what game is this',
  'hello from brazil',
  'lol',
  'true',
  'W',
  'same',
  'first time here',
  'that song is good',
  'brb',
];
const HYPE = [
  'LUL',
  'LUL LUL',
  'KEKW',
  'NO WAY',
  'CLIP IT',
  'clip that',
  'POGGERS',
  'LMAOOO',
  'WHAT',
  'HAHAHA',
  'OMEGALUL',
  'he did it',
];
const EMOTES = new Set(['LUL', 'KEKW', 'POGGERS', 'OMEGALUL']);
/** Where the stream got loud: start second, length, intensity, the emote the wall is made of. */
const BURSTS: [number, number, number, string][] = [
  [8 * 60 + 30, 40, 1.0, 'LUL'],
  [23 * 60, 35, 0.7, 'KEKW'],
  [41 * 60 + 15, 50, 1.4, 'POGGERS'],
  [58 * 60, 30, 0.6, 'LUL'],
  [72 * 60 + 40, 45, 1.1, 'OMEGALUL'],
  [84 * 60, 25, 0.5, 'KEKW'],
];

export function exampleMessages(): ChatMessage[] {
  const rnd = lcg(20260917);
  const out: ChatMessage[] = [];
  const say = (t: number, text: string, u: string) =>
    out.push({
      t: Math.round(t * 10) / 10,
      u,
      m: text,
      e: text.split(' ').filter((w) => EMOTES.has(w)),
      b: rnd() < 0.3 ? ['subscriber'] : [],
    });
  // a steady murmur: about one message every 6 s from a pool of regulars
  for (let t = 5; t < LENGTH; t += 4 + rnd() * 5)
    say(t, CALM[Math.floor(rnd() * CALM.length)]!, `viewer${Math.floor(rnd() * 240)}`);
  // the bursts: many users, emote walls, "clip it"
  for (const [start, len, k, emote] of BURSTS) {
    const n = Math.round(60 * k);
    for (let i = 0; i < n; i++) {
      const at = start + Math.pow(rnd(), 0.7) * len;
      const text = rnd() < 0.45 ? emote : HYPE[Math.floor(rnd() * HYPE.length)]!;
      say(at, text, `fan${Math.floor(rnd() * 900)}`);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
