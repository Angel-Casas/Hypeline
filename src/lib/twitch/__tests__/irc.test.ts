import { describe, expect, it, vi } from 'vitest';
import { joinChat, parseLine, parseTags, toChatMessage } from '../irc';

const LINE =
  '@badge-info=subscriber/48;badges=subscriber/48,moments/1;color=#2EFF1F;display-name=Client30;emotes=25:0-4,12-16/1902:6-10;id=cc56;mod=0;subscriber=1;tmi-sent-ts=1789505583088;user-id=194525795 :client30!client30@client30.tmi.twitch.tv PRIVMSG #xqc :Kappa Keepo Kappa go';

describe('irc', () => {
  it('parses tags with escapes', () => {
    const t = parseTags('a=1;system-msg=hello\\sworld\\:x;b=');
    expect(t.get('system-msg')).toBe('hello world;x');
    expect(t.get('b')).toBe('');
  });
  it('parses a PRIVMSG with emotes and badges', () => {
    const m = parseLine(LINE)!;
    expect(m).toMatchObject({
      ts: 1789505583088,
      login: 'client30',
      displayName: 'Client30',
      text: 'Kappa Keepo Kappa go',
      badges: ['subscriber', 'moments'],
    });
    expect([...m.emotes].sort()).toEqual(['Kappa', 'Kappa', 'Keepo']);
  });
  it('ignores everything else, unwraps /me', () => {
    expect(parseLine(':tmi.twitch.tv ROOMSTATE #xqc')).toBeNull();
    expect(parseLine('PING :tmi.twitch.tv')).toBeNull();
    const m = parseLine(':a!a@a.tmi.twitch.tv PRIVMSG #c :ACTION waves')!;
    expect(m.text).toBe('waves');
  });
  it('maps to a ChatMessage relative to the stream start', () => {
    const m = toChatMessage(parseLine(LINE)!, 1789505483088);
    expect(m).toEqual({
      t: 100,
      u: 'client30',
      m: 'Kappa Keepo Kappa go',
      e: ['Kappa', 'Kappa', 'Keepo'],
      b: ['subscriber', 'moments'],
    });
  });
  it('joins anonymously, answers PING, reconnects after a drop', () => {
    vi.useFakeTimers();
    const sockets: FakeWs[] = [];
    class FakeWs {
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {
        sockets.push(this);
      }
      send(s: string) {
        this.sent.push(s);
      }
      close() {
        this.onclose?.();
      }
    }
    const got: string[] = [];
    const states: string[] = [];
    const h = joinChat('XQC', {
      onMessage: (m) => got.push(m.text),
      onState: (s) => states.push(s),
      WebSocketImpl: FakeWs as unknown as typeof WebSocket,
    });
    const ws = sockets[0]!;
    ws.onopen!();
    expect(ws.sent[0]).toMatch(/^CAP REQ/);
    expect(ws.sent[1]).toMatch(/^NICK justinfan\d+$/);
    expect(ws.sent[2]).toBe('JOIN #xqc');
    ws.onmessage!({ data: 'PING :tmi.twitch.tv\r\n' + LINE + '\r\n' });
    expect(ws.sent[3]).toBe('PONG :tmi.twitch.tv');
    expect(got).toEqual(['Kappa Keepo Kappa go']);
    ws.onclose!();
    expect(states.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    h.close();
    expect(states.at(-1)).toBe('closed');
    vi.useRealTimers();
  });
});
