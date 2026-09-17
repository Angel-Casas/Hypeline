/**
 * The signed-in Twitch home (ADR-19): a token from the implicit grant kept in localStorage,
 * the channels the user follows, which of them are live, and each one's latest VOD — so a
 * VOD is one click away without leaving the app. Read-only scope; nothing else stored.
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  authorizeUrl,
  fetchAvatars,
  fetchFollowed,
  fetchFollowedStreams,
  fetchLatestVideos,
  HelixError,
  parseTokenFragment,
  TWITCH_CLIENT_ID,
  validateToken,
  type FollowedChannel,
  type LatestVideo,
  type LiveStream,
  type TwitchToken,
} from '@/lib/twitch/helix';
import { t as tr } from '@/i18n';

const KEY = 'hypeline.twitch.v1';
const STATE_KEY = 'hypeline.twitch.state';

function loadToken(): TwitchToken | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as TwitchToken;
    return t.accessToken && t.expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
}

export const useTwitchStore = defineStore('twitch', () => {
  const token = ref<TwitchToken | null>(loadToken());
  const available = TWITCH_CLIENT_ID !== '';
  const connected = computed(() => token.value !== null);
  const login = computed(() => token.value?.login ?? null);
  const followed = shallowRef<FollowedChannel[]>([]);
  const live = shallowRef<LiveStream[]>([]);
  const latest = shallowRef<LatestVideo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let refreshedAt = 0;

  function save(t: TwitchToken | null) {
    token.value = t;
    try {
      if (t) localStorage.setItem(KEY, JSON.stringify(t));
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode */
    }
  }

  /** Send the browser to Twitch; it comes back to `/dashboard` with the token in the hash. */
  function connect() {
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      sessionStorage.setItem(STATE_KEY, state);
    } catch {
      /* ignore */
    }
    const redirect = `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/dashboard`;
    location.assign(authorizeUrl(redirect, state));
  }

  /** On the dashboard after the round trip: take the token out of the URL and validate it. */
  async function handleRedirect(): Promise<boolean> {
    const frag = parseTokenFragment(location.hash);
    if (!frag) return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (frag.error) {
      error.value = frag.error === 'access_denied' ? tr('twitchStore.cancelled') : frag.error;
      return true;
    }
    let expected = '';
    try {
      expected = sessionStorage.getItem(STATE_KEY) ?? '';
      sessionStorage.removeItem(STATE_KEY);
    } catch {
      /* ignore */
    }
    if (expected && frag.state !== expected) {
      error.value = tr('twitchStore.stateMismatch');
      return true;
    }
    try {
      save(await validateToken(frag.accessToken));
      error.value = null;
      await refresh(true);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
    return true;
  }

  function disconnect() {
    save(null);
    followed.value = [];
    live.value = [];
    latest.value = [];
    refreshedAt = 0;
  }

  /** Follows → live now → latest VOD per channel (streaming in as they arrive). */
  async function refresh(force = false) {
    const t = token.value;
    if (!t || loading.value) return;
    if (!force && Date.now() - refreshedAt < 120_000) return;
    loading.value = true;
    error.value = null;
    try {
      // the token is validated on every refresh: Twitch asks for that hourly
      if (force || Date.now() - refreshedAt > 3600_000) save(await validateToken(t.accessToken));
      const [chans, streams] = await Promise.all([fetchFollowed(t), fetchFollowedStreams(t)]);
      const avatars = await fetchAvatars(
        chans.map((c) => c.id),
        t,
      ).catch(() => new Map<string, string>());
      followed.value = chans.map((c) => ({ ...c, avatar: avatars.get(c.id) }));
      live.value = streams;
      latest.value = [];
      const seen: LatestVideo[] = [];
      await fetchLatestVideos(chans, t, fetch, (v) => {
        seen.push(v);
        latest.value = [...seen].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      });
      refreshedAt = Date.now();
    } catch (e) {
      if (e instanceof HelixError && e.status === 401) {
        disconnect();
        error.value = tr('twitchStore.expired');
      } else error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  return {
    available,
    connected,
    login,
    followed,
    live,
    latest,
    loading,
    error,
    connect,
    handleRedirect,
    disconnect,
    refresh,
  };
});
