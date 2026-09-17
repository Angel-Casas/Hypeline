/**
 * UNOFFICIAL Twitch GQL client.
 *
 * Everything in this file talks to https://gql.twitch.tv/gql with the public
 * web client-id, exactly as the twitch.tv website does. None of it is
 * documented or guaranteed. Keep every unofficial call here so a breakage is
 * one file. Last verified: 2026-09-12 (see docs/05-research.md).
 *
 * Fallbacks if this breaks: import a chat JSON from TwitchDownloader
 * (M4 roadmap item); use Helix `clips` density as a weak hype signal.
 */
import { t } from '@/i18n';
import type { LiveInfo, VodInfo } from './types';

export const GQL_URL = 'https://gql.twitch.tv/gql';
/** Public client-id of the Twitch web player. Unofficial. */
export const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/** Persisted-query hash for VideoCommentsByOffsetOrCursor. Verified 2026-09-12. */
const COMMENTS_HASH = 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a';

export class TwitchError extends Error {
  constructor(
    public kind: 'network' | 'http' | 'gql' | 'integrity' | 'not-found',
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'TwitchError';
  }
}

type FetchLike = typeof fetch;

async function post<T>(body: unknown, fetchImpl: FetchLike, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(GQL_URL, {
      method: 'POST',
      headers: { 'Client-Id': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new TwitchError('network', t('twitchLib.couldNotReachGql'), e);
  }
  if (!res.ok) throw new TwitchError('http', t('twitchLib.gqlHttp', { status: res.status }));
  return (await res.json()) as T;
}

// ---------- VOD metadata ----------

interface VideoQueryResponse {
  data?: {
    video: null | {
      id: string;
      title: string;
      lengthSeconds: number;
      createdAt: string;
      viewCount: number;
      seekPreviewsURL: string | null;
      status?: string;
      owner: { login: string; displayName: string } | null;
      game: { name: string } | null;
    };
  };
  errors?: { message: string }[];
}

export async function fetchVodInfo(
  vodId: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<VodInfo> {
  const q = `query { video(id: "${vodId}") { id title lengthSeconds createdAt viewCount seekPreviewsURL status owner { login displayName } game { name } } }`;
  const r = await post<VideoQueryResponse>({ query: q }, fetchImpl, signal);
  if (r.errors?.length) throw new TwitchError('gql', r.errors[0]!.message, r.errors);
  const v = r.data?.video;
  if (!v) throw new TwitchError('not-found', t('twitchLib.vodNotFoundDetail', { id: vodId }));
  return {
    id: v.id,
    title: v.title,
    lengthSeconds: v.lengthSeconds,
    createdAt: v.createdAt,
    viewCount: v.viewCount,
    seekPreviewsURL: v.seekPreviewsURL,
    status: v.status,
    ownerLogin: v.owner?.login ?? '',
    ownerDisplayName: v.owner?.displayName ?? '',
    gameName: v.game?.name ?? null,
  };
}

// ---------- Live channel ----------

interface UserQueryResponse {
  data?: {
    user: null | {
      id: string;
      login: string;
      displayName: string;
      stream: null | {
        id: string;
        createdAt: string;
        viewersCount: number;
        title: string | null;
        game: { name: string } | null;
      };
      videos: null | {
        edges: { node: { id: string; createdAt: string; status: string } }[];
      };
    };
  };
  errors?: { message: string }[];
}

/**
 * Is the channel live, since when, and which VOD is recording it. `vodId` is the newest
 * archive whose `createdAt` is within 2 minutes of the stream's (verified 2026-09-15: the
 * archive appears ~5 s after the stream starts with `status: RECORDING`). Null when the
 * channel is offline; throws on unknown channels.
 */
export async function fetchLiveInfo(
  login: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<LiveInfo | null> {
  const l = login.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const q = `query { user(login: "${l}") { id login displayName stream { id createdAt viewersCount title game { name } } videos(first: 1, type: ARCHIVE, sort: TIME) { edges { node { id createdAt status } } } } }`;
  const r = await post<UserQueryResponse>({ query: q }, fetchImpl, signal);
  if (r.errors?.length) throw new TwitchError('gql', r.errors[0]!.message, r.errors);
  const u = r.data?.user;
  if (!u) throw new TwitchError('not-found', t('twitchLib.noChannel', { login: l }));
  if (!u.stream) return null;
  const startedAt = Date.parse(u.stream.createdAt);
  const v = u.videos?.edges[0]?.node;
  const vodId = v && Math.abs(Date.parse(v.createdAt) - startedAt) < 120_000 ? v.id : null;
  return {
    login: u.login,
    displayName: u.displayName,
    streamId: u.stream.id,
    startedAt: u.stream.createdAt,
    viewers: u.stream.viewersCount,
    title: u.stream.title ?? '',
    gameName: u.stream.game?.name ?? null,
    vodId,
  };
}

// ---------- Chat replay (one page) ----------

export interface RawComment {
  id: string;
  contentOffsetSeconds: number;
  commenter: { login: string; displayName: string } | null;
  message: {
    fragments: { text: string; emote: { emoteID: string } | null }[];
    userBadges: { setID: string; version: string }[];
  };
}

interface CommentsResponse {
  data?: {
    video: null | {
      comments: null | {
        edges: { cursor: string; node: RawComment }[];
        pageInfo: { hasNextPage: boolean };
      };
    };
  };
  errors?: { message: string; extensions?: { code?: string } }[];
}

export interface CommentsPage {
  comments: RawComment[];
  hasNextPage: boolean;
}

/**
 * Fetch the ~60-comment chunk that contains `offsetSeconds`.
 *
 * FINDINGS (2026-09-12): paging by `cursor` fails with IntegrityCheckFailed
 * without a Client-Integrity token; paging by offset does not. The chunk may
 * start *before* the requested offset, so callers must de-duplicate by id.
 * Asking past the VOD's end returns a "service error" — callers stop at
 * `lengthSeconds`.
 */
export async function fetchCommentsAtOffset(
  vodId: string,
  offsetSeconds: number,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<CommentsPage> {
  const body = [
    {
      operationName: 'VideoCommentsByOffsetOrCursor',
      variables: { videoID: vodId, contentOffsetSeconds: Math.max(0, Math.floor(offsetSeconds)) },
      extensions: { persistedQuery: { version: 1, sha256Hash: COMMENTS_HASH } },
    },
  ];
  const r = (await post<CommentsResponse[]>(body, fetchImpl, signal))[0];
  if (!r) throw new TwitchError('gql', t('twitchLib.emptyGql'));
  const c = r.data?.video?.comments;
  if (!c) {
    const err = r.errors?.[0];
    const code = err?.extensions?.code;
    if (code === 'IntegrityCheckFailed')
      throw new TwitchError('integrity', t('twitchLib.integrity'), r.errors);
    if (err?.message === 'service error') return { comments: [], hasNextPage: false }; // past the end
    if (!r.data?.video)
      throw new TwitchError('not-found', t('twitchLib.vodNotFound', { id: vodId }));
    throw new TwitchError('gql', err?.message ?? t('twitchLib.commentsUnavailable'), r.errors);
  }
  return { comments: c.edges.map((e) => e.node), hasNextPage: c.pageInfo.hasNextPage };
}
