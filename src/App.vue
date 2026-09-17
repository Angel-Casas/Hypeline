<script setup lang="ts">
/** App shell: the pastel atmosphere lives here so every page shares it. */
import LanguageSheet from '@/ui/LanguageSheet.vue';
import UpdateToast from '@/ui/UpdateToast.vue';
</script>

<template>
  <div class="hl-mesh" aria-hidden="true"></div>
  <svg class="hl-grain" aria-hidden="true" width="100%" height="100%">
    <filter id="hl-noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
      <feColorMatrix values="0 0 0 0 .13 0 0 0 0 .11 0 0 0 0 .16 0 0 0 .3 0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#hl-noise)" />
  </svg>
  <RouterView />
  <LanguageSheet />
  <UpdateToast />
</template>
