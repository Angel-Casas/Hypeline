/**
 * Live chat over Twitch IRC (WebSocket), read-only and anonymous: `NICK justinfan…` needs no
 * account or token (verified from a sandbox 2026-09-15, see docs/05-research.md). Messages
 * arrive as IRCv3 lines with tags; `parseLine` turns a PRIVMSG into a `ChatMessage` with the
 * same shape the VOD replay has, so the hype scoring works unchanged on a live stream.
 *
 * Twitch's chat documentation covers this protocol (it is the one official way to read
 * chat); the anonymous nick is a long-standing convention rather than a documented API.
 */
import type { ChatMessage } from './types';

export const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

export interface IrcMessage {
  /** Wall-clock time of the message (`tmi-sent-ts`), ms since epoch. */
  ts: number;
  login: string;
  displayName: string;
  text: string;
  emotes: string[];
  badges: string[];
}

export function parseTags(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const kv of raw.split(';')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    out.set(
      kv.slice(0, i),
      kv
        .slice(i + 1)
        .replace(/\\s/g, ' ')
        .replace(/\\:/g, ';')
        .replace(/\\\\/g, '\\'),
    );
  }
  return out;
}

/** The emote names in a message from the `emotes` tag (`id:start-end,start-end/id:…`). */
function emoteNames(tag: string | undefined, text: string): string[] {
  if (!tag) return [];
  const names: string[] = [];
  // spans index code points, not UTF-16 units
  const cps = Array.from(text);
  for (const group of tag.split('/')) {
    const spans = group.split(':')[1];
    if (!spans) continue;
    for (const span of spans.split(',')) {
      const [a, b] = span.split('-').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) names.push(cps.slice(a, b! + 1).join(''));
    }
  }
  return names;
}

/** One IRC line → a chat message, or null for anything that is not a PRIVMSG. */
export function parseLine(line: string): IrcMessage | null {
  if (!line.includes(' PRIVMSG ')) return null;
  let rest = line;
  let tags = new Map<string, string>();
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }
  const m = /^:([^!\s]+)![^\s]*\s+PRIVMSG\s+#\S+\s+:(.*)$/.exec(rest);
  if (!m) return null;
  let text = m[2]!;
  // /me actions are wrapped in \x01ACTION …\x01
  const CTRL = String.fromCharCode(1);
  if (text.startsWith(CTRL + 'ACTION ')) {
    text = text.slice(8);
    if (text.endsWith(CTRL)) text = text.slice(0, -1);
  }
  const ts = Number(tags.get('tmi-sent-ts')) || Date.now();
  const badges = (tags.get('badges') ?? '')
    .split(',')
    .map((b) => b.split('/')[0]!)
    .filter(Boolean);
  return {
    ts,
    login: m[1]!,
    displayName: tags.get('display-name') || m[1]!,
    text,
    emotes: emoteNames(tags.get('emotes'), text),
    badges,
  };
}

/** Same shape as a replayed message; `t` is seconds since `startedAtMs`. */
export function toChatMessage(m: IrcMessage, startedAtMs: number): ChatMessage {
  return {
    t: Math.max(0, (m.ts - startedAtMs) / 1000),
    u: m.login,
    m: m.text,
    e: m.emotes,
    b: m.badges,
  };
}

export type IrcState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface IrcOptions {
  onMessage: (m: IrcMessage) => void;
  onState?: (s: IrcState, detail?: string) => void;
  /** For tests. */
  WebSocketImpl?: typeof WebSocket;
  url?: string;
}

/**
 * Join one channel and stream its messages until `close()`. Reconnects with backoff
 * (1 s → 30 s) on drops; answers PINGs.
 */
export function joinChat(channel: string, opts: IrcOptions): { close: () => void } {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const chan = channel.toLowerCase().replace(/^#/, '');
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    opts.onState?.(attempt ? 'reconnecting' : 'connecting');
    ws = new WS(opts.url ?? IRC_URL);
    ws.onopen = () => {
      attempt = 0;
      ws!.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws!.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
      ws!.send(`JOIN #${chan}`);
      opts.onState?.('open');
    };
    ws.onmessage = (ev) => {
      for (const line of String(ev.data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          ws?.send('PONG :tmi.twitch.tv');
          continue;
        }
        if (line.includes(' RECONNECT')) {
          ws?.close();
          continue;
        }
        const m = parseLine(line);
        if (m) opts.onMessage(m);
      }
    };
    ws.onclose = () => {
      ws = null;
      if (closed) return;
      const wait = Math.min(30000, 1000 * 2 ** attempt++);
      opts.onState?.('reconnecting', `retry in ${Math.round(wait / 1000)} s`);
      timer = setTimeout(connect, wait);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }
  connect();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
      ws = null;
      opts.onState?.('closed');
    },
  };
}
