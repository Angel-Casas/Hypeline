<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useClipStore } from '../stores/clipStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useAiStore } from '@/features/ai/stores/aiStore';
import { useVodStore } from '@/features/vod/stores/vodStore';
import { formatHms } from '@/lib/twitch/vodUrl';
import type { Aspect, CutMode, CutProgress } from '@/lib/video/cut';
import MenuButton from '@/ui/MenuButton.vue';
import { frameBackground, type Storyboard } from '@/lib/twitch/storyboard';
import { silkAt } from '@/ui/thread/silk';

/**
 * "Filmstrip" (design/dashboard/hypeline-clip-panel.html #7, Angel 2026-09-15): the range
 * is an editor's trim — the storyboard frames at In and Out are the handles (silk placeholders
 * without the shim), the duration runs between them on a silk bar, tapping a frame seeks
 * there and the time on a frame is editable in place. Below it, one line: the preset pills and
 * a menu per setting (ADR-27).
 */
const props = defineProps<{
  vodId: string;
  currentTime: number;
  lengthSeconds?: number;
  storyboard?: Storyboard | null;
}>();
const emit = defineEmits<{ seek: [sec: number] }>();
const { t } = useI18n();
const store = useClipStore();
const settings = useSettingsStore();
const ai = useAiStore();
/** A subscribers-only VOD (Twitch refuses its video) or the example (there is none). */
const vod = useVodStore();
const locked = computed(() => vod.subOnly || vod.isExample);
const lockedWhy = computed(() =>
  vod.isExample ? t('example.clipLocked') : t('clip.subOnlyMessage'),
);
const {
  inSec,
  outSec,
  mode,
  aspect,
  cropCenterX,
  exporting,
  progress,
  error,
  clips,
  durationSec,
  canExport,
  captionsOn,
  captionStyle,
  captionsUppercase,
  captionCues,
  thumbTitle,
  thumbBusy,
  thumbProgress,
  thumbError,
  thumbnail,
  queue,
  queueRunning,
  queueDone,
  queueWaiting,
  preview,
  previewBusy,
  previewProgress,
  previewError,
  previewStale,
} = storeToRefs(store);

/** AI title for the current range, when "Explain" has run on exactly it. */
const aiTitle = computed(() => {
  const x = ai.explanation;
  return x && x.inSec === inSec.value && x.outSec === outSec.value && x.title ? x.title : '';
});

/** `render` says "Rendering" instead of "Cutting" (thumbnails and previews). */
function describe(p: CutProgress | null, render = false): string {
  if (!p) return '';
  const pct = p.ratio != null ? ` ${Math.round(p.ratio * 100)}%` : '';
  switch (p.stage) {
    case 'loading-ffmpeg':
      return t('clip.stageLoadingFfmpeg');
    case 'downloading':
      return t('clip.stageDownloading', { pct, detail: p.detail ?? '' });
    case 'cutting':
      return t(render ? 'clip.stageRendering' : 'clip.stageCutting', { pct });
    case 'done':
      return t('clip.stageDone');
    default:
      return '';
  }
}
const stageLabel = computed(() => describe(progress.value));
const thumbStageLabel = computed(() => describe(thumbProgress.value, true));
const previewStageLabel = computed(() => describe(previewProgress.value, true));

/** A handle frame: the storyboard frame at `sec`, else a silk placeholder for its position. */
function handleStyle(sec: number | null): Record<string, string> {
  const frac = sec != null && props.lengthSeconds ? sec / props.lengthSeconds : 0;
  const silk = silkAt(frac, false, 0);
  const frame = sec != null && props.storyboard ? frameBackground(props.storyboard, sec) : null;
  return frame ? { ...frame, '--c': silk } : { '--c': silk };
}
const overLimit = computed(() => durationSec.value > 600);
const durationLabel = computed(() => {
  const d = durationSec.value;
  if (!d) return '—';
  const m = Math.floor(d / 60);
  const sec = d - m * 60;
  return m ? `${m}:${sec.toFixed(0).padStart(2, '0')}` : t('clip.seconds', { s: sec.toFixed(1) });
});
const QUALITY = computed(() => [
  { v: 1080, l: t('clip.qualitySource') },
  { v: 720, l: '720p' },
  { v: 480, l: '480p' },
  { v: 360, l: '360p' },
]);
const MODES = computed(
  () =>
    [
      { v: 'fast', l: t('clip.modeFast'), t: t('clip.modeFastTip') },
      { v: 'precise', l: t('clip.modeExact'), t: t('clip.modeExactTip') },
    ] as const,
);
const ASPECTS = computed(
  () =>
    [
      { v: '16:9', l: '16:9', t: '' },
      { v: '9:16', l: '9:16', t: t('clip.aspectVerticalTip') },
      { v: 'split', l: t('clip.aspectSplit'), t: t('clip.aspectSplitTip') },
      { v: '1:1', l: '1:1', t: t('clip.aspectSquareTip') },
    ] as const,
);
/** Export presets: aspect + mode + quality (+ captions when there is a transcript). Labels are brand names. */
const PRESETS = [
  {
    id: 'tiktok',
    l: 'TikTok',
    tip: 'clip.presetTiktokTip',
    aspect: '9:16',
    mode: 'precise',
    height: 720,
    captions: true,
  },
  {
    id: 'shorts',
    l: 'Shorts',
    tip: 'clip.presetShortsTip',
    aspect: '9:16',
    mode: 'precise',
    height: 1080,
    captions: true,
  },
  {
    id: 'x',
    l: 'X / Discord',
    tip: 'clip.presetXTip',
    aspect: '16:9',
    mode: 'fast',
    height: 720,
    captions: false,
  },
  {
    id: 'square',
    l: 'Square',
    tip: 'clip.presetSquareTip',
    aspect: '1:1',
    mode: 'precise',
    height: 720,
    captions: false,
  },
] as const;
type Preset = (typeof PRESETS)[number];
const activePreset = computed(
  () =>
    PRESETS.find(
      (p) =>
        p.aspect === aspect.value &&
        p.mode === mode.value &&
        p.height === settings.preferredHeight &&
        (p.captions ? captionsOn.value || !captionCues.value.length : !captionsOn.value),
    )?.id ?? null,
);
function applyPreset(p: Preset) {
  aspect.value = p.aspect;
  mode.value = p.mode;
  settings.preferredHeight = p.height;
  captionsOn.value = p.captions && captionCues.value.length > 0;
}
const CAPTION_STYLES = computed(
  () =>
    [
      { v: 'bold', l: t('clip.captionBold') },
      { v: 'boxed', l: t('clip.captionBoxed') },
      { v: 'top', l: t('clip.captionTop') },
    ] as const,
);

/** The menus take `{ v, l, note }`; the pills' tooltips become the note. */
const MODE_OPTIONS = computed(() => MODES.value.map((m) => ({ v: m.v, l: m.l })));
const ASPECT_OPTIONS = computed(() =>
  ASPECTS.value.map((a) => ({ v: a.v, l: a.l, note: a.t || undefined })),
);
/** What each pill shows when its menu is shut: the current value, short. */
const qualityLabel = computed(
  () => QUALITY.value.find((q) => q.v === settings.preferredHeight)?.l ?? '—',
);
const modeLabel = computed(() => (mode.value === 'fast' ? t('clip.fast') : t('clip.exact')));
const aspectLabel = computed(() => ASPECTS.value.find((a) => a.v === aspect.value)?.l ?? '—');

function parseHms(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function onInField(e: Event) {
  const v = parseHms((e.target as HTMLInputElement).value);
  if (v != null) store.setIn(v);
}
function onOutField(e: Event) {
  const v = parseHms((e.target as HTMLInputElement).value);
  if (v != null) store.setOut(v);
}
const queuePct = computed(() => {
  const n = queue.value.length;
  if (!n) return 0;
  const running = queue.value.find((j) => j.status === 'running');
  const part = running?.progress?.ratio ?? 0;
  return Math.round(((queueDone.value + part * 0.98) / n) * 100);
});
/** Download every clip the queue produced, one after another (browsers need a small gap). */
async function downloadAll() {
  const ids = new Set(queue.value.filter((j) => j.status === 'done').map((j) => j.clipId));
  for (const c of clips.value.filter((c) => ids.has(c.id))) {
    download(
      c.url,
      `${c.vodId}_${Math.floor(c.inSec)}-${Math.floor(c.outSec)}_${c.aspect.replace(':', 'x')}.mp4`,
    );
    await new Promise((r) => setTimeout(r, 400));
  }
}
function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}
</script>

<template>
  <section class="glass flex flex-col gap-3 p-4">
    <div class="flex items-baseline justify-between">
      <h2 class="text-sm font-semibold">{{ t('clip.title') }}</h2>
      <span v-if="inSec != null" class="text-muted font-mono text-[11px]"
        >{{ formatHms(inSec) }} → {{ outSec != null ? formatHms(outSec) : '…' }}</span
      >
    </div>

    <div
      v-if="!settings.relayUrl"
      class="rounded-xl border border-warn/40 bg-butter/60 p-2 text-xs"
    >
      {{ t('clip.noRelay') }}
    </div>

    <!-- the strip: In frame · duration · Out frame -->
    <div
      class="grid grid-cols-[minmax(84px,112px)_minmax(0,1fr)_minmax(84px,112px)] items-center gap-2"
    >
      <div
        role="button"
        tabindex="0"
        class="handle relative aspect-video cursor-pointer overflow-hidden rounded-lg bg-black text-left"
        :class="{ empty: inSec == null }"
        :style="handleStyle(inSec)"
        :title="inSec != null ? t('clip.playFromIn') : t('clip.setInAtPlayhead')"
        @click="inSec != null ? emit('seek', inSec) : store.setIn(props.currentTime)"
        @keydown.enter="inSec != null ? emit('seek', inSec) : store.setIn(props.currentTime)"
      >
        <span class="tag">{{ t('clip.inTag') }}</span>
        <input
          class="time"
          :value="inSec != null ? formatHms(inSec) : ''"
          placeholder="h:mm:ss"
          :aria-label="t('clip.inLabel')"
          @click.stop
          @change="onInField"
        />
      </div>
      <div class="flex flex-col items-center text-center">
        <div
          class="font-display text-[20px] leading-none tabular-nums"
          :class="{ 'text-danger': overLimit }"
        >
          {{ durationLabel }}
        </div>
        <div class="silk my-1.5 h-1 w-full rounded-full" :class="{ over: overLimit }"></div>
        <div class="font-mono text-[10.5px]">
          <span v-if="overLimit" class="text-danger">{{ t('clip.overLimit') }}</span>
          <span v-else-if="inSec == null" class="text-muted">{{ t('clip.tapFrame') }}</span>
          <button v-else class="text-accent underline" @click="emit('seek', inSec)">
            {{ t('clip.playFromInLink') }}
          </button>
        </div>
      </div>
      <div
        role="button"
        tabindex="0"
        class="handle relative aspect-video cursor-pointer overflow-hidden rounded-lg bg-black text-left"
        :class="{ empty: outSec == null }"
        :style="handleStyle(outSec)"
        :title="outSec != null ? t('clip.playFromOut') : t('clip.setOutAtPlayhead')"
        @click="outSec != null ? emit('seek', outSec) : store.setOut(props.currentTime)"
        @keydown.enter="outSec != null ? emit('seek', outSec) : store.setOut(props.currentTime)"
      >
        <span class="tag">{{ t('clip.outTag') }}</span>
        <input
          class="time"
          :value="outSec != null ? formatHms(outSec) : ''"
          placeholder="h:mm:ss"
          :aria-label="t('clip.outLabel')"
          @click.stop
          @change="onOutField"
        />
      </div>
    </div>
    <div class="border-line border-t"></div>

    <!-- one line for every setting: preset pills, then a menu each (ADR-27). The panel used
         to spend five stacked rows on this and pushed Export below the fold. -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="seg" role="group" :aria-label="t('clip.preset')">
        <button
          v-for="pr in PRESETS"
          :key="pr.id"
          type="button"
          class="seg-opt"
          :aria-pressed="activePreset === pr.id"
          :title="t(pr.tip)"
          @click="applyPreset(pr)"
        >
          {{ pr.l }}
        </button>
      </span>
      <MenuButton
        :label="t('clip.sizeLabel')"
        :value="qualityLabel"
        :options="QUALITY"
        :model-value="settings.preferredHeight"
        data-testid="pick-quality"
        @update:model-value="settings.preferredHeight = Number($event)"
      />
      <MenuButton
        :label="t('clip.cutLabel')"
        :value="modeLabel"
        :options="MODE_OPTIONS"
        :model-value="mode"
        data-testid="pick-mode"
        @update:model-value="mode = $event as CutMode"
      />
      <MenuButton
        :label="t('clip.shapeLabel')"
        :value="aspectLabel"
        :options="ASPECT_OPTIONS"
        :model-value="aspect"
        data-testid="pick-aspect"
        @update:model-value="aspect = $event as Aspect"
      >
        <!-- the crop sliders belong to the shape that needs them, so the row never grows -->
        <label v-if="aspect === 'split'" class="flex items-center gap-2 text-xs">
          <span class="text-muted">{{ t('clip.camStrip') }}</span>
          <input
            v-model.number="store.split.camShare"
            type="range"
            min="0.25"
            max="0.5"
            step="0.01"
            class="flex-1"
          />
          <span class="font-mono">{{ Math.round(store.split.camShare * 100) }}%</span>
        </label>
        <label
          v-else-if="aspect === '9:16' || aspect === '1:1'"
          class="flex items-center gap-2 text-xs"
        >
          <span class="text-muted">{{ t('clip.cropCentre') }}</span>
          <input
            v-model.number="cropCenterX"
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="flex-1"
          />
          <span class="font-mono">{{ Math.round(cropCenterX * 100) }}%</span>
        </label>
      </MenuButton>
      <MenuButton
        :label="t('clip.capsLabel')"
        :value="captionsOn ? t('clip.captionsOn') : t('clip.captionsOff')"
        :title="captionCues.length ? undefined : t('clip.transcribeFirstTip')"
        data-testid="pick-captions"
      >
        <div class="flex flex-col gap-2 text-xs">
          <label class="flex items-center gap-2">
            <input v-model="captionsOn" type="checkbox" :disabled="!captionCues.length" />
            {{ t('clip.captions') }}
          </label>
          <p class="text-muted">
            {{
              captionCues.length
                ? t('clip.cuesReencode', { n: captionCues.length })
                : t('clip.transcribeFirst')
            }}
          </p>
          <template v-if="captionsOn && captionCues.length">
            <span class="seg self-start" role="group" :aria-label="t('clip.captionStyle')">
              <button
                v-for="c in CAPTION_STYLES"
                :key="c.v"
                type="button"
                class="seg-opt"
                :aria-pressed="captionStyle === c.v"
                @click="captionStyle = c.v"
              >
                {{ c.l }}
              </button>
            </span>
            <label class="flex items-center gap-2"
              ><input v-model="captionsUppercase" type="checkbox" /> {{ t('clip.uppercase') }}</label
            >
            <p class="text-muted">{{ t('clip.timingNote') }}</p>
          </template>
        </div>
      </MenuButton>
      <MenuButton
        :label="t('clip.thumbLabel')"
        :value="thumbnail || thumbTitle ? t('clip.thumbSet') : t('clip.thumbNone')"
        wide
        data-testid="pick-thumbnail"
      >
        <template #default="{ close }">
          <div class="flex flex-col gap-2 text-xs">
            <input
              v-model="thumbTitle"
              class="field py-1!"
              :placeholder="t('clip.thumbTitlePlaceholder')"
              maxlength="80"
            />
            <button
              v-if="aiTitle && aiTitle !== thumbTitle"
              class="text-accent self-start underline"
              @click="thumbTitle = aiTitle"
            >
              {{ t('clip.useAiTitle') }}
            </button>
            <div class="flex flex-wrap gap-2">
              <button
                v-if="inSec != null"
                class="btn-ghost px-2.5! py-1! text-xs"
                :disabled="thumbBusy || !settings.relayUrl || locked"
                @click="
                  store.grabThumbnailAt(props.vodId, inSec);
                  close();
                "
              >
                {{ t('clip.useInFrame') }}
              </button>
              <button
                class="btn-ghost px-2.5! py-1! text-xs"
                :disabled="thumbBusy || !settings.relayUrl || locked"
                @click="
                  store.grabThumbnailAt(props.vodId, props.currentTime);
                  close();
                "
              >
                {{ t('clip.grabAtPlayhead') }}
              </button>
            </div>
          </div>
        </template>
      </MenuButton>
      <span v-if="thumbBusy" class="text-muted text-xs">{{ thumbStageLabel }}</span>
    </div>
    <p
      v-if="thumbError"
      class="rounded-xl border border-danger/40 bg-petal/60 p-2 text-xs text-danger"
    >
      {{ thumbError }}
    </p>
    <div v-if="thumbnail" class="flex flex-col gap-1 text-xs">
      <img
        :src="thumbnail.url"
        :alt="t('clip.thumbnailAlt')"
        class="max-h-64 w-auto self-start rounded-lg bg-black"
        data-testid="thumbnail"
      />
      <div class="flex flex-wrap items-center gap-3">
        <span class="font-mono">{{ formatHms(thumbnail.atSec) }}</span>
        <span class="text-muted"
          >{{ thumbnail.width }}×{{ thumbnail.height }} · {{ aspect
          }}{{ thumbnail.title ? ` · ${t('clip.titled')}` : '' }} ·
          {{ t('clip.kb', { n: (thumbnail.blob.size / 1024).toFixed(0) }) }}</span
        >
        <button
          class="text-accent underline"
          @click="
            download(
              thumbnail.url,
              `${props.vodId}_${Math.floor(thumbnail.atSec)}_${aspect.replace(':', 'x')}_thumb.png`,
            )
          "
        >
          {{ t('clip.downloadPng') }}
        </button>
      </div>
    </div>

    <!-- preview: the first seconds of the range, small, with the real framing -->
    <div v-if="preview" class="flex flex-col gap-1.5">
      <div class="relative self-start overflow-hidden rounded-lg bg-black">
        <video
          :src="preview.url"
          controls
          autoplay
          muted
          loop
          playsinline
          class="block h-56 w-auto bg-black"
          :class="[
            { 'opacity-60': previewStale },
            preview.aspect === '16:9'
              ? 'aspect-video'
              : preview.aspect === '1:1'
                ? 'aspect-square'
                : 'aspect-[9/16]',
          ]"
          data-testid="preview"
        ></video>
        <button
          class="glass-sm absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center text-[14px] leading-none"
          :aria-label="t('clip.closePreview')"
          @click="store.clearPreview()"
        >
          ×
        </button>
      </div>
      <div class="text-muted font-mono text-[10.5px]">
        {{ t('clip.previewLabel') }} · {{ formatHms(preview.inSec) }} →
        {{ formatHms(preview.outSec) }} · {{ preview.variant }} · {{ preview.aspect }}
        <template v-if="previewStale"
          >· <span class="text-warn">{{ t('clip.settingsChanged') }}</span>
          <button class="text-accent underline" @click="store.previewClip(props.vodId)">
            {{ t('clip.previewAgainLink') }}
          </button></template
        >
      </div>
    </div>
    <p
      v-if="previewError"
      class="rounded-xl border border-danger/40 bg-petal/60 p-2 text-xs text-danger"
    >
      {{ previewError }}
    </p>

    <!-- export -->
    <div class="flex flex-wrap items-center gap-3">
      <button
        class="btn-silk"
        :disabled="!canExport || !settings.relayUrl || locked"
        :title="locked ? t('clip.subOnlyTip') : undefined"
        @click="store.exportClip(props.vodId)"
      >
        {{ t('clip.exportClip') }}
      </button>
      <button
        class="btn-ghost text-xs"
        :disabled="inSec == null || outSec == null || previewBusy || !settings.relayUrl || locked"
        :title="
          locked
            ? t('clip.subOnlyTip')
            : settings.relayUrl
              ? t('clip.previewTip')
              : t('clip.relayNotConfigured')
        "
        @click="store.previewClip(props.vodId)"
      >
        {{
          previewBusy
            ? previewStageLabel || t('clip.rendering')
            : preview
              ? t('clip.previewAgain')
              : t('clip.preview')
        }}
      </button>
      <button
        class="btn-ghost text-xs"
        :disabled="inSec == null || outSec == null || overLimit || locked"
        :title="t('clip.queueTip')"
        @click="store.enqueueCurrent()"
      >
        {{ t('clip.addToQueue') }}
      </button>
      <button v-if="exporting" class="btn-ghost text-xs" @click="store.cancel()">
        {{ t('common.cancel') }}
      </button>
      <span v-if="exporting" class="text-muted text-xs">{{ stageLabel }}</span>
      <span v-else-if="locked" class="text-warn text-xs" data-testid="clip-locked">{{
        lockedWhy
      }}</span>
      <span v-else-if="overLimit" class="text-xs text-danger">{{ t('clip.maxTenMinutes') }}</span>
    </div>
    <div v-if="exporting && progress?.ratio != null" class="h-1 w-full rounded-full bg-ink/10">
      <div
        class="h-1 rounded-full bg-ink"
        :style="{ width: Math.round(progress.ratio * 100) + '%' }"
      ></div>
    </div>
    <p v-if="error" class="rounded-xl border border-danger/40 bg-petal/60 p-2 text-xs text-danger">
      {{ error }}
    </p>

    <!-- the queue: several ranges, one run -->
    <div v-if="queue.length" class="border-line flex flex-col gap-1.5 border-t pt-2 text-xs">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="eyebrow">{{ t('clip.queue') }} · {{ queueDone }} / {{ queue.length }}</span>
        <div class="flex items-center gap-2">
          <button
            v-if="queueWaiting && !queueRunning"
            class="btn-silk px-3! py-1! text-xs"
            :disabled="exporting || !settings.relayUrl"
            @click="store.runQueue(props.vodId)"
          >
            {{ t('clip.exportNClips', queueWaiting) }}
          </button>
          <button v-if="queueRunning" class="btn-ghost px-3! py-1! text-xs" @click="store.cancel()">
            {{ t('clip.stop') }}
          </button>
          <button v-if="queueDone" class="text-accent underline" @click="downloadAll()">
            {{ t('clip.downloadAll') }}
          </button>
          <button v-if="queueDone" class="text-muted underline" @click="store.clearQueueDone()">
            {{ t('clip.clearDone') }}
          </button>
        </div>
      </div>
      <div v-if="queueRunning" class="h-1 w-full rounded-full bg-ink/10">
        <div
          class="h-1 rounded-full bg-ink transition-[width]"
          :style="{ width: queuePct + '%' }"
        ></div>
      </div>
      <ol class="flex flex-col gap-0.5">
        <li
          v-for="j in queue"
          :key="j.id"
          class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 font-mono text-[11px]"
        >
          <span>{{ formatHms(j.spec.inSec) }} → {{ formatHms(j.spec.outSec) }}</span>
          <span class="text-muted truncate">
            {{ j.spec.aspect }} · {{ j.spec.mode === 'fast' ? t('clip.fast') : t('clip.exact') }}
            <template v-if="j.status === 'running'"> · {{ describe(j.progress) }}</template>
            <template v-else-if="j.status === 'failed'">
              · <span class="text-danger">{{ j.error }}</span></template
            >
            <template v-else-if="j.status === 'done'"> · {{ t('clip.done') }}</template>
          </span>
          <button
            v-if="j.status !== 'running'"
            class="purge grid h-5 w-5 place-items-center rounded-full text-[13px] leading-none"
            :aria-label="j.status === 'done' ? t('clip.removeFromList') : t('clip.removeFromQueue')"
            @click="store.dequeue(j.id)"
          >
            ×
          </button>
          <span v-else class="w-5"></span>
        </li>
      </ol>
    </div>

    <!-- exported clips -->
    <ul v-if="clips.length" class="flex flex-col gap-3">
      <li
        v-for="c in clips"
        :key="c.id"
        class="border-line flex flex-col gap-1 border-t pt-2 text-xs"
      >
        <video
          :src="c.url"
          controls
          preload="metadata"
          class="max-h-64 w-full rounded-lg bg-black"
          :class="{ 'max-w-xs': c.aspect === '9:16' || c.aspect === 'split' }"
        ></video>
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-mono">{{ formatHms(c.inSec) }} → {{ formatHms(c.outSec) }}</span>
          <span class="text-muted"
            >{{ c.variant }} · {{ c.mode }} · {{ c.aspect
            }}{{ c.captions ? ` · ${t('clip.captionsTag')}` : '' }} ·
            {{ t('clip.mb', { n: (c.bytes / 1048576).toFixed(1) }) }}</span
          >
          <button
            class="text-accent underline"
            @click="
              download(
                c.url,
                `${c.vodId}_${Math.floor(c.inSec)}-${Math.floor(c.outSec)}_${c.aspect.replace(':', 'x')}.mp4`,
              )
            "
          >
            {{ t('common.download') }}
          </button>
          <button class="text-muted underline" @click="store.removeClip(c.id)">
            {{ t('common.remove') }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
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
/* a handle: the frame (or silk) with a dark foot for the time */
.handle {
  background-color: #16121a;
  background-image: linear-gradient(135deg, var(--c), #16121a 75%);
  background-size: cover;
  background-position: center;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition: transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.handle[style*='background-image: url'] {
  background-image: none;
}
.handle::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(22, 18, 26, 0) 40%, rgba(22, 18, 26, 0.8));
}
.handle::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--c);
}
.handle:hover {
  transform: translateY(-2px);
}
.handle.empty {
  background-image: none;
  background-color: color-mix(in srgb, var(--color-ink) 8%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-line);
}
.handle.empty::before,
.handle.empty::after {
  display: none;
}
.handle.empty .time {
  color: var(--color-muted);
}
.tag {
  position: absolute;
  top: 4px;
  right: 6px;
  font: 500 9px var(--font-mono);
  letter-spacing: 0.12em;
  color: rgba(243, 237, 246, 0.75);
}
.handle.empty .tag {
  color: var(--color-muted);
}
.time {
  position: absolute;
  left: 6px;
  bottom: 4px;
  width: calc(100% - 12px);
  background: none;
  border: 0;
  padding: 0;
  font: 700 11.5px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: #f3edf6;
  outline: none;
}
.time:focus {
  text-decoration: underline;
}
.silk {
  background: linear-gradient(90deg, #8eb0ff, #ae81ff, #ff77b5, #ffa968, #ffde68);
  opacity: 0.9;
}
.silk.over {
  background: var(--color-danger);
}
@media (prefers-reduced-motion: reduce) {
  .handle {
    transition: none;
  }
}
</style>
