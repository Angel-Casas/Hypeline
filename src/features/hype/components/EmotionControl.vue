<script setup lang="ts">
/**
 * The chat-mood control (ADR-43): off, or one axis at a time.
 *
 * One axis at a time on purpose. Two mirrored pairs sharing a spine is unreadable — four
 * lobes overlapping about one line — so this is a single-choice menu rather than a set of
 * toggles, and "off" is the first entry rather than a separate switch, which keeps the whole
 * control one tab stop and one decision.
 *
 * It is a `MenuButton` (ADR-27) rather than a `<select>`: the same paper menu the clip
 * panel's pills open, so the app has one dropdown and not two. It wears the silk, because
 * unlike SIZE or SHAPE this is not a setting someone arrives looking for — it is an offer of
 * a second way to read the stream, and it has to catch the eye to be found at all
 * (Angel, 2026-09-21).
 *
 * It also reports when the layer had to widen its buckets. That is not a detail we can hide:
 * on a quiet chat the emotion layer is reading minute-long windows while the heatmap beside
 * it reads fifteen-second ones, and someone comparing the two deserves to know why the mood
 * curve is smoother than the thread.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MenuButton, { type MenuOption } from '@/ui/MenuButton.vue';
import { AXES, AXIS_LABEL_KEY, BASE_BUCKET_SEC, type AxisKey } from '../emotion';

const props = defineProps<{
  modelValue: string;
  /** The width the layer actually chose, so a widened bucket can say so. */
  bucketSec?: number | null;
}>();
const emit = defineEmits<{
  'update:modelValue': [string];
  /** An axis the pointer is resting on in the open menu ('' = off), or null when none. */
  preview: [string | null];
}>();

const { t } = useI18n();

const options = computed<MenuOption[]>(() => [
  { v: '', l: t('emotion.off') },
  ...AXES.map((a) => ({ v: a.key, l: t(AXIS_LABEL_KEY[a.key]) })),
]);
/** What the pill reads: the chosen axis, or "off". */
const shown = computed(() =>
  props.modelValue ? t(AXIS_LABEL_KEY[props.modelValue as AxisKey]) : t('emotion.off'),
);
const widened = computed(
  () => !!props.modelValue && !!props.bucketSec && props.bucketSec > BASE_BUCKET_SEC,
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
    <MenuButton
      silk
      data-testid="emotion-axis"
      :label="t('emotion.title')"
      :value="shown"
      :options="options"
      :model-value="modelValue"
      :title="t('emotion.hint')"
      @update:model-value="emit('update:modelValue', String($event))"
      @preview="emit('preview', $event == null ? null : String($event))"
    />
    <span v-if="widened" class="text-muted font-mono text-[10px]" data-testid="emotion-widened">{{
      t('emotion.widened', { sec: bucketSec })
    }}</span>
    <span v-else-if="!modelValue" class="text-muted hidden text-[11px] sm:inline">{{
      t('emotion.hint')
    }}</span>
  </div>
</template>
