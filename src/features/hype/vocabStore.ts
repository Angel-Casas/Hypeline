import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
  buildVocabulary,
  emptyState,
  EMPTY_LISTS,
  type ListKind,
  type VocabLists,
  type VocabState,
} from './vocabulary';

const KEY = 'hypeline.vocab.v1';

function load(): VocabState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const d = JSON.parse(raw) as Partial<VocabState>;
    return {
      packs: Array.isArray(d.packs) ? d.packs : [],
      off: Array.isArray(d.off) ? d.off : [],
      global: { ...EMPTY_LISTS, ...(d.global ?? {}) },
      byChannel: d.byChannel ?? {},
    };
  } catch {
    return emptyState();
  }
}

/**
 * The user's chat vocabulary (ADR-29): which language packs are on, which shipped words they
 * turned off, and the words they added — globally and per channel. Everything is local, like
 * the rest of the app; nothing here reaches a server.
 */
export const useVocabStore = defineStore('vocab', () => {
  const state = ref<VocabState>(load());
  /** The channel whose overrides apply; the dashboard sets it when a VOD opens. */
  const channel = ref<string | null>(null);

  watch(
    state,
    (s) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        /* private mode: the lists live for this session only */
      }
    },
    { deep: true },
  );

  const vocabulary = computed(() => buildVocabulary(state.value, channel.value));
  /** True when anything at all has been changed from the shipped defaults. */
  const touched = computed(
    () =>
      state.value.packs.length > 0 ||
      state.value.off.length > 0 ||
      state.value.global.important.length > 0 ||
      state.value.global.reaction.length > 0 ||
      Object.keys(state.value.byChannel).length > 0,
  );

  function lists(scope: 'global' | 'channel'): VocabLists {
    if (scope === 'global') return state.value.global;
    const c = channel.value;
    if (!c) return state.value.global;
    return (state.value.byChannel[c] ??= { important: [], reaction: [] });
  }

  function add(scope: 'global' | 'channel', kind: ListKind, word: string): boolean {
    const w = word.trim();
    if (!w) return false;
    const l = lists(scope);
    if (l[kind].some((x) => x.toLowerCase() === w.toLowerCase())) return false;
    l[kind] = [...l[kind], w];
    // adding a word that was previously turned off should bring it back
    state.value.off = state.value.off.filter((k) => k !== kind + ':' + w);
    return true;
  }

  function remove(scope: 'global' | 'channel', kind: ListKind, word: string) {
    const l = lists(scope);
    l[kind] = l[kind].filter((x) => x !== word);
  }

  /** Shipped words are never deleted, only silenced, so they can come back. */
  function toggleDefault(kind: ListKind, word: string) {
    const k = kind + ':' + word;
    state.value.off = state.value.off.includes(k)
      ? state.value.off.filter((x) => x !== k)
      : [...state.value.off, k];
  }
  function isOff(kind: ListKind, word: string): boolean {
    return state.value.off.includes(kind + ':' + word);
  }

  function setPacks(ids: string[]) {
    state.value.packs = [...new Set(ids)];
  }
  function togglePack(id: string) {
    setPacks(
      state.value.packs.includes(id)
        ? state.value.packs.filter((x) => x !== id)
        : [...state.value.packs, id],
    );
  }

  function reset() {
    state.value = emptyState();
  }

  function exportJson(): string {
    return JSON.stringify(state.value, null, 2);
  }
  /** Returns false when the file is not one of ours rather than throwing at the caller. */
  function importJson(text: string): boolean {
    try {
      const d = JSON.parse(text) as Partial<VocabState>;
      if (!d || typeof d !== 'object' || !d.global) return false;
      state.value = {
        packs: Array.isArray(d.packs) ? d.packs : [],
        off: Array.isArray(d.off) ? d.off : [],
        global: {
          important: Array.isArray(d.global.important) ? d.global.important : [],
          reaction: Array.isArray(d.global.reaction) ? d.global.reaction : [],
        },
        byChannel: d.byChannel ?? {},
      };
      return true;
    } catch {
      return false;
    }
  }

  return {
    state,
    channel,
    vocabulary,
    touched,
    add,
    remove,
    toggleDefault,
    isOff,
    setPacks,
    togglePack,
    reset,
    exportJson,
    importJson,
  };
});
