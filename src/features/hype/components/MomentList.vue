<script setup lang="ts">
/**
 * The moments as a heat grid (design/dashboard/hypeline-moments-box.html #11, Angel
 * 2026-09-15): one chip per moment, coloured by its strength in the silk of its place in the
 * VOD, a ring meter in the corner (score as the arc, rank inside). With a storyboard the
 * chip's background becomes the video frame of that moment, the silk kept as a bottom edge.
 * Hovering a chip (or its pin on the timeline) opens a **moment card** beside it — the frame,
 * the time, every reason in full, the counts — as a fixed-position glass popover teleported
 * to the body so no panel can clip it (2026-09-15, Angel: the one-line caption truncated).
 * On touch screens there is no hover: the first tap opens the card, its button (or a second
 * tap on the chip) clips the moment; a tap anywhere else closes it.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Moment } from '../scoring';
import { POLE_KEY, isUpper, type PoleKey } from '../emotion';
import { formatHms } from '@/lib/twitch/vodUrl';
import { frameBackground, type Storyboard } from '@/lib/twitch/storyboard';
import { silkAt } from '@/ui/thread/silk';
import { useSettingsStore } from '@/features/settings/settingsStore';

const props = defineProps<{
  moments: Moment[];
  lengthSeconds: number;
  activeId?: string | null;
  hoverId?: string | null;
  /** Moments that already have an exported clip. */
  clippedIds?: Set<string>;
  storyboard?: Storyboard | null;
}>();
/** Clicking a chip enters clip mode for that moment; hovering lights its pin. */
const emit = defineEmits<{
  clip: [m: Moment];
  hover: [id: string | null];
}>();
const settings = useSettingsStore();
const { t } = useI18n();

// --- the moment card ---
const chipEls = new Map<string, HTMLElement>();
function setChip(id: string, el: unknown) {
  if (el instanceof HTMLElement) chipEls.set(id, el);
  else chipEls.delete(id);
}
/**
 * Desktop only, the grid is capped and scrolls (ADR-27): a sensitive VOD finds twenty peaks
 * and the list used to push the clip panel off the screen. Keep the chosen one in view when
 * the choice came from elsewhere — a pin on the timeline, or the keyboard.
 */
watch(
  () => props.activeId,
  (id) => {
    if (!id) return;
    void nextTick(() => chipEls.get(id)?.scrollIntoView({ block: 'nearest' }));
  },
);
/** Touch screens: no hover, so a tap opens the card first. */
const coarse =
  typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches;
const tapped = ref<string | null>(null);
const cardId = computed(() => tapped.value ?? props.hoverId ?? null);
const card = computed(() => chips.value.find((c) => c.m.id === cardId.value) ?? null);
const cardPos = ref<{ left: number; top: number; above: boolean } | null>(null);
const CARD_W = 272;
function placeCard() {
  const id = cardId.value;
  const el = id ? chipEls.get(id) : null;
  if (!el) {
    cardPos.value = null;
    return;
  }
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(vw - CARD_W - 8, r.left + r.width / 2 - CARD_W / 2));
  const above = r.bottom + 8 + 190 > vh && r.top > 200;
  cardPos.value = { left, top: above ? r.top - 8 : r.bottom + 8, above };
}
watch(cardId, () => void nextTick(placeCard));
function onChipClick(c: (typeof chips.value)[number]) {
  if (coarse && tapped.value !== c.m.id) {
    tapped.value = c.m.id;
    emit('hover', c.m.id);
    return;
  }
  tapped.value = null;
  emit('clip', c.m);
}
function clipFromCard() {
  if (!card.value) return;
  const m = card.value.m;
  tapped.value = null;
  emit('hover', null);
  emit('clip', m);
}
function onDocPointer(e: Event) {
  if (!tapped.value) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('.moment-card') || t?.closest('.chip')) return;
  tapped.value = null;
  emit('hover', null);
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true);
  window.addEventListener('scroll', placeCard, true);
  window.addEventListener('resize', placeCard);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
  window.removeEventListener('scroll', placeCard, true);
  window.removeEventListener('resize', placeCard);
});

/**
 * The "6.2× baseline rate" reason, in whatever language the reasons were written: the
 * message's text around `{n}` identifies it, and what sits between is the multiplier.
 */
const SENTINEL = '\u2063'; // invisible separator: never part of a real multiplier
const baselineProbe = computed(() => {
  const [pre = '', post = ''] = t('scoring.baselineRate', { n: SENTINEL }).split(SENTINEL);
  return { pre, post };
});
function baselineMult(reasons: string[]): string | undefined {
  const { pre, post } = baselineProbe.value;
  const hit = reasons.find(
    (r) => r.length > pre.length + post.length && r.startsWith(pre) && r.endsWith(post),
  );
  return hit?.slice(pre.length, hit.length - post.length);
}

const chips = computed(() => {
  // Rate-scored moments rank among themselves. AI hits carry their confidence (1–5), and
  // emotion moments (ADR-43) carry a lift — three different scales, so only the first kind
  // is ranked and only its scores set the heat. Mixing them would make the numbering lie.
  const chat = props.moments.filter((m) => !m.source);
  const max = Math.max(1e-6, ...chat.map((m) => m.score));
  const byScore = [...chat].sort((a, b) => b.score - a.score);
  return props.moments.map((m) => {
    const ai = m.source === 'ai';
    const emo = m.source === 'emotion';
    const pole = emo ? (m.pole as PoleKey | undefined) : undefined;
    const at = props.lengthSeconds ? m.t / props.lengthSeconds : 0;
    const frame = props.storyboard ? frameBackground(props.storyboard, m.t) : null;
    const mult = baselineMult(m.reasons);
    const aiReasons = m.reasons.join(' — ');
    return {
      m,
      ai,
      emo,
      pole,
      poleLabel: pole ? t(POLE_KEY[pole]) : '',
      poleUp: pole ? isUpper(pole) : false,
      time: formatHms(m.t),
      mult:
        ai || emo
          ? ai
            ? `${m.score}/5`
            : t('moments.chattersShort', { n: m.users })
          : mult
            ? `${mult}×`
            : t('moments.chattersShort', { n: m.users }),
      colour: silkAt(at, false, 0),
      // an emotion moment's strength is a lift, not a rate score: ~3 is a strong one
      heat: ai ? m.score / 5 : emo ? Math.min(1, m.score / 3) : m.score / max,
      rank: ai || emo ? 0 : byScore.indexOf(m) + 1,
      frame,
      why: ai
        ? m.query
          ? t('moments.aiWhy', { query: m.query, reasons: aiReasons })
          : aiReasons
        : m.reasons.length
          ? m.reasons.join(', ')
          : t('moments.msgsFromUsers', { n: m.n, users: m.users }),
    };
  });
});
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2">
    <ol class="chips grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-1.5">
      <li
        v-for="c in chips"
        :key="c.m.id"
        :ref="(el) => setChip(c.m.id, el)"
        class="chip relative aspect-[16/10] cursor-pointer overflow-hidden rounded-[10px] p-[7px]"
        :class="{
          'is-on': c.m.id === activeId,
          'is-hot': c.m.id === hoverId,
          'has-frame': !!c.frame,
          'is-ai': c.ai,
          'is-emo': c.emo,
          dark: settings.dark,
        }"
        :style="{ '--c': c.colour, '--h': c.heat }"
        :aria-label="`${c.time} · ${c.why}`"
        @click="onChipClick(c)"
        @mouseenter="!coarse && emit('hover', c.m.id)"
        @mouseleave="!coarse && emit('hover', null)"
      >
        <span
          v-if="c.frame"
          class="frame absolute inset-0"
          :style="c.frame"
          aria-hidden="true"
        ></span>
        <span v-if="c.ai" class="aitag absolute top-[6px] left-[6px]">AI</span>
        <!-- the pole, by shape as well as by colour: an arrow up for the warm pole, down for
             the cool one, so the chip is readable without colour vision or a legend -->
        <span
          v-else-if="c.emo"
          class="motag absolute top-[6px] left-[6px]"
          :class="c.poleUp ? 'up' : 'down'"
          :title="c.poleLabel"
          data-testid="moment-emo"
          >{{ c.poleUp ? '▲' : '▼' }}</span
        >
        <span v-else class="dial absolute top-[6px] left-[6px]"
          ><i>{{ c.rank }}</i></span
        >
        <span
          v-if="clippedIds?.has(c.m.id)"
          class="clipmark absolute top-[7px] right-[7px] font-mono text-[9px]"
          :title="t('moments.hasClip')"
          >{{ t('moments.clipMark') }}</span
        >
        <span class="text absolute right-[7px] bottom-[6px] left-[7px] flex items-baseline gap-1">
          <b class="font-mono text-[11.5px] font-bold tabular-nums">{{ c.time }}</b>
          <span class="mult font-mono text-[10px]">{{ c.mult }}</span>
        </span>
      </li>
    </ol>
    <p class="text-muted min-h-4 font-mono text-[10.5px]">
      {{ coarse ? t('moments.hintTouch') : t('moments.hintHover') }}
    </p>

    <!-- the moment card: fixed, above everything, never clipped by a panel -->
    <Teleport to="body">
      <Transition name="card">
        <div
          v-if="card && cardPos"
          class="moment-card glass-sm fixed z-[60]"
          :class="{ above: cardPos.above, touch: coarse }"
          :style="{
            left: cardPos.left + 'px',
            top: cardPos.top + 'px',
            width: CARD_W + 'px',
            '--c': card.colour,
          }"
          role="tooltip"
        >
          <div v-if="card.frame" class="cframe relative aspect-video w-full" :style="card.frame">
            <span class="ctime absolute bottom-1.5 left-2 font-mono text-[11px] font-bold">{{
              card.time
            }}</span>
          </div>
          <div class="flex flex-col gap-1.5 p-3">
            <div class="flex items-baseline gap-2">
              <span v-if="card.ai" class="cai font-mono text-[10px] font-bold">AI</span>
              <span v-else class="crank font-mono text-[10px] font-bold">#{{ card.rank }}</span>
              <b v-if="!card.frame" class="font-mono text-[13px] font-bold tabular-nums">{{
                card.time
              }}</b>
              <span class="text-muted font-mono text-[10.5px]">{{ card.mult }}</span>
            </div>
            <p v-if="card.ai && card.m.query" class="text-muted text-[11.5px] leading-snug">
              {{ t('moments.youAsked', { query: card.m.query }) }}
            </p>
            <ul class="text-ink flex flex-col gap-0.5 text-[12.5px] leading-snug">
              <li v-for="r in card.m.reasons" :key="r">{{ r }}</li>
              <li v-if="!card.m.reasons.length" class="text-muted">{{ t('moments.louder') }}</li>
            </ul>
            <div class="text-muted font-mono text-[10.5px]">
              <template v-if="card.ai">{{
                t('moments.transcriptConfidence', { score: card.m.score })
              }}</template>
              <template v-else>{{
                t('moments.chatStats', {
                  n: card.m.n,
                  users: card.m.users,
                  score: card.m.score.toFixed(2),
                })
              }}</template>
            </div>
            <button
              v-if="coarse"
              class="btn-silk mt-1 w-full py-1.5! text-xs"
              @click="clipFromCard"
            >
              {{ t('moments.clipThis') }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/*
 * The emotion tag. Same size and seat as the rank dial it replaces, so a mixed list still
 * scans down one column. Colours are the validated pole pair; the arrow carries the same
 * information, which is what makes the chip work in greyscale.
 */
.motag {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 5px;
  font-size: 9px;
  line-height: 1;
  color: #fff;
  background: #c2661a;
}
.motag.down {
  background: #5a6fd6;
}
:global(html[data-theme='dark']) .motag {
  background: #cf7020;
}
:global(html[data-theme='dark']) .motag.down {
  background: #6b7fe0;
}

/* A phone scrolls the page, which is the right scroll there. On a desktop the grid takes
   whatever height its column has and scrolls only past that — a fixed cap left the chips
   huddled at the top of a tall, empty card (Angel, 2026-09-17). `max-content` rows keep a
   chip at its own height instead of sharing out the box. */
@media (min-width: 1024px) {
  .chips {
    /* shrink-to-fit, never stretch: the hint stays under the last chip, and a long list
       scrolls inside whatever height the column has */
    flex: 0 1 auto;
    min-height: 6rem;
    align-content: start;
    grid-auto-rows: max-content;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 4px;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--color-ink) 22%, transparent) transparent;
  }
  .chips::-webkit-scrollbar {
    width: 8px;
  }
  .chips::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--color-ink) 20%, transparent);
    border-radius: 999px;
  }
}

.moment-card {
  overflow: hidden;
  border-radius: 14px;
  /* denser than glass-sm: it sits over other chips and must read at a glance */
  background: color-mix(in srgb, var(--color-ground) 96%, transparent);
  border-color: var(--glass-line);
  /* the chip's silk shows as a tinted shadow under the card, not as a stripe */
  box-shadow: 0 18px 40px -16px color-mix(in srgb, var(--c) 55%, rgba(22, 18, 26, 0.6));
  pointer-events: none;
}
.moment-card.touch {
  pointer-events: auto;
}
.moment-card.above {
  transform: translateY(-100%);
}
.cframe {
  background-color: var(--color-ground-2);
}
.cframe::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(22, 18, 26, 0) 55%, rgba(22, 18, 26, 0.75));
}
/* the same 3 px silk foot the chips have, so the card reads as the chip, enlarged */
.cframe::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--c);
}
.ctime {
  color: #f3edf6;
}
.crank {
  color: var(--c);
}
.cai {
  color: var(--color-accent);
  letter-spacing: 0.12em;
}
/* AI chips: an accent ring instead of the silk heat, and an AI tag where the rank dial sits */
.chip.is-ai {
  box-shadow: inset 0 0 0 1.5px var(--color-accent);
}
.chip.is-ai.is-on {
  box-shadow:
    inset 0 0 0 1.5px var(--color-accent),
    inset 0 0 0 3px var(--ink);
}
.aitag {
  z-index: 1;
  font: 700 9px var(--font-mono);
  letter-spacing: 0.12em;
  padding: 3px 6px;
  border-radius: 999px;
  color: var(--color-accent);
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
}
.chip.has-frame .aitag {
  background: rgba(22, 18, 26, 0.85);
}
.card-enter-active,
.card-leave-active {
  transition:
    opacity 0.16s ease,
    translate 0.16s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.card-enter-from,
.card-leave-to {
  opacity: 0;
  translate: 0 4px;
}
.moment-card.above.card-enter-from,
.moment-card.above.card-leave-to {
  translate: 0 -4px;
}
.chip {
  --ink: var(--color-ink);
  --paper: var(--color-ground-2);
  color: var(--ink);
  /* heat: the silk at full strength, paper at none */
  background: color-mix(in srgb, var(--c) calc(var(--h) * 100%), var(--paper));
  box-shadow: inset 0 0 0 1px transparent;
  transition:
    transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 0.2s;
}
.chip:hover,
.chip.is-hot {
  transform: translateY(-2px);
}
.chip:hover {
  box-shadow: var(--hover-shadow);
}
.chip.is-hot {
  box-shadow: inset 0 0 0 1px var(--glass-line);
}
.chip.is-on {
  box-shadow: inset 0 0 0 1.5px var(--ink);
}
/* the frame fades in over the heat once the storyboard is there */
.frame {
  opacity: 0;
  animation: frame-in 0.5s ease forwards;
}
.frame::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(22, 18, 26, 0) 35%, rgba(22, 18, 26, 0.78));
}
.frame::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--c);
}
@keyframes frame-in {
  to {
    opacity: 1;
  }
}
.chip.has-frame {
  color: #f3edf6;
  --ink: #f3edf6;
}
.dial,
.text,
.clipmark {
  z-index: 1;
}
.dial {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font: 700 9.5px var(--font-mono);
  background: conic-gradient(
    var(--ink) calc(var(--h) * 360deg),
    color-mix(in srgb, var(--ink) 18%, transparent) 0
  );
}
.dial::before {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--c) calc(var(--h) * 100%), var(--paper));
}
.chip.has-frame .dial::before {
  background: rgba(22, 18, 26, 0.85);
}
.dial i {
  position: relative;
  font-style: normal;
}
.mult {
  color: color-mix(in srgb, var(--ink) 70%, transparent);
}
.clipmark {
  color: color-mix(in srgb, var(--ink) 75%, transparent);
  border: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
  border-radius: 999px;
  padding: 0 5px;
  line-height: 13px;
}
@media (prefers-reduced-motion: reduce) {
  .chip {
    transition: none;
  }
  .frame {
    animation-duration: 0.01s;
  }
}
</style>
