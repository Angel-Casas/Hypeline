<script setup lang="ts">
/**
 * The "?" in the rail (2026-09-17): a paper sheet with three doors into the GitHub project —
 * suggest a feature, report a bug, ask a question — each a prefilled new issue
 * (`lib/support.ts`). Bug reports carry a short non-personal context block. Escape and the
 * backdrop close it; the sheet is paper, like the language sheet.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useVodStore } from '@/features/vod/stores/vodStore';
import { locale } from '@/i18n';
import { REPO_URL, supportUrl, type SupportContext, type SupportKind } from '@/lib/support';

const { t } = useI18n();
const settings = useSettingsStore();
const vod = useVodStore();
const route = useRoute();
const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
const sheet = ref<HTMLDivElement | null>(null);

const ctx = computed<SupportContext>(() => ({
  version: __APP_VERSION__,
  userAgent: navigator.userAgent,
  locale: locale.value,
  theme: settings.dark ? 'night' : 'day',
  where: vod.info ? `${String(route.name)} · VOD ${vod.info.id}` : String(route.name ?? route.path),
  relay: !!settings.relayUrl,
  aiKey: !!settings.aiApiKey,
}));

const DOORS: { kind: SupportKind; icon: string }[] = [
  {
    kind: 'feature',
    icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z',
  },
  {
    kind: 'bug',
    icon: 'M8 9V7a4 4 0 0 1 8 0v2M6 13h12M4 9l3 2M20 9l-3 2M4 18l3-2M20 18l-3-2M12 11v9M8 20a4 4 0 0 0 8 0v-9a4 4 0 0 0-8 0z',
  },
  { kind: 'question', icon: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17.5v.01' },
];
const href = (k: SupportKind) => supportUrl(k, k === 'bug' ? ctx.value : undefined);

function close() {
  open.value = false;
  btn.value?.focus();
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close();
}
watch(open, (o) => {
  if (o) requestAnimationFrame(() => sheet.value?.focus());
});
document.addEventListener('keydown', onKey);
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="glass-sm inline-flex h-8 w-8 items-center justify-center text-ink"
    :title="t('support.title')"
    :aria-label="t('support.title')"
    aria-haspopup="dialog"
    :aria-expanded="open"
    data-testid="support-button"
    @click="open = true"
  >
    <svg
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
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1 .9-1 1.6v.4M12 16.6v.01" />
    </svg>
  </button>
  <Teleport to="body">
    <Transition name="sup">
      <div
        v-if="open"
        class="scrim-soft fixed inset-0 z-[80] flex items-end justify-center p-3 backdrop-blur-[10px] backdrop-saturate-125 sm:items-center"
        role="dialog"
        aria-modal="true"
        :aria-label="t('support.title')"
        data-testid="support-sheet"
        @click.self="close"
      >
        <div
          ref="sheet"
          tabindex="-1"
          class="sup-sheet w-full max-w-md rounded-3xl p-5 outline-none sm:p-6"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="eyebrow">{{ t('support.title') }}</p>
              <h2 class="mt-1.5 font-display text-2xl leading-tight text-ink text-balance">
                {{ t('support.headline') }}
              </h2>
            </div>
            <button
              type="button"
              class="glass-sm inline-flex h-8 w-8 shrink-0 items-center justify-center text-ink"
              :aria-label="t('common.close')"
              @click="close"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div class="mt-4 flex flex-col gap-1.5">
            <a
              v-for="d in DOORS"
              :key="d.kind"
              :href="href(d.kind)"
              target="_blank"
              rel="noopener"
              class="door group flex items-center gap-3.5 rounded-2xl px-3.5 py-3 text-ink transition-colors hover:bg-ink/6 focus-visible:bg-ink/6"
              :data-kind="d.kind"
              @click="open = false"
            >
              <span class="door-icon grid h-10 w-10 shrink-0 place-items-center rounded-xl">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path :d="d.icon" />
                </svg>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-[14px] font-semibold">{{
                  t(`support.${d.kind}.title`)
                }}</span>
                <span class="text-muted block text-xs leading-snug">{{
                  t(`support.${d.kind}.body`)
                }}</span>
              </span>
              <span
                class="text-muted text-sm transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
                >↗</span
              >
            </a>
          </div>
          <p class="text-muted mt-4 font-mono text-[10.5px] leading-relaxed">
            {{ t('support.footer') }}
            <a :href="REPO_URL" target="_blank" rel="noopener" class="underline decoration-dotted"
              >GitHub ↗</a
            >
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim-soft {
  background: var(--scrim-soft);
}
.sup-sheet {
  background: var(--color-ground);
  border: 1px solid var(--glass-line);
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.3),
    0 4px 14px rgba(0, 0, 0, 0.1);
}
/* each door's icon sits on its own pastel: butter for ideas, petal for bugs, sky for questions */
.door-icon {
  background: color-mix(in srgb, var(--color-ink) 6%, transparent);
}
.door[data-kind='feature'] .door-icon {
  background: var(--color-butter);
}
.door[data-kind='bug'] .door-icon {
  background: var(--color-petal);
}
.door[data-kind='question'] .door-icon {
  background: var(--color-sky);
}
.sup-enter-active {
  transition: opacity 160ms ease;
}
.sup-enter-active .sup-sheet {
  transition:
    transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 240ms ease;
}
.sup-leave-active {
  transition: opacity 140ms ease;
}
.sup-enter-from,
.sup-leave-to {
  opacity: 0;
}
.sup-enter-from .sup-sheet {
  transform: translateY(14px) scale(0.985);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .sup-enter-active,
  .sup-leave-active,
  .sup-enter-active .sup-sheet {
    transition: none;
  }
}
</style>
