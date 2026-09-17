<script setup lang="ts">
/**
 * Laid over the player when Twitch gates this VOD behind a subscription: the embed would sit
 * on its spinner forever for an anonymous viewer, and a cut would be refused the same way.
 * Chat and frames are not gated, so the rest of the desk keeps working (2026-09-16).
 */
import { useI18n } from 'vue-i18n';

defineProps<{ vodId: string; streamer: string }>();
const { t } = useI18n();
</script>

<template>
  <div
    class="sub-only absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4 text-center backdrop-blur-sm"
    role="status"
    data-testid="sub-only"
  >
    <div class="bg-ground max-w-sm rounded-2xl px-6 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
      <p class="eyebrow">{{ t('subOnly.eyebrow') }}</p>
      <h3 class="mt-2 font-display text-lg leading-tight text-ink text-balance">
        {{ t('subOnly.title', { streamer: streamer || t('subOnly.thisChannel') }) }}
      </h3>
      <p class="text-muted mt-2 text-xs leading-relaxed text-pretty">
        {{ t('subOnly.body') }}
      </p>
      <a
        class="btn-ghost mt-4 inline-flex text-xs"
        :href="`https://www.twitch.tv/videos/${vodId}`"
        target="_blank"
        rel="noopener"
        >{{ t('common.watchOnTwitch') }}</a
      >
    </div>
  </div>
</template>
