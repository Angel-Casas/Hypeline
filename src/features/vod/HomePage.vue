<script setup lang="ts">
/**
 * Landing page — "Masthead" composition (chosen 2026-09-13): the wordmark on
 * top, the hype thread beneath it drawing itself as you scroll (the hero is
 * pinned for ~2.5 screens), glass moment cards on the peaks, a one-sentence
 * deck and the VOD pill. Recent cached VODs below.
 *
 * The example thread is the illustrative VOD from the design prototypes
 * (five moments); it is labelled as an example.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import VodInput from './components/VodInput.vue';
import HypeThread from '@/ui/HypeThread.vue';
import { seriesFromPeaks } from '@/ui/thread/series';
import { silkAt } from '@/ui/thread/silk';
import { formatHms } from '@/lib/twitch/vodUrl';
import ThemeToggle from '@/ui/ThemeToggle.vue';
import LanguageMenu from '@/ui/LanguageMenu.vue';
import SupportButton from '@/ui/SupportButton.vue';
import { useSettingsStore } from '@/features/settings/settingsStore';

const { t } = useI18n();
const settings = useSettingsStore();

const router = useRouter();

// --- the example thread (same moments as the design prototype) ---
const LENGTH = 23042;
/** The card copy lives in the catalog (`landing.card*`); `note` is a key or a chatter count. */
const EXAMPLE: {
  t: number;
  weight: number;
  time?: string;
  mult?: string;
  note?: { chatters: number } | 'demoted' | null;
  card?: number;
}[] = [
  { t: 0.12, weight: 0.22 },
  { t: 0.29, weight: 0.95, time: '0:34:15', mult: '6.2×', note: { chatters: 41 }, card: 1 },
  { t: 0.5, weight: 0.32, time: '2:03:08', mult: '2.1×', note: 'demoted', card: 2 },
  { t: 0.68, weight: 0.72, time: '2:48:52', mult: '4.0×', note: { chatters: 33 }, card: 3 },
  { t: 0.85, weight: 0.4, time: '3:20:11', mult: '2.6×', note: null, card: 4 },
];
const series = seriesFromPeaks(EXAMPLE, { n: 768, width: 0.05 });
/**
 * Geometry. Landscape: the thread runs across, under the wordmark. Portrait (phones, narrow
 * windows — 2026-09-14): it runs top → bottom, spine centred, the scroll drawing it downward;
 * the cards alternate sides of the spine and the ruler stands along the left edge.
 */
const portraitMq = typeof matchMedia === 'function' ? matchMedia('(orientation: portrait)') : null;
const portrait = ref(portraitMq?.matches ?? false);
function onOrient() {
  portrait.value = portraitMq?.matches ?? false;
}
const SPAN = computed<[number, number]>(() => (portrait.value ? [0.3, 0.68] : [0.04, 0.96]));
const CY = computed(() => (portrait.value ? 0.5 : 0.48));
const SCALE = computed(() => (portrait.value ? 0.58 : 0.85));

// --- scroll-driven reveal ---
const track = ref<HTMLElement | null>(null);
const progress = ref(0);
const reduce =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function onScroll() {
  const el = track.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const t = (0 - r.top) / Math.max(1, r.height - window.innerHeight);
  progress.value = reduce ? 1 : Math.max(0, Math.min(1, t));
}
const cards = computed(() =>
  EXAMPLE.filter((m) => m.card).map((m, i) => {
    const wid = (0.015 + 0.21 * m.weight) * SCALE.value;
    const along = (SPAN.value[0] + m.t * (SPAN.value[1] - SPAN.value[0])) * 100;
    // portrait: cards alternate sides; the pin's dot sits on the ribbon's edge on that side
    const side = i % 2 ? 'r' : 'l';
    const note =
      m.note === 'demoted'
        ? t('landing.demoted')
        : m.note
          ? t('landing.chatters', m.note.chatters)
          : null;
    // shorter pill on a phone: time and multiplier only
    const metaShort = `${m.time} · ${m.mult}`;
    return {
      ...m,
      title: t(`landing.card${m.card}Title`),
      sub: t(`landing.card${m.card}Sub`),
      meta: note ? `${metaShort} · ${note}` : metaShort,
      metaShort,
      left: along,
      // anchor: the top edge of the thread at the peak — the pin's dot sits there
      top: (1 - (CY.value + wid * 0.5 + 0.004)) * 100,
      on: progress.value > m.t + 0.01,
      side,
      along,
      edge: (CY.value + (side === 'r' ? wid : -wid) * 0.5) * 100,
    };
  }),
);
/** Axis: hour labels (+ the end) placed along the thread's span; each lights up in the silk's
 *  colour at its position once the thread has passed it, drifting in from alternating sides. */
const axis = computed(() => {
  const marks: number[] = [];
  // hour marks, then the end; drop an hour that would collide with the end label
  for (let s = 0; s < LENGTH - LENGTH * 0.07; s += 3600) marks.push(s);
  marks.push(LENGTH);
  const p = progress.value;
  // magnet: the label nearest the tip (within 8% of the VOD) lifts and goes bold
  let hot = -1;
  let hotD = 0.08;
  marks.forEach((sec, i) => {
    const d = Math.abs(p - sec / LENGTH);
    if (d < hotD) {
      hotD = d;
      hot = i;
    }
  });
  return marks.map((sec, i) => {
    const t = sec / LENGTH;
    return {
      sec,
      label: formatHms(sec),
      left: t * 100,
      // 0:00:00 waits for the first scroll (a cleaner first view), the rest light up when passed
      on: p > 0.005 && p >= t - 0.001,
      color: silkAt(t, settings.dark),
      near: Math.max(0, 1 - Math.abs(p - t) / 0.08),
      hot: i === hot && p > 0.001,
      edge: i === 0 ? 'start' : i === marks.length - 1 ? 'end' : 'mid',
    };
  });
});
/** Ruler: a 10-minute tick every 1/(LENGTH/600) of the width, drawn in with the thread. */
const TICKS_PER_WIDTH = LENGTH / 600;
/** The call to action (pitch, pill, footer) appears once the thread is fully drawn. */
const ctaOn = computed(() => progress.value >= 0.985);
const axisClip = computed(() => {
  const rest = ((1 - progress.value) * 100).toFixed(2) + '%';
  return portrait.value ? `inset(0 0 ${rest} 0)` : `inset(0 ${rest} 0 0)`;
});

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  portraitMq?.addEventListener('change', onOrient);
  onScroll();
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onScroll);
  portraitMq?.removeEventListener('change', onOrient);
});

function open(id: string) {
  void router.push({ name: 'dashboard', params: { id } });
}
function live(channel: string) {
  void router.push({ name: 'dashboard', query: { channel } });
}
</script>

<template>
  <main class="relative">
    <!-- pinned hero: scrolling draws the thread; nothing follows it, so the last scroll position is the finished thread -->
    <div ref="track" class="relative h-[280vh]">
      <section class="sticky top-0 h-screen min-h-[640px] overflow-hidden">
        <div class="absolute inset-0">
          <HypeThread
            :series="series"
            :progress="progress"
            :cy="CY"
            :scale="SCALE"
            :span="SPAN"
            :vertical="portrait"
            ripple="page"
            end-dot
            :dark="settings.dark"
          />
        </div>
        <header class="absolute top-4 right-6 left-6 z-10 flex items-center justify-between">
          <span></span>
          <div class="flex items-center gap-2">
            <SupportButton />
            <LanguageMenu />
            <ThemeToggle />
            <RouterLink to="/dashboard" class="glass-sm px-3 py-1.5 text-xs">{{
              t('landing.dashboard')
            }}</RouterLink>
          </div>
        </header>
        <div
          class="pointer-events-none absolute top-[5vh] right-0 left-0 z-10 flex flex-col items-center gap-4 text-center portrait:top-[11vh]"
        >
          <h1
            class="font-display text-ink text-[clamp(60px,11vw,168px)] leading-[1.04] tracking-[-0.03em] pb-[0.08em]"
          >
            Hypeline
          </h1>
          <div class="eyebrow max-w-[90vw] [text-wrap:balance]">
            {{ t('landing.tagline1') }} · {{ t('landing.tagline2') }} · {{ t('landing.tagline3') }}
          </div>
        </div>
        <!-- moment cards: a glass "tab" card (timestamp as an ink pill on its top edge) pinned to
             the peak by a hairline stem ending in an ink dot on the thread. Entrance "Stagger"
             (design/thread/hypeline-card-motion.html): dot, stem, box, then pill / title / sub. -->
        <template v-if="portrait">
          <!-- portrait: the card sits beside the spine on its side, the stem runs to the dot on
               the ribbon's edge; the box shrinks when the peak leaves it less room -->
          <div
            v-for="c in cards"
            :key="'p' + c.t"
            class="mc mcv pointer-events-none absolute z-10 flex -translate-y-1/2 items-center"
            :class="[{ on: c.on }, c.side === 'r' ? 'flex-row-reverse' : 'flex-row']"
            :style="
              c.side === 'r'
                ? { top: c.along + '%', left: c.edge + '%', right: '12px' }
                : { top: c.along + '%', left: '34px', width: `calc(${c.edge}% - 34px)` }
            "
          >
            <div class="mc-box glass relative min-w-0 max-w-[176px] flex-1 px-3 pt-3.5 pb-2">
              <div
                class="mc-tab bg-ink text-ground absolute -top-[10px] left-2.5 rounded-full px-2 py-[2px] font-mono text-[9px] whitespace-nowrap"
              >
                {{ c.metaShort }}
              </div>
              <div class="mc-title font-display text-[17px] leading-[1.08]">{{ c.title }}</div>
              <div class="mc-sub text-ink-2 mt-0.5 text-[11px]">{{ c.sub }}</div>
            </div>
            <div class="mc-stem bg-ink h-px w-3.5 shrink-0"></div>
            <div class="mc-dot bg-ink h-[7px] w-[7px] shrink-0 rounded-full"></div>
          </div>
        </template>
        <div
          v-for="c in cards"
          v-else
          :key="c.t"
          class="mc pointer-events-none absolute z-10 flex w-[212px] -translate-x-1/2 -translate-y-full flex-col items-center"
          :class="{ on: c.on }"
          :style="{ left: c.left + '%', top: c.top + '%' }"
        >
          <div class="mc-box glass relative w-full px-4 pt-4 pb-2.5">
            <div
              class="mc-tab bg-ink text-ground absolute -top-[11px] left-3 rounded-full px-2.5 py-[3px] font-mono text-[10px]"
            >
              {{ c.meta }}
            </div>
            <div class="mc-title font-display text-[22px] leading-[1.05]">{{ c.title }}</div>
            <div class="mc-sub text-ink-2 mt-1 text-xs">{{ c.sub }}</div>
          </div>
          <div class="mc-stem bg-ink h-5 w-px"></div>
          <div class="mc-dot bg-ink -mt-px h-[7px] w-[7px] rounded-full"></div>
        </div>
        <!-- scroll hint: sits under the eye at its resting spot (thread start, x = span[0], y = cy)
             and fades out as soon as the thread starts drawing -->
        <div
          class="hint text-muted pointer-events-none absolute z-10 -translate-x-1/2 font-mono text-[10px] tracking-[0.18em] uppercase"
          :class="{ off: progress > 0.005 }"
          :style="
            portrait
              ? { left: CY * 100 + '%', top: SPAN[0] * 100 + 2.6 + '%' }
              : { left: SPAN[0] * 100 + '%', top: (1 - CY) * 100 + 3.2 + '%' }
          "
          aria-hidden="true"
        >
          <!-- one line, so nothing has to line up with anything: the arrow rides along the text.
               (letter-spacing trails the last glyph; pad the left so the line is centred) -->
          <span class="block pl-[0.18em] whitespace-nowrap"
            >{{ t('landing.scrollDown') }}
            <span class="hint-arrow inline-block text-[12px]">↓</span></span
          >
        </div>
        <!-- axis: Ruler + Ink + Drift (design/thread/hypeline-axis-motion.html, Angel 2026-09-13):
             10-minute ticks draw in with the thread; labels reveal (rise in) and take the silk's
             colour; the one nearest the tip lifts and goes bold (magnet) -->
        <div
          v-if="portrait"
          class="axv text-muted pointer-events-none absolute left-2 z-10 w-6 font-mono text-[10px]"
          :style="{ top: SPAN[0] * 100 + '%', bottom: (1 - SPAN[1]) * 100 + '%' }"
        >
          <div class="axv-ticks" :style="{ clipPath: axisClip }"></div>
          <span
            v-for="a in axis"
            :key="a.sec"
            class="axv-lab"
            :class="{ on: a.on, hot: a.hot }"
            :style="{ top: a.left + '%', '--near': a.near, '--c': a.color }"
            >{{ a.label }}</span
          >
        </div>
        <div
          v-else
          class="ax text-muted pointer-events-none absolute top-[71%] right-[4%] left-[4%] z-10 h-5 font-mono text-[11px]"
        >
          <div class="ax-ticks" :style="{ clipPath: axisClip }"></div>
          <span
            v-for="a in axis"
            :key="a.sec"
            class="ax-lab"
            :class="[a.edge, { on: a.on, hot: a.hot }]"
            :style="{ left: a.left + '%', '--near': a.near, '--c': a.color }"
            >{{ a.label }}</span
          >
        </div>
        <!-- call to action: hidden until the thread is fully drawn, then "Pill first"
             (design/thread/hypeline-cta-entrance.html): the pill springs open, the pitch fades
             in above it, the footer last. The pill wears a slowly turning silk ribbon. -->
        <div
          class="cta cta-pitch absolute right-0 bottom-[14vh] left-0 z-10 px-6 text-center portrait:bottom-[21vh]"
          :class="{ on: ctaOn }"
        >
          <p
            class="font-display text-ink mx-auto max-w-[920px] text-[clamp(20px,2.2vw,32px)] leading-[1.2] [text-wrap:balance]"
          >
            {{ t('landing.pitch') }}
          </p>
        </div>
        <div
          class="cta cta-pill ribbon absolute bottom-[6.5vh] left-1/2 z-10 w-[min(720px,92vw)] -translate-x-1/2 rounded-full p-[1.5px] portrait:bottom-[10.5vh]"
          :class="{ on: ctaOn }"
        >
          <VodInput :busy="false" pill :refetch="false" @submit="open" @live="live" />
        </div>
        <!-- footer lives inside the pinned hero: the page ends exactly where the thread finishes -->
        <p
          class="cta cta-foot text-muted pointer-events-none absolute right-0 bottom-[2.5vh] left-0 z-10 px-6 text-center font-mono text-[11px] portrait:bottom-[3vh]"
          :class="{ on: ctaOn }"
        >
          {{ t('landing.footFree') }} · {{ t('landing.footOpenSource') }} ·
          {{ t('landing.footNoAccount') }} · {{ t('landing.footAi') }}
        </p>
      </section>
    </div>
  </main>
</template>

<style scoped>
/* Call to action: "Pill first". The pill springs open from the centre; the pitch fades in above
   it 0.45 s later; the footer last. Leaving (scrolling back up) is quick and in reverse. */
.cta-pill {
  transition:
    opacity 0.3s,
    transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.cta-pill:not(.on) {
  opacity: 0;
  /* Tailwind v4 centres with the separate `translate` property, so only scale here */
  transform: scaleX(0.2) scaleY(0.6);
  transition:
    opacity 0.25s,
    transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1);
  pointer-events: none;
}
.cta-pitch {
  transition:
    opacity 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) 0.45s,
    transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) 0.45s;
}
.cta-pitch:not(.on) {
  opacity: 0;
  transform: translateY(12px);
  transition-delay: 0s;
  transition-duration: 0.3s;
}
.cta-foot {
  transition: opacity 0.5s 0.9s;
}
.cta-foot:not(.on) {
  opacity: 0;
  transition-delay: 0s;
}
/* Glow ring (after the reference Angel sent): not a uniform border but a few iridescent arcs
   of the silk's colours travelling around the pill at different speeds — a sharp ring in front
   and a wider, blurred one behind for the glow — over a faint full hairline. */
@property --ribbon-a {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
@property --ribbon-b {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
.ribbon {
  box-shadow: 0 18px 50px rgba(34, 28, 42, 0.08);
}
.ribbon::before,
.ribbon::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
  /* only the ring: punch out the content box so the glass stays glass */
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
}
/* sharp arcs, 2 px */
.ribbon::before {
  --ribbon-a: 0deg;
  inset: 0;
  padding: 2px;
  background:
    conic-gradient(
      from var(--ribbon-a),
      transparent 0deg,
      #ff77b5 28deg,
      #ffa968 60deg,
      #ffde68 84deg,
      transparent 110deg,
      transparent 150deg,
      #8eb0ff 170deg,
      #ae81ff 205deg,
      transparent 235deg,
      transparent 280deg,
      #ff77b5 300deg,
      #ae81ff 325deg,
      transparent 348deg
    ),
    linear-gradient(var(--glass-line) 0 0);
  animation: ribbon-turn 7s linear infinite;
}
/* the glow: wider band, blurred, other arcs, turning the other way more slowly */
.ribbon::after {
  --ribbon-b: 140deg;
  inset: -5px;
  padding: 8px;
  background: conic-gradient(
    from var(--ribbon-b),
    transparent 0deg,
    #ae81ff 30deg,
    #8eb0ff 70deg,
    transparent 105deg,
    transparent 180deg,
    #ffa968 210deg,
    #ff77b5 250deg,
    #ffde68 280deg,
    transparent 310deg
  );
  filter: blur(7px);
  opacity: 0.85;
  animation: ribbon-turn-b 11s linear infinite reverse;
}
@keyframes ribbon-turn-b {
  to {
    --ribbon-b: 500deg;
  }
}
@keyframes ribbon-turn {
  to {
    --ribbon-a: 360deg;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ribbon::before,
  .ribbon::after {
    animation: none;
  }
  .cta,
  .cta:not(.on) {
    transition-duration: 0.01s;
    transition-delay: 0s;
  }
}
/* Scroll hint: gentle bob while resting, fades out as the thread starts to draw. */
.hint {
  text-align: center;
  transition: opacity 0.45s ease;
}
.hint.off {
  opacity: 0;
}
.hint-arrow {
  animation: hint-bob 1.6s ease-in-out infinite;
}
@keyframes hint-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .hint-arrow {
    animation: none;
  }
}
/* Axis ruler: minor ticks every 10 min (4 px), hour ticks taller (7 px); clipped by progress. */
.ax-ticks {
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 8px;
  background-image:
    repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-ink) 32%, transparent) 0 1px,
      transparent 1px calc(100% / v-bind(TICKS_PER_WIDTH))
    ),
    repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-ink) 55%, transparent) 0 1px,
      transparent 1px calc(100% / (v-bind(TICKS_PER_WIDTH) / 6))
    );
  background-size:
    100% 4px,
    100% 7px;
  background-position: 0 100%;
  background-repeat: no-repeat;
}
/* Portrait ruler: the same ticks standing along the left edge, labels written upward. */
.axv-ticks {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 8px;
  background-image:
    repeating-linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-ink) 32%, transparent) 0 1px,
      transparent 1px calc(100% / v-bind(TICKS_PER_WIDTH))
    ),
    repeating-linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-ink) 55%, transparent) 0 1px,
      transparent 1px calc(100% / (v-bind(TICKS_PER_WIDTH) / 6))
    );
  background-size:
    4px 100%,
    7px 100%;
  background-position: 0 0;
  background-repeat: no-repeat;
}
.axv-lab {
  position: absolute;
  left: 11px;
  writing-mode: vertical-rl;
  white-space: nowrap;
  transform: translateY(-50%) rotate(180deg);
  translate: calc(var(--near) * 3px) 0;
  scale: calc(1 + var(--near) * 0.3);
  transform-origin: center;
  transition:
    opacity 0.4s,
    translate 0.5s cubic-bezier(0.2, 0.7, 0.2, 1),
    scale 0.5s cubic-bezier(0.2, 0.7, 0.2, 1),
    color 0.4s,
    font-weight 0.3s;
}
.axv-lab.on {
  color: var(--c);
}
.axv-lab.hot {
  font-weight: 700;
}
.axv-lab:not(.on) {
  opacity: 0;
  translate: -8px 0;
}
/* Axis labels: Reveal (rise in as the thread passes) + Magnet (the label nearest the tip lifts,
   grows and goes bold, then settles) + the silk colour at their position. */
.ax-lab {
  --lift: calc(var(--near) * -3px);
  --grow: calc(1 + var(--near) * 0.3);
  position: absolute;
  top: 2px;
  white-space: nowrap;
  transform: translateX(-50%) translateY(var(--lift)) scale(var(--grow));
  transform-origin: bottom center;
  transition:
    opacity 0.4s,
    transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1),
    color 0.4s,
    font-weight 0.3s;
}
.ax-lab.start {
  transform: translateY(var(--lift)) scale(var(--grow));
  transform-origin: bottom left;
}
.ax-lab.end {
  transform: translateX(-100%) translateY(var(--lift)) scale(var(--grow));
  transform-origin: bottom right;
}
.ax-lab.on {
  color: var(--c);
}
.ax-lab.hot {
  font-weight: 700;
}
.ax-lab:not(.on) {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
.ax-lab.start:not(.on) {
  transform: translateY(8px);
}
.ax-lab.end:not(.on) {
  transform: translateX(-100%) translateY(8px);
}
@media (prefers-reduced-motion: reduce) {
  .ax-lab {
    transition-duration: 0.01s;
  }
}
/* "Stagger" card motion. The glass box stays promoted (will-change) so its backdrop blur is
   there from the first frame instead of arriving when the transition starts. */
.mc-box {
  will-change: transform, opacity;
  /* lighter than the glass default: the big soft shadow muddied the silk below the cards */
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 var(--glass-inset);
}
.mc-box,
.mc-tab,
.mc-title,
.mc-sub,
.mc-stem,
.mc-dot {
  transition-timing-function: cubic-bezier(0.2, 0.7, 0.2, 1);
}
.mc-dot {
  transition:
    transform 0.25s,
    opacity 0.25s;
}
.mc-stem {
  transform-origin: bottom center;
  transition: transform 0.25s 0.12s;
}
.mc-box {
  transition:
    opacity 0.3s 0.25s,
    transform 0.4s 0.25s;
}
.mc-tab {
  transition:
    opacity 0.3s 0.4s,
    transform 0.3s 0.4s;
}
.mc-title {
  transition:
    opacity 0.3s 0.5s,
    transform 0.3s 0.5s;
}
.mc-sub {
  transition:
    opacity 0.3s 0.6s,
    transform 0.3s 0.6s;
}
/* leaving: the parts go in the opposite order */
.mc:not(.on) .mc-dot {
  transform: scale(0);
  opacity: 0;
  transition-delay: 0.3s;
}
.mc:not(.on) .mc-stem {
  transform: scaleY(0);
  transition-delay: 0.2s;
}
.mc:not(.on) .mc-box {
  opacity: 0;
  transform: translateY(-10px);
  transition-delay: 0.1s;
}
.mc:not(.on) .mc-tab,
.mc:not(.on) .mc-title,
.mc:not(.on) .mc-sub {
  opacity: 0;
  transform: translateY(6px);
  transition-delay: 0s;
}
/* portrait: the stem grows sideways from the box, the box slides in from its side */
.mcv .mc-stem {
  transform-origin: left center;
}
.mcv.flex-row-reverse .mc-stem {
  transform-origin: right center;
}
.mcv:not(.on) .mc-stem {
  transform: scaleX(0);
}
.mcv:not(.on) .mc-box {
  transform: translateX(-8px);
}
.mcv.flex-row-reverse:not(.on) .mc-box {
  transform: translateX(8px);
}
@media (prefers-reduced-motion: reduce) {
  .mc-box,
  .mc-tab,
  .mc-title,
  .mc-sub,
  .mc-stem,
  .mc-dot {
    transition-duration: 0.01s;
    transition-delay: 0s;
  }
}
</style>
