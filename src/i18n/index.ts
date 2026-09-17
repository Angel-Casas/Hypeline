/**
 * Languages (ADR-20, 2026-09-16). English is the source; the other nine were drafted by
 * Claude and are marked so in docs/09-languages.md for native speakers to correct.
 *
 * First visit: the browser's language picks the start locale and a sheet asks the user to
 * confirm it (`chosen` is false until they do). The choice lives in localStorage; the rail's
 * globe button changes it any time. Components use `useI18n().t`; stores and libs use the
 * exported `t`. Every catalog is bundled (they are small); the `<html lang>` follows.
 */
import { createI18n } from 'vue-i18n';
import { computed, ref } from 'vue';
import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt-BR.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import ru from './locales/ru.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zh from './locales/zh-TW.json';
import tr from './locales/tr.json';

export const LOCALES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
] as const;
export type Locale = (typeof LOCALES)[number]['code'];
export const LOCALE_KEY = 'hypeline.locale';

const messages = { en, es, 'pt-BR': pt, de, fr, ru, ja, ko, 'zh-TW': zh, tr };

function isLocale(x: string | null | undefined): x is Locale {
  return !!x && LOCALES.some((l) => l.code === x);
}

/** The best of our locales for a browser language tag (`pt-PT` → pt-BR, `zh-HK` → zh-TW). */
export function matchLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (t.startsWith('pt')) return 'pt-BR';
    if (t.startsWith('zh')) return 'zh-TW';
    const base = t.split('-')[0]!;
    const hit = LOCALES.find((l) => l.code.toLowerCase() === t || l.code === base);
    if (hit) return hit.code;
  }
  return 'en';
}

function stored(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

const initial = stored();
/** False until the user has confirmed or picked a language (the first-visit sheet). */
export const chosen = ref(initial !== null);

export const i18n = createI18n({
  legacy: false,
  locale: initial ?? matchLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
  fallbackLocale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

/** Current locale (reactive). */
export const locale = computed(() => i18n.global.locale.value as Locale);

/** Switch and remember. */
export function setLocale(code: Locale) {
  i18n.global.locale.value = code;
  chosen.value = true;
  try {
    localStorage.setItem(LOCALE_KEY, code);
  } catch {
    /* private mode */
  }
  applyLang(code);
}

export function applyLang(code: Locale = locale.value) {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

/**
 * For stores and libs (components use `useI18n().t`). `count` picks the plural form of a
 * `"none | one | {n} many"` message and is also available as `{n}`.
 */
export function t(key: string, named: Record<string, unknown> = {}, count?: number): string {
  return count == null ? i18n.global.t(key, named) : i18n.global.t(key, count, { named });
}
