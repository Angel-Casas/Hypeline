<script setup lang="ts">
/**
 * First visit (ADR-20): the browser's language is already in effect; this sheet asks the
 * user to confirm it or pick another. Tapping a language previews it at once (the headline
 * changes), "Continue" keeps it. Escape or the backdrop keep the current one. Shown once —
 * `chosen` flips when a choice is stored.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { chosen, i18n, LOCALES, locale, setLocale, type Locale } from '@/i18n';

const { t } = useI18n();
const root = ref<HTMLDivElement | null>(null);
/** Closed from inside too, so the sheet leaves even if the shared `chosen` ref is stale. */
const closed = ref(false);

function preview(code: Locale) {
  i18n.global.locale.value = code;
}
function keep() {
  setLocale(locale.value);
  closed.value = true;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') keep();
}
onMounted(() => {
  document.addEventListener('keydown', onKey);
  // focus the sheet itself: keys work at once, without a focus ring on the pre-selected pill
  root.value?.focus();
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    v-if="!chosen && !closed"
    class="scrim-soft fixed inset-0 z-[80] flex items-end justify-center p-3 backdrop-blur-[10px] backdrop-saturate-125 sm:items-center"
    role="dialog"
    aria-modal="true"
    :aria-label="t('language.chooseTitle')"
    data-testid="language-sheet"
    @click.self="keep"
  >
    <div
      ref="root"
      tabindex="-1"
      class="lang-sheet w-full max-w-md rounded-3xl p-5 outline-none sm:p-6"
    >
      <p class="eyebrow">{{ t('language.title') }}</p>
      <h2 class="mt-1.5 font-display text-2xl leading-tight text-ink text-balance">
        {{ t('language.chooseTitle') }}
      </h2>
      <p class="text-muted mt-1.5 text-xs leading-relaxed">{{ t('language.chooseHint') }}</p>
      <div
        class="mt-4 grid grid-cols-2 gap-1.5"
        role="radiogroup"
        :aria-label="t('language.title')"
      >
        <button
          v-for="l in LOCALES"
          :key="l.code"
          type="button"
          role="radio"
          :aria-checked="l.code === locale"
          :lang="l.code"
          class="flex flex-col items-start rounded-xl px-3 py-2 text-left transition-colors hover-wash focus:bg-[var(--hover-wash)] focus:outline-none"
          :class="l.code === locale ? 'silk-ring bg-ink/4' : ''"
          @click="preview(l.code)"
        >
          <span class="text-[13.5px] font-semibold text-ink">{{ l.native }}</span>
          <span class="text-muted text-[10.5px]">{{ l.name }}</span>
        </button>
      </div>
      <div class="mt-4 flex items-center justify-between gap-3">
        <span class="text-muted font-mono text-[10.5px]">{{ t('language.later') }}</span>
        <button type="button" class="btn-silk" data-testid="language-continue" @click="keep">
          {{ t('language.continue') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim-soft {
  background: var(--scrim-soft);
}
.lang-sheet {
  background: var(--color-ground);
  border: 1px solid var(--glass-line);
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.3),
    0 4px 14px rgba(0, 0, 0, 0.1);
  animation: sheet-in 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes sheet-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lang-sheet {
    animation: none;
  }
}
</style>
