<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { parseVodInput } from '@/lib/twitch/vodUrl';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    busy: boolean;
    pill?: boolean;
    refetch?: boolean;
    compact?: boolean;
    placeholder?: string;
  }>(),
  { pill: false, refetch: true, compact: false, placeholder: 'twitch.tv/videos/2871164819' },
);
const emit = defineEmits<{ submit: [vodId: string, force: boolean]; live: [channel: string] }>();
const value = ref('');
const bad = ref(false);

function go(force = false) {
  const p = parseVodInput(value.value);
  bad.value = !p;
  if (!p || props.busy) return;
  if ('channel' in p) emit('live', p.channel);
  else emit('submit', p.vodId, force);
}
</script>

<template>
  <form
    class="flex gap-2"
    :class="
      pill
        ? 'glass items-center rounded-full! p-2 pl-5'
        : compact
          ? 'flex-col'
          : 'flex-wrap items-center'
    "
    @submit.prevent="go(false)"
  >
    <span v-if="pill" class="eyebrow hidden sm:inline">{{ t('vodInput.vodLink') }}</span>
    <input
      v-model="value"
      type="text"
      :placeholder="placeholder"
      :aria-label="t('vodInput.ariaLabel')"
      class="min-w-0 flex-1 text-sm"
      :class="[
        pill ? 'bg-transparent px-3 py-2 font-mono outline-none' : 'field',
        bad ? 'text-danger' : '',
      ]"
    />
    <button
      type="submit"
      :disabled="busy"
      :class="[pill ? 'btn-ink rounded-full!' : 'btn-silk', { 'w-full justify-center': compact }]"
    >
      {{ t('vodInput.findMoments') }}
    </button>
    <button
      v-if="refetch && !compact"
      type="button"
      :disabled="busy"
      class="btn-ghost text-xs"
      @click="go(true)"
    >
      {{ t('vodInput.refetch') }}
    </button>
  </form>
</template>
