/**
 * Chat-file import — the fallback when the unofficial comments endpoint breaks (roadmap M4).
 * Reads the JSON that TwitchDownloader (CLI or GUI, "chatdownload") writes, in both its
 * shapes (2022+ `comments[].message.fragments`, and the older Twitch-API dump it mirrors),
 * plus a bare array of comments. Nothing here touches the network.
 */
import { t } from '@/i18n';
import type { ChatMessage, VodInfo } from './types';

export interface ChatImport {
  messages: ChatMessage[];
  /** From `video.id` / `streamer` when the file carries them. */
  vodId?: string;
  info?: Partial<VodInfo>;
}

// TwitchDownloader's shape, loosely typed: every field is optional in practice
interface TdComment {
  content_offset_seconds?: number;
  commenter?: { name?: string; display_name?: string; _id?: string } | null;
  message?: {
    body?: string;
    fragments?: { text?: string; emoticon?: { emoticon_id?: string } | null }[] | null;
    user_badges?: { _id?: string; version?: string }[] | null;
    emoticons?: { _id?: string; begin?: number; end?: number }[] | null;
  } | null;
}
interface TdFile {
  comments?: TdComment[];
  video?: {
    id?: string | number;
    title?: string;
    length?: number;
    start?: number;
    end?: number;
    created_at?: string;
    game?: string;
    viewCount?: number;
  } | null;
  streamer?: { name?: string; id?: string | number } | null;
}

function toMessage(c: TdComment): ChatMessage | null {
  const t = Number(c.content_offset_seconds);
  if (!Number.isFinite(t) || t < 0) return null;
  const msg = c.message ?? {};
  const frags = Array.isArray(msg.fragments) ? msg.fragments : [];
  const text = frags.length ? frags.map((f) => f.text ?? '').join('') : (msg.body ?? '');
  const emotes = frags.filter((f) => f.emoticon?.emoticon_id).map((f) => (f.text ?? '').trim());
  // older dumps carry emote spans instead of fragments
  if (!emotes.length && Array.isArray(msg.emoticons) && msg.body) {
    for (const e of msg.emoticons) {
      if (typeof e.begin === 'number' && typeof e.end === 'number')
        emotes.push(msg.body.slice(e.begin, e.end + 1));
    }
  }
  const badges = (msg.user_badges ?? []).map((b) => b._id ?? '').filter(Boolean);
  return {
    t,
    u: c.commenter?.name ?? c.commenter?._id ?? '?',
    m: text,
    e: emotes.filter(Boolean),
    b: badges,
  };
}

export class ChatImportError extends Error {}

/** Parse a chat file's text. Throws `ChatImportError` with a one-line reason when it can't. */
export function parseChatExport(text: string): ChatImport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ChatImportError(t('twitchLib.importNotJson'));
  }
  const raw: TdComment[] | undefined = Array.isArray(json)
    ? (json as TdComment[])
    : Array.isArray((json as TdFile)?.comments)
      ? (json as TdFile).comments
      : undefined;
  if (!raw) throw new ChatImportError(t('twitchLib.importNoComments'));
  const messages = raw
    .map(toMessage)
    .filter((m): m is ChatMessage => m !== null)
    .sort((a, b) => a.t - b.t);
  if (!messages.length) throw new ChatImportError(t('twitchLib.importNoMessages'));

  const out: ChatImport = { messages };
  if (!Array.isArray(json)) {
    const f = json as TdFile;
    const id = f.video?.id ?? undefined;
    if (id !== undefined && /^\d+$/.test(String(id))) out.vodId = String(id);
    const v = f.video ?? {};
    const length =
      typeof v.length === 'number' && v.length > 0
        ? v.length
        : typeof v.end === 'number' && v.end > 0
          ? v.end - (v.start ?? 0)
          : undefined;
    const info: Partial<VodInfo> = {};
    if (out.vodId) info.id = out.vodId;
    if (v.title) info.title = v.title;
    if (length) info.lengthSeconds = Math.ceil(length);
    if (v.created_at) info.createdAt = v.created_at;
    if (v.game) info.gameName = v.game;
    if (typeof v.viewCount === 'number') info.viewCount = v.viewCount;
    if (f.streamer?.name) {
      info.ownerLogin = f.streamer.name.toLowerCase();
      info.ownerDisplayName = f.streamer.name;
    }
    if (Object.keys(info).length) out.info = info;
  }
  return out;
}

/** A VodInfo for a VOD we could not look up: file facts first, then safe defaults. */
export function infoFromImport(vodId: string, imp: ChatImport): VodInfo {
  const last = imp.messages[imp.messages.length - 1]?.t ?? 0;
  return {
    id: vodId,
    title: imp.info?.title ?? `VOD ${vodId} (imported chat)`,
    lengthSeconds: imp.info?.lengthSeconds ?? Math.ceil(last + 1),
    createdAt: imp.info?.createdAt ?? new Date().toISOString(),
    ownerLogin: imp.info?.ownerLogin ?? '',
    ownerDisplayName: imp.info?.ownerDisplayName ?? 'imported chat',
    gameName: imp.info?.gameName ?? null,
    viewCount: imp.info?.viewCount ?? 0,
    seekPreviewsURL: null,
  };
}
