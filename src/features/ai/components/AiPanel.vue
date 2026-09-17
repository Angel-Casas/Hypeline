<script setup lang="ts">
/**
 * The AI box as an "Instrument" (design/dashboard/hypeline-ai-panel.html #7, Angel
 * 2026-09-15): mono readouts in rows — range, chat model, speech model, transcript coverage,
 * wallet — a status line with an LED and a silk progress, two run buttons for the current
 * range (transcribe, explain), the results, and the whole-VOD transcript search underneath.
 * Without a key the box is a pastel card that points to Settings (the key lives there).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useAiStore } from '../stores/aiStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useClipStore } from '@/features/clips/stores/clipStore';
import { useVodStore } from '@/features/vod/stores/vodStore';
import { formatUsd, STT_PRICE_PER_MIN } from '@/lib/nanogpt/pricing';
import { REFERRAL_URL } from '@/lib/nanogpt/client';
import { formatHms } from '@/lib/twitch/vodUrl';
import type { ChatMessage } from '@/lib/twitch/types';

const props = defineProps<{
  vodId: string;
  streamer: string;
  game: string | null;
  messages: ChatMessage[];
  lengthSeconds: number;
}>();
const emit = defineEmits<{ seek: [sec: number]; clip: [sec: number]; settings: [] }>();
const { t } = useI18n();
const ai = useAiStore();
const settings = useSettingsStore();
const clipStore = useClipStore();
/** The example VOD has no video and a made-up chat: nothing here should cost money. */
const example = computed(() => useVodStore().isExample);
const {
  models,
  balanceUsd,
  busy,
  progress,
  error,
  transcript,
  explanation,
  spentUsd,
  hasKey,
  transcribeEstimate,
  bulkChunks,
  bulk,
  searchHits,
  lastQuery,
  aiMoments,
} = storeToRefs(ai);
const { inSec, outSec, durationSec } = storeToRefs(clipStore);

// --- the range ---
const hasRange = computed(
  () => inSec.value != null && outSec.value != null && durationSec.value > 0,
);
const explainEst = computed(() =>
  hasRange.value
    ? ai.explainEstimate(ai.chatExcerptFor(props.messages, inSec.value!, outSec.value!))
    : 0,
);
const transcriptMatches = computed(
  () =>
    !!transcript.value &&
    transcript.value.inSec === inSec.value &&
    transcript.value.outSec === outSec.value,
);
const explanationMatches = computed(
  () =>
    !!explanation.value &&
    explanation.value.inSec === inSec.value &&
    explanation.value.outSec === outSec.value,
);
const rangeState = computed(() => {
  if (!hasRange.value) return t('ai.noRange');
  return transcriptMatches.value ? t('ai.transcribed') : t('ai.chatOnly');
});

// --- models ---
const chatModel = computed(() => models.value.find((m) => m.id === settings.chatModel));
const sttPrice = computed(() => STT_PRICE_PER_MIN[settings.sttModel]);

// --- status ---
const stage = computed(() => {
  const p = progress.value;
  if (busy.value === 'bulk' && bulk.value)
    return t('ai.stageBulk', {
      done: bulk.value.done,
      total: bulk.value.total,
      cost: formatUsd(bulk.value.costUsd),
    });
  if (busy.value === 'searching') return t('ai.stageSearching');
  if (!p) return busy.value === 'idle' ? t('ai.stageReady') : t('ai.stageWorking');
  const pct = 'ratio' in p && p.ratio != null ? Math.round(p.ratio * 100) : null;
  switch (p.stage) {
    case 'loading-ffmpeg':
      return t('ai.stageLoadingFfmpeg');
    case 'downloading':
      return pct == null ? t('ai.stageDownloading') : t('ai.stageDownloadingPct', { pct });
    case 'extracting':
      return t('ai.stageExtracting');
    case 'uploading':
      return t('ai.stageUploading');
    case 'thinking':
      return t('ai.stageThinking');
    default:
      return t('ai.stageWorking');
  }
});
const ratio = computed(() => {
  if (busy.value === 'bulk' && bulk.value?.total) return bulk.value.done / bulk.value.total;
  const p = progress.value;
  return p && 'ratio' in p && p.ratio != null ? p.ratio : null;
});

// --- whole VOD: coverage, bulk transcription, search ---
const coveredSec = computed(() =>
  bulkChunks.value.reduce((s, c) => s + (c.endSec - c.startSec), 0),
);
/** Covered stretches as [left%, width%] for the coverage bar. */
const coverSpans = computed(() =>
  props.lengthSeconds
    ? bulkChunks.value.map((c) => [
        (c.startSec / props.lengthSeconds) * 100,
        ((c.endSec - c.startSec) / props.lengthSeconds) * 100,
      ])
    : [],
);
const fromField = ref('0:00:00');
const toField = ref('');
function parseHms(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(s.trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
const bulkRange = computed(() => {
  const a = parseHms(fromField.value) ?? 0;
  const b = toField.value ? (parseHms(toField.value) ?? props.lengthSeconds) : props.lengthSeconds;
  return {
    from: Math.max(0, Math.min(a, props.lengthSeconds)),
    to: Math.max(0, Math.min(b, props.lengthSeconds)),
  };
});
const bulkEst = computed(() => ai.bulkEstimate(bulkRange.value.from, bulkRange.value.to));
const query = ref('');
const searchEst = computed(() => ai.searchEstimate(query.value));

/** Title + hook to the clipboard, ready for the upload form. */
const copied = ref(false);
async function copyTitleHook() {
  const x = explanation.value;
  if (!x) return;
  try {
    await navigator.clipboard.writeText(`${x.title}\n\n${x.hook}`);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard refused (insecure context) — nothing to do */
  }
}

onMounted(() => {
  if (hasKey.value && !models.value.length) void ai.refreshModels();
});
watch(
  () => settings.aiApiKey,
  () => {
    if (hasKey.value) void ai.refreshModels();
  },
);
</script>

<template>
  <!-- no key: a pastel card pointing to Settings -->
  <section
    v-if="!hasKey"
    class="nokey flex flex-col gap-1.5 rounded-2xl px-5 py-5"
    data-testid="ai-nokey"
  >
    <div class="eyebrow text-ink-2!">{{ t('ai.off') }}</div>
    <h2 class="font-display text-[20px] leading-[1.1]">{{ t('ai.byokTitle') }}</h2>
    <i18n-t keypath="ai.byokBody" tag="p" class="text-ink-2 text-[12.5px]">
      <template #settings>
        <button
          class="text-ink font-semibold underline"
          :aria-label="t('ai.openSettings')"
          @click="emit('settings')"
        >
          {{ t('common.settings') }}
        </button>
      </template>
    </i18n-t>
    <a
      :href="REFERRAL_URL"
      target="_blank"
      rel="noopener"
      class="text-ink-2 mt-0.5 self-start font-mono text-[10.5px] underline decoration-dotted"
      >{{ t('settings.referralNote') }} ↗</a
    >
  </section>

  <section v-else class="instrument glass flex flex-col gap-2 p-4 text-sm">
    <div class="flex items-baseline justify-between">
      <h2 class="text-sm font-semibold">{{ t('ai.title') }}</h2>
      <span class="text-muted font-mono text-[10.5px]">{{ t('ai.yourKey') }}</span>
    </div>

    <!-- readouts -->
    <div class="dials font-mono text-[11.5px]">
      <div class="dial">
        <span class="k">{{ t('ai.range') }}</span>
        <span v-if="hasRange"
          >{{ formatHms(inSec!) }} → {{ formatHms(outSec!) }} · {{ durationSec.toFixed(0) }} s</span
        >
        <span v-else class="text-muted">{{ t('ai.rangeHint') }}</span>
        <span class="text-muted">{{ rangeState }}</span>
      </div>
      <div class="dial">
        <span class="k">{{ t('ai.chatModel') }}</span>
        <select v-model="settings.chatModel" class="pick" :aria-label="t('ai.chatModel')">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <span class="text-muted">
          <template v-if="chatModel?.promptPerM != null">{{
            t('ai.perM', {
              prompt: '$' + chatModel.promptPerM,
              completion: '$' + chatModel.completionPerM,
            })
          }}</template>
          <button v-else class="underline" :disabled="busy !== 'idle'" @click="ai.refreshModels()">
            {{ t('ai.loadModels') }}
          </button>
        </span>
      </div>
      <div class="dial">
        <span class="k">{{ t('ai.speech') }}</span>
        <select v-model="settings.sttModel" class="pick" :aria-label="t('ai.transcriptionModel')">
          <option v-for="id in Object.keys(STT_PRICE_PER_MIN)" :key="id" :value="id">
            {{ id }}
          </option>
        </select>
        <span class="text-muted">{{ t('ai.perMin', { price: '$' + sttPrice }) }}</span>
      </div>
      <div class="dial">
        <span class="k">{{ t('ai.coverage') }}</span>
        <span class="cover" :title="t('ai.coverageTitle', { n: bulkChunks.length })">
          <i
            v-for="(c, i) in coverSpans"
            :key="i"
            :style="{ left: c[0] + '%', width: c[1] + '%' }"
          ></i>
        </span>
        <span class="text-muted">{{ formatHms(coveredSec) }} / {{ formatHms(lengthSeconds) }}</span>
      </div>
      <div class="dial last">
        <span class="k">{{ t('ai.wallet') }}</span>
        <span>{{ balanceUsd != null ? '$' + balanceUsd.toFixed(2) : '—' }}</span>
        <span class="text-muted">{{ t('ai.spentHere', { cost: formatUsd(spentUsd) }) }}</span>
      </div>
    </div>

    <!-- status line -->
    <div class="text-muted flex items-center gap-2.5 font-mono text-[11px]">
      <span class="led" :class="{ on: busy !== 'idle' }" aria-hidden="true"></span>
      <span class="truncate">{{ stage }}</span>
      <span class="progress ml-auto w-24 shrink-0" :class="{ live: busy !== 'idle' }">
        <i
          :style="{
            width: (ratio != null ? Math.round(ratio * 100) : busy !== 'idle' ? 100 : 0) + '%',
          }"
        ></i>
      </span>
    </div>

    <p v-if="example" class="text-warn text-xs" data-testid="ai-example">
      {{ t('example.aiLocked') }}
    </p>
    <!-- run -->
    <div class="grid grid-cols-2 gap-1.5">
      <button
        class="btn-silk justify-center text-xs"
        :disabled="!hasRange || busy !== 'idle' || !settings.relayUrl || example"
        :title="settings.relayUrl ? '' : t('ai.relayNotConfigured')"
        @click="ai.transcribeRange(props.vodId)"
      >
        {{ t('ai.transcribe') }}
        <span class="cost">{{ hasRange ? formatUsd(transcribeEstimate) : '' }}</span>
      </button>
      <button
        class="btn-silk justify-center text-xs"
        :disabled="!hasRange || busy !== 'idle' || !settings.chatModel || example"
        :title="transcriptMatches ? '' : t('ai.chatOnlyHint')"
        @click="
          ai.explainRange(
            props.vodId,
            { streamer: props.streamer, game: props.game },
            props.messages,
          )
        "
      >
        {{ t('ai.explain') }}
        <span class="cost">{{ hasRange ? formatUsd(explainEst) : '' }}</span>
      </button>
    </div>

    <p v-if="error" class="rounded-xl border border-danger/40 bg-petal/60 p-2 text-xs text-danger">
      {{ error }}
    </p>

    <!-- results -->
    <div v-if="transcript && transcriptMatches" class="result">
      <div class="meta">
        {{ t('ai.transcriptLabel') }} · {{ transcript.model }} ·
        {{ transcript.costUsd != null ? formatUsd(transcript.costUsd) : t('ai.na') }}
      </div>
      <p class="text-ink-2 max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap">
        {{ transcript.text }}
      </p>
    </div>
    <div v-if="explanation && explanationMatches" class="result">
      <div class="meta">
        {{ explanation.model }} ·
        {{ explanation.costUsd != null ? formatUsd(explanation.costUsd) : t('ai.na') }} ·
        {{ t('ai.clipWorthiness') }}
        <span class="stars" :title="`${explanation.clipWorthiness}/5`">
          <i v-for="n in 5" :key="n" :class="{ on: n <= explanation.clipWorthiness }"></i>
        </span>
      </div>
      <div class="font-display text-[19px] leading-[1.1]">{{ explanation.title }}</div>
      <div class="text-ink-2 text-[13px]">{{ explanation.hook }}</div>
      <div class="text-muted text-xs">{{ explanation.why }}</div>
      <div class="text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px]">
        <span class="whitespace-nowrap">{{
          t('ai.suggested', {
            in: explanation.suggestedInOffset.toFixed(0),
            out: explanation.suggestedOutOffset.toFixed(0),
          })
        }}</span>
        <button class="text-accent underline" @click="ai.applySuggestedRange()">
          {{ t('ai.applyToInOut') }}
        </button>
        <button class="text-accent underline" @click="copyTitleHook()">
          {{ copied ? t('ai.copied') : t('ai.copyTitleHook') }}
        </button>
      </div>
    </div>

    <!-- whole VOD: search -->
    <div class="border-line border-t pt-2">
      <form class="flex items-center gap-1.5" @submit.prevent="ai.searchVod(query, props.streamer)">
        <input
          v-model="query"
          type="text"
          :placeholder="t('ai.searchPlaceholder')"
          class="field min-w-0 flex-1 py-1!"
          :aria-label="t('ai.searchAria')"
          :disabled="!bulkChunks.length"
        />
        <button
          type="submit"
          class="btn-silk px-3! py-1! text-xs"
          :disabled="
            busy !== 'idle' || !bulkChunks.length || !query.trim() || !settings.chatModel || example
          "
        >
          {{ t('ai.search') }}
          <span class="cost">{{ query.trim() ? formatUsd(searchEst.usd) : '' }}</span>
        </button>
      </form>
      <div
        class="text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px]"
      >
        <span v-if="!bulkChunks.length">{{ t('ai.nothingTranscribed') }}</span>
        <span v-else-if="searchEst.truncated" class="text-warn">{{ t('ai.longVod') }}</span>
        <button v-if="busy === 'bulk'" class="underline" @click="ai.cancelBulk()">
          {{ t('ai.cancel') }}
        </button>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <input
          v-model="fromField"
          class="field w-20 py-1! font-mono"
          placeholder="h:mm:ss"
          :aria-label="t('ai.from')"
        />
        <span class="text-muted">→</span>
        <input
          v-model="toField"
          class="field w-20 py-1! font-mono"
          :placeholder="t('ai.endPlaceholder')"
          :aria-label="t('ai.to')"
        />
        <button
          class="btn-silk flex w-full flex-col items-center gap-0 py-2! text-xs"
          :disabled="busy !== 'idle' || !settings.relayUrl || bulkEst.chunks === 0 || example"
          :title="settings.relayUrl ? '' : t('ai.relayNotConfigured')"
          @click="ai.transcribeBulk(props.vodId, bulkRange.from, bulkRange.to)"
        >
          <span>{{ toField ? t('ai.transcribeVodRange') : t('ai.transcribeVodToEnd') }}</span>
          <span class="cost silk-cost"
            >{{ t('ai.chunks', bulkEst.chunks) }} · {{ formatUsd(bulkEst.usd) }} ·
            {{ bulkEst.downloadMb.toFixed(0) }} MB<template v-if="bulkEst.cached">
              · {{ t('ai.cachedCount', { n: bulkEst.cached }) }}</template
            ></span
          >
        </button>
      </div>
      <p v-if="aiMoments.length" class="text-muted mt-1 font-mono text-[10.5px]">
        <span class="text-accent">{{ t('ai.title') }}</span> ·
        {{ t('ai.hitsPinned', aiMoments.length) }} ·
        <button class="underline" @click="ai.clearAiMoments()">{{ t('ai.clear') }}</button>
      </p>
      <ol v-if="searchHits.length" class="mt-1 flex flex-col">
        <li
          v-for="h in searchHits"
          :key="h.t + h.quote"
          class="hit border-line grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 border-t border-dotted py-1.5 text-xs"
        >
          <button class="text-accent font-mono underline" @click="emit('seek', h.t)">
            {{ formatHms(h.t) }}
          </button>
          <span>
            <span class="text-ink">{{ t('ai.quoted', { quote: h.quote }) }}</span>
            <span class="text-muted"> — {{ h.why }} · {{ h.confidence }}/5</span>
          </span>
          <button class="text-accent underline" @click="emit('clip', h.t + 15)">
            {{ t('ai.clipThis') }}
          </button>
        </li>
      </ol>
      <p v-else-if="lastQuery && busy === 'idle'" class="text-muted mt-1 text-xs">
        {{ t('ai.noHits', { query: lastQuery }) }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.nokey {
  background: linear-gradient(135deg, var(--color-sky), var(--color-lilac));
  color: var(--color-ink);
}
.dials {
  display: flex;
  flex-direction: column;
}
.dial {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--color-line);
  min-height: 30px;
}
.dial.last {
  border-bottom: 0;
}
.dial .k {
  color: var(--color-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 10px;
}
.dial > :nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dial > :nth-child(3) {
  white-space: nowrap;
  font-size: 10.5px;
}
/* a narrow column (the desk's AI column, a phone): the note drops under the value */
.instrument {
  container-type: inline-size;
}
@container (max-width: 379px) {
  .dial {
    grid-template-columns: 82px minmax(0, 1fr);
    row-gap: 1px;
  }
  .dial > :nth-child(3) {
    grid-column: 2;
    white-space: normal;
  }
}
/* a picker that reads like a readout until you open it */
.pick {
  appearance: none;
  background: none;
  border: 0;
  padding: 0 14px 0 0;
  font: inherit;
  color: var(--color-ink);
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--color-muted) 50%),
    linear-gradient(135deg, var(--color-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 8px) 55%,
    calc(100% - 4px) 55%;
  background-size: 4px 4px;
  background-repeat: no-repeat;
}
.cover {
  position: relative;
  display: block;
  height: 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-ink) 8%, transparent);
  overflow: hidden;
}
.cover i {
  position: absolute;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, #ae81ff, #ff77b5);
}
.led {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-ink) 25%, transparent);
  flex-shrink: 0;
}
.led.on {
  background: #ffa968;
  box-shadow: 0 0 8px #ffa968;
  animation: led-blink 1.2s ease-in-out infinite;
}
@keyframes led-blink {
  50% {
    opacity: 0.45;
  }
}
.progress {
  height: 3px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-ink) 12%, transparent);
  position: relative;
  overflow: hidden;
}
.progress i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  background: linear-gradient(90deg, #8eb0ff, #ae81ff, #ff77b5, #ffa968, #ffde68);
  transition: width 0.3s;
}
.progress.live i {
  animation: sheen 1.6s linear infinite;
  background-size: 200% 100%;
}
@keyframes sheen {
  to {
    background-position: -200% 0;
  }
}
.cost {
  font: 500 10.5px var(--font-mono);
  opacity: 0.7;
  margin-left: 4px;
}
.btn-silk .cost {
  color: #3b3444;
  opacity: 0.85;
}
.silk-cost {
  margin-left: 0;
}
.result {
  padding: 8px 10px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-lift) 45%, transparent);
  border: 1px solid var(--glass-line);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.result .meta {
  font: 10.5px var(--font-mono);
  color: var(--color-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.stars {
  display: inline-flex;
  gap: 3px;
  vertical-align: middle;
}
.stars i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-ink) 15%, transparent);
}
.stars i.on {
  background: linear-gradient(135deg, #ae81ff, #ff77b5);
}
@media (prefers-reduced-motion: reduce) {
  .led.on,
  .progress.live i {
    animation: none;
  }
}
</style>
