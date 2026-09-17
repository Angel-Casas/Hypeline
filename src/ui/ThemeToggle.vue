<script setup lang="ts">
/** Day / night switch: a sun or a moon, in the glass-sm pill style. */
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/features/settings/settingsStore';

const { t } = useI18n();
const settings = useSettingsStore();
function onClick(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  settings.toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}
</script>

<template>
  <button
    type="button"
    class="glass-sm inline-flex h-8 w-8 items-center justify-center text-ink"
    :title="settings.dark ? t('theme.toDay') : t('theme.toNight')"
    :aria-label="settings.dark ? t('theme.toDayMode') : t('theme.toNightMode')"
    @click="onClick"
  >
    <svg
      v-if="settings.dark"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      />
    </svg>
    <svg
      v-else
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  </button>
</template>
