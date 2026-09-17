import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { estimateQuota, quotaLevel, requestPersist, type QuotaInfo } from '@/lib/storage/quota';

/** Origin storage quota, refreshed on page load and after every write that matters. */
export const useQuotaStore = defineStore('quota', () => {
  const info = ref<QuotaInfo>({ usage: 0, quota: 0, ratio: 0, persisted: false, unknown: true });
  const level = computed(() => quotaLevel(info.value));
  const free = computed(() => Math.max(0, info.value.quota - info.value.usage));
  /** Set when a save failed because the quota was hit; cleared on the next successful refresh below 'critical'. */
  const lastWriteFailed = ref(false);

  async function refresh(): Promise<QuotaInfo> {
    info.value = await estimateQuota();
    if (level.value !== 'critical') lastWriteFailed.value = false;
    return info.value;
  }

  async function persist(): Promise<boolean> {
    const ok = await requestPersist();
    await refresh();
    return ok;
  }

  function noteWriteFailure() {
    lastWriteFailed.value = true;
    void refresh();
  }

  return { info, level, free, lastWriteFailed, refresh, persist, noteWriteFailure };
});
