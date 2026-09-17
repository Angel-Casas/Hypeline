import { describe, expect, it } from 'vitest';
import { fetchLiveInfo } from '../gql';

function fetchWith(user: unknown) {
  return (async () => new Response(JSON.stringify({ data: { user } }))) as unknown as typeof fetch;
}

describe('fetchLiveInfo', () => {
  it('returns the stream and the VOD recording it', async () => {
    const li = await fetchLiveInfo(
      'xqc',
      fetchWith({
        id: '1',
        login: 'xqc',
        displayName: 'xQc',
        stream: {
          id: 's',
          createdAt: '2026-09-15T20:27:31Z',
          viewersCount: 19990,
          title: 'hi',
          game: { name: 'Just Chatting' },
        },
        videos: {
          edges: [
            { node: { id: '2875113048', createdAt: '2026-09-15T20:27:36Z', status: 'RECORDING' } },
          ],
        },
      }),
    );
    expect(li).toMatchObject({
      login: 'xqc',
      viewers: 19990,
      gameName: 'Just Chatting',
      vodId: '2875113048',
    });
  });
  it('ignores an old VOD, reports offline and unknown channels', async () => {
    const li = await fetchLiveInfo(
      'x',
      fetchWith({
        id: '1',
        login: 'x',
        displayName: 'x',
        stream: {
          id: 's',
          createdAt: '2026-09-15T20:27:31Z',
          viewersCount: 1,
          title: '',
          game: null,
        },
        videos: {
          edges: [{ node: { id: '9', createdAt: '2026-09-14T20:27:36Z', status: 'RECORDED' } }],
        },
      }),
    );
    expect(li?.vodId).toBeNull();
    expect(
      await fetchLiveInfo(
        'x',
        fetchWith({ id: '1', login: 'x', displayName: 'x', stream: null, videos: null }),
      ),
    ).toBeNull();
    await expect(fetchLiveInfo('nope', fetchWith(null))).rejects.toThrow(/No Twitch channel/);
  });
});
