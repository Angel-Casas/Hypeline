<script setup lang="ts">
/**
 * Dashboard (`/dashboard`, `/dashboard/:id`): where the app lives. "Desk" layout with a
 * "Library" rail (design/dashboard/hypeline-dashboard-layouts.html, Angel 2026-09-14):
 *
 *   rail  — brand, VOD input, the VODs cached in this browser, storage summary, settings
 *   main  — VOD card (title + the hype thread timeline), then three columns:
 *           moments | player + zoom + clip | AI + search
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useVodStore } from './stores/vodStore';
import { useTwitchStore } from './stores/twitchStore';
import VodInput from './components/VodInput.vue';
import TwitchPlayer from './components/TwitchPlayer.vue';
import SubOnlyNotice from './components/SubOnlyNotice.vue';
import HypeTimeline from '@/features/hype/components/HypeTimeline.vue';
import MomentList from '@/features/hype/components/MomentList.vue';
import ClipPanel from '@/features/clips/components/ClipPanel.vue';
import CropOverlay from '@/features/clips/components/CropOverlay.vue';
import SplitOverlay from '@/features/clips/components/SplitOverlay.vue';
import AiPanel from '@/features/ai/components/AiPanel.vue';
import CaptionPreview from '@/features/clips/components/CaptionPreview.vue';
import { useAiStore } from '@/features/ai/stores/aiStore';
import { useShortcuts } from '@/features/clips/useShortcuts';
import ShortcutsHelp from '@/ui/ShortcutsHelp.vue';
import SettingsPanel from '@/features/settings/SettingsPanel.vue';
import TourOverlay, { type TourStep } from '@/features/tour/TourOverlay.vue';
import { useTourStore } from '@/features/tour/tourStore';
import { EXAMPLE_ID } from './example';
import { chosen as localeChosen } from '@/i18n';
import QuotaBanner from '@/features/settings/QuotaBanner.vue';
import { clipAnchor, useClipStore } from '@/features/clips/stores/clipStore';
import { useQuotaStore } from '@/features/settings/quotaStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { deleteVodData, listClips, listVods } from '@/lib/storage/db';
import { formatBytes } from '@/lib/storage/quota';
import type { VodInfo } from '@/lib/twitch/types';
import { formatHms } from '@/lib/twitch/vodUrl';
import { fetchLiveInfo } from '@/lib/twitch/gql';
import ThemeToggle from '@/ui/ThemeToggle.vue';
import LanguageMenu from '@/ui/LanguageMenu.vue';
import SupportButton from '@/ui/SupportButton.vue';
import Logo from '@/ui/Logo.vue';
import InstallChip from '@/ui/InstallChip.vue';
import { loadStoryboard, StoryboardError, type Storyboard } from '@/lib/twitch/storyboard';
import { viaShim } from '@/lib/twitch/hls';
import type { Moment } from '@/features/hype/scoring';

const { t } = useI18n();
const store = useVodStore();
const {
  phase,
  error,
  info,
  progress,
  buckets,
  moments,
  dropped,
  fromCache,
  seekTarget,
  lengthSeconds,
  messages,
  live,
  liveConn,
  liveEdge,
  liveFeed,
  notify,
  notifyPermission,
  subOnly,
  isExample,
} = storeToRefs(store);
const clipStore = useClipStore();
const { inSec, outSec } = storeToRefs(clipStore);
const twitch = useTwitchStore();
const settings = useSettingsStore();
const quota = useQuotaStore();

// --- library (VODs cached in this browser) ---
const vods = ref<(VodInfo & { fetchedAt?: number; clips: number })[]>([]);
const clipTotal = computed(() => vods.value.reduce((n, v) => n + v.clips, 0));
async function loadLibrary() {
  const all = await listVods();
  const rows = await Promise.all(
    all.map(async (v) => ({ ...v, clips: (await listClips(v.id)).length })),
  );
  vods.value = rows.sort((a, b) => (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0));
}
onMounted(() => {
  void loadLibrary();
  void quota.refresh();
});
async function purge(id: string) {
  await deleteVodData(id);
  await loadLibrary();
  // the open VOD was forgotten (the example, usually): back to the home
  if (info.value?.id === id) goHome();
}
const showSettings = ref(false);
// Settings → Storage can clear the library: re-read it when the overlay closes
watch(showSettings, (open) => {
  if (!open) void loadLibrary();
});
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && showSettings.value) showSettings.value = false;
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
/** Open the settings overlay (from the AI card's link). */
function openSettings() {
  showSettings.value = true;
}

/**
 * Small screens (2026-09-14): below `lg` the rail becomes a drawer (button in a top bar);
 * below `xl` the three desk columns become tabs under a player that stays pinned while the
 * page scrolls. Tapping a moment switches to the Clip tab there.
 */
const railOpen = ref(false);
type Tab = 'moments' | 'clip' | 'ai';
const tab = ref<Tab>('moments');
const TABS = computed<{ id: Tab; label: string }[]>(() => [
  { id: 'moments', label: t('dashboard.tabMoments') },
  { id: 'clip', label: t('dashboard.tabClip') },
  { id: 'ai', label: t('dashboard.tabAi') },
]);
const tabbedMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 79.99rem)') : null;
const tabbed = ref(tabbedMq?.matches ?? false);
tabbedMq?.addEventListener('change', () => (tabbed.value = tabbedMq.matches));
const drawerMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 63.99rem)') : null;
const drawer = ref(drawerMq?.matches ?? false);
drawerMq?.addEventListener('change', () => (drawer.value = drawerMq.matches));

/** Visible window of the timeline (null = whole VOD). Wheel/pinch and the minimap change it. */
const view = ref<{ start: number; end: number } | null>(null);
/** Zoom around a clip range: 30 s (or half the range) of context on each side. */
function zoomAround(i: number, o: number) {
  const pad = Math.max(30, (o - i) * 0.5);
  view.value = { start: Math.max(0, i - pad), end: Math.min(lengthSeconds.value, o + pad) };
}
const hoverMomentId = ref<string | null>(null);
/** The video storyboard for the hover preview (needs the shim; silently absent otherwise). */
const storyboard = ref<Storyboard | null>(null);
/**
 * Twitch renders the storyboard only after the stream ends (2026-09-15: 403 while
 * `RECORDING`, there within a couple of hours). For a VOD that is live or just ended we say
 * so and keep trying every two minutes while the page is open on it.
 */
const framesPending = ref(false);
let framesRetry: ReturnType<typeof setTimeout> | null = null;
function isFresh(v: VodInfo) {
  const endedAgo = Date.now() - (Date.parse(v.createdAt) + v.lengthSeconds * 1000);
  return v.status === 'RECORDING' || endedAgo < 3 * 3600_000;
}
/** Why the frames are missing, for the VOD line (a fresh VOD's 403 reads as "not ready"). */
const framesError = ref<string | null>(null);
async function loadFrames(url: string) {
  if (framesRetry) clearTimeout(framesRetry);
  framesRetry = null;
  try {
    storyboard.value = await loadStoryboard(url, (u) =>
      settings.relayUrl ? viaShim(settings.relayUrl, u) : u,
    );
    framesError.value = null;
    framesPending.value = false;
    return;
  } catch (e) {
    storyboard.value = null;
    const fresh = !!info.value && isFresh(info.value);
    const denied = e instanceof StoryboardError && (e.status === 403 || e.status === 404);
    framesPending.value = fresh && denied;
    framesError.value = framesPending.value ? null : e instanceof Error ? e.message : String(e);
  }
  // keep trying every two minutes: a fresh VOD gets its storyboard later; a relay may come back
  framesRetry = setTimeout(() => void loadFrames(url), 120_000);
}
watch(
  () => info.value?.seekPreviewsURL,
  (url) => {
    if (framesRetry) clearTimeout(framesRetry);
    framesRetry = null;
    storyboard.value = null;
    framesPending.value = false;
    framesError.value = null;
    if (url) void loadFrames(url);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (framesRetry) clearTimeout(framesRetry);
});
const clipRanges = computed(() =>
  clipStore.clips.map((c) => ({ inSec: c.inSec, outSec: c.outSec })),
);
/** Moments that fall inside an exported clip's range. */
const clippedIds = computed(
  () =>
    new Set(
      allMoments.value
        .filter((m) => clipStore.clips.some((c) => m.t >= c.inSec - 5 && m.t <= c.outSec))
        .map((m) => m.id),
    ),
);
const thumbs = computed(() => (clipStore.thumbnail ? [clipStore.thumbnail.atSec] : []));
const route = useRoute();
const router = useRouter();
const currentTime = ref(0);
const player = ref<InstanceType<typeof TwitchPlayer> | null>(null);

useShortcuts({
  setIn: () => clipStore.setIn(currentTime.value),
  setOut: () => clipStore.setOut(currentTime.value),
  seekBy: (d) => player.value?.seekQuiet(currentTime.value + d),
  seekTo: (w) => {
    const t = w === 'in' ? inSec.value : outSec.value;
    if (t != null) store.seek(t);
  },
  togglePlay: () => player.value?.togglePlay(),
  exportClip: () => {
    if (info.value) void clipStore.exportClip(info.value.id);
  },
  jumpPeak,
  selectPeak,
});

const aiStore = useAiStore();
/** Chat's moments plus the ones the user's transcript searches pinned (AI), in time order. */
const allMoments = computed<Moment[]>(() =>
  aiStore.aiMoments.length
    ? [...moments.value, ...aiStore.aiMoments].sort((a, b) => a.t - b.t)
    : moments.value,
);
/** What the timeline shows of the transcript: coverage, and the running bulk job. */
const transcriptTrack = computed(() =>
  aiStore.bulkChunks.length || aiStore.bulk
    ? {
        chunks: aiStore.bulkChunks,
        running:
          aiStore.busy === 'bulk' && aiStore.bulk
            ? {
                fromSec: aiStore.bulk.fromSec,
                toSec: aiStore.bulk.toSec,
                current: aiStore.bulk.current,
              }
            : null,
      }
    : null,
);
store.setOnReady((id) => {
  void aiStore.loadBulk(id);
  void loadLibrary();
  // arriving from live mode (`?t=sec`): land on that second, ready to clip — after the clip
  // list has loaded, since loading it for a new VOD clears the range
  const t = Number(route.query.t);
  void clipStore.loadClips(id).then(() => {
    if (Number.isFinite(t) && t > 0) {
      clipMoment(t);
      void router.replace({ name: 'dashboard', params: { id }, query: {} });
    }
  });
});

/** The player is not pinned on phones any more: scroll it back when it is needed. */
const miniPlayer = ref<HTMLElement | null>(null);
function showPlayer() {
  if (!tabbed.value) return;
  void nextTick(() => miniPlayer.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}
/** One 45 s clip per moment into the export queue (then the Clip tab on a phone). */
function queueAllMoments() {
  clipStore.enqueueMoments(allMoments.value.map(clipAnchor));
  if (tabbed.value) tab.value = 'clip';
}
/** Enter clip mode for a moment: range around it (shifted for chat lag), seek to In, zoom. */
function clipMoment(sec: number) {
  clipStore.selectAround(sec);
  if (inSec.value != null && outSec.value != null) {
    store.seek(inSec.value);
    zoomAround(inSec.value, outSec.value);
  }
  if (tabbed.value) {
    tab.value = 'clip';
    showPlayer();
  }
}
function selectMoment(m: Moment) {
  clipMoment(clipAnchor(m));
}
/** , / . — the previous / next moment pin from the playhead. */
function jumpPeak(dir: -1 | 1) {
  const ts = allMoments.value.map((m) => m.t).sort((a, b) => a - b);
  const now = currentTime.value;
  const next = dir > 0 ? ts.find((t) => t > now + 1) : [...ts].reverse().find((t) => t < now - 1);
  if (next != null) store.seek(next);
}
function selectPeak() {
  let best: Moment | null = null;
  for (const m of allMoments.value)
    if (!best || Math.abs(m.t - currentTime.value) < Math.abs(best.t - currentTime.value)) best = m;
  if (best) selectMoment(best);
}

const busy = computed(
  () =>
    phase.value === 'loading-info' || phase.value === 'loading-chat' || phase.value === 'scoring',
);
/** The moment being worked on: the one inside the clip range, else the one at the playhead. */
const activeMomentId = computed(() => {
  const i = inSec.value;
  const o = outSec.value;
  const inRange =
    i != null && o != null ? allMoments.value.find((x) => x.t >= i && x.t <= o) : undefined;
  const m =
    inRange ??
    allMoments.value.find((x) => currentTime.value >= x.t - 5 && currentTime.value < x.t + 60);
  return m?.id ?? null;
});
const pct = computed(() =>
  progress.value
    ? Math.min(
        100,
        Math.round((progress.value.coveredSeconds / progress.value.lengthSeconds) * 100),
      )
    : 0,
);

/**
 * A channel instead of a VOD (ADR-18): find the VOD Twitch is recording of its stream and
 * open that — it grows in place while the stream is on. The VOD can lag the stream start by
 * a few seconds, so a fresh stream is retried for a minute.
 */
const lookingUp = ref<string | null>(null);
async function openChannel(channel: string, attempt = 0) {
  lookingUp.value = channel;
  store.stopLive();
  try {
    const li = await fetchLiveInfo(channel);
    if (!li) {
      lookingUp.value = null;
      store.failWith(t('dashboard.channelOffline', { channel }));
      return;
    }
    if (!li.vodId) {
      if (attempt < 3) {
        setTimeout(() => void openChannel(channel, attempt + 1), 10_000);
        return;
      }
      lookingUp.value = null;
      store.failWith(t('dashboard.vodNotListedYet', { name: li.displayName }));
      return;
    }
    lookingUp.value = null;
    open(li.vodId);
  } catch (e) {
    lookingUp.value = null;
    store.failWith(e instanceof Error ? e.message : String(e));
  }
}
function open(vodId: string, force = false) {
  view.value = null;
  railOpen.value = false;
  void router.push({ name: 'dashboard', params: { id: vodId } });
  void store.load(vodId, { force });
}

/** Chat-file fallback (TwitchDownloader JSON) for when Twitch's comments endpoint breaks. */
const chatFile = ref<HTMLInputElement | null>(null);
async function importChatFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  view.value = null;
  railOpen.value = false;
  const id = await store.importChat(await file.text());
  if (id && route.params.id !== id) void router.push({ name: 'dashboard', params: { id } });
}

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string' && id) {
      if (id !== info.value?.id && !busy.value) void store.load(id);
    } else if (info.value || phase.value !== 'idle') {
      // `/dashboard` with no id is the home, never the last VOD (Angel, 2026-09-16)
      store.reset();
    }
  },
  { immediate: true },
);
// back from Twitch's sign-in (token in the hash), and the home's data
onMounted(async () => {
  await twitch.handleRedirect();
  if (twitch.connected) void twitch.refresh();
});
function goHome() {
  view.value = null;
  railOpen.value = false;
  void router.push({ name: 'dashboard' });
}
const avatarOf = (id: string) => twitch.followed.find((c) => c.id === id)?.avatar;
/** "2 h ago" for the home cards. */
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return t('dashboard.minAgo', { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86400) return t('dashboard.hoursAgo', { n: Math.round(s / 3600) });
  return t('dashboard.daysAgo', { n: Math.round(s / 86400) });
}
// the landing sends a channel as `?channel=`: resolve it here
watch(
  () => route.query.channel,
  (c) => {
    if (typeof c === 'string' && c) {
      void router.replace({ name: 'dashboard', query: {} });
      void openChannel(c);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => store.stopLive());

// --- the tour (2026-09-17): five steps over the desk, on the example VOD ---
const tour = useTourStore();
/**
 * Every step says what the desk should look like, the drawer included: the tour can be
 * started from Settings, which on a phone lives *inside* the open drawer, and the drawer then
 * stayed over the step it was pointing at (Angel, 2026-09-17).
 */
function desk(t: Tab, rail = false) {
  return () => {
    tab.value = t;
    railOpen.value = rail && drawer.value;
  };
}
const TOUR_STEPS: TourStep[] = [
  { id: 'heatmap', before: desk('moments') },
  { id: 'moments', before: desk('moments') },
  { id: 'clip', before: desk('clip') },
  { id: 'ai', before: desk('ai') },
  { id: 'rail', before: desk('ai', true) },
];
/** Start once the desk is ready (the example, or whatever VOD the first visit opened). */
const tourPending = ref(false);
function startTourWhenReady() {
  tourPending.value = true;
  if (phase.value === 'ready') {
    tourPending.value = false;
    tour.start();
  }
}
watch(phase, (p) => {
  if (p === 'ready' && tourPending.value) {
    tourPending.value = false;
    tour.start();
  }
});
// first visit: after the language is chosen, open the example and walk through it
watch(
  localeChosen,
  (ok) => {
    if (!ok || tour.seen || tour.active || tourPending.value) return;
    if (!route.params.id && phase.value === 'idle') open(EXAMPLE_ID);
    startTourWhenReady();
  },
  { immediate: true },
);
// Settings → "show the tour again"
watch(
  () => tour.requested,
  (r) => {
    if (!r) return;
    showSettings.value = false;
    if (!info.value || phase.value !== 'ready') open(EXAMPLE_ID);
    startTourWhenReady();
  },
);
watch(
  () => tour.active,
  (a) => {
    if (!a) {
      if (drawer.value) railOpen.value = false;
      tab.value = 'moments';
    }
  },
);
</script>

<template>
  <main
    class="grid min-h-screen content-start gap-4 p-3 pt-0 lg:grid-cols-[260px_minmax(0,1fr)] lg:p-4"
  >
    <!-- small screens: a top bar with the brand and the rail's button -->
    <header
      class="glass-sm sticky top-0 z-30 mt-3 flex items-center justify-between px-3 py-2 [background:color-mix(in_srgb,var(--color-ground)_88%,transparent)] lg:hidden"
    >
      <RouterLink
        to="/"
        class="text-ink inline-flex items-center"
        title="Hypeline"
        aria-label="Hypeline"
      >
        <Logo :size="26" hover />
      </RouterLink>
      <div class="flex items-center gap-2">
        <SupportButton />
        <LanguageMenu />
        <ThemeToggle />
        <button class="btn-ghost text-xs" @click="railOpen = true">
          {{ t('dashboard.library') }}
        </button>
      </div>
    </header>
    <div
      v-if="railOpen"
      class="scrim fixed inset-0 z-40 backdrop-blur-[6px] lg:hidden"
      @click="railOpen = false"
    ></div>
    <!-- rail: brand, VOD input, library, storage, settings. Below lg it is a drawer. -->
    <aside
      data-tour="rail"
      class="glass rail-drawer fixed inset-y-3 left-3 z-50 flex w-[min(320px,86vw)] flex-col gap-4 overflow-y-auto p-4 transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:w-auto lg:translate-x-0 lg:self-start lg:overflow-visible"
      :class="railOpen ? 'translate-x-0' : '-translate-x-[calc(100%+16px)]'"
      :inert="drawer && !railOpen"
    >
      <div class="flex items-center justify-between">
        <RouterLink
          to="/"
          class="text-ink inline-flex items-center"
          title="Hypeline"
          aria-label="Hypeline"
        >
          <Logo :size="34" hover />
        </RouterLink>
        <div class="flex items-center gap-2">
          <button
            v-if="info || phase !== 'idle'"
            class="glass-sm grid h-9 w-9 place-items-center"
            :title="t('dashboard.home')"
            :aria-label="t('dashboard.home')"
            @click="goHome"
          >
            <svg
              viewBox="0 0 20 20"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 9.5 10 4l7 5.5" />
              <path d="M5 8.5V16h10V8.5" />
              <path d="M8.5 16v-4h3v4" />
            </svg>
          </button>
          <SupportButton class="max-lg:hidden" />
          <LanguageMenu class="max-lg:hidden" />
          <ThemeToggle class="max-lg:hidden" />
          <button class="btn-ghost text-xs lg:hidden" @click="railOpen = false">
            {{ t('common.close') }}
          </button>
        </div>
      </div>
      <VodInput :busy="busy" compact @submit="open" @live="openChannel" />
      <div class="silk-ring rounded-2xl p-3">
        <div class="eyebrow mb-2">{{ t('dashboard.inThisBrowser') }}</div>
        <p v-if="!vods.length" class="text-muted text-xs">{{ t('dashboard.noVodsCached') }}</p>
        <ul v-else class="flex flex-col gap-1">
          <li
            v-for="v in vods"
            :key="v.id"
            class="group flex items-center gap-2 rounded-xl px-2 py-1.5"
            :class="v.id === info?.id ? 'bg-lift/70' : 'hover:bg-lift/40'"
          >
            <button class="min-w-0 flex-1 text-left" @click="open(v.id)">
              <div class="truncate text-xs leading-tight font-semibold">{{ v.title || v.id }}</div>
              <div class="text-muted font-mono text-[10.5px]">
                {{ v.ownerDisplayName }} · {{ formatHms(v.lengthSeconds) }} ·
                {{ t('dashboard.clipCount', v.clips) }}
              </div>
            </button>
            <button
              class="purge grid h-6 w-6 shrink-0 place-items-center rounded-full text-[15px] leading-none"
              :title="t('dashboard.removeFromBrowser')"
              :aria-label="t('dashboard.removeFromBrowser')"
              @click="purge(v.id)"
            >
              ×
            </button>
          </li>
        </ul>
      </div>
      <RouterLink
        to="/clips"
        class="glass-sm silk-ring flex items-center justify-between px-3 py-2 text-xs"
      >
        <span class="font-semibold">{{ t('dashboard.clips') }}</span>
        <span class="text-muted font-mono">{{
          t('dashboard.clipsInBrowser', { n: clipTotal })
        }}</span>
      </RouterLink>
      <div class="mt-auto flex flex-col gap-2 border-t border-line pt-3 text-[11.5px]">
        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <b class="font-semibold">{{ t('dashboard.storage') }}</b>
          <span class="text-muted">{{
            quota.info.unknown
              ? '—'
              : `${formatBytes(quota.info.usage)} / ${formatBytes(quota.info.quota)}`
          }}</span>
          <b class="font-semibold">{{ t('dashboard.video') }}</b>
          <span class="text-muted">{{
            settings.relayUrl
              ? settings.shimUrl
                ? t('dashboard.customRelay')
                : t('dashboard.relayReady')
              : t('dashboard.noRelay')
          }}</span>
          <b class="font-semibold">NanoGPT</b>
          <span class="text-muted">{{
            settings.aiApiKey ? t('dashboard.keySet') : t('dashboard.noKey')
          }}</span>
        </div>
        <InstallChip />
        <button class="btn-ghost silk-ring text-xs" @click="showSettings = true">
          {{ t('common.settings') }}
        </button>
      </div>
    </aside>

    <!-- main: the desk -->
    <section class="flex min-w-0 flex-col gap-4">
      <QuotaBanner />
      <div
        v-if="phase === 'error'"
        class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-danger/40 bg-petal/60 p-3 text-sm text-danger"
      >
        <span class="min-w-0 flex-1">{{ error }}</span>
        <button
          class="btn-ghost text-xs whitespace-nowrap"
          :title="t('dashboard.importChatFileTitle')"
          @click="chatFile?.click()"
        >
          {{ t('dashboard.importChatFile') }}
        </button>
      </div>
      <input
        ref="chatFile"
        type="file"
        accept=".json,application/json"
        class="hidden"
        :aria-label="t('dashboard.importChatFile')"
        @change="importChatFile"
      />

      <template v-if="info">
        <!-- VOD card: title + the thread -->
        <div class="glass flex flex-col gap-2 px-5 pt-4 pb-2" data-tour="heatmap">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div class="eyebrow">
                {{ info.ownerDisplayName }}<span v-if="info.gameName"> · {{ info.gameName }}</span>
              </div>
              <h1 class="font-display mt-0.5 text-[22px] leading-[1.1]">{{ info.title }}</h1>
              <div class="text-muted font-mono text-[11px]">
                {{ formatHms(info.lengthSeconds) }}
                <template v-if="phase === 'ready'">
                  · {{ t('dashboard.messagesCount', { n: messages.length })
                  }}{{ fromCache ? ' ' + t('dashboard.cached') : '' }} ·
                  {{ t('dashboard.momentsCount', { n: moments.length })
                  }}<template v-if="aiStore.aiMoments.length">
                    ·
                    {{
                      t('dashboard.fromYourQuestions', { n: aiStore.aiMoments.length })
                    }}</template
                  >
                  · {{ t('dashboard.botMessagesDropped', { n: dropped }) }}
                </template>
                <template v-if="live">
                  · <span class="live-dot" aria-hidden="true"></span>
                  <span class="text-danger">{{ t('common.live') }}</span> ·
                  {{ t('dashboard.chatConn', { state: t(`dashboard.conn.${liveConn}`) }) }} ·
                  <a
                    :href="`https://twitch.tv/${info.ownerLogin}`"
                    target="_blank"
                    rel="noopener"
                    class="underline decoration-dotted"
                    >{{ t('common.watchOnTwitch') }}</a
                  >
                </template>
                <template v-else-if="info.status === 'RECORDING'">
                  · <span class="text-danger">{{ t('dashboard.liveNow') }}</span>
                </template>
                <template v-if="isExample">
                  · <span class="text-accent">{{ t('example.tag') }}</span>
                </template>
                <template v-if="subOnly">
                  ·
                  <span class="text-warn" :title="t('dashboard.subscribersOnlyTitle')">{{
                    t('dashboard.subscribersOnly')
                  }}</span>
                </template>
                <template v-if="framesPending">
                  ·
                  <span :title="t('dashboard.framesPendingTitle')">{{
                    t('dashboard.framesPending')
                  }}</span>
                </template>
                <template v-else-if="framesError">
                  ·
                  <span
                    class="text-warn"
                    :title="t('dashboard.storyboardFailed', { reason: framesError })"
                    >{{ t('dashboard.noFramesReason', { reason: framesError }) }}</span
                  >
                  ·
                  <button
                    class="underline"
                    @click="info.seekPreviewsURL && loadFrames(info.seekPreviewsURL)"
                  >
                    {{ t('common.retry') }}
                  </button>
                </template>
                <template v-else-if="!storyboard && !info.seekPreviewsURL && !isExample">
                  ·
                  <span :title="t('dashboard.noFramesTitle')">{{ t('dashboard.noFrames') }}</span>
                </template>
              </div>
            </div>
            <div v-if="phase === 'loading-chat'" class="text-muted min-w-56 text-xs">
              {{ t('dashboard.loadingChat', { n: progress?.messages ?? 0, pct }) }}
              <div class="mt-1 h-1 w-full rounded-full bg-ink/10">
                <div class="h-1 rounded-full bg-ink" :style="{ width: pct + '%' }"></div>
              </div>
            </div>
          </div>
          <HypeTimeline
            v-if="buckets.length || phase === 'loading-chat'"
            :buckets="buckets"
            :moments="allMoments"
            :length-seconds="lengthSeconds"
            :current-time="currentTime"
            :in-sec="inSec"
            :out-sec="outSec"
            :view-start="view?.start ?? null"
            :view-end="view?.end ?? null"
            :messages="messages"
            :storyboard="storyboard"
            :clips="clipRanges"
            :thumbs="thumbs"
            :hover-id="hoverMomentId"
            :active-id="activeMomentId"
            :loading="phase === 'loading-chat' ? (progress?.lanes ?? []) : null"
            :transcript="transcriptTrack"
            :live-edge="liveEdge"
            @seek="store.seek"
            @update:in="clipStore.setIn"
            @update:out="clipStore.setOut"
            @clear-range="clipStore.clearRange()"
            @update:view="view = $event"
            @hover-moment="hoverMomentId = $event"
            @select="selectMoment"
          />
        </div>

        <!-- below xl the columns become tabs. The player used to stay pinned here; it ate a
             third of a phone screen, so it scrolls away and the tab bar is what sticks
             (Angel, 2026-09-17). Anything that needs the video scrolls it back into view. -->
        <div
          ref="miniPlayer"
          class="silk-frame [--ring-w:3px] scroll-mt-[64px] shadow-[0_24px_60px_rgba(0,0,0,0.18)] xl:hidden"
        >
          <div class="@container relative overflow-hidden rounded-2xl bg-black">
            <div v-if="tabbed && isExample" class="example-video aspect-video w-full">
              <span>{{ t('example.noVideo') }}</span>
            </div>
            <TwitchPlayer
              v-else-if="tabbed"
              ref="player"
              :vod-id="info.id"
              :seek-target="seekTarget"
              :live="live"
              :length-seconds="lengthSeconds"
              @time="currentTime = $event"
            />
            <CropOverlay
              v-if="clipStore.aspect !== 'split'"
              :aspect="clipStore.aspect"
              :center-x="clipStore.cropCenterX"
              @update:center-x="clipStore.cropCenterX = $event"
            />
            <SplitOverlay v-else :layout="clipStore.split" @update="clipStore.split = $event" />
            <CaptionPreview :current-time="currentTime" />
            <SubOnlyNotice v-if="subOnly" :vod-id="info.id" :streamer="info.ownerDisplayName" />
          </div>
        </div>
        <div
          class="glass-sm sticky top-[56px] z-30 flex gap-1 p-1 lg:top-2 xl:hidden"
          role="tablist"
        >
          <button
            v-for="tb in TABS"
            :key="tb.id"
            role="tab"
            :aria-selected="tab === tb.id"
            class="flex-1 rounded-full py-1.5 text-xs font-semibold transition-colors"
            :class="tab === tb.id ? 'bg-ink text-ground' : 'text-muted hover:bg-lift/40'"
            @click="tab = tb.id"
          >
            {{ tb.label }}
          </button>
        </div>

        <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.9fr)]">
          <!-- moments -->
          <div
            class="glass flex-col gap-2 p-4"
            :class="tab === 'moments' ? 'flex' : 'hidden xl:flex'"
            data-tour="moments"
          >
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-sm font-semibold">{{ t('dashboard.moments') }}</h2>
              <!-- sensitivity: how many peaks surface (1 = only the loudest … 5 = everything) -->
              <label
                class="text-ink-2 flex items-center gap-2.5 font-mono text-[11px]"
                :title="t('dashboard.sensitivityTitle', { n: settings.sensitivity })"
              >
                <span>{{ t('dashboard.fewer') }}</span>
                <input
                  v-model.number="settings.sensitivity"
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  class="sens"
                  :aria-label="t('dashboard.sensitivityAria')"
                />
                <span>{{ t('dashboard.more') }}</span>
              </label>
            </div>
            <!-- live: new moments as they happen, and a notification for the ones you miss -->
            <div v-if="live" class="flex flex-col gap-1.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="eyebrow">{{ t('dashboard.newWhileLive') }} · {{ liveFeed.length }}</div>
                <button
                  v-if="notifyPermission !== 'unsupported'"
                  class="btn-ghost text-[11px]"
                  :class="{ 'silk-ring': notify }"
                  :aria-pressed="notify"
                  :title="
                    notifyPermission === 'denied'
                      ? t('dashboard.notificationsBlocked')
                      : t('dashboard.notifyTitle')
                  "
                  :disabled="notifyPermission === 'denied'"
                  @click="store.setNotify(!notify)"
                >
                  {{ notify ? t('dashboard.notifying') : t('dashboard.notifyMe') }}
                </button>
              </div>
              <p v-if="!liveFeed.length" class="text-muted text-xs">
                {{ t('dashboard.listening') }}
              </p>
              <ol v-else class="flex flex-col">
                <li
                  v-for="m in liveFeed.slice(0, 6)"
                  :key="m.id"
                  class="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-lift/40"
                >
                  <button
                    class="font-mono text-[12px] font-semibold tabular-nums"
                    @click="selectMoment(m)"
                  >
                    {{ formatHms(m.t) }}
                  </button>
                  <span class="text-muted min-w-0 flex-1 truncate font-mono text-[10.5px]">{{
                    m.reasons[0] ?? t('dashboard.msgs', { n: m.n })
                  }}</span>
                </li>
              </ol>
            </div>
            <button
              v-if="moments.length && !subOnly"
              class="text-accent self-start font-mono text-[10.5px] underline"
              :title="t('dashboard.queueAllTitle')"
              @click="queueAllMoments()"
            >
              {{ t('dashboard.queueAll', { n: allMoments.length }) }}
            </button>
            <MomentList
              v-if="allMoments.length"
              class="min-h-0 flex-1"
              :moments="allMoments"
              :length-seconds="lengthSeconds"
              :active-id="activeMomentId"
              :hover-id="hoverMomentId"
              :clipped-ids="clippedIds"
              :storyboard="storyboard"
              @clip="selectMoment"
              @hover="hoverMomentId = $event"
            />
            <p v-else class="text-muted text-xs">
              {{
                phase === 'ready' ? t('dashboard.noMomentsFound') : t('dashboard.findingMoments')
              }}
            </p>
          </div>

          <!-- player + zoom + clip -->
          <div
            class="min-w-0 flex-col gap-4"
            :class="tab === 'clip' ? 'flex' : 'hidden xl:flex'"
            data-tour="clip"
          >
            <div
              class="silk-frame [--ring-w:3px] hidden shadow-[0_24px_60px_rgba(0,0,0,0.18)] xl:block"
            >
              <div class="@container relative overflow-hidden rounded-2xl bg-black">
                <div v-if="!tabbed && isExample" class="example-video aspect-video w-full">
                  <span>{{ t('example.noVideo') }}</span>
                </div>
                <TwitchPlayer
                  v-else-if="!tabbed"
                  ref="player"
                  :vod-id="info.id"
                  :seek-target="seekTarget"
                  :live="live"
                  :length-seconds="lengthSeconds"
                  @time="currentTime = $event"
                />
                <CropOverlay
                  v-if="clipStore.aspect !== 'split'"
                  :aspect="clipStore.aspect"
                  :center-x="clipStore.cropCenterX"
                  @update:center-x="clipStore.cropCenterX = $event"
                />
                <SplitOverlay v-else :layout="clipStore.split" @update="clipStore.split = $event" />
                <CaptionPreview :current-time="currentTime" />
                <SubOnlyNotice v-if="subOnly" :vod-id="info.id" :streamer="info.ownerDisplayName" />
              </div>
            </div>
            <div class="hidden lg:block"><ShortcutsHelp /></div>
            <ClipPanel
              :vod-id="info.id"
              :current-time="currentTime"
              :length-seconds="lengthSeconds"
              :storyboard="storyboard"
              @seek="store.seek"
            />
          </div>

          <!-- AI + search -->
          <div class="min-w-0 flex-col gap-4" :class="tab === 'ai' ? 'flex' : 'hidden xl:flex'">
            <AiPanel
              data-tour="ai"
              :vod-id="info.id"
              :streamer="info.ownerDisplayName"
              :game="info.gameName"
              :messages="messages"
              :length-seconds="lengthSeconds"
              @seek="store.seek"
              @clip="clipMoment"
              @settings="openSettings"
            />
          </div>
        </div>
      </template>

      <div v-else-if="lookingUp" class="glass p-6 text-sm text-muted">
        {{ t('dashboard.lookingUp', { channel: lookingUp }) }}
      </div>
      <template v-else-if="phase === 'idle'">
        <!-- the home: your Twitch, if connected; else the invitation -->
        <div v-if="!twitch.connected" class="home-invite flex flex-col gap-3 rounded-2xl p-6">
          <div class="eyebrow">{{ t('dashboard.yourDesk') }}</div>
          <h1 class="font-display text-[26px] leading-[1.1]">
            {{ t('dashboard.inviteTitle') }}
          </h1>
          <p class="text-ink-2 max-w-[56ch] text-sm">
            {{ t('dashboard.inviteBody') }}
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <button v-if="twitch.available" class="btn-silk text-sm" @click="twitch.connect()">
              {{ t('dashboard.connectTwitch') }}
            </button>
            <span v-else class="text-muted font-mono text-[11px]">{{
              t('dashboard.signInNotSetUp')
            }}</span>
            <span class="text-muted text-xs max-lg:hidden">{{
              t('dashboard.orPasteLinkInRail')
            }}</span>
            <span class="text-muted text-xs lg:hidden">{{ t('dashboard.orPasteLink') }}</span>
          </div>
          <p v-if="twitch.error" class="text-danger text-xs">{{ twitch.error }}</p>
          <VodInput class="lg:hidden" :busy="busy" compact @submit="open" @live="openChannel" />
          <div class="text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <button
              class="underline"
              :disabled="busy"
              :title="t('dashboard.exampleTitle')"
              @click="open(EXAMPLE_ID)"
            >
              {{ t('dashboard.tryExample') }}
            </button>
            <span>
              {{ t('dashboard.replayNotReachable') }}
              <button class="underline" @click="chatFile?.click()">
                {{ t('dashboard.importChatFileLower') }}
              </button>
              {{ t('dashboard.twitchDownloaderJson') }}
            </span>
          </div>
        </div>

        <template v-else>
          <div class="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <div>
              <div class="eyebrow">{{ t('dashboard.yourTwitch') }} · {{ twitch.login }}</div>
              <h1 class="font-display text-[26px] leading-[1.1]">
                <template v-if="twitch.live.length">{{
                  t('dashboard.nLiveNow', { n: twitch.live.length })
                }}</template>
                <template v-else>{{ t('dashboard.nobodyLive') }}</template>
              </h1>
            </div>
            <div class="text-muted flex items-center gap-3 font-mono text-[11px]">
              <span v-if="twitch.loading">{{ t('dashboard.refreshing') }}</span>
              <button v-else class="underline" @click="twitch.refresh(true)">
                {{ t('dashboard.refresh') }}
              </button>
              <button class="underline" @click="twitch.disconnect()">
                {{ t('dashboard.disconnect') }}
              </button>
            </div>
          </div>
          <p v-if="twitch.error" class="text-danger px-1 text-xs">{{ twitch.error }}</p>

          <!-- live now: open the channel → its recording VOD, growing -->
          <ul
            v-if="twitch.live.length"
            class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
          >
            <li v-for="s in twitch.live" :key="s.userId">
              <button
                class="home-card glass group flex w-full flex-col overflow-hidden text-left"
                :title="t('dashboard.openStreamTitle', { name: s.name })"
                @click="openChannel(s.login)"
              >
                <div class="relative aspect-video w-full bg-black">
                  <img :src="s.thumb" alt="" class="h-full w-full object-cover" loading="lazy" />
                  <span
                    class="live-tag absolute top-2 left-2 font-mono text-[10px] font-bold tracking-[0.12em]"
                    >{{ t('dashboard.liveTag') }}</span
                  >
                  <span
                    class="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white"
                    >{{ t('dashboard.watching', { n: s.viewers.toLocaleString() }) }}</span
                  >
                </div>
                <div class="flex flex-col gap-0.5 p-3">
                  <div class="text-sm font-semibold">{{ s.name }}</div>
                  <div class="text-ink-2 line-clamp-2 text-xs">{{ s.title }}</div>
                  <div class="text-muted font-mono text-[10.5px]">
                    {{ s.game || 'Just Chatting' }} · {{ ago(s.startedAt) }}
                  </div>
                </div>
              </button>
            </li>
          </ul>

          <div class="eyebrow px-1">
            {{ t('dashboard.latestVods') }} · {{ twitch.latest.length }}
          </div>
          <p v-if="!twitch.latest.length && twitch.loading" class="text-muted px-1 text-sm">
            {{ t('dashboard.fetchingLatest') }}
          </p>
          <p v-else-if="!twitch.latest.length" class="text-muted px-1 text-sm">
            {{ t('dashboard.noPastBroadcasts') }}
          </p>
          <ul v-else class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            <li v-for="v in twitch.latest" :key="v.id">
              <button
                class="home-card glass group flex w-full flex-col overflow-hidden text-left"
                :title="v.title"
                @click="open(v.id)"
              >
                <div class="relative aspect-video w-full bg-black">
                  <img :src="v.thumb" alt="" class="h-full w-full object-cover" loading="lazy" />
                  <span
                    class="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white"
                    >{{ formatHms(v.lengthSeconds) }}</span
                  >
                </div>
                <div class="flex items-start gap-2.5 p-3">
                  <img
                    v-if="avatarOf(v.userId)"
                    :src="avatarOf(v.userId)"
                    alt=""
                    class="mt-0.5 h-8 w-8 shrink-0 rounded-full"
                    loading="lazy"
                  />
                  <div class="min-w-0 flex flex-col gap-0.5">
                    <div class="text-sm font-semibold">{{ v.name }}</div>
                    <div class="text-ink-2 line-clamp-2 text-xs">{{ v.title }}</div>
                    <div class="text-muted font-mono text-[10.5px]">{{ ago(v.createdAt) }}</div>
                  </div>
                </div>
              </button>
            </li>
          </ul>
          <p class="text-muted px-1 text-[11px]">
            <span class="max-lg:hidden">{{ t('dashboard.orPasteAnyLinkInRail') }}</span>
            <span class="lg:hidden">{{ t('dashboard.orPasteAnyLink') }}</span>
            <button class="underline" @click="chatFile?.click()">
              {{ t('dashboard.importChatFile') }}
            </button>
            {{ t('dashboard.ifReplayNotReachable') }}
          </p>
          <VodInput class="lg:hidden" :busy="busy" compact @submit="open" @live="openChannel" />
        </template>
      </template>
      <div v-else-if="busy && !info" class="glass p-6 text-sm text-muted">
        {{ t('dashboard.loadingVod') }}
      </div>
    </section>

    <TourOverlay :steps="TOUR_STEPS" />

    <!-- settings: an overlay over a blurred page; the ×, the backdrop or Escape close it -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showSettings"
          class="scrim fixed inset-0 z-[70] grid place-items-center overflow-y-auto p-4 backdrop-blur-md"
          @click.self="showSettings = false"
        >
          <div
            class="modal relative w-full max-w-[560px]"
            role="dialog"
            aria-modal="true"
            :aria-label="t('common.settings')"
          >
            <button
              class="glass-sm absolute top-3 right-3 z-10 grid h-8 w-8 place-items-center text-[18px] leading-none"
              :aria-label="t('dashboard.closeSettings')"
              @click="showSettings = false"
            >
              ×
            </button>
            <SettingsPanel />
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
/* Below lg the rail floats over the page, so it must be a surface you can read rather than a
   window onto the dashboard behind it (Angel, 2026-09-17). At lg it is a column on the page's
   own background, where the glass is right. */
@media (max-width: 1023.98px) {
  .rail-drawer {
    background: color-mix(in srgb, var(--color-ground) 86%, transparent);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
  }
}
/* overlay scrims: a real dim in both themes (see --scrim in style.css) */
.scrim {
  background: var(--scrim);
}
/* the example VOD has no video: a black card with a whisper, where the player would be */
.example-video {
  display: grid;
  place-items: center;
  background: #000;
  color: rgba(255, 255, 255, 0.55);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
/* the home: the invitation card is the AI panel's pastel (sky → lilac), the cards are glass */
.home-invite {
  background: linear-gradient(135deg, var(--color-sky), var(--color-lilac));
  color: var(--color-ink);
}
.home-card {
  transition:
    transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 0.2s;
}
.home-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 40px -20px rgba(22, 18, 26, 0.5);
}
.live-tag {
  padding: 3px 7px;
  border-radius: 999px;
  color: #fff;
  background: var(--color-danger);
}
.live-dot {
  display: inline-block;
  flex: none;
  width: 7px;
  height: 7px;
  /* Vue drops the newline between the dot and the word, so the gap is the dot's own */
  margin-right: 5px;
  border-radius: 999px;
  background: var(--color-danger);
  vertical-align: 0;
  animation: live-pulse 1.8s ease-out infinite;
}
@keyframes live-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-danger) 50%, transparent);
  }
  100% {
    box-shadow: 0 0 0 8px transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .live-dot {
    animation: none;
  }
}
/* the sensitivity slider: a silk track, an ink thumb */
.sens {
  appearance: none;
  width: 132px;
  height: 20px;
  background: transparent;
  cursor: pointer;
}
.sens::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 6px;
  background: linear-gradient(90deg, #8eb0ff, #ae81ff, #ff77b5, #ffa968, #ffde68);
}
.sens::-moz-range-track {
  height: 6px;
  border-radius: 6px;
  background: linear-gradient(90deg, #8eb0ff, #ae81ff, #ff77b5, #ffa968, #ffde68);
}
.sens::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  margin-top: -6px;
  border-radius: 50%;
  background: var(--color-ink);
  border: 3px solid var(--color-ground);
  box-shadow: 0 0 0 1px var(--color-line);
}
.sens::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-ink);
  border: 3px solid var(--color-ground);
  box-shadow: 0 0 0 1px var(--color-line);
}
.sens:focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
  border-radius: 6px;
}
.purge {
  color: var(--color-danger);
  opacity: 0.75;
  transition:
    background-color 0.15s,
    opacity 0.15s;
}
.purge:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-danger) 14%, transparent);
}
/* the settings panel sits on a blurred page, so its glass is nearly solid to stay legible */
.modal :deep(section) {
  background: color-mix(in srgb, var(--color-ground) 94%, transparent);
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s;
}
.modal-enter-active .modal,
.modal-leave-active .modal {
  transition:
    transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.2s;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: translateY(10px) scale(0.98);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal,
  .modal-leave-active .modal {
    transition: none;
  }
}
</style>
