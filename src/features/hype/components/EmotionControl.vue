<script setup lang="ts">
/**
 * The chat-mood control (ADR-43): off, or one axis at a time.
 *
 * One axis at a time on purpose. Two mirrored pairs sharing a spine is unreadable — four
 * lobes overlapping about one line — so this is a single-choice list rather than a set of
 * toggles, and "off" is the first entry rather than a separate switch, which keeps the whole
 * control one tab stop and one decision.
 *
 * It also reports when the layer had to widen its buckets. That is not a detail we can hide:
 * on a quiet chat the emotion layer is reading minute-long windows while the heatmap beside
 * it reads fifteen-second ones, and someone comparing the two deserves to know why the mood
 * curve is smoother than the thread.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { AXES, AXIS_LABEL_KEY, BASE_BUCKET_SEC } from '../emotion';

const props = defineProps<{
  modelValue: string;
  /** The width the layer actually chose, so a widened bucket can say so. */
  bucketSec?: number | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const { t } = useI18n();
const widened = computed(
  () => !!props.modelValue && !!props.bucketSec && props.bucketSec > BASE_BUCKET_SEC,
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <label class="eyebrow shrink-0" for="emotion-axis">{{ t('emotion.title') }}</label>
    <select
      id="emotion-axis"
      class="field h-7 py-0 text-xs"
      :aria-label="t('emotion.aria')"
      data-testid="emotion-axis"
      :value="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">{{ t('emotion.off') }}</option>
      <option v-for="a in AXES" :key="a.key" :value="a.key">
        {{ t(AXIS_LABEL_KEY[a.key]) }}
      </option>
    </select>
    <span
      v-if="widened"
      class="text-muted font-mono text-[10px]"
      data-testid="emotion-widened"
      >{{ t('emotion.widened', { sec: bucketSec }) }}</span
    >
    <span v-else-if="!modelValue" class="text-muted hidden text-[11px] sm:inline">{{
      t('emotion.hint')
    }}</span>
  </div>
</template>
