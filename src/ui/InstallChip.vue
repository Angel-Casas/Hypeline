<script setup lang="ts">
/**
 * "Install Hypeline" (2026-09-17): one quiet line in the rail, shown only when the browser
 * has actually offered an install, and only until the user says no once. No modal, no banner
 * over the desk — the app works perfectly in a tab.
 */
import { useI18n } from 'vue-i18n';
import Logo from './Logo.vue';
import { dismissInstall, installable, promptInstall } from '@/lib/pwa';

const { t } = useI18n();
</script>

<template>
  <div
    v-if="installable"
    class="install border-line flex items-center gap-2 border-t pt-2"
    data-testid="install-chip"
  >
    <Logo :size="18" class="shrink-0 opacity-80" />
    <span class="min-w-0 flex-1">
      <span class="block text-[12px] font-semibold text-ink">{{ t('install.title') }}</span>
      <span class="text-muted block font-mono text-[10px] leading-tight">{{
        t('install.body')
      }}</span>
    </span>
    <button
      class="btn-ghost px-2.5! py-1! text-[11px]"
      data-testid="install-go"
      @click="promptInstall()"
    >
      {{ t('install.action') }}
    </button>
    <button
      class="text-muted grid h-6 w-6 shrink-0 place-items-center rounded-full text-[14px] leading-none hover:bg-ink/6"
      :aria-label="t('install.dismiss')"
      :title="t('install.dismiss')"
      data-testid="install-no"
      @click="dismissInstall()"
    >
      ×
    </button>
  </div>
</template>
