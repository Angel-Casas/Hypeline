<script setup lang="ts">
/**
 * The tour's stage: four blurred, tinted panels around a hole cut over the current step's
 * target (`[data-tour="<id>"]`, the first visible one), a silk ring on the hole, and a paper
 * card with the step's words. The card sits under the target when there is room, above it
 * otherwise, always inside the viewport; on narrow screens it is a bottom sheet so it can
 * never hide off the side. Steps may switch a tab or open a drawer first (`before`), then the
 * target is scrolled into view and measured; resize and scroll re-measure. Arrow keys / Enter
 * advance, Escape ends.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTourStore } from './tourStore';

export interface TourStep {
  id: string;
  /** Runs before the target is looked up (switch a tab, open the drawer). */
  before?: () => void | Promise<void>;
}
const props = defineProps<{ steps: TourStep[] }>();
const { t } = useI18n();
const tour = useTourStore();

const PAD = 8;
const hole = ref<{ x: number; y: number; w: number; h: number } | null>(null);
const card = ref<HTMLDivElement | null>(null);
const cardBox = ref({ w: 0, h: 0 });
const vw = ref(0);
const vh = ref(0);
const narrow = computed(() => vw.value < 640);
/** Narrow screens: the sheet sits at the bottom, or at the top when the target is low. */
const sheetTop = ref(false);
/** Roughly the sticky top bar + tab strip, so a scrolled target does not hide under them. */
const STUCK = 108;
const current = computed(() => props.steps[tour.step]);
const last = computed(() => tour.step >= props.steps.length - 1);

function target(): HTMLElement | null {
  const id = current.value?.id;
  if (!id) return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`));
  return (
    all.find((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed') ?? null
  );
}
function measure() {
  vw.value = window.innerWidth;
  vh.value = window.innerHeight;
  const el = target();
  if (!el) {
    hole.value = null;
    return;
  }
  const r = el.getBoundingClientRect();
  hole.value = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
  if (card.value) cardBox.value = { w: card.value.offsetWidth, h: card.value.offsetHeight };
  if (narrow.value) {
    // the sheet must not sit on the thing it is describing: when the target reaches too far
    // down the screen, move the sheet to the top instead (Angel, 2026-09-17)
    const h = cardBox.value.h || 200;
    const below = vh.value - (hole.value.y + hole.value.h);
    const above = hole.value.y;
    sheetTop.value = below < h + 16 && above >= h + 16;
  }
}
let settle: ReturnType<typeof setTimeout> | null = null;
// the target can grow after it is measured (the ribbon renders a beat later): follow it
const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
async function place() {
  await current.value?.before?.();
  await nextTick();
  const el = target();
  ro?.disconnect();
  if (el) ro?.observe(el);
  if (el) {
    if (narrow.value) {
      // phone: put the target's top just under the sticky bars, so the tallest panels show
      // their heading and the sheet has the rest of the screen
      const top = window.scrollY + el.getBoundingClientRect().top - STUCK;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      // desktop: centre it; the card goes under, over or beside
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
  }
  measure();
  if (settle) clearTimeout(settle);
  settle = setTimeout(measure, 420);
}
watch(
  () => [tour.active, tour.step],
  () => {
    // only while it runs: on Done the step's `before` would otherwise fire once more and put
    // the desk back the way that step wanted it (the rail drawer re-opened — Angel, 2026-09-17)
    if (tour.active) void place();
    else ro?.disconnect();
  },
  { immediate: true },
);
watch(card, () => measure());

const RADIUS = 18;
/** The veil covers everything; a rounded-rect mask layer is subtracted where the hole is. */
const veilStyle = computed(() => {
  if (!hole.value) return {};
  const { x, y, w, h } = hole.value;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='${w}' height='${h}' rx='${RADIUS}'/></svg>`;
  const cut = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  return {
    maskImage: `linear-gradient(#000 0 0), ${cut}`,
    maskPosition: `0 0, ${x}px ${y}px`,
    maskSize: `100% 100%, ${w}px ${h}px`,
    maskRepeat: 'no-repeat, no-repeat',
    maskComposite: 'exclude',
    WebkitMaskImage: `linear-gradient(#000 0 0), ${cut}`,
    WebkitMaskPosition: `0 0, ${x}px ${y}px`,
    WebkitMaskSize: `100% 100%, ${w}px ${h}px`,
    WebkitMaskRepeat: 'no-repeat, no-repeat',
    WebkitMaskComposite: 'xor',
  } as Record<string, string>;
});

const cardStyle = computed(() => {
  const w = Math.min(360, vw.value - 24);
  if (narrow.value || !hole.value)
    return {
      left: '12px',
      right: '12px',
      width: 'auto',
      ...(sheetTop.value && hole.value ? { top: '12px' } : { bottom: '12px' }),
    } as Record<string, string>;
  const h = cardBox.value.h || 180;
  const H = hole.value;
  const clampX = (x: number) => Math.min(Math.max(12, x), vw.value - w - 12);
  const clampY = (y: number) => Math.min(Math.max(12, y), vh.value - h - 12);
  // under the target, over it, beside it (right, then left) — the first that fits without
  // covering the hole; a tall column (the clip or AI panels) gets the card at its side
  if (H.y + H.h + 12 + h <= vh.value - 12)
    return { left: `${clampX(H.x)}px`, top: `${H.y + H.h + 12}px`, width: `${w}px` };
  if (H.y - 12 - h >= 12)
    return { left: `${clampX(H.x)}px`, top: `${H.y - 12 - h}px`, width: `${w}px` };
  if (H.x + H.w + 12 + w <= vw.value - 12)
    return { left: `${H.x + H.w + 12}px`, top: `${clampY(H.y)}px`, width: `${w}px` };
  if (H.x - 12 - w >= 12)
    return { left: `${H.x - 12 - w}px`, top: `${clampY(H.y)}px`, width: `${w}px` };
  return { left: '12px', right: '12px', bottom: '12px', width: 'auto' } as Record<string, string>;
});

function next() {
  if (last.value) tour.end();
  else tour.step++;
}
function back() {
  if (tour.step > 0) tour.step--;
}
function onKey(e: KeyboardEvent) {
  if (!tour.active) return;
  if (e.key === 'Escape') tour.end();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
  else if (e.key === 'ArrowLeft') back();
  else return;
  e.preventDefault();
}
onMounted(() => {
  window.addEventListener('resize', measure);
  window.addEventListener('scroll', measure, true);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure);
  window.removeEventListener('scroll', measure, true);
  window.removeEventListener('keydown', onKey);
  if (settle) clearTimeout(settle);
  ro?.disconnect();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="tour.active && current" class="tour" data-testid="tour" :data-step="current.id">
      <!-- one veil with a rounded hole cut out of it (a mask, so the blur and the tint both
           stop at the ring's own radius) -->
      <div class="veil" :style="veilStyle"></div>
      <div
        v-if="hole"
        class="hole silk-ring [--ring-w:2px]"
        :style="{
          left: hole.x + 'px',
          top: hole.y + 'px',
          width: hole.w + 'px',
          height: hole.h + 'px',
        }"
      ></div>

      <div
        ref="card"
        class="card"
        :class="{ 'card-sheet': narrow || !hole }"
        :style="cardStyle"
        role="dialog"
        aria-modal="true"
        :aria-label="t(`tour.${current.id}.title`)"
        data-testid="tour-card"
      >
        <p class="eyebrow">{{ t('tour.eyebrow', { n: tour.step + 1, total: steps.length }) }}</p>
        <h2 class="mt-1 font-display text-[19px] leading-tight text-ink text-balance">
          {{ t(`tour.${current.id}.title`) }}
        </h2>
        <p class="text-muted mt-1.5 text-[12.5px] leading-relaxed text-pretty">
          {{ t(`tour.${current.id}.body`) }}
        </p>
        <div class="mt-3.5 flex items-center gap-2">
          <span class="dots" aria-hidden="true">
            <i v-for="(s, i) in steps" :key="s.id" :class="{ on: i === tour.step }"></i>
          </span>
          <span class="flex-1"></span>
          <button
            v-if="!last"
            type="button"
            class="btn-ghost text-xs"
            data-testid="tour-skip"
            @click="tour.end()"
          >
            {{ t('tour.skip') }}
          </button>
          <button v-if="tour.step > 0" type="button" class="btn-ghost text-xs" @click="back">
            {{ t('tour.back') }}
          </button>
          <button type="button" class="btn-silk text-xs" data-testid="tour-next" @click="next">
            {{ last ? t('tour.done') : t('tour.next') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 75;
}
.veil {
  position: absolute;
  inset: 0;
  background: var(--scrim-strong);
  backdrop-filter: blur(3px) saturate(0.8);
  -webkit-backdrop-filter: blur(3px) saturate(0.8);
  transition:
    mask-position 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    mask-size 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    -webkit-mask-position 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    -webkit-mask-size 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.hole {
  position: absolute;
  border-radius: 18px;
  pointer-events: auto;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-ground) 60%, transparent) inset;
  transition:
    top 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    left 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    width 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    height 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.card {
  position: absolute;
  background: var(--color-ground);
  border: 1px solid var(--glass-line);
  border-radius: 20px;
  padding: 16px 18px 14px;
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.3),
    0 3px 10px rgba(0, 0, 0, 0.1);
  max-width: calc(100vw - 24px);
  transition:
    top 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    left 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.card-sheet {
  border-radius: 22px;
}
.dots {
  display: inline-flex;
  gap: 5px;
}
.dots i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 18%, transparent);
  transition: background 200ms;
}
.dots i.on {
  background: var(--color-ink);
}
@media (prefers-reduced-motion: reduce) {
  .veil,
  .hole,
  .card {
    transition: none;
  }
}
</style>
