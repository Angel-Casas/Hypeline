<script setup lang="ts">
/**
 * The library rail (ADR-41, Angel 2026-09-18): brand, VOD input, the VODs cached in this
 * browser, the clips link, storage, settings. It was written inside the dashboard and lived
 * only there, so the gallery — reached from this very rail — dropped it and read as a
 * different app. It is a shared shell now, and any page that is "inside" Hypeline wears it.
 *
 * Below `lg` it is a drawer behind a top bar, which is why this component also owns that bar
 * and the scrim: the three move together. It owns the library it lists (IndexedDB), the
 * storage figures and the settings overlay; the page above it only says which VOD is open and
 * what to do when one is picked, since the dashboard opens a VOD in place while every other
 * page routes to it.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import VodInput from '@/features/vod/components/VodInput.vue';
import SettingsPanel from '@/features/settings/SettingsPanel.vue';
import { useQuotaStore } from '@/features/settings/quotaStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useTourStore } from '@/features/tour/tourStore';
import { deleteVodData, listClips, listVods } from '@/lib/storage/db';
import { formatBytes } from '@/lib/storage/quota';
import type { VodInfo } from '@/lib/twitch/types';
import { formatHms } from '@/lib/twitch/vodUrl';
import ThemeToggle from '@/ui/ThemeToggle.vue';
import LanguageMenu from '@/ui/LanguageMenu.vue';
import SupportButton from '@/ui/SupportButton.vue';
import Logo from '@/ui/Logo.vue';
import InstallChip from '@/ui/InstallChip.vue';

const props = withDefaults(
  defineProps<{
    /** The VOD open on the page, lit in the list. */
    activeVodId?: string | null;
    /** The page is loading something: the input says so. */
    busy?: boolean;
    /** Show the "home" button — the dashboard hides it when it already is the home. */
    showHome?: boolean;
  }>(),
  { activeVodId: null, busy: false, showHome: true },
);
const emit = defineEmits<{
  /** A VOD was picked, by id or by pasting a link. */
  open: [vodId: string];
  /** A channel was pasted: live mode. */
  live: [channel: string];
  home: [];
  /** A VOD was removed from this browser — the page may have it open. */
  purged: [vodId: string];
}>();
const { t } = useI18n();
const quota = useQuotaStore();
const settings = useSettingsStore();
const tour = useTourStore();

// --- library (VODs cached in this browser) ---
const vods = ref<(VodInfo & { fetchedAt?: number; clips: number })[]>([]);
const clipTotal = computed(() => vods.value.reduce((n, v) => n + v.clips, 0));
async function refresh() {
  const all = await listVods();
  const rows = await Promise.all(
    all.map(async (v) => ({ ...v, clips: (await listClips(v.id)).length })),
  );
  vods.value = rows.sort((a, b) => (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0));
}
onMounted(() => {
  void refresh();
  void quota.refresh();
});
async function purge(id: string) {
  await deleteVodData(id);
  await refresh();
  emit('purged', id);
}

// --- the drawer (below lg) ---
const railOpen = ref(false);
const drawerMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 63.99rem)') : null;
const drawer = ref(drawerMq?.matches ?? false);
drawerMq?.addEventListener('change', () => (drawer.value = drawerMq.matches));
/** Anything the rail does closes the drawer: it covers the page it just acted on. */
function pick(vodId: string) {
  railOpen.value = false;
  emit('open', vodId);
}
function live(channel: string) {
  railOpen.value = false;
  emit('live', channel);
}
function home() {
  railOpen.value = false;
  emit('home');
}

// --- settings ---
const showSettings = ref(false);
// Settings → Storage can clear the library: re-read it when the overlay closes
watch(showSettings, (open) => {
  if (!open) void refresh();
});
/*
 * The tour cannot run under the overlay it is started from, and on a phone that overlay covers
 * the whole screen (Angel, 2026-09-19: "the settings page was blocking the view", two times in
 * three). Watching `tour.requested` alone was a race I lost: the page's own watcher runs first,
 * calls `tour.start()`, and `start()` clears `requested` — so by the time this one ran the flag
 * was false again and the overlay stayed. Hence both, and hence `settingsOpen` below: while the
 * tour is on, the overlay is not rendered at all, whatever any flag says.
 */
watch([() => tour.requested, () => tour.active], ([requested, active]) => {
  if (requested || active) showSettings.value = false;
});
/** Never over the tour — the one state that outranks "the user opened Settings". */
const settingsOpen = computed(() => showSettings.value && !tour.active);
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && showSettings.value) showSettings.value = false;
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

defineExpose({
  /** The tour points at the rail, which on a phone means opening the drawer first. */
  openDrawer: () => (railOpen.value = drawer.value),
  closeDrawer: () => (railOpen.value = false),
  openSettings: () => (showSettings.value = true),
  /** Re-read the library — the page exported a clip, or finished loading a VOD. */
  refresh,
});
// `props` is read in the template; naming it keeps the linter and the reader honest
void props;
</script>

<template>
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
    class="scrim-soft fixed inset-0 z-40 backdrop-blur-[6px] lg:hidden"
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
          v-if="showHome"
          class="glass-sm grid h-9 w-9 place-items-center"
          :title="t('dashboard.home')"
          :aria-label="t('dashboard.home')"
          @click="home"
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
    <VodInput :busy="busy" compact @submit="pick" @live="live" />
    <div class="silk-ring rounded-2xl p-3">
      <div class="eyebrow mb-2">{{ t('dashboard.inThisBrowser') }}</div>
      <p v-if="!vods.length" class="text-muted text-xs">{{ t('dashboard.noVodsCached') }}</p>
      <ul v-else class="flex flex-col gap-1">
        <li
          v-for="v in vods"
          :key="v.id"
          class="group flex items-center gap-2 rounded-xl px-2 py-1.5"
          :class="[v.id === activeVodId ? 'bg-lift/70' : '', 'hover-frost']"
        >
          <button class="min-w-0 flex-1 text-left" @click="pick(v.id)">
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

  <!-- settings: an overlay over a blurred page; the ×, the backdrop or Escape close it -->
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="settingsOpen"
        class="scrim fixed inset-0 z-[70] grid place-items-center overflow-y-auto p-4 backdrop-blur-md"
        @click.self="showSettings = false"
      >
        <div
          class="modal relative w-full max-w-[560px]"
          role="dialog"
          aria-modal="true"
          data-testid="settings-overlay"
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
</template>

<style scoped>
/* Below lg the rail floats over the page, so it must be a surface you can read rather than a
   window onto the page behind it (Angel, 2026-09-17). At lg it is a column on the page's own
   background, where the glass is right. */
@media (max-width: 1023.98px) {
  .rail-drawer {
    background: var(--sheet-bg);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
  }
}
/* overlay scrims: a real dim in both themes (see --scrim in style.css) */
.scrim {
  background: var(--scrim);
}
/* The drawer's scrim is the lighter one: it sits *between* the page and the drawer, so a
   full-strength dim there is counted twice and the drawer reads as flat black however
   transparent its own background is (Angel, 2026-09-17). */
.scrim-soft {
  background: var(--sheet-scrim);
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
