import { describe, expect, it } from 'vitest';
import { formatHms, parseVodInput } from '../vodUrl';

describe('parseVodInput', () => {
  it('accepts ids and URLs', () => {
    expect(parseVodInput('2871164819')).toEqual({ vodId: '2871164819' });
    expect(parseVodInput('https://www.twitch.tv/videos/2871164819')).toEqual({
      vodId: '2871164819',
    });
    expect(parseVodInput('twitch.tv/videos/2871164819?t=1h2m3s')).toEqual({
      vodId: '2871164819',
      startSec: 3723,
    });
    expect(parseVodInput('https://m.twitch.tv/videos/123456?t=45s')).toEqual({
      vodId: '123456',
      startSec: 45,
    });
  });
  it('rejects junk', () => {
    expect(parseVodInput('')).toBeNull();
    expect(parseVodInput('https://youtube.com/watch?v=x')).toBeNull();
    expect(parseVodInput('https://twitch.tv/directory')).toBeNull();
  });
  it('reads a channel as live mode', () => {
    expect(parseVodInput('https://twitch.tv/tokyosims')).toEqual({ channel: 'tokyosims' });
    expect(parseVodInput('twitch.tv/TokyoSims/')).toEqual({ channel: 'tokyosims' });
    expect(parseVodInput('#xqc')).toEqual({ channel: 'xqc' });
  });
});

describe('formatHms', () => {
  it('formats', () => {
    expect(formatHms(0)).toBe('0:00:00');
    expect(formatHms(3723)).toBe('1:02:03');
  });
});
