<script setup lang="ts">
/**
 * Draggable crop window drawn over the player for 9:16 / 1:1 exports.
 * The container is pointer-transparent so the Twitch player stays usable;
 * only the window itself captures drags.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Aspect } from '@/lib/video/cut';

const props = defineProps<{ aspect: Aspect; centerX: number }>();
const emit = defineEmits<{ 'update:centerX': [v: number] }>();

const { t } = useI18n();
const host = ref<HTMLDivElement | null>(null);
const dragging = ref(false);
let grabOffset = 0; // px between pointer and window centre at drag start

/** Window width as a fraction of the 16:9 frame width. */
const widthFrac = computed(() => {
  const frameRatio = 16 / 9;
  const target = props.aspect === '9:16' ? 9 / 16 : 1;
  return Math.min(1, target / frameRatio);
});
const leftFrac = computed(() => {
  const half = widthFrac.value / 2;
  return Math.max(0, Math.min(1 - widthFrac.value, props.centerX - half));
});

function onDown(e: PointerEvent) {
  const el = host.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  grabOffset = e.clientX - (r.left + (leftFrac.value + widthFrac.value / 2) * r.width);
  dragging.value = true;
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onMove(e: PointerEvent) {
  if (!dragging.value || !host.value) return;
  const r = host.value.getBoundingClientRect();
  const c = (e.clientX - grabOffset - r.left) / r.width;
  emit('update:centerX', Math.max(0, Math.min(1, c)));
}
function onUp() {
  dragging.value = false;
}
</script>

<template>
  <div
    v-if="aspect === '9:16' || aspect === '1:1'"
    ref="host"
    class="pointer-events-none absolute inset-0"
  >
    <div
      class="absolute inset-y-0 left-0 bg-black/50"
      :style="{ width: leftFrac * 100 + '%' }"
    ></div>
    <div
      class="absolute inset-y-0 right-0 bg-black/50"
      :style="{ width: (1 - leftFrac - widthFrac) * 100 + '%' }"
    ></div>
    <div
      class="pointer-events-auto absolute inset-y-0 cursor-grab border-2 border-yellow-400"
      :class="{ 'cursor-grabbing': dragging }"
      :style="{ left: leftFrac * 100 + '%', width: widthFrac * 100 + '%' }"
      :title="t('overlay.dragCrop')"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <span class="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-warn"
        >{{ aspect }} · {{ t('overlay.drag') }}</span
      >
    </div>
  </div>
</template>
