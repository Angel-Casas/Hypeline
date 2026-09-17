<script setup lang="ts">
/** A small "?" that opens a popover listing the keyboard shortcuts (hover or click). */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SHORTCUTS } from '@/features/clips/useShortcuts';

const { t } = useI18n();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
function onDoc(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
onMounted(() => {
  document.addEventListener('pointerdown', onDoc);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDoc);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="relative inline-flex" @mouseenter="open = true" @mouseleave="open = false">
    <button
      type="button"
      class="glass-sm text-muted hover:text-ink grid h-7 w-7 place-items-center font-mono text-[13px] font-bold"
      :aria-expanded="open"
      :aria-label="t('shortcuts.title')"
      :title="t('shortcuts.title')"
      @click="open = !open"
    >
      ?
    </button>
    <Transition name="tip">
      <div
        v-if="open"
        class="glass absolute bottom-full left-0 z-30 mb-2 w-64 p-3 text-xs"
        role="tooltip"
      >
        <div class="eyebrow mb-2">{{ t('shortcuts.keyboard') }}</div>
        <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
          <template v-for="s in SHORTCUTS" :key="s.id">
            <dt class="flex gap-1">
              <kbd v-for="k in s.keys" :key="k">{{ k }}</kbd>
            </dt>
            <dd class="text-ink-2">{{ t(`shortcuts.actions.${s.id}`) }}</dd>
          </template>
        </dl>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
kbd {
  font: 600 10.5px var(--font-mono);
  color: var(--color-ink);
  background: color-mix(in srgb, var(--color-lift) 70%, transparent);
  border: 1px solid var(--color-line);
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 1px 5px;
  min-width: 20px;
  text-align: center;
  line-height: 1.4;
}
.tip-enter-active,
.tip-leave-active {
  transition:
    opacity 0.15s,
    transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
@media (prefers-reduced-motion: reduce) {
  .tip-enter-active,
  .tip-leave-active {
    transition: none;
  }
}
</style>
