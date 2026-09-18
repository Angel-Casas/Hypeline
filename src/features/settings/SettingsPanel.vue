<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTourStore } from '@/features/tour/tourStore';
import { API_KEYS_URL, REFERRAL_URL } from '@/lib/nanogpt/client';
import { DEFAULT_RELAY_URL, useSettingsStore } from './settingsStore';
import { useRouter } from 'vue-router';
import { useQuotaStore } from './quotaStore';
import { formatBytes } from '@/lib/storage/quota';
import {
  clearAi,
  clearAppCache,
  clearClips,
  clearForeign,
  clearVods,
  eraseEverything,
  storageBreakdown,
  type Breakdown,
} from '@/lib/storage/cleanup';
import { useVodStore } from '@/features/vod/stores/vodStore';

const { t } = useI18n();
const tour = useTourStore();
const settings = useSettingsStore();
const quota = useQuotaStore();
const persistResult = ref<string | null>(null);
async function persist() {
  persistResult.value = (await quota.persist())
    ? t('settings.persistGranted')
    : t('settings.persistDenied');
}
/**
 * Storage (2026-09-17): what is kept, by kind, each with its own "clear"; "erase everything"
 * asks twice. The browser's own total can lag behind a delete (Chrome reclaims IndexedDB
 * space in the background), so the kinds are measured directly and a note says so.
 */
const usage = ref<Breakdown | null>(null);
const busy = ref<string | null>(null);
const confirmErase = ref(false);
const vod = useVodStore();
const router = useRouter();
async function measure() {
  try {
    usage.value = await storageBreakdown();
    await quota.refresh();
  } catch {
    usage.value = null;
  }
}
onMounted(measure);
type ClearKind = 'vods' | 'clips' | 'ai' | 'cache' | 'foreign' | 'all';
async function clear(kind: ClearKind) {
  if (kind === 'all' && !confirmErase.value) {
    confirmErase.value = true;
    return;
  }
  busy.value = kind;
  try {
    if (kind === 'vods') await clearVods();
    else if (kind === 'clips') await clearClips();
    else if (kind === 'ai') await clearAi();
    else if (kind === 'cache') await clearAppCache();
    else if (kind === 'foreign') await clearForeign();
    else await eraseEverything();
    // the open VOD is gone with its kind: back to the home
    if ((kind === 'vods' || kind === 'all') && vod.info) {
      vod.reset();
      void router.push({ name: 'dashboard' });
    }
  } finally {
    busy.value = null;
    confirmErase.value = false;
    await measure();
  }
}
const KINDS: { id: 'vods' | 'clips' | 'ai' | 'cache'; key: 'vods' | 'clips' | 'ai' | 'cache' }[] = [
  { id: 'vods', key: 'vods' },
  { id: 'clips', key: 'clips' },
  { id: 'ai', key: 'ai' },
  { id: 'cache', key: 'cache' },
];
</script>

<template>
  <section class="glass flex max-h-[88vh] flex-col gap-2 overflow-y-auto p-4 pr-12 text-sm">
    <h2 class="font-semibold">{{ t('common.settings') }}</h2>
    <div class="border-line flex flex-col gap-1 border-t pt-2 text-xs">
      <div class="font-semibold">{{ t('settings.nanogptKey') }}</div>
      <p class="text-muted">{{ t('settings.keyIntro') }}</p>
      <!-- Getting a key is three steps and most people have never done any of them (Angel,
           2026-09-18). Numbered, with the two links they need in the steps that need them. -->
      <ol class="steps text-muted">
        <li>
          <i18n-t keypath="settings.keyStep1" tag="span">
            <template #link>
              <a
                :href="REFERRAL_URL"
                target="_blank"
                rel="noopener"
                class="text-accent underline"
                >{{ t('settings.keyLinkSite') }}</a
              >
            </template>
          </i18n-t>
        </li>
        <li>{{ t('settings.keyStep2') }}</li>
        <li>
          <i18n-t keypath="settings.keyStep3" tag="span">
            <template #link>
              <a
                :href="API_KEYS_URL"
                target="_blank"
                rel="noopener"
                class="text-accent underline"
                >{{ t('settings.keyLinkApi') }}</a
              >
            </template>
          </i18n-t>
        </li>
      </ol>
      <div class="flex items-center gap-2">
        <input
          v-model.trim="settings.aiApiKey"
          type="password"
          :placeholder="t('settings.keyPlaceholder')"
          class="field min-w-0 flex-1"
          :aria-label="t('settings.keyAria')"
        />
        <button
          v-if="settings.aiApiKey"
          class="purge grid h-7 w-7 shrink-0 place-items-center rounded-full text-[16px] leading-none"
          :title="t('settings.removeKey')"
          :aria-label="t('settings.removeKey')"
          @click="settings.aiApiKey = ''"
        >
          ×
        </button>
      </div>
    </div>
    <div class="border-line flex flex-col gap-1 border-t pt-2 text-xs" data-testid="storage">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-semibold">{{ t('storage.title') }}</span>
        <span v-if="!quota.info.unknown" class="text-muted font-mono text-[10.5px]">
          {{
            t('storage.browserTotal', {
              usage: formatBytes(quota.info.usage),
              quota: formatBytes(quota.info.quota),
            })
          }}
        </span>
      </div>
      <ul v-if="usage" class="flex flex-col">
        <li
          v-for="k in KINDS"
          :key="k.id"
          class="flex items-center justify-between gap-3 py-1"
          :data-kind="k.id"
        >
          <span class="min-w-0">
            <span>{{ t(`storage.kind.${k.id}`) }}</span>
            <span class="text-muted font-mono text-[10.5px]">
              · {{ t('storage.items', usage[k.key].count) }} · {{ formatBytes(usage[k.key].bytes) }}
            </span>
          </span>
          <button
            class="btn-ghost px-2.5! py-0.5! text-[11px]"
            :disabled="busy !== null || usage[k.key].count === 0"
            @click="clear(k.id)"
          >
            {{ busy === k.id ? '…' : t('storage.clear') }}
          </button>
        </li>
        <li
          v-if="usage.foreign.databases.length || usage.foreign.caches.length"
          class="flex items-center justify-between gap-3 py-1"
          data-kind="foreign"
        >
          <span class="min-w-0">
            <span>{{ t('storage.kind.foreign') }}</span>
            <span
              class="text-muted font-mono text-[10.5px]"
              :title="[...usage.foreign.databases, ...usage.foreign.caches].join(', ')"
            >
              ·
              {{
                t('storage.foreignCount', {
                  db: usage.foreign.databases.length,
                  caches: usage.foreign.caches.length,
                })
              }}
            </span>
          </span>
          <button
            class="btn-ghost px-2.5! py-0.5! text-[11px]"
            :disabled="busy !== null"
            @click="clear('foreign')"
          >
            {{ busy === 'foreign' ? '…' : t('storage.clear') }}
          </button>
        </li>
      </ul>
      <p v-if="usage?.usageDetails" class="text-muted font-mono text-[10.5px]">
        {{ t('storage.browserSplit') }}
        {{
          Object.entries(usage.usageDetails)
            .map(([k, v]) => `${k} ${formatBytes(v)}`)
            .join(' · ')
        }}
      </p>
      <p class="text-muted">
        {{ t('storage.lagNote') }}
        <template v-if="!quota.info.unknown">
          <template v-if="quota.info.persisted">{{ t('settings.persistent') }}</template>
          <template v-else>
            {{ t('settings.notPersistent') }}
            <button class="underline" @click="persist">
              {{ t('settings.requestPersistent') }}
            </button>
          </template>
          <span v-if="persistResult"> {{ persistResult }}</span>
        </template>
      </p>
      <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span class="text-muted">{{ t('storage.eraseHint') }}</span>
        <button
          class="purge-all text-[11px]"
          :class="{ armed: confirmErase }"
          :disabled="busy !== null"
          data-testid="erase-all"
          @click="clear('all')"
        >
          {{ busy === 'all' ? '…' : confirmErase ? t('storage.eraseConfirm') : t('storage.erase') }}
        </button>
      </div>
    </div>
    <p class="border-line flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
      <span class="text-muted">{{ t('tour.settingsHint') }}</span>
      <button class="btn-ghost text-xs" data-testid="tour-again" @click="tour.request()">
        {{ t('tour.settingsButton') }}
      </button>
    </p>
    <details class="border-line border-t pt-2 text-xs">
      <summary class="text-muted cursor-pointer select-none">
        {{ t('settings.advancedRelay') }}
      </summary>
      <div class="mt-2 flex flex-col gap-1">
        <p class="text-muted">
          <i18n-t keypath="settings.relayIntro" tag="span">
            <template #readme><code>shim/README.md</code></template>
          </i18n-t>
          <i18n-t v-if="DEFAULT_RELAY_URL" keypath="settings.relayBuiltIn" tag="span">
            <template #url
              ><code>{{ DEFAULT_RELAY_URL }}</code></template
            >
          </i18n-t>
          <template v-else>{{ t('settings.relayNone') }}</template>
        </p>
        <div class="flex items-center gap-2">
          <input
            v-model.trim="settings.shimUrl"
            type="url"
            placeholder="https://your-relay.workers.dev"
            class="field min-w-0 flex-1"
            :aria-label="t('settings.relayAria')"
          />
          <button
            v-if="settings.shimUrl"
            class="purge grid h-7 w-7 shrink-0 place-items-center rounded-full text-[16px] leading-none"
            :title="t('settings.useBuiltInRelay')"
            :aria-label="t('settings.useBuiltInRelay')"
            @click="settings.shimUrl = ''"
          >
            ×
          </button>
        </div>
      </div>
    </details>
  </section>
</template>

<style scoped>
/* the three steps: counters in mono so they line up with the rest of the panel's numbers */
.steps {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 2px 0 4px;
  padding: 0;
  list-style: none;
  counter-reset: step;
}
.steps li {
  display: flex;
  gap: 7px;
  line-height: 1.45;
}
.steps li::before {
  counter-increment: step;
  content: counter(step);
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 8%, transparent);
  color: var(--color-ink);
  font-family: var(--font-mono);
  font-size: 9.5px;
  line-height: 15px;
  text-align: center;
}

/* the red ×, as in the Library rail */
.purge {
  color: var(--color-danger);
  opacity: 0.75;
  transition:
    background-color var(--hover-ease),
    opacity var(--hover-ease);
}
.purge:hover {
  opacity: 1;
  background: var(--hover-danger);
}
/* "Erase everything" had no style of its own at all — no hover, and nothing marking it as the
   destructive one on the screen (found by the hover audit, 2026-09-18). */
.purge-all {
  border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
  border-radius: 999px;
  padding: 3px 10px;
  color: var(--color-danger);
  transition:
    background-color var(--hover-ease),
    border-color var(--hover-ease);
}
.purge-all:hover:not(:disabled) {
  background: var(--hover-danger);
  border-color: var(--color-danger);
}
.purge-all.armed {
  background: var(--hover-danger);
  font-weight: 700;
}
</style>
