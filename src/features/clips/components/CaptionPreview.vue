<script setup lang="ts">
/** Shows the caption cue for the current player time over the video, when captions are on. Approximates the burned-in look. */
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useClipStore } from '../stores/clipStore';

const props = defineProps<{ currentTime: number }>();
const store = useClipStore();
const { captionsOn, captionCues, captionStyle, inSec } = storeToRefs(store);

const cue = computed(() => {
  if (!captionsOn.value || inSec.value == null) return null;
  const t = props.currentTime - inSec.value;
  return captionCues.value.find((c) => t >= c.start && t < c.end) ?? null;
});
</script>

<template>
  <div
    v-if="cue"
    class="pointer-events-none absolute inset-x-0 flex justify-center px-[6%]"
    :class="captionStyle === 'top' ? 'top-[10%]' : 'bottom-[10%]'"
  >
    <span
      class="max-w-full text-center font-bold leading-tight"
      :class="
        captionStyle === 'boxed'
          ? 'bg-black/65 px-2 py-1 text-white'
          : 'text-white [text-shadow:_-2px_-2px_0_#000,_2px_-2px_0_#000,_-2px_2px_0_#000,_2px_2px_0_#000]'
      "
      :style="{ fontSize: captionStyle === 'top' ? '1.9cqw' : '2.4cqw' }"
    >
      {{ cue.text }}
    </span>
  </div>
</template>
