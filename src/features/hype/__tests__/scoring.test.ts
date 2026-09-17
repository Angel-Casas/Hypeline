import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { ChatMessage } from '@/lib/twitch/types';
import {
  analyse,
  dropBotsAndAnnouncements,
  isClipRequest,
  isReaction,
  isTechTrouble,
  reasonsFor,
  scoreBuckets,
  sensitivityToOptions,
} from '../scoring';

function load(name: string): ChatMessage[] {
  const p = join(process.cwd(), 'src/features/hype/__tests__/fixtures', name);
  let text: string;
  if (name.endsWith('.gz')) text = gunzipSync(readFileSync(p)).toString('utf8');
  else text = readFileSync(p, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ChatMessage);
}

const msg = (m: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  t: 0,
  u: 'u1',
  m,
  e: [],
  b: [],
  ...extra,
});

describe('classifiers', () => {
  it('detects reactions', () => {
    expect(isReaction(msg('LMAOOOO'))).toBe(true);
    expect(isReaction(msg('lol w'))).toBe(true);
    expect(isReaction(msg('KEKW KEKW', { e: ['KEKW'] }))).toBe(true);
    expect(isReaction(msg('what is he doing with the harpoon gun'))).toBe(false);
    expect(isReaction(msg(''))).toBe(false);
  });

  it('detects clip requests but not toenails', () => {
    expect(isClipRequest(msg('CLIP IT'))).toBe(true);
    expect(isClipRequest(msg('twitch, clip that'))).toBe(true);
    expect(isClipRequest(msg('Clipped and shipped'))).toBe(true);
    expect(isClipRequest(msg('Im clipping my toenails right now'))).toBe(true); // known false positive, accepted
    expect(isClipRequest(msg('clip farm'))).toBe(false);
    expect(isClipRequest(msg('nice play'))).toBe(false);
  });

  it('detects technical trouble', () => {
    expect(isTechTrouble(msg('the mics are fucked'))).toBe(true);
    expect(isTechTrouble(msg("can't hear anything"))).toBe(true);
    expect(isTechTrouble(msg('grandma got game'))).toBe(false);
  });

  it('drops bots and repeated announcements', () => {
    const bot = msg('Join our Discord', { b: ['bot-badge'] });
    const timer = msg('Frames by Kole: https://x', { u: 'timerbot' });
    const human = msg('hello', { u: 'h' });
    const out = dropBotsAndAnnouncements([bot, timer, timer, timer, timer, human]);
    expect(out).toEqual([human]);
  });
});

describe('scoreBuckets', () => {
  it('scores an empty VOD as all zeros', () => {
    const b = scoreBuckets([], 60);
    expect(b.length).toBe(5);
    expect(b.every((x) => x.score === 0)).toBe(true);
  });

  it('needs a crowd: two users spamming do not score', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) msgs.push(msg('LOL', { t: 100 + (i % 5), u: i % 2 ? 'a' : 'b' }));
    const b = scoreBuckets(msgs, 3600);
    const bucket = b.find((x) => x.t === 90)!; // 100s falls in bucket [90,105)
    expect(bucket.n).toBe(20);
    expect(bucket.users).toBe(2);
    // confidence weight users/5 = 0.4 caps it well below a real moment
    const crowd: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) crowd.push(msg('LOL', { t: 100 + (i % 5), u: `u${i}` }));
    const bc = scoreBuckets(crowd, 3600).find((x) => x.t === 90)!;
    expect(bc.score).toBeGreaterThan(bucket.score * 2);
  });

  it('demotes technical trouble', () => {
    const complaint: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) complaint.push(msg('mic is broken', { t: 100, u: `u${i}` }));
    const hype: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) hype.push(msg('LMAOOO', { t: 100, u: `u${i}` }));
    const sc = scoreBuckets(complaint, 3600).find((x) => x.t === 90)!.score;
    const sh = scoreBuckets(hype, 3600).find((x) => x.t === 90)!.score;
    expect(sc).toBeLessThan(sh / 2);
  });
});

describe('fixtures (regression against the S3/S3b findings)', () => {
  it('tokyosims: finds the verified moments', () => {
    const raw = load('tokyosims_2871164819.jsonl');
    const { moments, dropped } = analyse(raw, '2871164819', 23042, 12);
    expect(dropped).toBeGreaterThan(300);
    const times = moments.map((m) => m.t);
    // Angel verified these three by watching the VOD.
    expect(times).toContain(34 * 60 + 15); // grandma segment
    expect(times).toContain(94 * 60 + 15); // NPC dance, "CLIP IT"
    expect(times).toContain(254 * 60 + 30); // "twitch clip that" — top score
    // The broken-mic complaint at 2:30:15 must not be a top-12 moment.
    expect(times).not.toContain(150 * 60 + 15);
    expect(moments.every((m) => m.users >= 3)).toBe(true);
  });

  it('popkreep (tiny channel): every moment has a crowd', () => {
    const raw = load('popkreep_2861002437.jsonl');
    const { moments } = analyse(raw, '2861002437', 11282, 8);
    expect(moments.length).toBeGreaterThan(0);
    expect(moments.every((m) => m.users >= 5)).toBe(true);
  });

  it('caseoh (big channel): 100k messages score in reasonable time and find the big laugh', () => {
    const raw = load('caseoh_2871808638.jsonl.gz');
    expect(raw.length).toBeGreaterThan(100_000);
    const t0 = performance.now();
    const { moments } = analyse(raw, '2871808638', 14254, 12);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(5000);
    expect(moments.map((m) => m.t)).toContain(204 * 60 + 15); // 3:24:15, highest peak
  });
});

describe('walls, moods, copypasta, sensitivity', () => {
  const msg = (t: number, u: string, m: string, e: string[] = []): ChatMessage => ({
    t,
    u,
    m,
    e,
    b: [],
  });
  it('reports an emote wall and a laugh mood', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 12; i++) msgs.push(msg(600 + i, 'u' + i, 'KEKW', ['KEKW']));
    for (let i = 0; i < 40; i++) msgs.push(msg(i * 15, 'q' + (i % 6), 'hello there friends'));
    const b = scoreBuckets(msgs, 1200).find((x) => x.t === 600)!;
    expect(b.wall?.token).toBe('KEKW');
    expect(b.wall!.users).toBe(12);
    expect(b.mood).toBe('laugh');
    expect(reasonsFor(b)[0]).toMatch(/KEKW wall/);
    expect(reasonsFor(b)).toContain('chat is losing it');
  });
  it('reports copypasta and confusion', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 8; i++)
      msgs.push(msg(300 + i, 'p' + i, 'this is the funniest stream of all time'));
    for (let i = 0; i < 6; i++) msgs.push(msg(900 + i, 'c' + i, '???'));
    for (let i = 0; i < 40; i++) msgs.push(msg(i * 15 + 3, 'q' + (i % 6), 'some chatter here'));
    const bs = scoreBuckets(msgs, 1200);
    expect(bs.find((x) => x.t === 300)!.pasta).toBe(8);
    expect(reasonsFor(bs.find((x) => x.t === 300)!)).toContain('copypasta ×8');
    expect(bs.find((x) => x.t === 900)!.mood).toBe('confused');
  });
  it('sensitivity changes how many moments surface', () => {
    const raw = load('tokyosims_2871164819.jsonl');
    const lo = sensitivityToOptions(1);
    const hi = sensitivityToOptions(5);
    const few = analyse(raw, 'x', 23042, lo.top, lo.opts).moments;
    const many = analyse(raw, 'x', 23042, hi.top, hi.opts).moments;
    expect(few.length).toBe(6);
    expect(many.length).toBeGreaterThan(few.length);
    const loudest = [...few].sort((a, b) => b.score - a.score)[0]!;
    expect(many.map((m) => m.t)).toContain(loudest.t);
  });
});
