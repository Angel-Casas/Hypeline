import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'hypeline.settings.v1';

interface Persisted {
  shimUrl: string;
  preferredHeight: number;
  /** AI provider (ADR-6). Key stays in this browser; encryption-at-rest is a later item. */
  aiApiKey: string;
  aiBaseUrl: string;
  chatModel: string;
  sttModel: string;
  /** Day / night (design-system doc). 'system' follows the OS. */
  theme: Theme;
  /** How many moments to surface: 1 (only the loudest) … 5 (everything that stirs). */
  sensitivity: number;
}

const DEFAULTS: Persisted = {
  shimUrl: '',
  preferredHeight: 720,
  aiApiKey: '',
  aiBaseUrl: 'https://nano-gpt.com/api',
  chatModel: '',
  sttModel: 'Whisper-Large-V3',
  theme: 'system',
  sensitivity: 3,
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

/**
 * The video relay (CORS shim, `shim/`): the app owner deploys one and bakes its URL into the
 * build as `VITE_SHIM_URL`; users never see it. `shimUrl` in settings is an advanced override
 * (a fork, a local worker) and wins when set.
 */
export const DEFAULT_RELAY_URL = ((import.meta.env.VITE_SHIM_URL as string | undefined) ?? '')
  .trim()
  .replace(/\/$/, '');

export const useSettingsStore = defineStore('settings', () => {
  const initial = load();
  const shimUrl = ref(initial.shimUrl);
  /** The relay actually used: the override, else the built-in default ('' = none). */
  const relayUrl = computed(() => shimUrl.value.trim() || DEFAULT_RELAY_URL);
  const preferredHeight = ref(initial.preferredHeight);
  const aiApiKey = ref(initial.aiApiKey);
  const aiBaseUrl = ref(initial.aiBaseUrl);
  const chatModel = ref(initial.chatModel);
  const sttModel = ref(initial.sttModel);
  const theme = ref<Theme>(initial.theme);
  const sensitivity = ref(Math.min(5, Math.max(1, Number(initial.sensitivity) || 3)));
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const systemDark = ref(mq?.matches ?? false);
  mq?.addEventListener?.('change', (e) => (systemDark.value = e.matches));
  /** The theme in effect: the explicit choice, or the OS preference. */
  const dark = computed(() =>
    theme.value === 'system' ? systemDark.value : theme.value === 'dark',
  );
  watch(
    dark,
    (d) => {
      if (typeof document !== 'undefined')
        document.documentElement.dataset.theme = d ? 'dark' : 'light';
    },
    { immediate: true },
  );
  /**
   * Switch day / night. With the View Transitions API the new theme is revealed as a
   * circle growing from `origin` (the toggle's position); elsewhere it just swaps.
   */
  function toggleTheme(origin?: { x: number; y: number }) {
    const next: Theme = dark.value ? 'light' : 'dark';
    const doc = typeof document !== 'undefined' ? document : null;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc || !('startViewTransition' in doc) || reduce) {
      theme.value = next;
      return;
    }
    const x = origin?.x ?? window.innerWidth - 40;
    const y = origin?.y ?? 40;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    doc.documentElement.style.setProperty('--vt-x', `${x}px`);
    doc.documentElement.style.setProperty('--vt-y', `${y}px`);
    doc.documentElement.style.setProperty('--vt-r', `${r}px`);
    (
      doc as Document & { startViewTransition: (cb: () => void) => { finished: Promise<void> } }
    ).startViewTransition(() => {
      theme.value = next;
      // the attribute is stamped by the watcher above; flush it synchronously for the snapshot
      doc.documentElement.dataset.theme = next === 'dark' ? 'dark' : 'light';
    });
  }

  watch(
    [shimUrl, preferredHeight, aiApiKey, aiBaseUrl, chatModel, sttModel, theme, sensitivity],
    () => {
    try {
      const p: Persisted = {
        shimUrl: shimUrl.value,
        preferredHeight: preferredHeight.value,
        aiApiKey: aiApiKey.value,
        aiBaseUrl: aiBaseUrl.value,
        chatModel: chatModel.value,
        sttModel: sttModel.value,
        theme: theme.value,
        sensitivity: sensitivity.value,
      };
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  });

  return {
    shimUrl,
    relayUrl,
    preferredHeight,
    aiApiKey,
    aiBaseUrl,
    chatModel,
    sttModel,
    theme,
    sensitivity,
    dark,
    toggleTheme,
  };
});
