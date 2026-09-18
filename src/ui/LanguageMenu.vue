<script setup lang="ts">
/**
 * The globe in the rail (ADR-20): a glass-sm button that opens a small paper menu with the
 * ten languages in their own names. The current one wears the silk ring. Closes on Escape,
 * on a click outside, and after a choice.
 */
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { LOCALES, locale, setLocale, type Locale } from '@/i18n';

const { t } = useI18n();
const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);
const pos = ref({ top: 0, left: 0, right: 0, fromRight: false });

function place() {
  const r = btn.value?.getBoundingClientRect();
  if (!r) return;
  // open to the right of the button on the rail, flip when there is no room
  const fromRight = r.left + 220 > window.innerWidth;
  pos.value = {
    top: r.bottom + 8,
    left: r.left,
    right: window.innerWidth - r.right,
    fromRight,
  };
}
function toggle() {
  open.value = !open.value;
  if (open.value) {
    place();
    void nextTick(() => menu.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
}
function pick(code: Locale) {
  setLocale(code);
  open.value = false;
  btn.value?.focus();
}
function onDoc(e: MouseEvent) {
  if (!open.value) return;
  const el = e.target as Node;
  if (menu.value?.contains(el) || btn.value?.contains(el)) return;
  open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === 'Escape') {
    open.value = false;
    btn.value?.focus();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = Array.from(
      menu.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    if (!n) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
  }
}
document.addEventListener('mousedown', onDoc);
document.addEventListener('keydown', onKey);
window.addEventListener('resize', place);
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', place);
});
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="glass-sm inline-flex h-8 w-8 items-center justify-center text-ink"
    :title="t('language.title')"
    :aria-label="t('language.title')"
    aria-haspopup="menu"
    :aria-expanded="open"
    data-testid="language-button"
    @click="toggle"
  >
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
    </svg>
  </button>
  <Teleport to="body">
    <Transition name="lang-pop">
      <div
        v-if="open"
        ref="menu"
        role="menu"
        :aria-label="t('language.title')"
        class="lang-menu fixed z-[70] w-52 rounded-2xl p-1.5"
        :style="
          pos.fromRight
            ? { top: pos.top + 'px', right: pos.right + 'px' }
            : { top: pos.top + 'px', left: pos.left + 'px' }
        "
        data-testid="language-menu"
      >
        <p class="eyebrow px-2.5 pt-1.5 pb-1">{{ t('language.title') }}</p>
        <button
          v-for="l in LOCALES"
          :key="l.code"
          type="button"
          role="menuitemradio"
          :aria-checked="l.code === locale"
          :lang="l.code"
          class="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[13px] text-ink transition-colors hover-wash focus:bg-[var(--hover-wash)] focus:outline-none"
          :class="l.code === locale ? 'silk-ring font-semibold' : ''"
          @click="pick(l.code)"
        >
          <span>{{ l.native }}</span>
          <span v-if="l.code === locale" class="text-muted text-[10px]" aria-hidden="true">●</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lang-menu {
  background: var(--color-ground);
  border: 1px solid var(--glass-line);
  box-shadow:
    0 18px 50px rgba(0, 0, 0, 0.22),
    0 2px 8px rgba(0, 0, 0, 0.08);
}
.lang-pop-enter-active,
.lang-pop-leave-active {
  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.lang-pop-enter-from,
.lang-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
