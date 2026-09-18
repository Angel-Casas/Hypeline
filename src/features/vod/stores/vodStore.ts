import { defineStore } from 'pinia';
import { computed, ref, shallowRef, triggerRef, watch } from 'vue';
import type { ChatMessage, VodInfo } from '@/lib/twitch/types';
import { fetchLiveInfo, fetchVodInfo, TwitchError } from '@/lib/twitch/gql';
import { joinChat, toChatMessage, type IrcState } from '@/lib/twitch/irc';
import { fetchChatReplay, type ChatFetchProgress } from '@/lib/twitch/chat';
import { checkPlaybackAccess, type PlaybackAccess } from '@/lib/twitch/hls';
import { ChatImportError, infoFromImport, parseChatExport } from '@/lib/twitch/chatImport';
import { analyse, sensitivityToOptions, type Bucket, type Moment } from '@/features/hype/scoring';
import type { SpeechChunk } from '@/features/hype/speech';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useVocabStore } from '@/features/hype/vocabStore';
import * as db from '@/lib/storage/db';
import { isQuotaError } from '@/lib/storage/quota';
import { useQuotaStore } from '@/features/settings/quotaStore';
import { formatHms } from '@/lib/twitch/vodUrl';
import { EXAMPLE_ID, exampleInfo, exampleMessages, isExampleId } from '../example';
import { t } from '@/i18n';

/** Caching is best-effort: a full quota must not stop the VOD from loading. */
function cacheWarn(e: unknown) {
  if (isQuotaError(e)) useQuotaStore().noteWriteFailure();
  else console.warn('could not cache', e);
}

export type Phase = 'idle' | 'loading-info' | 'loading-chat' | 'scoring' | 'ready' | 'error';

export const useVodStore = defineStore('vod', () => {
  const phase = ref<Phase>('idle');
  const error = ref<string | null>(null);
  const info = ref<VodInfo | null>(null);
  const messages = shallowRef<ChatMessage[]>([]);
  const progress = ref<ChatFetchProgress | null>(null);
  const buckets = shallowRef<Bucket[]>([]);
  const moments = shallowRef<Moment[]>([]);
  const dropped = ref(0);
  const fromCache = ref(false);
  /** Seconds the player should be at; set by clicking the timeline or a moment. */
  const seekTarget = ref<number | null>(null);
  let abort: AbortController | null = null;
  /**
   * Whether an anonymous viewer may play the VOD (null: not asked yet / could not ask). A
   * subscribers-only VOD still has chat and frames, but the embed never plays it and a cut
   * would 403 — so the desk says so instead of spinning (Angel, 2026-09-16).
   */
  const access = ref<PlaybackAccess | null>(null);
  const subOnly = computed(() => access.value?.subOnly === true);
  /** The made-up example VOD (tour + first look): no video, nothing fetched. */
  const isExample = computed(() => isExampleId(info.value?.id));
  async function checkAccess(vodId: string, signal: AbortSignal) {
    access.value = null;
    try {
      const a = await checkPlaybackAccess(vodId, fetch, signal);
      if (!signal.aborted) access.value = a;
    } catch {
      /* aborted: a newer load took over */
    }
  }

  // ---------- live: a VOD whose stream is still on (ADR-18) ----------
  /** True while the VOD is recording and we are appending its live chat. */
  const live = ref(false);
  const liveConn = ref<IrcState>('closed');
  /** Seconds of VOD that exist right now (grows every second while live). */
  const liveEdge = ref<number | null>(null);
  /** Moments that appeared while live, newest first (the "what did I miss" list). */
  const liveFeed = ref<(Moment & { seenAt: number })[]>([]);
  /** Moments noticed while the tab was hidden and not yet looked at. */
  const unseen = ref(0);
  const notify = ref(readNotify());
  const notifyPermission = ref<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  let irc: { close: () => void } | null = null;
  let liveTick: ReturnType<typeof setInterval> | null = null;
  let liveRefresh: ReturnType<typeof setInterval> | null = null;
  let liveScoreTimer: ReturnType<typeof setTimeout> | null = null;
  let vodStartMs = 0;
  /** Replay messages end here; live chat is appended only past it (no double counting). */
  let replayEnd = 0;
  const seenLive = new Set<string>();
  const NOTIFY_KEY = 'hypeline.live.notify';
  /** The id of the last VOD `load()` was asked for — what a chat import attaches to. */
  const requestedId = ref<string | null>(null);

  const lengthSeconds = computed(() => info.value?.lengthSeconds ?? 0);

  const settings = useSettingsStore();
  /** The user's own chat vocabulary (ADR-29): changing it re-scores, it never re-fetches. */
  const vocab = useVocabStore();
  /** Transcript chunks for the current VOD (set by the AI store); they lift or damp the scores. */
  const speech = shallowRef<SpeechChunk[]>([]);
  function setSpeech(chunks: SpeechChunk[]) {
    speech.value = chunks;
    if (phase.value === 'ready') rescore();
  }
  function rescore() {
    if (!info.value) return;
    const { top, opts } = sensitivityToOptions(settings.sensitivity);
    const r = analyse(
      messages.value,
      info.value.id,
      info.value.lengthSeconds,
      top,
      opts,
      speech.value,
      vocab.vocabulary,
    );
    buckets.value = r.buckets;
    moments.value = r.moments;
    dropped.value = r.dropped;
  }
  // the slider re-picks the peaks (the buckets' scores don't change, only how many surface)
  watch(
    () => settings.sensitivity,
    () => {
      if (phase.value === 'ready') rescore();
    },
  );
  // the vocabulary changes what a bucket is worth: same messages, new scores, no refetch
  watch(
    () => vocab.vocabulary,
    () => {
      if (phase.value === 'ready') rescore();
    },
  );

  /** Hook for other stores (clips) to react when a VOD is ready; avoids a store-import cycle. */
  let onReady: ((vodId: string) => void) | null = null;
  function setOnReady(cb: (vodId: string) => void) {
    onReady = cb;
  }

  async function load(vodId: string, opts: { force?: boolean } = {}) {
    abort?.abort();
    stopLive();
    abort = new AbortController();
    const signal = abort.signal;
    requestedId.value = vodId;
    phase.value = 'loading-info';
    error.value = null;
    info.value = null;
    access.value = null;
    messages.value = [];
    buckets.value = [];
    moments.value = [];
    progress.value = null;
    fromCache.value = false;
    seekTarget.value = null;
    try {
      if (vodId === EXAMPLE_ID) {
        // the example is generated, never fetched; cached so it sits in the library like
        // any VOD and its × removes it
        info.value = exampleInfo();
        messages.value = exampleMessages();
        await db.putVod(info.value).catch(cacheWarn);
        await db.putChat(vodId, messages.value).catch(cacheWarn);
        phase.value = 'scoring';
        rescore();
        phase.value = 'ready';
        onReady?.(vodId);
        return;
      }
      let cachedInfo = opts.force ? undefined : await db.getVod(vodId);
      // an entry cached before the storyboard field existed has no `seekPreviewsURL` key at
      // all (null means "asked, none"): refresh it so the frames can show up
      if (cachedInfo && !('seekPreviewsURL' in cachedInfo)) cachedInfo = undefined;
      // a VOD cached while its stream was still on keeps growing: ask again
      if (cachedInfo?.status === 'RECORDING') cachedInfo = undefined;
      info.value = cachedInfo ?? (await fetchVodInfo(vodId, fetch, signal));
      if (!cachedInfo) await db.putVod(info.value).catch(cacheWarn);
      void checkAccess(vodId, signal);

      // a recording VOD's replay is a snapshot: always fetch it fresh, never cache it
      const recording = info.value.status === 'RECORDING';
      const cachedChat = opts.force || recording ? undefined : await db.getChat(vodId);
      if (cachedChat) {
        messages.value = cachedChat.messages;
        fromCache.value = true;
      } else {
        phase.value = 'loading-chat';
        const collected: ChatMessage[] = [];
        let lastScore = 0;
        messages.value = await fetchChatReplay(vodId, info.value.lengthSeconds, {
          lanes: 8,
          signal,
          onBatch: (batch, p) => {
            collected.push(...batch);
            progress.value = p;
            // Progressive heatmap: rescore at most every ~400 ms.
            const now = performance.now();
            if (now - lastScore > 400) {
              lastScore = now;
              messages.value = collected.slice().sort((a, b) => a.t - b.t);
              rescore();
            }
          },
        });
        if (!recording) await db.putChat(vodId, messages.value).catch(cacheWarn);
      }
      phase.value = 'scoring';
      rescore();
      phase.value = 'ready';
      onReady?.(vodId);
      if (recording) startLive();
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
      error.value = e instanceof TwitchError ? `${e.message} (${e.kind})` : String(e);
      phase.value = 'error';
    }
  }

  /**
   * Fallback when Twitch's comments endpoint is broken: take a chat file (TwitchDownloader
   * JSON) instead. Attaches to the VOD being loaded (or the one in the file), keeps the VOD
   * info we have, else builds one from the file, and caches the chat like a normal fetch.
   */
  async function importChat(text: string): Promise<string | null> {
    abort?.abort();
    let imp;
    try {
      imp = parseChatExport(text);
    } catch (e) {
      error.value = e instanceof ChatImportError ? e.message : String(e);
      phase.value = 'error';
      return null;
    }
    const vodId = imp.vodId ?? requestedId.value ?? info.value?.id;
    if (!vodId) {
      error.value = t('vodStore.chatFileNoVod');
      phase.value = 'error';
      return null;
    }
    requestedId.value = vodId;
    error.value = null;
    phase.value = 'scoring';
    if (!info.value || info.value.id !== vodId) {
      info.value = (await db.getVod(vodId)) ?? infoFromImport(vodId, imp);
      await db.putVod(info.value).catch(cacheWarn);
      abort = new AbortController();
      void checkAccess(vodId, abort.signal);
    }
    messages.value = imp.messages;
    fromCache.value = false;
    progress.value = null;
    seekTarget.value = null;
    await db.putChat(vodId, imp.messages).catch(cacheWarn);
    rescore();
    phase.value = 'ready';
    onReady?.(vodId);
    return vodId;
  }

  function seek(sec: number) {
    seekTarget.value = sec;
  }
  /** Back to the empty desk: no VOD, nothing loading, live mode off. */
  function reset() {
    abort?.abort();
    stopLive();
    phase.value = 'idle';
    error.value = null;
    info.value = null;
    access.value = null;
    messages.value = [];
    buckets.value = [];
    moments.value = [];
    progress.value = null;
    seekTarget.value = null;
  }
  /** Show an error in the desk without a VOD (a channel that is offline, for instance). */
  function failWith(message: string) {
    error.value = message;
    phase.value = 'error';
  }

  function readNotify(): boolean {
    try {
      return localStorage.getItem('hypeline.live.notify') === '1';
    } catch {
      return false;
    }
  }
  async function setNotify(on: boolean) {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      notifyPermission.value = await Notification.requestPermission();
      if (notifyPermission.value !== 'granted') on = false;
    }
    notify.value = on;
    try {
      localStorage.setItem(NOTIFY_KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
  }

  /**
   * Keep a recording VOD growing: join its chat over IRC and append what arrives past the
   * replay, tick the live edge, rescore every few seconds, and announce new moments near the
   * edge (tab title badge, optional browser notification). Stops when the stream ends.
   */
  function startLive() {
    const v = info.value;
    if (!v) return;
    vodStartMs = Date.parse(v.createdAt);
    replayEnd = messages.value.length ? messages.value[messages.value.length - 1]!.t : 0;
    live.value = true;
    liveFeed.value = [];
    seenLive.clear();
    unseen.value = 0;
    liveEdge.value = Math.max(v.lengthSeconds, (Date.now() - vodStartMs) / 1000);
    for (const m of moments.value) seenLive.add(m.id);
    irc = joinChat(v.ownerLogin, {
      onMessage: (m) => {
        const cm = toChatMessage(m, vodStartMs);
        if (cm.t <= replayEnd) return;
        messages.value.push(cm);
        scheduleLiveRescore();
      },
      onState: (st) => {
        liveConn.value = st;
      },
    });
    liveTick = setInterval(liveSecond, 1000);
    liveRefresh = setInterval(() => void refreshLive(), 60_000);
    document.addEventListener('visibilitychange', onVisible);
  }
  let scoredBuckets = 0;
  function liveSecond() {
    if (!info.value) return;
    const edge = (Date.now() - vodStartMs) / 1000;
    liveEdge.value = edge;
    if (edge > info.value.lengthSeconds)
      info.value = { ...info.value, lengthSeconds: Math.floor(edge) };
    const full = Math.floor(edge / 15);
    if (full !== scoredBuckets) {
      scoredBuckets = full;
      scheduleLiveRescore();
    }
  }
  function scheduleLiveRescore() {
    if (liveScoreTimer) return;
    liveScoreTimer = setTimeout(() => {
      liveScoreTimer = null;
      triggerRef(messages); // the array grew in place
      rescore();
      announceNew();
    }, 3000);
  }
  /** Moments that appeared within the last two minutes of the live edge are news. */
  function announceNew() {
    const edge = liveEdge.value ?? 0;
    for (const m of moments.value) {
      if (seenLive.has(m.id)) continue;
      seenLive.add(m.id);
      if (m.t < edge - 120) continue;
      liveFeed.value = [{ ...m, seenAt: Date.now() }, ...liveFeed.value].slice(0, 60);
      if (typeof document === 'undefined' || !document.hidden) continue;
      unseen.value++;
      updateTitle();
      if (!notify.value || notifyPermission.value !== 'granted') continue;
      try {
        const n = new Notification(
          t('vodStore.chatSpiked', {
            streamer: info.value?.ownerDisplayName ?? t('vodStore.stream'),
          }),
          {
            body: `${formatHms(m.t)} · ${m.reasons.slice(0, 2).join(' · ')}`,
            tag: 'hypeline-live',
          },
        );
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        /* refused at the OS level */
      }
    }
  }
  let baseTitle = '';
  function updateTitle() {
    if (typeof document === 'undefined') return;
    if (!baseTitle) baseTitle = document.title;
    document.title = unseen.value ? `(${unseen.value}) ${baseTitle}` : baseTitle;
  }
  function onVisible() {
    if (document.hidden) return;
    if (unseen.value) {
      unseen.value = 0;
      updateTitle();
    }
    void refreshLive();
  }
  /** Is the stream still on? Twitch flips the VOD to RECORDED a little after it ends. */
  async function refreshLive() {
    const v = info.value;
    if (!v || !live.value) return;
    try {
      const li = await fetchLiveInfo(v.ownerLogin);
      if (li && li.vodId === v.id) return;
      // over: keep everything we appended, fetch the final metadata, stop listening
      const fresh = await fetchVodInfo(v.id).catch(() => null);
      if (fresh) {
        info.value = fresh;
        await db.putVod(fresh).catch(cacheWarn);
      } else info.value = { ...v, status: 'RECORDED' };
      stopLive();
      rescore();
    } catch {
      /* transient */
    }
  }
  function stopLive() {
    irc?.close();
    irc = null;
    if (liveTick) clearInterval(liveTick);
    if (liveRefresh) clearInterval(liveRefresh);
    if (liveScoreTimer) clearTimeout(liveScoreTimer);
    liveTick = liveRefresh = liveScoreTimer = null;
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onVisible);
    if (live.value) {
      live.value = false;
      liveConn.value = 'closed';
      liveEdge.value = null;
      unseen.value = 0;
      updateTitle();
    }
  }

  return {
    phase,
    error,
    info,
    access,
    subOnly,
    isExample,
    messages,
    progress,
    buckets,
    moments,
    dropped,
    fromCache,
    seekTarget,
    speech,
    setSpeech,
    lengthSeconds,
    load,
    importChat,
    reset,
    failWith,
    seek,
    setOnReady,
    live,
    liveConn,
    liveEdge,
    liveFeed,
    unseen,
    notify,
    notifyPermission,
    setNotify,
    stopLive,
    refreshLive,
  };
});
