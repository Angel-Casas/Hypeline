<script setup lang="ts">
/**
 * A new build is waiting (2026-09-17): a small paper toast above the bottom edge, never a
 * reload under the user's feet — a clip could be exporting. Dismissing keeps the old build
 * until the next visit.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { needRefresh, reloadForUpdate } from '@/lib/pwa';

const { t } = useI18n();
const busy = ref(false);
async function reload() {
  busy.value = true;
  await reloadForUpdate();
}
</script>

<template>
  <Transition name="toast">
    <div
      v-if="needRefresh"
      class="toast fixed right-3 bottom-3 left-3 z-[85] mx-auto flex max-w-[420px] items-center gap-3 rounded-2xl px-4 py-3"
      role="status"
      data-testid="update-toast"
    >
      <span class="min-w-0 flex-1">
        <span class="block text-[13px] font-semibold text-ink">{{ t('update.title') }}</span>
        <span class="text-muted block text-[11.5px] leading-tight">{{ t('update.body') }}</span>
      </span>
      <button class="btn-silk px-3! py-1.5! text-xs" data-testid="update-reload" @click="reload">
        {{ busy ? '…' : t('update.action') }}
      </button>
      <button
        class="text-muted grid h-7 w-7 shrink-0 place-items-center rounded-full text-[15px] leading-none hover-wash"
        :aria-label="t('update.later')"
        :title="t('update.later')"
        @click="needRefresh = false"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  background: var(--color-ground);
  border: 1px solid var(--glass-line);
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.28),
    0 2px 8px rgba(0, 0, 0, 0.1);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 200ms ease,
    transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
