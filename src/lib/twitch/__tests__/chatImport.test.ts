import { describe, expect, it } from 'vitest';
import { infoFromImport, parseChatExport } from '../chatImport';

// the shape TwitchDownloader (2022+) writes, trimmed to what we read
const td = {
  streamer: { name: 'tokyosims', id: 12345 },
  video: { id: '2871164819', title: 'chatting', start: 0, end: 23064, created_at: '2026-09-01' },
  comments: [
    {
      content_offset_seconds: 12.5,
      commenter: { name: 'alice', display_name: 'Alice', _id: '1' },
      message: {
        body: 'LUL LUL clip it',
        fragments: [
          { text: 'LUL', emoticon: { emoticon_id: '425618' } },
          { text: ' ' },
          { text: 'LUL', emoticon: { emoticon_id: '425618' } },
          { text: ' clip it', emoticon: null },
        ],
        user_badges: [{ _id: 'subscriber', version: '12' }],
      },
    },
    {
      content_offset_seconds: 3,
      commenter: { name: 'bob' },
      message: { body: 'hi', fragments: null, user_badges: null },
    },
    { content_offset_seconds: 'x', commenter: null, message: { body: 'broken' } },
  ],
};

describe('parseChatExport', () => {
  it('reads TwitchDownloader JSON into ChatMessages, sorted, with emotes and badges', () => {
    const r = parseChatExport(JSON.stringify(td));
    expect(r.vodId).toBe('2871164819');
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0]).toEqual({ t: 3, u: 'bob', m: 'hi', e: [], b: [] });
    expect(r.messages[1]).toEqual({
      t: 12.5,
      u: 'alice',
      m: 'LUL LUL clip it',
      e: ['LUL', 'LUL'],
      b: ['subscriber'],
    });
    expect(r.info).toMatchObject({
      title: 'chatting',
      lengthSeconds: 23064,
      ownerDisplayName: 'tokyosims',
    });
  });

  it('reads the older dump with emote spans and a bare comments array', () => {
    const r = parseChatExport(
      JSON.stringify([
        {
          content_offset_seconds: 1,
          commenter: { name: 'c' },
          message: { body: 'Kappa yes', emoticons: [{ _id: '25', begin: 0, end: 4 }] },
        },
      ]),
    );
    expect(r.vodId).toBeUndefined();
    expect(r.messages[0]).toMatchObject({ m: 'Kappa yes', e: ['Kappa'] });
  });

  it('rejects files that are not chat', () => {
    expect(() => parseChatExport('nope')).toThrow(/JSON/);
    expect(() => parseChatExport('{"a":1}')).toThrow(/comments/);
    expect(() => parseChatExport('{"comments":[]}')).toThrow(/no chat/);
  });

  it('builds VOD info from the file, with safe defaults', () => {
    const imp = parseChatExport(JSON.stringify(td));
    expect(infoFromImport('2871164819', imp)).toMatchObject({
      id: '2871164819',
      title: 'chatting',
      lengthSeconds: 23064,
      seekPreviewsURL: null,
    });
    const bare = parseChatExport(JSON.stringify([{ content_offset_seconds: 41, message: {} }]));
    expect(infoFromImport('7', bare)).toMatchObject({
      id: '7',
      lengthSeconds: 42,
      ownerDisplayName: 'imported chat',
    });
  });
});
