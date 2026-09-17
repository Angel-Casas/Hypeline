<script setup lang="ts">
/**
 * Overlay for the 'split' (cam + game) layout: a draggable/resizable 16:9
 * facecam box and a draggable window for the main view. Fractions of the frame.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SplitLayout } from '@/lib/video/cut';

const props = defineProps<{ layout: SplitLayout }>();
const emit = defineEmits<{ update: [layout: SplitLayout] }>();

const { t } = useI18n();
const host = ref<HTMLDivElement | null>(null);
const dragging = ref<'cam' | 'game' | 'resize' | null>(null);
let grab = { dx: 0, dy: 0 };

/** In a 16:9 frame a 16:9 box's height fraction equals its width fraction. */
const camHFrac = computed(() => props.layout.camW);

const gameShare = computed(() => 1 - Math.min(0.5, Math.max(0.25, props.layout.camShare)));
/** Game window width fraction: output ratio (9:16 of the lower strip) mapped onto the 16:9 frame. */
const gameWFrac = computed(() => {
  const outW = 9 / 16; // relative to output height (=frame height)
  const gameH = gameShare.value;
  const gw = outW / gameH; // width in frame-height units
  return Math.min(1, gw / (16 / 9));
});
const gameLeft = computed(() =>
  Math.max(0, Math.min(1 - gameWFrac.value, props.layout.gameCenterX - gameWFrac.value / 2)),
);

function rect() {
  return host.value!.getBoundingClientRect();
}
function start(kind: 'cam' | 'game' | 'resize', e: PointerEvent) {
  const r = rect();
  const fx = (e.clientX - r.left) / r.width;
  const fy = (e.clientY - r.top) / r.height;
  if (kind === 'cam') grab = { dx: fx - props.layout.camX, dy: fy - props.layout.camY };
  else if (kind === 'game') grab = { dx: fx - props.layout.gameCenterX, dy: 0 };
  else grab = { dx: 0, dy: 0 };
  dragging.value = kind;
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
  e.preventDefault();
  e.stopPropagation();
}
function move(e: PointerEvent) {
  if (!dragging.value || !host.value) return;
  const r = rect();
  const fx = (e.clientX - r.left) / r.width;
  const fy = (e.clientY - r.top) / r.height;
  const l = { ...props.layout };
  if (dragging.value === 'cam') {
    l.camX = Math.max(0, Math.min(1 - l.camW, fx - grab.dx));
    l.camY = Math.max(0, Math.min(1 - camHFrac.value, fy - grab.dy));
  } else if (dragging.value === 'game') {
    l.gameCenterX = Math.max(0, Math.min(1, fx - grab.dx));
  } else {
    l.camW = Math.max(0.12, Math.min(0.6, fx - l.camX));
    l.camX = Math.min(l.camX, 1 - l.camW);
  }
  emit('update', l);
}
function end() {
  dragging.value = null;
}
</script>

<template>
  <div ref="host" class="pointer-events-none absolute inset-0">
    <!-- game window (lower strip source) -->
    <div
      class="absolute inset-y-0 left-0 bg-black/45"
      :style="{ width: gameLeft * 100 + '%' }"
    ></div>
    <div
      class="absolute inset-y-0 right-0 bg-black/45"
      :style="{ width: (1 - gameLeft - gameWFrac) * 100 + '%' }"
    ></div>
    <div
      class="pointer-events-auto absolute inset-y-0 cursor-grab border-2 border-yellow-400"
      :style="{ left: gameLeft * 100 + '%', width: gameWFrac * 100 + '%' }"
      :title="t('overlay.mainViewTip')"
      @pointerdown="start('game', $event)"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
    >
      <span class="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-warn">{{
        t('overlay.mainViewDrag')
      }}</span>
    </div>
    <!-- facecam box -->
    <div
      class="pointer-events-auto absolute cursor-grab border-2 border-cyan-400"
      :style="{
        left: layout.camX * 100 + '%',
        top: layout.camY * 100 + '%',
        width: layout.camW * 100 + '%',
        height: camHFrac * 100 + '%',
      }"
      :title="t('overlay.facecamTip')"
      @pointerdown="start('cam', $event)"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
    >
      <span class="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-cyan-300">{{
        t('overlay.camDrag')
      }}</span>
      <div
        class="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize bg-cyan-400"
        :title="t('overlay.resize')"
        @pointerdown="start('resize', $event)"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
      ></div>
    </div>
  </div>
</template>
