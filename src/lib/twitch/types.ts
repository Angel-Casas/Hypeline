/** A normalised chat replay message. Usernames are kept as opaque ids. */
export interface ChatMessage {
  /** Seconds from the start of the VOD. */
  t: number;
  /** Stable per-user id (login or a hash of it). */
  u: string;
  /** Message text with emotes rendered as their names. */
  m: string;
  /** Emote names present in the message. */
  e: string[];
  /** Badge set ids (subscriber, moderator, bot-badge, ...). */
  b: string[];
}

export interface VodInfo {
  id: string;
  title: string;
  lengthSeconds: number;
  createdAt: string;
  ownerLogin: string;
  ownerDisplayName: string;
  gameName: string | null;
  viewCount: number;
  /** Storyboard URL — its path is also the CDN path of the video segments. */
  seekPreviewsURL: string | null;
  /** `RECORDING` while the stream is still on (entries cached before 2026-09-15 lack it). */
  status?: string;
}

/** A channel that is live right now (unofficial GQL `user.stream`). */
export interface LiveInfo {
  login: string;
  displayName: string;
  streamId: string;
  /** ISO time the stream started; live chat times are measured from here. */
  startedAt: string;
  viewers: number;
  title: string;
  gameName: string | null;
  /** The archive VOD recording this stream, when Twitch already lists it. */
  vodId: string | null;
}
