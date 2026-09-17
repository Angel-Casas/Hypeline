/**
 * "What was chat saying?" — the most repeated lines in a window of the chat replay,
 * for the timeline's hover readout. Messages are normalised (lower-case, whitespace
 * and repeated characters collapsed, trailing punctuation dropped) so "CLIP IT!!!",
 * "clip it" and "Clip  it" count as one line.
 */
import type { ChatMessage } from '@/lib/twitch/types';

export interface BurstLine {
  text: string;
  count: number;
}

export function normaliseLine(m: string): string {
  return m
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/[!?.…]+$/g, '')
    .trim();
}

/** First index with t >= sec (messages sorted by t). */
export function lowerBound(msgs: ChatMessage[], sec: number): number {
  let lo = 0;
  let hi = msgs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (msgs[mid]!.t < sec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Top `limit` repeated lines in [from, to), plus the message and user counts. */
export function burst(
  msgs: ChatMessage[],
  from: number,
  to: number,
  limit = 3,
): { lines: BurstLine[]; n: number; users: number } {
  const counts = new Map<string, { text: string; count: number }>();
  const users = new Set<string>();
  let n = 0;
  for (let i = lowerBound(msgs, from); i < msgs.length && msgs[i]!.t < to; i++) {
    const m = msgs[i]!;
    n++;
    users.add(m.u);
    const key = normaliseLine(m.m);
    if (!key) continue;
    const c = counts.get(key);
    if (c) c.count++;
    else counts.set(key, { text: m.m.trim().slice(0, 40), count: 1 });
  }
  const lines = [...counts.values()]
    .filter((c) => c.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { lines, n, users: users.size };
}
