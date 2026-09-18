<script setup lang="ts">
/**
 * "What this chat means" (ADR-29) — the one screen where a user teaches Hypeline their
 * community's words. Two lists: **important** (several different people saying one of these
 * inside a bucket marks it strongly) and **reactions** (the ordinary noise, counted as a share
 * of a busy bucket). No weights: a word is in a list or it is not, so nobody can flatten their
 * own heatmap.
 *
 * Nothing here fetches. "Seen in this VOD" is the chat replay we already have, counted by
 * distinct people, and changing a list re-scores the same messages in place — which is why the
 * before/after strip at the bottom is affordable.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useVodStore } from '@/features/vod/stores/vodStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useVocabStore } from '../vocabStore';
import { LOCALES } from '@/i18n';
import {
  analyse,
  dropBotsAndAnnouncements,
  NO_VOCAB,
  sensitivityToOptions,
  type Bucket,
} from '../scoring';
import {
  detectPacks,
  packsToEnable,
  PACKS,
  seenTokens,
  topTokens,
  type ListKind,
} from '../vocabulary';

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const vod = useVodStore();
const settings = useSettingsStore();
const vocab = useVocabStore();
const { messages, moments, buckets, info } = storeToRefs(vod);

const scope = ref<'global' | 'channel'>('global');
const channel = computed(() => info.value?.ownerLogin ?? null);
const KINDS: ListKind[] = ['important', 'reaction'];

/** Bot-filtered once: both the token list and the baseline below want the same messages. */
const clean = computed(() => dropBotsAndAnnouncements(messages.value));
const seen = computed(() => seenTokens(clean.value));
/** The companion list: what this chat says most, rather than what a crowd said at once. */
const most = computed(() => topTokens(clean.value));
/** Each chip wears a different slice of the one silk gradient, so a row of them reads as a set. */
function slice(i: number): Record<string, string> {
  return { '--silk-a': ((i * 47) % 360) + 'deg' };
}
function inList(kind: ListKind, token: string): boolean {
  return mine(kind).some((w) => w.toLowerCase() === token.toLowerCase());
}
const columns = computed(() => [
  { key: 'seen' as const, rows: seen.value, unit: t('vocab.seen.atOnce') },
  { key: 'most' as const, rows: most.value, unit: t('vocab.most.uses') },
]);
const counts = ref<Record<string, number>>({});
const packs = computed(() =>
  PACKS.map((p) => ({
    ...p,
    name: LOCALES.find((l) => l.code === p.locale)?.native ?? p.id,
    users: counts.value[p.id] ?? 0,
    on: vocab.state.packs.includes(p.id),
  })),
);

/** The shipped English words, shown so they can be argued with. */
const DEFAULT_WORDS: Record<ListKind, string[]> = {
  important: ['clip', 'clip it', 'clip that', 'clipped', 'someone clip'],
  reaction: ['lol', 'lmao', 'kekw', 'omegalul', 'pog', 'poggers', 'gg', 'wtf', 'bruh', 'monkas'],
};
function packWords(kind: ListKind): { word: string; pack: string }[] {
  return packs.value
    .filter((p) => p.on)
    .flatMap((p) => p[kind].map((word) => ({ word, pack: p.name })));
}
function mine(kind: ListKind): string[] {
  const c = channel.value;
  if (scope.value === 'global' || !c) return vocab.state.global[kind];
  return vocab.state.byChannel[c]?.[kind] ?? [];
}
function liveCount(kind: ListKind): number {
  const off = (w: string) => vocab.isOff(kind, w);
  return (
    DEFAULT_WORDS[kind].filter((w) => !off(w)).length +
    packWords(kind).filter((p) => !off(p.word)).length +
    vocab.state.global[kind].length +
    (channel.value ? (vocab.state.byChannel[channel.value]?.[kind]?.length ?? 0) : 0)
  );
}

const draft = ref<Record<ListKind, string>>({ important: '', reaction: '' });
function submit(kind: ListKind) {
  if (vocab.add(scope.value, kind, draft.value[kind])) draft.value[kind] = '';
}

// --- the before/after strip ------------------------------------------------------
/** Scored with the shipped lists only, computed once when the overlay opens. */
const baseline = ref<{ buckets: Bucket[]; moments: Set<number> } | null>(null);
function computeBaseline() {
  if (!info.value) return;
  const { top, opts } = sensitivityToOptions(settings.sensitivity);
  const r = analyse(
    messages.value,
    info.value.id,
    info.value.lengthSeconds,
    top,
    opts,
    vod.speech,
    NO_VOCAB,
  );
  baseline.value = { buckets: r.buckets, moments: new Set(r.moments.map((m) => Math.round(m.t))) };
}
const BARS = 110;
/**
 * `n` bars, each the peak of its slice — a shape, not a reading. Both rows share one scale:
 * normalising each by its own maximum would hide exactly what this panel exists to show, a
 * lift that raises every burst by the same amount (2026-09-18).
 */
function bars(bs: Bucket[], max: number): number[] {
  if (!bs.length) return [];
  const per = bs.length / BARS;
  return Array.from({ length: BARS }, (_, i) => {
    let v = 0;
    for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per) && j < bs.length; j++)
      v = Math.max(v, bs[j]!.score);
    return Math.min(1, v / max);
  });
}
const scale = computed(() =>
  Math.max(
    0.001,
    ...(baseline.value?.buckets ?? []).map((b) => b.score),
    ...buckets.value.map((b) => b.score),
  ),
);
const before = computed(() => bars(baseline.value?.buckets ?? [], scale.value));
const after = computed(() => bars(buckets.value, scale.value));
const rows = computed(() => [
  { key: 'before' as const, vals: before.value },
  { key: 'after' as const, vals: after.value },
]);
const lifted = computed(() => {
  const a = before.value;
  const b = after.value;
  return a.length === b.length ? a.filter((v, i) => b[i]! - v > 0.04).length : 0;
});
/**
 * How many surfaced moments are new. The *count* barely moves — the sensitivity slider fixes
 * how many peaks surface — so what matters is which ones won their place (2026-09-18).
 */
const newMoments = computed(() => {
  const was = baseline.value?.moments;
  if (!was) return 0;
  return moments.value.filter((m) => !was.has(Math.round(m.t))).length;
});
const momentsNote = computed(() =>
  newMoments.value ? ' · ' + t('vocab.changes.moments', { n: newMoments.value }) : '',
);
const STOPS = ['#ff9bb8', '#e39ad8', '#c9a3df', '#ffb98a', '#ffd98a'];
function colour(v: number): string {
  return STOPS[Math.min(STOPS.length - 1, Math.floor(v * STOPS.length))]!;
}

// --- export / import -------------------------------------------------------------
const file = ref<HTMLInputElement | null>(null);
function exportFile() {
  const blob = new Blob([vocab.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hypeline-vocabulary.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const importError = ref(false);
async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  importError.value = !vocab.importJson(await f.text());
  (e.target as HTMLInputElement).value = '';
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => {
  vocab.channel = channel.value;
  counts.value = detectPacks(clean.value);
  computeBaseline();
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
// the sensitivity slider changes how many peaks surface, so the baseline has to follow
watch(() => settings.sensitivity, computeBaseline);
</script>

<template>
  <Teleport to="body">
    <div
      class="scrim fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-3 backdrop-blur-[6px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      :aria-label="t('vocab.title')"
      data-testid="vocab-overlay"
      @click.self="emit('close')"
    >
      <div class="sheet vocab w-full max-w-5xl p-4 sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <h2 class="font-display text-xl leading-tight text-ink">{{ t('vocab.title') }}</h2>
          <div class="flex items-center gap-2">
            <span class="seg" role="group" :aria-label="t('vocab.scope')">
              <button
                type="button"
                class="seg-opt"
                :aria-pressed="scope === 'global'"
                @click="scope = 'global'"
              >
                {{ t('vocab.everywhere') }}
              </button>
              <button
                v-if="channel"
                type="button"
                class="seg-opt"
                :aria-pressed="scope === 'channel'"
                data-testid="vocab-scope-channel"
                @click="scope = 'channel'"
              >
                {{ t('vocab.onlyChannel', { channel }) }}
              </button>
            </span>
            <button class="btn-ghost text-xs" data-testid="vocab-close" @click="emit('close')">
              {{ t('common.close') }}
            </button>
          </div>
        </div>
        <p class="mt-1.5 text-xs leading-relaxed text-ink">
          {{
            scope === 'global'
              ? t('vocab.scopeGlobal')
              : t('vocab.scopeChannel', { channel: channel ?? '' })
          }}
        </p>

        <!-- row 1: the two lists, side by side -->
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <section v-for="kind in KINDS" :key="kind" class="box" :data-list="kind">
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="text-[13px] font-bold">{{ t(`vocab.${kind}.name`) }}</h3>
              <span class="font-mono text-[10.5px] text-ink"
                >{{ liveCount(kind) }} {{ t('vocab.words') }}</span
              >
            </div>
            <p class="mt-0.5 mb-2 text-[11.5px] leading-relaxed text-ink">
              {{ t(`vocab.${kind}.help`) }}
            </p>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="(w, i) in DEFAULT_WORDS[kind]"
                :key="'d' + w"
                class="vchip silk-ring"
                :class="{ off: vocab.isOff(kind, w) }"
                :style="slice(i)"
              >
                <span>{{ w }}</span>
                <button
                  class="vx"
                  :title="t(vocab.isOff(kind, w) ? 'vocab.turnOn' : 'vocab.turnOff')"
                  @click="vocab.toggleDefault(kind, w)"
                >
                  {{ vocab.isOff(kind, w) ? '+' : '×' }}
                </button>
              </span>
              <span
                v-for="(p, i) in packWords(kind)"
                :key="'p' + p.word"
                class="vchip silk-ring"
                :class="{ off: vocab.isOff(kind, p.word) }"
                :style="slice(i + 7)"
              >
                <span>{{ p.word }}</span>
                <em class="who">{{ p.pack }}</em>
                <button
                  class="vx"
                  :title="t(vocab.isOff(kind, p.word) ? 'vocab.turnOn' : 'vocab.turnOff')"
                  @click="vocab.toggleDefault(kind, p.word)"
                >
                  {{ vocab.isOff(kind, p.word) ? '+' : '×' }}
                </button>
              </span>
              <span v-for="w in mine(kind)" :key="'m' + w" class="vchip mine">
                <span>{{ w }}</span>
                <em class="who">{{ t('vocab.yours') }}</em>
                <button
                  class="vx"
                  :title="t('common.remove')"
                  @click="vocab.remove(scope, kind, w)"
                >
                  ×
                </button>
              </span>
            </div>
            <form class="mt-2 flex gap-1.5" @submit.prevent="submit(kind)">
              <input
                v-model="draft[kind]"
                class="field min-w-0 flex-1 py-1! text-xs!"
                :placeholder="t(`vocab.${kind}.placeholder`)"
                maxlength="40"
                :data-testid="`vocab-add-${kind}`"
              />
              <button type="submit" class="btn-ghost px-2.5! py-1! text-xs">
                {{ t('vocab.add') }}
              </button>
            </form>
          </section>
        </div>

        <!-- row 2: what the chat said, two ways -->
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <section v-for="col in columns" :key="col.key" class="box" :data-tokens="col.key">
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="text-[13px] font-bold">{{ t(`vocab.${col.key}.name`) }}</h3>
              <span class="font-mono text-[10.5px] text-ink">{{ col.unit }}</span>
            </div>
            <p class="mt-0.5 mb-2 text-[11.5px] leading-relaxed text-ink">
              {{ t(`vocab.${col.key}.help`) }}
            </p>
            <p v-if="!col.rows.length" class="text-xs text-ink">{{ t('vocab.seen.empty') }}</p>
            <ul v-else class="seen">
              <li v-for="s in col.rows" :key="s.token" class="seenrow">
                <span class="tok"
                  ><b>{{ s.token }}</b
                  ><em>{{ t(`vocab.kind.${s.kind}`) }}</em></span
                >
                <span class="bar"
                  ><i :style="{ width: Math.round((s.peak / col.rows[0]!.peak) * 100) + '%' }"></i
                ></span>
                <span
                  class="font-mono text-[10.5px] text-ink"
                  :title="t('vocab.seen.usersTotal', { n: s.users })"
                  >{{ s.peak }}</span
                >
                <span class="flex gap-1">
                  <button
                    v-for="kind in KINDS"
                    :key="kind"
                    class="mini"
                    :class="{ done: inList(kind, s.token) }"
                    :disabled="inList(kind, s.token)"
                    @click="vocab.add(scope, kind, s.token)"
                  >
                    {{ t(`vocab.addTo.${kind}`) }}
                  </button>
                </span>
              </li>
            </ul>
          </section>
        </div>

        <!-- row 3: the packs -->
        <section class="box mt-3">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-[13px] font-bold">{{ t('vocab.packs.name') }}</h3>
            <button
              class="mini"
              data-testid="vocab-detect"
              @click="vocab.setPacks(packsToEnable(counts))"
            >
              {{ t('vocab.packs.detect') }}
            </button>
          </div>
          <p class="mt-0.5 mb-2 text-[11.5px] leading-relaxed text-ink">
            {{ t('vocab.packs.help') }}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <span class="pack silk-ring" :style="slice(0)" aria-pressed="true">
              English <small>{{ t('vocab.packs.always') }}</small>
            </span>
            <button
              v-for="(p, i) in packs"
              :key="p.id"
              class="pack silk-ring"
              :style="slice(i + 1)"
              :aria-pressed="p.on"
              @click="vocab.togglePack(p.id)"
            >
              {{ p.name }}
              <small>{{ p.users ? t('vocab.packs.people', { n: p.users }) : '0' }}</small>
            </button>
          </div>
        </section>

        <!-- row 4: before / after -->
        <div class="border-line mt-3 border-t pt-2.5">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-[13px] font-bold">{{ t('vocab.changes.name') }}</h3>
            <span class="font-mono text-[10.5px] text-ink" data-testid="vocab-delta">{{
              lifted
                ? t('vocab.changes.summary', { n: lifted }) + momentsNote
                : t('vocab.changes.none')
            }}</span>
          </div>
          <div class="mt-1.5 flex flex-col gap-1.5">
            <div v-for="row in rows" :key="row.key" class="strip">
              <span class="font-mono text-[10px] text-ink">{{
                t(`vocab.changes.${row.key}`)
              }}</span>
              <svg class="wave" viewBox="0 0 600 34" preserveAspectRatio="none" aria-hidden="true">
                <rect
                  v-for="(v, i) in row.vals"
                  :key="i"
                  :x="(i * (600 / BARS)).toFixed(2)"
                  :y="(34 - Math.max(1.5, v * 34)).toFixed(2)"
                  :width="(600 / BARS - 1).toFixed(2)"
                  :height="Math.max(1.5, v * 34).toFixed(2)"
                  rx="1"
                  :fill="colour(v)"
                  :opacity="(0.5 + v * 0.5).toFixed(2)"
                />
              </svg>
            </div>
          </div>
        </div>

        <div class="border-line mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
          <button class="btn-ghost px-2.5! py-1! text-xs" @click="exportFile">
            {{ t('vocab.export') }}
          </button>
          <button class="btn-ghost px-2.5! py-1! text-xs" @click="file?.click()">
            {{ t('vocab.import') }}
          </button>
          <input ref="file" type="file" accept="application/json" class="hidden" @change="onFile" />
          <button
            class="btn-ghost px-2.5! py-1! text-xs"
            data-testid="vocab-reset"
            @click="vocab.reset()"
          >
            {{ t('vocab.reset') }}
          </button>
          <span v-if="importError" class="text-xs text-danger">{{ t('vocab.importFailed') }}</span>
          <span class="flex-1"></span>
          <button class="btn-silk text-sm" @click="emit('close')">{{ t('vocab.done') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * This panel's own surface rules (Angel, 2026-09-18):
 *  - the boxes are a *white* film by day rather than an ink one, so they do not read grey
 *    next to the near-white sheet; at night the same film in white at a low alpha;
 *  - nothing here is grey text. Everything is `--color-ink`, which is near-black by day and
 *    near-white by night; hierarchy comes from size and weight instead;
 *  - a chosen thing is marked in **mint**, not the accent violet, because violet is what the
 *    silk ring is made of and the two were competing.
 *
 * `--box-film`, `--pick` and `--pick-soft` are theme tokens in `src/style.css`. They started
 * here, behind `:global([data-theme='dark']) .vocab`, and that compiles to `[data-theme=dark]`
 * alone — the `.vocab` half is dropped — so the night values landed on <html> where the day
 * rule on `.vocab` itself overrode them, and the whole panel ran day colours at night.
 */
.scrim {
  background: var(--sheet-scrim);
}
.box {
  border: 1px solid var(--color-line);
  border-radius: 16px;
  padding: 11px 12px;
  background: var(--box-film);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
/* every deletable word wears a slice of the one silk gradient, still rather than turning:
   forty animated conic gradients on one screen is not worth the cost */
.vchip,
.pack {
  --ring-w: 1.5px;
}
.vchip::before,
.pack::before {
  animation: none;
}
.vchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  padding: 3px 8px 3px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--color-ink);
  background: var(--box-film);
  white-space: nowrap;
}
.vchip.off {
  opacity: 0.42;
  text-decoration: line-through;
}
.vchip.mine {
  border: 1.5px solid var(--pick);
  background: var(--pick-soft);
}
.who {
  font-style: normal;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-ink);
  opacity: 0.75;
}
.vx {
  opacity: 0.65;
  font-size: 12px;
  line-height: 1;
}
.vx:hover {
  opacity: 1;
}
.seen {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 210px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-ink) 22%, transparent) transparent;
}
.seenrow {
  display: grid;
  grid-template-columns: minmax(84px, 1fr) minmax(20px, 44px) 26px auto;
  align-items: center;
  gap: 7px;
  padding: 3px 5px;
  border-radius: 9px;
}
.seenrow:hover {
  background: color-mix(in srgb, var(--color-ink) 7%, transparent);
}
.tok {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.tok b {
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tok em {
  flex: none;
  font-style: normal;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-ink);
  opacity: 0.7;
}
.bar {
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 12%, transparent);
  position: relative;
}
.bar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: linear-gradient(90deg, #ff9bb8, #c9a3df, #ffd08a);
}
.mini {
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-size: 11px;
  padding: 1px 7px;
  white-space: nowrap;
  color: var(--color-ink);
}
.mini:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-ink) 10%, transparent);
}
.mini:disabled {
  border-color: var(--pick);
  background: var(--pick-soft);
  opacity: 1;
}
.pack {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--color-ink);
  background: var(--box-film);
}
.pack[aria-pressed='true'] {
  border: 1.5px solid var(--pick);
  background: var(--pick-soft);
  font-weight: 600;
}
.pack small {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-ink);
  opacity: 0.7;
}
.strip {
  display: grid;
  grid-template-columns: 46px 1fr;
  align-items: center;
  gap: 9px;
}
.wave {
  height: 34px;
  width: 100%;
  display: block;
}
</style>
