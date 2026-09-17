import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkPlaybackAccess,
  parsePlaybackAccess,
  parseMasterPlaylist,
  parseVariantPlaylist,
  pickAudioVariant,
  pickVariant,
  segmentsForRange,
  viaShim,
} from '../hls';

const fx = (n: string) =>
  readFileSync(join(process.cwd(), 'src/lib/twitch/__tests__/fixtures', n), 'utf8');

describe('parseMasterPlaylist', () => {
  it('reads the five Twitch variants with names and resolutions', () => {
    const v = parseMasterPlaylist(fx('master.m3u8'));
    expect(v.map((x) => x.name)).toEqual(['chunked', '720p30', '480p30', '360p30', '160p30']);
    expect(v[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(v[1]).toMatchObject({ width: 1280, height: 720 });
    expect(v.every((x) => x.url.startsWith('https://'))).toBe(true);
  });
  it('handles an audio_only variant and never picks it for video', () => {
    const text =
      fx('master.m3u8') +
      '\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="audio_only",NAME="Audio Only",AUTOSELECT=NO,DEFAULT=NO\n#EXT-X-STREAM-INF:BANDWIDTH=216383,CODECS="mp4a.40.2",VIDEO="audio_only"\nhttps://cdn.example/abc/audio_only/index-dvr.m3u8\n';
    const v = parseMasterPlaylist(text);
    expect(v.map((x) => x.name)).toContain('audio_only');
    expect(pickAudioVariant(v).name).toBe('audio_only');
    expect(pickVariant(v, 10).name).toBe('160p30');
    expect(pickAudioVariant(parseMasterPlaylist(fx('master.m3u8'))).name).toBe('160p30');
  });
  it('picks by max height', () => {
    const v = parseMasterPlaylist(fx('master.m3u8'));
    expect(pickVariant(v, 720).name).toBe('720p30');
    expect(pickVariant(v, 1080).name).toBe('chunked');
    expect(pickVariant(v, 500).name).toBe('480p30');
    expect(pickVariant(v, 10).name).toBe('160p30');
  });
});

describe('parseVariantPlaylist', () => {
  it('accumulates start times and resolves relative URLs', () => {
    const segs = parseVariantPlaylist(
      fx('variant-head.m3u8'),
      'https://cdn.example/abc/chunked/index-dvr.m3u8',
    );
    expect(segs.length).toBe(10); // fixture ends with a dangling EXTINF, which must be ignored
    expect(segs[0]).toEqual({
      start: 0,
      duration: 11.9,
      url: 'https://cdn.example/abc/chunked/0.ts',
    });
    expect(segs[1]!.start).toBeCloseTo(11.9, 3);
    expect(segs[2]!.start).toBeCloseTo(23.066, 3);
  });
  it('selects the segments covering a range', () => {
    const segs = parseVariantPlaylist(
      fx('variant-head.m3u8'),
      'https://cdn.example/abc/chunked/index-dvr.m3u8',
    );
    const want = segmentsForRange(segs, 20, 40);
    expect(want.map((s) => s.url.split('/').pop())).toEqual(['1.ts', '2.ts', '3.ts']);
    expect(segmentsForRange(segs, 0, 1).length).toBe(1);
  });
});

describe('viaShim', () => {
  it('encodes the target', () => {
    expect(viaShim('https://shim.example/', 'https://usher.ttvnw.net/x?a=1&b=2')).toBe(
      'https://shim.example/?u=https%3A%2F%2Fusher.ttvnw.net%2Fx%3Fa%3D1%26b%3D2',
    );
    expect(() => viaShim('', 'https://x')).toThrow();
  });
});

describe('playback access', () => {
  const tok = (v: unknown) => ({ value: JSON.stringify(v), signature: 'sig' });
  it('reads a subscribers-only VOD out of the token (as Twitch answered on 2026-09-16)', () => {
    const a = parsePlaybackAccess(
      tok({
        authorization: { forbidden: true, reason: 'UNAUTHORIZED_ENTITLEMENTS' },
        chansub: { restricted_bitrates: ['160p30', '360p30', '720p60', 'chunked'] },
        vod_id: 2875511531,
      }),
    );
    expect(a).toEqual({ forbidden: true, reason: 'UNAUTHORIZED_ENTITLEMENTS', subOnly: true });
  });
  it('lets an open VOD through, and a token it cannot read', () => {
    expect(
      parsePlaybackAccess(
        tok({
          authorization: { forbidden: false, reason: '' },
          chansub: { restricted_bitrates: [] },
        }),
      ),
    ).toMatchObject({ forbidden: false, subOnly: false });
    expect(parsePlaybackAccess({ value: 'not json', signature: '' }).subOnly).toBe(false);
  });
  it('answers null (not locked) when Twitch cannot be asked', async () => {
    const failing = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    expect(await checkPlaybackAccess('1', failing)).toBeNull();
    const sub = (async () =>
      new Response(
        JSON.stringify([
          {
            data: {
              videoPlaybackAccessToken: tok({
                authorization: { forbidden: true, reason: 'UNAUTHORIZED_ENTITLEMENTS' },
              }),
            },
          },
        ]),
      )) as unknown as typeof fetch;
    expect((await checkPlaybackAccess('1', sub))?.subOnly).toBe(true);
  });
});
