<script setup lang="ts">
/**
 * The clips gallery (`/clips`, 2026-09-15): every clip cut in this browser, across VODs, with
 * a title and tags you can edit in place, share (Web Share with the file where the browser
 * offers it), download, open the VOD, or remove. Filter by tag.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  deleteClip,
  listAllClips,
  listVods,
  updateClipMeta,
  type StoredClip,
} from '@/lib/storage/db';
import { formatHms } from '@/lib/twitch/vodUrl';
import type { VodInfo } from '@/lib/twitch/types';
import ThemeToggle from '@/ui/ThemeToggle.vue';
import LanguageMenu from '@/ui/LanguageMenu.vue';
import SupportButton from '@/ui/SupportButton.vue';
import Logo from '@/ui/Logo.vue';

interface Row extends StoredClip {
  url: string;
  vod?: VodInfo;
}
const { t } = useI18n();
const rows = ref<Row[]>([]);
const loading = ref(true);
const filter = ref<string | null>(null);
const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

async function load() {
  loading.value = true;
  const [clips, vods] = await Promise.all([listAllClips(), listVods()]);
  const byId = new Map(vods.map((v) => [v.id, v]));
  for (const r of rows.value) URL.revokeObjectURL(r.url);
  rows.value = clips.map((c) => ({
    ...c,
    url: URL.createObjectURL(c.blob),
    vod: byId.get(c.vodId),
  }));
  loading.value = false;
}
onMounted(load);
onBeforeUnmount(() => rows.value.forEach((r) => URL.revokeObjectURL(r.url)));

const tags = computed(() => {
  const count = new Map<string, number>();
  for (const r of rows.value) for (const t of r.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t, n }));
});
const shown = computed(() =>
  filter.value ? rows.value.filter((r) => r.tags?.includes(filter.value!)) : rows.value,
);
const totalBytes = computed(() => rows.value.reduce((s, r) => s + r.bytes, 0));

function fileName(r: Row) {
  const base = r.title?.trim()
    ? r.title
        .trim()
        .replace(/[^\w\- ]+/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 60)
    : `${r.vodId}_${Math.floor(r.inSec)}-${Math.floor(r.outSec)}_${r.aspect.replace(':', 'x')}`;
  return `${base}.mp4`;
}
function download(r: Row) {
  const a = document.createElement('a');
  a.href = r.url;
  a.download = fileName(r);
  a.click();
}
/** Hand the file to the OS share sheet where the browser supports it; else download. */
async function share(r: Row) {
  const file = new File([r.blob], fileName(r), { type: 'video/mp4' });
  const data: ShareData = { files: [file], title: r.title || t('gallery.defaultShareTitle') };
  if (canShareFiles && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return;
    } catch {
      /* cancelled or refused: fall back */
    }
  }
  download(r);
}
async function rename(r: Row, e: Event) {
  const title = (e.target as HTMLInputElement).value.trim();
  r.title = title;
  await updateClipMeta(r.id, { title });
}
async function addTag(r: Row, e: Event) {
  const input = e.target as HTMLInputElement;
  const t = input.value.trim().toLowerCase().replace(/^#/, '');
  input.value = '';
  if (!t || r.tags?.includes(t)) return;
  r.tags = [...(r.tags ?? []), t];
  await updateClipMeta(r.id, { tags: r.tags });
}
async function dropTag(r: Row, t: string) {
  r.tags = (r.tags ?? []).filter((x) => x !== t);
  await updateClipMeta(r.id, { tags: r.tags });
}
async function remove(r: Row) {
  await deleteClip(r.id);
  URL.revokeObjectURL(r.url);
  rows.value = rows.value.filter((x) => x.id !== r.id);
}
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-[1240px] flex-col gap-4 p-3 lg:p-6">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-baseline gap-3">
        <RouterLink
          to="/"
          class="text-ink inline-flex items-center gap-2.5"
          title="Hypeline"
          aria-label="Hypeline"
        >
          <Logo :size="30" hover />
          <span class="font-display text-[26px] leading-none">Hypeline</span>
        </RouterLink>
        <span class="eyebrow">{{ t('gallery.eyebrow') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <SupportButton />
        <LanguageMenu />
        <ThemeToggle />
        <RouterLink to="/dashboard" class="glass-sm px-3 py-1.5 text-xs">{{
          t('gallery.dashboard')
        }}</RouterLink>
      </div>
    </header>

    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h1 class="font-display text-[28px] leading-none">
        {{ t('gallery.clipCount', rows.length) }}
        <span class="text-muted font-mono text-[12px]">{{
          t('gallery.mbInBrowser', { n: (totalBytes / 1048576).toFixed(0) })
        }}</span>
      </h1>
      <div v-if="tags.length" class="flex flex-wrap items-center gap-1.5">
        <button class="chip" :class="{ on: filter === null }" @click="filter = null">
          {{ t('gallery.all') }}
        </button>
        <button
          v-for="tag in tags"
          :key="tag.t"
          class="chip"
          :class="{ on: filter === tag.t }"
          @click="filter = filter === tag.t ? null : tag.t"
        >
          #{{ tag.t }} <span class="opacity-60">{{ tag.n }}</span>
        </button>
      </div>
    </div>

    <p v-if="loading" class="text-muted text-sm">{{ t('gallery.loading') }}</p>
    <div v-else-if="!rows.length" class="glass flex flex-col gap-2 p-6">
      <div class="eyebrow">{{ t('gallery.nothingYet') }}</div>
      <i18n-t keypath="gallery.emptyHint" tag="p" class="text-muted max-w-[52ch] text-sm">
        <template #dashboard>
          <RouterLink to="/dashboard" class="text-accent underline">{{
            t('gallery.dashboardLink')
          }}</RouterLink>
        </template>
      </i18n-t>
    </div>
    <ul v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <li v-for="r in shown" :key="r.id" class="glass flex flex-col gap-2 p-3">
        <video
          :src="r.url"
          controls
          preload="metadata"
          class="w-full rounded-xl bg-black"
          :class="
            r.aspect === '9:16' || r.aspect === 'split'
              ? 'aspect-[9/16] max-h-80 self-center'
              : r.aspect === '1:1'
                ? 'aspect-square'
                : 'aspect-video'
          "
        ></video>
        <input
          :value="r.title ?? ''"
          :placeholder="t('gallery.untitledClip')"
          class="title font-display w-full bg-transparent text-[18px] leading-tight outline-none"
          :aria-label="t('gallery.clipTitle')"
          maxlength="120"
          @change="rename(r, $event)"
        />
        <div class="text-muted font-mono text-[10.5px]">
          <RouterLink
            :to="`/dashboard/${r.vodId}`"
            class="hover:text-ink underline decoration-dotted"
          >
            {{ r.vod?.ownerDisplayName ?? r.vodId }}</RouterLink
          >
          · {{ formatHms(r.inSec) }} → {{ formatHms(r.outSec) }} · {{ r.aspect }} · {{ r.variant }}
          <template v-if="r.captions"> · {{ t('gallery.captionsTag') }}</template> ·
          {{ t('gallery.mb', { n: (r.bytes / 1048576).toFixed(1) }) }}
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <span v-for="tag in r.tags ?? []" :key="tag" class="chip on">
            #{{ tag }}
            <button
              class="ml-1 opacity-70 hover:opacity-100"
              :aria-label="t('gallery.removeTag', { tag })"
              @click="dropTag(r, tag)"
            >
              ×
            </button>
          </span>
          <input
            class="tagin text-muted min-w-16 flex-1 bg-transparent font-mono text-[11px] outline-none"
            :placeholder="t('gallery.addTagPlaceholder')"
            :aria-label="t('gallery.addTag')"
            @keydown.enter.prevent="addTag(r, $event)"
            @blur="addTag(r, $event)"
          />
        </div>
        <div class="mt-auto flex flex-wrap items-center gap-3 pt-1 text-xs">
          <button class="btn-silk px-3! py-1! text-xs" @click="share(r)">
            {{ canShareFiles ? t('gallery.share') : t('common.download') }}
          </button>
          <button v-if="canShareFiles" class="text-accent underline" @click="download(r)">
            {{ t('gallery.downloadLower') }}
          </button>
          <button
            class="purge ml-auto grid h-6 w-6 place-items-center rounded-full text-[15px] leading-none"
            :title="t('gallery.removeFromBrowser')"
            :aria-label="t('gallery.removeClip')"
            @click="remove(r)"
          >
            ×
          </button>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.chip {
  font: 500 11px var(--font-mono);
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: color-mix(in srgb, var(--color-lift) 45%, transparent);
  color: var(--color-muted);
  display: inline-flex;
  align-items: center;
}
.chip.on {
  color: var(--color-ink);
  background: color-mix(in srgb, var(--color-lift) 80%, transparent);
  border-color: var(--glass-line);
}
.title::placeholder {
  color: var(--color-muted);
  opacity: 0.6;
}
.tagin::placeholder {
  color: var(--color-muted);
}
.purge {
  color: var(--color-danger);
  opacity: 0.75;
}
.purge:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-danger) 14%, transparent);
}
</style>
