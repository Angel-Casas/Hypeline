import { describe, expect, it } from 'vitest';
import {
  authorizeUrl,
  fetchFollowed,
  fetchLatestVideos,
  parseHelixDuration,
  parseTokenFragment,
  sizedThumb,
  type TwitchToken,
} from '../helix';

const token: TwitchToken = { accessToken: 'abc', expiresAt: 0, userId: '42', login: 'angel' };

describe('helix', () => {
  it('builds the implicit-grant URL with the read-only scope', () => {
    const u = new URL(authorizeUrl('http://localhost:5173/dashboard', 'xyz'));
    expect(u.origin + u.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(u.searchParams.get('response_type')).toBe('token');
    expect(u.searchParams.get('scope')).toBe('user:read:follows');
    expect(u.searchParams.get('state')).toBe('xyz');
  });
  it('reads the token or the error out of the fragment', () => {
    expect(
      parseTokenFragment(
        '#access_token=tok&scope=user%3Aread%3Afollows&state=s1&token_type=bearer',
      ),
    ).toEqual({
      accessToken: 'tok',
      state: 's1',
    });
    expect(parseTokenFragment('#error=access_denied&state=s1')).toMatchObject({
      error: 'access_denied',
    });
    expect(parseTokenFragment('')).toBeNull();
    expect(parseTokenFragment('#t=12s')).toBeNull();
  });
  it('parses durations and sizes thumbnails', () => {
    expect(parseHelixDuration('3h2m1s')).toBe(10921);
    expect(parseHelixDuration('45m10s')).toBe(2710);
    expect(parseHelixDuration('59s')).toBe(59);
    expect(sizedThumb('https://x/%{width}x%{height}.jpg', 440, 248)).toBe('https://x/440x248.jpg');
    expect(sizedThumb('https://x/{width}x{height}.jpg', 320, 180)).toBe('https://x/320x180.jpg');
  });
  it('pages follows and gathers the latest VOD per channel, newest first', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      const u = new URL(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer abc');
      if (u.pathname.endsWith('/channels/followed')) {
        const after = u.searchParams.get('after');
        return new Response(
          JSON.stringify(
            after
              ? { data: [{ broadcaster_id: '2', broadcaster_login: 'b', broadcaster_name: 'B' }] }
              : {
                  data: [{ broadcaster_id: '1', broadcaster_login: 'a', broadcaster_name: 'A' }],
                  pagination: { cursor: 'c1' },
                },
          ),
        );
      }
      if (u.pathname.endsWith('/videos')) {
        const id = u.searchParams.get('user_id');
        if (id === '2') return new Response(JSON.stringify({ data: [] }));
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'v1',
                title: 'A plays',
                created_at: '2026-09-15T10:00:00Z',
                duration: '1h0m0s',
                view_count: 5,
                thumbnail_url: 'https://x/%{width}x%{height}.jpg',
              },
            ],
          }),
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const chans = await fetchFollowed(token, fetchImpl);
    expect(chans.map((c) => c.login)).toEqual(['a', 'b']);
    const latest = await fetchLatestVideos(chans, token, fetchImpl);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({
      id: 'v1',
      login: 'a',
      lengthSeconds: 3600,
      thumb: 'https://x/440x248.jpg',
    });
  });
});
