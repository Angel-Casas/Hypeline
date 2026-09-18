<script setup lang="ts">
/**
 * Choosing an LLM out of ~600 (ADR-40, Angel 2026-09-18, after the picker in his other
 * NanoGPT app). A `<select>` with six hundred `<option>`s is not a choice, it is a scroll:
 * no prices, no search, no families, and no way to ask "what is the cheapest thing that can
 * read a chat log".
 *
 * Two panels. The left one searches and lists, grouped by family with a count per group; the
 * right one sorts and filters, and folds away under 720 px behind the footer's "Filters"
 * button. Every row carries what the decision actually needs: the name, the id you would paste
 * into an API call, when the model appeared, and input/output price per million tokens.
 *
 * The list is plain DOM — six hundred rows of three spans, built once per query, measured at
 * ~9 ms on the desk and ~30 ms on a throttled phone. A virtual scroller would be faster and a
 * great deal more code; if the catalogue ever triples, that is the change to make.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ModelInfo } from '@/lib/nanogpt/client';
import {
  arrange,
  monthOf,
  providerCounts,
  providerOf,
  shortUsd,
  type SortKey,
} from '@/lib/nanogpt/catalog';
import { pickDefaultChatModel } from '@/lib/nanogpt/pricing';

const props = defineProps<{ models: ModelInfo[]; selected: string }>();
const emit = defineEmits<{ close: []; pick: [id: string] }>();
const { t, locale } = useI18n();

const query = ref('');
const sort = ref<SortKey>('provider');
/** Empty = every provider. A filter that can exclude everything is a filter that breaks. */
const only = ref(new Set<string>());
const showFilters = ref(false);
const search = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);

const groups = computed(() =>
  arrange(props.models, { query: query.value, sort: sort.value, providers: only.value }),
);
const flat = computed(() => groups.value.flatMap((g) => g.models));
const counts = computed(() => providerCounts(props.models));
const grouped = computed(() => sort.value === 'provider');
/** What "recommended" resolves to right now, so the row can name it rather than being magic. */
const recommended = computed(() => pickDefaultChatModel(props.models));
const recommendedName = computed(
  () => props.models.find((m) => m.id === recommended.value)?.name ?? recommended.value ?? '—',
);

const SORTS: { key: SortKey; icon: string; label: string }[] = [
  { key: 'provider', icon: '◫', label: 'ai.sortProvider' },
  { key: 'name', icon: '↓A', label: 'ai.sortName' },
  { key: 'cheap', icon: '$↑', label: 'ai.sortCheap' },
  { key: 'pricey', icon: '$↓', label: 'ai.sortPricey' },
  { key: 'new', icon: '★', label: 'ai.sortNew' },
  { key: 'old', icon: '○', label: 'ai.sortOld' },
];

function toggleProvider(key: string) {
  const next = new Set(only.value);
  if (!next.delete(key)) next.add(key);
  only.value = next;
}
function price(m: ModelInfo): string | null {
  const p = shortUsd(m.promptPerM);
  const c = shortUsd(m.completionPerM);
  if (p == null || c == null) return null;
  return `$${p}/$${c}`;
}
function priceTitle(m: ModelInfo): string {
  if (m.promptPerM == null) return '';
  return t('ai.priceTitle', { prompt: m.promptPerM, completion: m.completionPerM ?? 0 });
}
function month(m: ModelInfo): string | null {
  return monthOf(m, locale.value);
}

/*
 * Keyboard: the search box keeps focus, so the arrows steer the list from there. The cursor is
 * -1 — nowhere — until the user asks for it, either by typing a query (where the top hit is
 * what Enter should take) or by pressing a key: a dashed ring around the first row of an
 * untouched list is noise, not an offer.
 */
const cursor = ref(-1);
watch([query, sort, only], () => {
  cursor.value = query.value.trim() ? 0 : -1;
});
function move(by: number) {
  if (!flat.value.length) return;
  cursor.value = Math.min(flat.value.length - 1, Math.max(0, cursor.value + by));
  void nextTick(() => {
    list.value
      ?.querySelector('[data-cursor="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
  });
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') return emit('close');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    move(-1);
  } else if (e.key === 'Enter') {
    const m = cursor.value < 0 ? undefined : flat.value[cursor.value];
    if (m) emit('pick', m.id);
  }
}
onMounted(() => {
  document.addEventListener('keydown', onKey);
  void nextTick(() => search.value?.focus());
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div
      class="scrim fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-3 backdrop-blur-[6px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      :aria-label="t('ai.pickModel')"
      data-testid="model-picker"
      @click.self="emit('close')"
    >
      <div class="sheet picker flex w-full max-w-4xl flex-col overflow-hidden">
        <div class="flex items-baseline justify-between gap-3 px-4 pt-4 sm:px-5">
          <h2 class="font-display text-ink text-lg leading-tight">{{ t('ai.pickModel') }}</h2>
          <button class="btn-ghost text-xs" data-testid="picker-close" @click="emit('close')">
            {{ t('common.close') }}
          </button>
        </div>

        <div class="panels">
          <!-- left: search, the recommended shortcut, the list -->
          <div class="models">
            <label class="field search mx-4 mt-3 flex items-center gap-2 sm:mx-5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref="search"
                v-model="query"
                type="text"
                :placeholder="t('ai.searchModels')"
                data-testid="model-search"
                class="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>

            <button
              v-if="recommended"
              class="row hover-frost mx-4 mt-2 sm:mx-5"
              :class="{ on: selected === recommended, 'silk-ring': selected === recommended }"
              data-testid="model-recommended"
              @click="emit('pick', recommended)"
            >
              <span class="glyph">↩</span>
              <span class="info">
                <span class="name">{{ t('ai.useRecommended') }}</span>
                <span class="meta"
                  ><span class="id">{{ recommendedName }}</span></span
                >
              </span>
              <span v-if="selected === recommended" class="tick">✓</span>
            </button>

            <div ref="list" class="list" role="listbox" :aria-label="t('ai.pickModel')">
              <p v-if="!flat.length" class="text-muted px-1 py-6 text-center text-xs">
                {{ t('ai.noModels', { query }) }}
              </p>
              <div v-for="g in groups" :key="g.provider.key" class="group">
                <div v-if="grouped" class="ghead">
                  <span class="glyph">{{ g.provider.glyph }}</span>
                  <span class="gname">{{ g.provider.label }}</span>
                  <span class="gcount">{{ g.models.length }}</span>
                </div>
                <button
                  v-for="m in g.models"
                  :key="m.id"
                  class="row hover-frost"
                  role="option"
                  :aria-selected="m.id === selected"
                  :class="{
                    on: m.id === selected,
                    'silk-ring': m.id === selected,
                    at: flat[cursor]?.id === m.id,
                  }"
                  :data-cursor="flat[cursor]?.id === m.id"
                  :data-model="m.id"
                  :title="priceTitle(m)"
                  @click="emit('pick', m.id)"
                >
                  <span class="glyph">{{ providerOf(m).glyph }}</span>
                  <span class="info">
                    <span class="name">{{ m.name }}</span>
                    <span class="meta">
                      <span class="id">{{ m.id }}</span>
                      <span v-if="month(m)" class="when">{{ month(m) }}</span>
                    </span>
                  </span>
                  <span v-if="price(m)" class="cost">{{ price(m) }}</span>
                  <span v-if="m.id === selected" class="tick">✓</span>
                </button>
              </div>
            </div>

            <div class="foot">
              <span class="text-muted font-mono text-[10.5px]">{{
                t('ai.modelCount', { n: flat.length })
              }}</span>
              <button
                class="btn-ghost filters-btn text-xs"
                :aria-pressed="showFilters"
                @click="showFilters = !showFilters"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M7 12h10M10 18h4" />
                </svg>
                {{ t('ai.filters') }}
              </button>
            </div>
          </div>

          <!-- right: sort and provider filters -->
          <div class="filters" :class="{ open: showFilters }">
            <div class="fsection">
              <div class="eyebrow mb-2">{{ t('ai.sortBy') }}</div>
              <div class="sorts">
                <button
                  v-for="s in SORTS"
                  :key="s.key"
                  class="sort seg-opt"
                  :aria-pressed="sort === s.key"
                  :data-sort="s.key"
                  @click="sort = s.key"
                >
                  <span class="sicon">{{ s.icon }}</span> {{ t(s.label) }}
                </button>
              </div>
            </div>
            <div class="fsection">
              <div class="mb-2 flex items-baseline justify-between gap-2">
                <span class="eyebrow">{{ t('ai.providers') }}</span>
                <button
                  v-if="only.size"
                  class="text-muted text-[11px] underline"
                  @click="only = new Set()"
                >
                  {{ t('ai.allProviders') }}
                </button>
              </div>
              <div class="sorts">
                <button
                  v-for="p in counts"
                  :key="p.provider.key"
                  class="sort seg-opt"
                  :aria-pressed="only.has(p.provider.key)"
                  :data-provider="p.provider.key"
                  @click="toggleProvider(p.provider.key)"
                >
                  <span class="sicon">{{ p.provider.glyph }}</span>
                  <span class="flex-1 text-left">{{ p.provider.label }}</span>
                  <span class="gcount">{{ p.count }}</span>
                </button>
              </div>
            </div>
            <p class="text-muted px-1 text-[11px] leading-snug">{{ t('ai.priceLegend') }}</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.picker {
  max-height: min(80vh, 780px);
  /* The sheet's 88 % ground is right for a page of prose; under sixty dense mono rows the
     dashboard reads straight through it and the ids become unreadable, so this one sheet sits
     on near-solid paper (2026-09-18). */
  background: color-mix(in srgb, var(--color-ground) 97%, transparent);
}
.panels {
  display: flex;
  min-height: 0;
  flex: 1;
}
.models {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.search svg {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--color-muted);
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 4px;
  scrollbar-width: thin;
}
@media (min-width: 640px) {
  .list {
    padding-inline: 20px;
  }
}
.list .row {
  width: 100%;
}
.group + .group {
  margin-top: 10px;
}
.ghead {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 4px 4px;
  /* opaque: rows scroll under it */
  background: var(--color-ground);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.gname {
  font-weight: 700;
}
.gcount {
  margin-left: auto;
  font-family: var(--font-mono);
  letter-spacing: 0;
  opacity: 0.7;
}
/* no `width: 100%`: the recommended row carries side margins, and a percentage width plus a
   margin overflows its parent — on a phone that pushed its tick off the sheet (2026-09-18) */
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 6px 8px;
  text-align: left;
  cursor: pointer;
}
/*
 * The chosen model wears the silk ring, which is how the rest of the app says "this one" — an
 * ink wash would just be a grey row, and grey is the one thing this design does not do.
 */
.row.on {
  border-color: transparent;
}
.row.at {
  outline: 1px dashed var(--color-line);
  outline-offset: -1px;
}
.glyph {
  width: 15px;
  flex: none;
  text-align: center;
  font-size: 12px;
  color: var(--color-ink);
  opacity: 0.75;
}
.info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  line-height: 1.25;
}
.meta {
  display: flex;
  gap: 8px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-muted);
}
.id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  flex: none;
  opacity: 0.8;
}
.cost {
  flex: none;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
}
.tick {
  flex: none;
  font-size: 11px;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--color-line);
  padding: 8px 16px;
}
@media (min-width: 640px) {
  .foot {
    padding-inline: 20px;
  }
}
.filters-btn svg {
  width: 13px;
  height: 13px;
  display: inline-block;
  vertical-align: -2px;
  margin-right: 4px;
}
.filters {
  display: none;
  width: 212px;
  flex: none;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  border-left: 1px solid var(--color-line);
  padding: 14px 14px 16px;
}
.fsection {
  display: flex;
  flex-direction: column;
}
.sorts {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sort {
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 9px;
  text-align: left;
}
.sicon {
  width: 16px;
  flex: none;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10px;
}
/* wide: the filters live beside the list. Narrow: the footer button drops them over it. */
@media (min-width: 720px) {
  .filters {
    display: flex;
  }
  .filters-btn {
    display: none;
  }
}
@media (max-width: 719px) {
  .filters.open {
    display: flex;
    width: auto;
    border-left: 0;
    border-top: 1px solid var(--color-line);
  }
  .panels {
    flex-direction: column;
  }
}
</style>
