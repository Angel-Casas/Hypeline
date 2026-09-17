/**
 * VOD playlists and segments. Playlists/segments are NOT readable from a
 * browser origin (no CORS on usher/CDN — S1), so every URL here is routed
 * through the CORS shim (ADR-9) via `viaShim`.
 */
import { t } from '@/i18n';
import { GQL_URL, WEB_CLIENT_ID, TwitchError } from './gql';

/** Persisted-query hash for PlaybackAccessToken. Verified 2026-09-12 (S1). UNOFFICIAL. */
const PLAYBACK_TOKEN_HASH = '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712';

export interface PlaybackToken {
  value: string;
  signature: string;
}

export interface Variant {
  /** e.g. "chunked" (source), "720p60", "480p30" */
  name: string;
  width: number;
  height: number;
  bandwidth: number;
  url: string;
}

export interface Segment {
  /** Start time in VOD seconds (sum of previous EXTINF durations). */
  start: number;
  duration: number;
  url: string;
}

export function viaShim(shimUrl: string, url: string): string {
  const base = shimUrl.trim().replace(/\/$/, '');
  if (!base) throw new TwitchError('network', t('twitchLib.noShim'));
  return `${base}/?u=${encodeURIComponent(url)}`;
}

export async function fetchPlaybackToken(
  vodId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PlaybackToken> {
  const body = [
    {
      operationName: 'PlaybackAccessToken',
      variables: { isLive: false, login: '', isVod: true, vodID: vodId, playerType: 'site' },
      extensions: { persistedQuery: { version: 1, sha256Hash: PLAYBACK_TOKEN_HASH } },
    },
  ];
  const res = await fetchImpl(GQL_URL, {
    method: 'POST',
    headers: { 'Client-Id': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new TwitchError('http', t('twitchLib.gqlHttp', { status: res.status }));
  const json = (await res.json()) as {
    data?: { videoPlaybackAccessToken?: PlaybackToken | null };
  }[];
  const tok = json[0]?.data?.videoPlaybackAccessToken;
  if (!tok) throw new TwitchError('gql', t('twitchLib.noPlaybackToken'), json);
  return tok;
}

/** What the token says about who may watch. */
export interface PlaybackAccess {
  /** Twitch refuses playback for an anonymous viewer. */
  forbidden: boolean;
  /** Twitch's reason, e.g. `UNAUTHORIZED_ENTITLEMENTS` (subscribers only). */
  reason: string | null;
  /** Subscribers-only past broadcast: the channel gates its VODs behind a sub. */
  subOnly: boolean;
}

/**
 * The token's `value` is a JSON document; `authorization.forbidden` with reason
 * `UNAUTHORIZED_ENTITLEMENTS` (and every quality under `chansub.restricted_bitrates`) is a
 * subscribers-only VOD (verified 2026-09-16 on a "past broadcasts for subs" channel). The
 * official embed then buffers forever for an anonymous viewer and usher answers 403.
 */
export function parsePlaybackAccess(token: PlaybackToken): PlaybackAccess {
  try {
    const v = JSON.parse(token.value) as {
      authorization?: { forbidden?: boolean; reason?: string | null };
      chansub?: { restricted_bitrates?: string[] };
    };
    const forbidden = v.authorization?.forbidden === true;
    const reason = v.authorization?.reason ?? null;
    const restricted = (v.chansub?.restricted_bitrates?.length ?? 0) > 0;
    return {
      forbidden,
      reason,
      subOnly: forbidden && (reason === 'UNAUTHORIZED_ENTITLEMENTS' || restricted),
    };
  } catch {
    return { forbidden: false, reason: null, subOnly: false };
  }
}

/**
 * Can an anonymous viewer play this VOD? Null when Twitch could not be asked (network,
 * endpoint drift) — callers treat that as "probably fine" rather than locking the VOD.
 */
export async function checkPlaybackAccess(
  vodId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PlaybackAccess | null> {
  try {
    return parsePlaybackAccess(await fetchPlaybackToken(vodId, fetchImpl, signal));
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') throw e;
    return null;
  }
}

export function masterPlaylistUrl(vodId: string, token: PlaybackToken): string {
  const u = new URL(`https://usher.ttvnw.net/vod/${vodId}.m3u8`);
  u.searchParams.set('sig', token.signature);
  u.searchParams.set('token', token.value);
  u.searchParams.set('allow_source', 'true');
  u.searchParams.set('allow_audio_only', 'true');
  return u.toString();
}

/** Parse a master playlist into variants (source first, as Twitch lists them). */
export function parseMasterPlaylist(text: string): Variant[] {
  const lines = text.split(/\r?\n/);
  const out: Variant[] = [];
  let pendingName = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith('#EXT-X-MEDIA:')) {
      const m = /NAME="([^"]+)"/.exec(l);
      pendingName = m?.[1] ?? '';
    } else if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(l);
      const bw = /BANDWIDTH=(\d+)/.exec(l);
      const video = /VIDEO="([^"]+)"/.exec(l);
      const url = lines[i + 1] ?? '';
      if (!url.startsWith('http')) continue;
      out.push({
        name: video?.[1] ?? pendingName ?? `${res?.[2] ?? '?'}p`,
        width: Number(res?.[1] ?? 0),
        height: Number(res?.[2] ?? 0),
        bandwidth: Number(bw?.[1] ?? 0),
        url,
      });
    }
  }
  return out;
}

/** Parse a variant (media) playlist into segments with absolute URLs and VOD start times. */
export function parseVariantPlaylist(text: string, playlistUrl: string): Segment[] {
  const base = playlistUrl.slice(0, playlistUrl.lastIndexOf('/') + 1);
  const lines = text.split(/\r?\n/);
  const out: Segment[] = [];
  let t = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXTINF:([\d.]+)/.exec(lines[i]!);
    if (!m) continue;
    const duration = parseFloat(m[1]!);
    let name = lines[i + 1] ?? '';
    // skip any tag lines between EXTINF and the URI
    let j = i + 1;
    while (name.startsWith('#') && j < lines.length) name = lines[++j] ?? '';
    if (!name) break;
    const url = name.startsWith('http') ? name : base + name;
    out.push({ start: t, duration, url });
    t += duration;
  }
  return out;
}

/** Segments covering [inSec, outSec). */
export function segmentsForRange(segments: Segment[], inSec: number, outSec: number): Segment[] {
  return segments.filter((s) => s.start + s.duration > inSec && s.start < outSec);
}

export function isAudioOnly(v: Variant): boolean {
  return v.name === 'audio_only' || (v.width === 0 && v.height === 0);
}

/** Pick a video variant by desired height (closest at or below; smallest if none fit). */
export function pickVariant(variants: Variant[], maxHeight: number): Variant {
  const video = variants.filter((v) => !isAudioOnly(v));
  const sorted = [...(video.length ? video : variants)].sort((a, b) => b.height - a.height);
  return sorted.find((v) => v.height <= maxHeight) ?? sorted[sorted.length - 1]!;
}

/** The audio-only variant when Twitch offers one (216 kbps AAC, ~270 KB per 10 s), else the smallest video. */
export function pickAudioVariant(variants: Variant[]): Variant {
  return variants.find(isAudioOnly) ?? pickVariant(variants, 0);
}

export async function fetchText(
  url: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal });
  } catch (e) {
    throw new TwitchError('network', t('twitchLib.playlistFailed'), e);
  }
  if (!res.ok) throw new TwitchError('http', t('twitchLib.playlistHttp', { status: res.status }));
  return res.text();
}

export async function fetchBytes(
  url: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal });
  } catch (e) {
    throw new TwitchError('network', t('twitchLib.segmentFailed'), e);
  }
  if (!res.ok) throw new TwitchError('http', t('twitchLib.segmentHttp', { status: res.status }));
  return new Uint8Array(await res.arrayBuffer());
}
