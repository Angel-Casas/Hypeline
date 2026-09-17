import { describe, expect, it } from 'vitest';
import { buildCues, chunkTranscript, outputSize, timeCues, titleAss, toAss } from '../captions';

describe('chunkTranscript', () => {
  it('packs words into short cues and breaks at sentence ends', () => {
    const c = chunkTranscript(
      'Grandma what are you doing. She is pulling up right now and chat is losing it completely!',
      { maxChars: 24 },
    );
    expect(c.every((x) => x.length <= 32)).toBe(true); // ≤ maxChars with merge slack
    expect(c[0]).toBe('Grandma what are you doing.'); // tiny "doing." folded into its sentence
    expect(c.every((x) => !/doing\. She/.test(x))).toBe(true); // never straddles sentences
  });
  it('merges a tiny trailing cue', () => {
    expect(
      chunkTranscript('one two three four five six seven eight nine ten ok', { maxChars: 40 }),
    ).toEqual(['one two three four five six seven eight', 'nine ten ok']);
    expect(
      chunkTranscript('one two three four five six seven eight nine ten. ok', { maxChars: 40 }),
    ).toEqual(['one two three four five six seven eight', 'nine ten. ok']);
  });
  it('handles empty', () => {
    expect(chunkTranscript('   ')).toEqual([]);
  });
});

describe('timeCues', () => {
  it('spreads cues over the duration proportionally and ends on time', () => {
    const cues = timeCues(['aaaa', 'bb', 'cccccccc'], 14);
    expect(cues[0]!.start).toBe(0);
    expect(cues[2]!.end).toBeCloseTo(14, 5);
    expect(cues[2]!.end - cues[2]!.start).toBeGreaterThan(cues[1]!.end - cues[1]!.start);
  });
  it('respects the minimum duration by rescaling', () => {
    const cues = timeCues(['a', 'b', 'c', 'd'], 1);
    expect(cues[3]!.end).toBeCloseTo(1, 5);
    expect(cues.every((c) => c.end > c.start)).toBe(true);
  });
});

describe('toAss', () => {
  it('writes a valid script with escaped text and frame size', () => {
    const cues = buildCues('hello {chat} how are you', 4, { uppercase: true, maxChars: 40 });
    const ass = toAss(cues, 404, 720, 'boxed');
    expect(ass).toContain('PlayResX: 404');
    expect(ass).toContain('PlayResY: 720');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:04.00,Cap,,0,0,0,,HELLO (CHAT) HOW ARE YOU');
    expect(ass).toMatch(/Style: Cap,DejaVu Sans,50,/); // 720 * 0.07
  });
  it('outputSize follows the crop', () => {
    expect(outputSize(1280, 720, 'crop=404:720:438:0')).toEqual({ width: 404, height: 720 });
    expect(outputSize(1280, 720, null)).toEqual({ width: 1280, height: 720 });
  });
});

describe('titleAss', () => {
  it('sizes by the smaller frame dimension and escapes braces', () => {
    const wide = titleAss('He {actually} did it', 1280, 720);
    expect(wide).toContain('PlayResX: 1280');
    expect(wide).toMatch(/Style: Title,DejaVu Sans,65,/); // min(720*0.09=64.8, 1280*0.11)
    expect(wide).toContain(',,He (actually) did it\n');
    const tall = titleAss('x', 404, 720);
    expect(tall).toMatch(/Style: Title,DejaVu Sans,44,/); // min(64.8, 404*0.11=44.4)
  });
});
