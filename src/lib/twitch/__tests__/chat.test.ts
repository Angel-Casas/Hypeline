import { describe, expect, it } from 'vitest';
import { fetchChatReplay, normalise } from '../chat';
import type { RawComment } from '../gql';

const comment = (id: string, t: number, text = 'hi'): RawComment => ({
  id,
  contentOffsetSeconds: t,
  commenter: { login: 'user' + id, displayName: 'User' },
  message: { fragments: [{ text, emote: null }], userBadges: [] },
});

/** Fake Twitch: 60-comment chunks, one comment per second, chunk contains the offset. */
function fakeTwitch(lengthSeconds: number) {
  const calls: number[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      variables: { contentOffsetSeconds: number };
    }[];
    const off = body[0]!.variables.contentOffsetSeconds;
    calls.push(off);
    if (off >= lengthSeconds) {
      return new Response(
        JSON.stringify([
          { errors: [{ message: 'service error' }], data: { video: { comments: null } } },
        ]),
      );
    }
    const start = Math.max(0, off - 5); // chunk starts a bit before the offset, like Twitch
    const edges = [];
    for (let t = start; t < Math.min(lengthSeconds, start + 60); t++) {
      edges.push({ cursor: 'c' + t, node: comment('id' + t, t) });
    }
    return new Response(
      JSON.stringify([
        {
          data: {
            video: { comments: { edges, pageInfo: { hasNextPage: start + 60 < lengthSeconds } } },
          },
        },
      ]),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('normalise', () => {
  it('joins fragments and extracts emotes and badges', () => {
    const c: RawComment = {
      id: 'x',
      contentOffsetSeconds: 12,
      commenter: { login: 'bob', displayName: 'Bob' },
      message: {
        fragments: [
          { text: 'lol ', emote: null },
          { text: 'KEKW', emote: { emoteID: '1' } },
        ],
        userBadges: [{ setID: 'subscriber', version: '3' }],
      },
    };
    expect(normalise(c)).toEqual({
      t: 12,
      u: 'bob',
      m: 'lol KEKW',
      e: ['KEKW'],
      b: ['subscriber'],
    });
  });
});

describe('fetchChatReplay', () => {
  it('collects every message exactly once with parallel lanes', async () => {
    const { fetchImpl, calls } = fakeTwitch(1000);
    const batches: number[] = [];
    const msgs = await fetchChatReplay('v', 1000, {
      lanes: 4,
      fetchImpl,
      onBatch: (b, p) => {
        batches.push(b.length);
        expect(p.lengthSeconds).toBe(1000);
      },
    });
    expect(msgs.length).toBe(1000);
    expect(new Set(msgs.map((m) => m.t)).size).toBe(1000);
    expect(msgs[0]!.t).toBe(0);
    expect(msgs[999]!.t).toBe(999);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(calls.length).toBeLessThan(40);
  });

  it('works with a single lane and stops at the end', async () => {
    const { fetchImpl } = fakeTwitch(130);
    const msgs = await fetchChatReplay('v', 130, { lanes: 1, fetchImpl });
    expect(msgs.length).toBe(130);
  });
});
