/**
 * Twitch Helix (the official API) for the signed-in home (ADR-19): who you follow, who is
 * live, their latest VODs. Auth is the **implicit grant** — the browser is sent to Twitch,
 * comes back with a token in the URL fragment, and keeps it in localStorage; no server, no
 * client secret. The app owner registers the app once (dev.twitch.tv/console) and bakes its
 * client id into the build as `VITE_TWITCH_CLIENT_ID`; the redirect URL is the app's
 * `/dashboard`. Scope: `user:read:follows` only — Hypeline never posts or changes anything.
 */

import { t } from '@/i18n';

export const TWITCH_CLIENT_ID = (
  (import.meta.env.VITE_TWITCH_CLIENT_ID as string | undefined) ?? ''
).trim();
const AUTH = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
export const SCOPES = ['user:read:follows'];

export interface TwitchToken {
  accessToken: string;
  /** Epoch ms when it stops working (Twitch tokens last ~60 days; validate on load). */
  expiresAt: number;
  userId: string;
  login: string;
}
export interface FollowedChannel {
  id: string;
  login: string;
  name: string;
  avatar?: string;
}
export interface LiveStream {
  userId: string;
  login: string;
  name: string;
  title: string;
  game: string;
  viewers: number;
  startedAt: string;
  /** Sized thumbnail URL. */
  thumb: string;
}
export interface LatestVideo {
  id: string;
  userId: string;
  login: string;
  name: string;
  title: string;
  createdAt: string;
  lengthSeconds: number;
  views: number;
  thumb: string;
}

export class HelixError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HelixError';
  }
}

/** Where to send the browser to sign in; `state` guards the round trip. */
export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(`${AUTH}/authorize`);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('client_id', TWITCH_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('state', state);
  return u.toString();
}

/** The token Twitch put in the fragment on return, or null when the fragment is not that. */
export function parseTokenFragment(
  hash: string,
): { accessToken: string; state: string; error?: string } | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const error = q.get('error');
  if (error) return { accessToken: '', state: q.get('state') ?? '', error };
  const accessToken = q.get('access_token');
  if (!accessToken) return null;
  return { accessToken, state: q.get('state') ?? '' };
}

/** Ask Twitch whose token this is (and that it still works). */
export async function validateToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TwitchToken> {
  const res = await fetchImpl(`${AUTH}/validate`, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) throw new HelixError(res.status, t('twitchLib.signInExpired'));
  const j = (await res.json()) as { user_id: string; login: string; expires_in: number };
  return {
    accessToken,
    userId: j.user_id,
    login: j.login,
    expiresAt: Date.now() + j.expires_in * 1000,
  };
}

async function helix<T>(
  path: string,
  params: Record<string, string | string[]>,
  token: TwitchToken,
  fetchImpl: typeof fetch,
): Promise<T> {
  const u = new URL(`${HELIX}/${path}`);
  for (const [k, v] of Object.entries(params))
    for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, x);
  const res = await fetchImpl(u.toString(), {
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Client-Id': TWITCH_CLIENT_ID },
  });
  if (!res.ok)
    throw new HelixError(res.status, t('twitchLib.helixHttp', { status: res.status, path }));
  return (await res.json()) as T;
}

/** Every channel the user follows (paged, up to a few hundred). */
export async function fetchFollowed(
  token: TwitchToken,
  fetchImpl: typeof fetch = fetch,
): Promise<FollowedChannel[]> {
  const out: FollowedChannel[] = [];
  let after: string | undefined;
  do {
    const j = await helix<{
      data: { broadcaster_id: string; broadcaster_login: string; broadcaster_name: string }[];
      pagination?: { cursor?: string };
    }>(
      'channels/followed',
      { user_id: token.userId, first: '100', ...(after ? { after } : {}) },
      token,
      fetchImpl,
    );
    for (const d of j.data)
      out.push({ id: d.broadcaster_id, login: d.broadcaster_login, name: d.broadcaster_name });
    after = j.pagination?.cursor;
  } while (after && out.length < 400);
  return out;
}

/** Profile pictures for up to 100 ids per call. */
export async function fetchAvatars(
  ids: string[],
  token: TwitchToken,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const j = await helix<{ data: { id: string; profile_image_url: string }[] }>(
      'users',
      { id: ids.slice(i, i + 100) },
      token,
      fetchImpl,
    );
    for (const u of j.data) out.set(u.id, u.profile_image_url);
  }
  return out;
}

/** Helix thumbnail templates: `%{width}x%{height}` (videos) or `{width}x{height}` (streams). */
export function sizedThumb(url: string, w: number, h: number): string {
  return url.replace(/%?\{width\}/g, String(w)).replace(/%?\{height\}/g, String(h));
}

/** Followed channels that are live right now. */
export async function fetchFollowedStreams(
  token: TwitchToken,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveStream[]> {
  const j = await helix<{
    data: {
      user_id: string;
      user_login: string;
      user_name: string;
      title: string;
      game_name: string;
      viewer_count: number;
      started_at: string;
      thumbnail_url: string;
    }[];
  }>('streams/followed', { user_id: token.userId, first: '100' }, token, fetchImpl);
  return j.data.map((s) => ({
    userId: s.user_id,
    login: s.user_login,
    name: s.user_name,
    title: s.title,
    game: s.game_name,
    viewers: s.viewer_count,
    startedAt: s.started_at,
    thumb: sizedThumb(s.thumbnail_url, 440, 248),
  }));
}

/** Helix durations look like `3h2m1s`, `45m10s`, `59s`. */
export function parseHelixDuration(d: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d.trim());
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** The newest archive VOD of one channel, or null when it keeps none. */
export async function fetchLatestVideo(
  ch: FollowedChannel,
  token: TwitchToken,
  fetchImpl: typeof fetch = fetch,
): Promise<LatestVideo | null> {
  const j = await helix<{
    data: {
      id: string;
      title: string;
      created_at: string;
      duration: string;
      view_count: number;
      thumbnail_url: string;
    }[];
  }>('videos', { user_id: ch.id, type: 'archive', first: '1' }, token, fetchImpl);
  const v = j.data[0];
  if (!v) return null;
  return {
    id: v.id,
    userId: ch.id,
    login: ch.login,
    name: ch.name,
    title: v.title,
    createdAt: v.created_at,
    lengthSeconds: parseHelixDuration(v.duration),
    views: v.view_count,
    thumb: sizedThumb(v.thumbnail_url, 440, 248),
  };
}

/** Latest VOD per channel, a few requests at a time, newest first. */
export async function fetchLatestVideos(
  channels: FollowedChannel[],
  token: TwitchToken,
  fetchImpl: typeof fetch = fetch,
  onOne?: (v: LatestVideo) => void,
): Promise<LatestVideo[]> {
  const out: LatestVideo[] = [];
  const queue = [...channels];
  async function lane() {
    for (let ch = queue.shift(); ch; ch = queue.shift()) {
      try {
        const v = await fetchLatestVideo(ch, token, fetchImpl);
        if (v) {
          out.push(v);
          onOne?.(v);
        }
      } catch {
        /* one channel failing must not hide the others */
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, lane));
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
