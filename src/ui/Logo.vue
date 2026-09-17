<script setup lang="ts">
/**
 * The mark (2026-09-17, "H Spine · serif feet", chosen by Angel from ten candidates): a
 * Gloock-weight H with slab feet whose crossbar is a hype-thread peak in silk. The stems are
 * the In and Out handles of a clip, the peak between them the moment. Ink follows
 * `currentColor`; the silk is the app's gradient. Sits in the rail where the wordmark was.
 *
 * `hover`: the "Handles" motion (chosen from five, 2026-09-17) — when the link around it is
 * hovered or focused, the stems nudge inward and the peak tightens, the clip range closing on
 * a moment; it settles back on leave. Off by default so the mark stays still elsewhere.
 */
import { useId } from 'vue';

withDefaults(defineProps<{ size?: number | string; hover?: boolean }>(), {
  size: 28,
  hover: false,
});
// gradient ids must be unique per instance: two marks on one page (drawer + rail) would
// otherwise share one <defs>, and a hidden first instance breaks the reference in Safari
const gid = `silk-${useId()}`;
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    fill="none"
    aria-hidden="true"
    class="hl-mark"
    :class="{ 'hl-mark-hover': hover }"
  >
    <defs>
      <linearGradient :id="gid" gradientUnits="userSpaceOnUse" x1="15" y1="0" x2="49" y2="0">
        <stop offset="0" stop-color="#ffa968" />
        <stop offset="0.3" stop-color="#ff77b5" />
        <stop offset="0.62" stop-color="#b39cff" />
        <stop offset="0.85" stop-color="#8eb0ff" />
        <stop offset="1" stop-color="#ffde68" />
      </linearGradient>
    </defs>
    <g class="stem-l">
      <path
        d="M9 11 H21 M9 53 H21"
        stroke="currentColor"
        stroke-width="3.2"
        stroke-linecap="round"
      />
      <path d="M15 11 V53" stroke="currentColor" stroke-width="5.6" />
    </g>
    <g class="stem-r">
      <path
        d="M43 11 H55 M43 53 H55"
        stroke="currentColor"
        stroke-width="3.2"
        stroke-linecap="round"
      />
      <path d="M49 11 V53" stroke="currentColor" stroke-width="5.6" />
    </g>
    <path
      class="peak"
      d="M15 38 C 22 38, 25 20, 32 20 S 42 38, 49 38"
      :stroke="`url(#${gid})`"
      stroke-width="5"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
/* the motion is keyed to the nearest link/button so the whole hit area triggers it */
.hl-mark-hover .stem-l,
.hl-mark-hover .stem-r,
.hl-mark-hover .peak {
  transition: transform 380ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.hl-mark-hover .peak {
  transform-origin: 32px 38px;
}
:is(a, button):is(:hover, :focus-visible) > .hl-mark-hover .stem-l {
  transform: translateX(4px);
}
:is(a, button):is(:hover, :focus-visible) > .hl-mark-hover .stem-r {
  transform: translateX(-4px);
}
:is(a, button):is(:hover, :focus-visible) > .hl-mark-hover .peak {
  transform: scaleX(0.78) scaleY(1.12);
}
@media (prefers-reduced-motion: reduce) {
  .hl-mark-hover .stem-l,
  .hl-mark-hover .stem-r,
  .hl-mark-hover .peak {
    transition: none;
  }
}
</style>
