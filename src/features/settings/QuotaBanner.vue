<script setup lang="ts">
/**
 * Storage warning shown at the top of the home and VOD pages when the
 * browser's quota for this origin is getting full (or a save already failed).
 */
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useQuotaStore } from './quotaStore';
import { formatBytes } from '@/lib/storage/quota';

const { t } = useI18n();
const quota = useQuotaStore();
const { info, level, free, lastWriteFailed } = storeToRefs(quota);
onMounted(() => void quota.refresh());
</script>

<template>
  <div
    v-if="level !== 'ok' || lastWriteFailed"
    class="rounded-xl border p-2 text-xs"
    :class="
      level === 'critical' || lastWriteFailed
        ? 'border-danger/40 bg-petal/60 text-danger'
        : 'border-warn/40 bg-butter/60'
    "
    data-testid="quota-banner"
  >
    <template v-if="lastWriteFailed">
      <strong>{{ t('quota.fullLabel') }}</strong> {{ t('quota.fullBody') }}
    </template>
    <template v-else>
      <strong>{{
        level === 'critical' ? t('quota.almostFullLabel') : t('quota.fillingUpLabel')
      }}</strong>
      {{
        t('quota.usage', {
          usage: formatBytes(info.usage),
          quota: formatBytes(info.quota),
          free: formatBytes(free),
        })
      }}
    </template>
    <i18n-t keypath="quota.freeSpace" tag="span">
      <template #homePage
        ><RouterLink to="/" class="underline">{{ t('quota.homePage') }}</RouterLink></template
      >
    </i18n-t>
  </div>
</template>
