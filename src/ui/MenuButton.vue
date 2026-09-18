<script setup lang="ts">
/**
 * A pill that says what a setting currently is, and opens a small paper menu to change it
 * (ADR-27). Two shapes in one component:
 *
 *  - a list of choices, via `options` + `modelValue` — the common case;
 *  - anything at all, via the default slot, which receives `{ close }`.
 *
 * Both may be used together: the options are listed first and the slot follows, which is how
 * the shape menu carries its crop slider. The menu is teleported to the body, so a panel with
 * `overflow: hidden` cannot clip it, and closes on Escape, on a click outside and after a
 * choice. Arrow keys walk the list.
 */
import { nextTick, onBeforeUnmount, ref } from 'vue';

export interface MenuOption {
  v: string | number;
  l: string;
  /** A few words of explanation, shown greyed after the label. */
  note?: string;
}
const props = withDefaults(
  defineProps<{
    /** Small-caps word in front of the value ("size"). Omit for a plain button. */
    label?: string;
    /** What the pill shows as the current value. */
    value: string;
    options?: MenuOption[];
    modelValue?: string | number;
    title?: string;
    /** Width of the panel; the options list is comfortable at the default. */
    wide?: boolean;
  }>(),
  { label: undefined, options: undefined, modelValue: undefined, title: undefined, wide: false },
);
const emit = defineEmits<{ 'update:modelValue': [string | number] }>();
// two roots (the pill and the teleported menu), so attributes have to be placed by hand
defineOptions({ inheritAttrs: false });

const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);
const pos = ref({ top: 0, left: 0, width: 208 });

function place() {
  const r = btn.value?.getBoundingClientRect();
  if (!r) return;
  // the widest panel is wider than a phone, so clamp inside the viewport rather than
  // anchoring to an edge — right-anchoring pushed the thumbnail panel off the left of a
  // 390 px screen (2026-09-17)
  const w = Math.min(props.wide ? 320 : 208, window.innerWidth - 24);
  const left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
  pos.value = { top: r.bottom + 6, left, width: w };
}
function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  place();
  void nextTick(() =>
    menu.value
      ?.querySelector<HTMLElement>('[aria-checked="true"], input, button')
      ?.focus({ preventScroll: true }),
  );
}
function close(refocus = true) {
  open.value = false;
  if (refocus) btn.value?.focus({ preventScroll: true });
}
function pick(v: string | number) {
  emit('update:modelValue', v);
  close();
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
    e.stopPropagation(); // the panel below also listens for Escape
    close();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = Array.from(
    menu.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
  );
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
}
document.addEventListener('mousedown', onDoc);
document.addEventListener('keydown', onKey, true);
window.addEventListener('resize', place);
window.addEventListener('scroll', place, true);
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
});
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="pick hover-frost"
    v-bind="$attrs"
    :title="title"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click="toggle"
  >
    <span v-if="label" class="pick-k">{{ label }}</span>
    <span class="pick-v">{{ value }}</span>
    <span class="pick-caret" aria-hidden="true">▾</span>
  </button>
  <Teleport to="body">
    <Transition name="pick-pop">
      <div
        v-if="open"
        ref="menu"
        role="menu"
        :aria-label="label ?? value"
        class="pick-menu fixed z-[70] rounded-2xl p-1.5"
        :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }"
        data-testid="pick-menu"
      >
        <p v-if="label" class="eyebrow px-2.5 pt-1.5 pb-1">{{ label }}</p>
        <button
          v-for="o in options"
          :key="o.v"
          type="button"
          role="menuitemradio"
          :aria-checked="o.v === modelValue"
          class="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-left text-[13px] text-ink transition-colors hover-frost focus:outline-none"
          :class="o.v === modelValue ? 'font-semibold' : ''"
          @click="pick(o.v)"
        >
          <span>{{ o.l }}</span>
          <span v-if="o.note" class="text-muted text-[10.5px]">{{ o.note }}</span>
          <span v-else-if="o.v === modelValue" class="text-accent text-[11px]" aria-hidden="true"
            >✓</span
          >
        </button>
        <div v-if="$slots.default" :class="options?.length ? 'mt-1 px-1.5 pt-2 pb-1' : 'p-1.5'">
          <slot :close="close" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pick {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-line);
  background-color: var(--ghost-bg);
  color: var(--color-ink);
  border-radius: 999px;
  padding: 5px 10px 5px 12px;
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  transition: border-color 0.15s;
}
.pick {
  transition:
    border-color var(--hover-ease),
    background-color var(--hover-ease);
}

.pick:disabled {
  opacity: 0.45;
}
.pick-k {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.pick-v {
  font-weight: 600;
}
.pick-caret {
  font-size: 9px;
  opacity: 0.5;
}
.pick-menu {
  background: var(--color-ground);
  border: 1px solid var(--glass-line);
  box-shadow:
    0 18px 50px rgba(0, 0, 0, 0.22),
    0 2px 8px rgba(0, 0, 0, 0.08);
}
.pick-pop-enter-active,
.pick-pop-leave-active {
  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pick-pop-enter-from,
.pick-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .pick-pop-enter-active,
  .pick-pop-leave-active {
    transition: none;
  }
}
</style>
