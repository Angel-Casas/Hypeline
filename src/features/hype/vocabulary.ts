/**
 * What a chat's words mean (ADR-29) — pure, framework-free, no i18n.
 *
 * Two lists feed the scoring:
 *
 *  - **important**: when several *different* people say one of these inside a bucket, the
 *    bucket is marked strongly (`clipUserSet`, worth up to +3.6). The shipped English list is
 *    the clip-request regex in `scoring.ts`; everything here adds to it.
 *  - **reaction**: the ordinary noise of a chat enjoying itself. A single one means nothing;
 *    what counts is the *share* of a busy bucket made of them.
 *
 * A term matches by word when it is plain ASCII (`clip`, `jaja`) and by substring otherwise,
 * because `\b` is meaningless in Japanese, Korean and Chinese — `草` has no word boundary and
 * `切り抜き` is one word with no spaces. Emote names are matched against the message's own
 * emote list as well, case-insensitively, so `PagMan` works however Twitch cased it.
 */
import type { ChatMessage } from '@/lib/twitch/types';

export type ListKind = 'important' | 'reaction';

export interface VocabLists {
  important: string[];
  reaction: string[];
}

/** A language's starter words. `en` ships inside `scoring.ts` and is always on. */
export interface Pack extends VocabLists {
  id: string;
  /** The locale code this pack belongs to, for the UI's own name of the language. */
  locale: string;
}

/**
 * The packs. These are a starting point, not a dictionary: the honest fix for a chat we do
 * not speak is the "seen in this VOD" list, which shows what this community actually says.
 * Keep terms distinctive — a word as common as "que" would mark half the VOD.
 */
export const PACKS: Pack[] = [
  {
    id: 'es',
    locale: 'es',
    important: ['clipea', 'clipeen', 'clipealo', 'clipea eso', 'clipazo', 'sube eso', 'corta eso'],
    reaction: ['jaja', 'jajaja', 'jajajaja', 'jeje', 'xd', 'uf', 'vamos', 'joder', 'madre mia'],
  },
  {
    id: 'pt-BR',
    locale: 'pt-BR',
    important: ['clipa', 'clipa isso', 'clipar', 'corta isso'],
    reaction: ['kkk', 'kkkk', 'kkkkk', 'rsrs', 'eita', 'vish', 'nossa', 'mano'],
  },
  {
    id: 'de',
    locale: 'de',
    important: ['clip das', 'clippen', 'clipp das', 'abclippen'],
    reaction: ['hahaha', 'lachflash', 'krass', 'alter', 'digga', 'oha'],
  },
  {
    id: 'fr',
    locale: 'fr',
    important: ['clippe', 'clippe ça', 'coupe ça', 'faut clip'],
    reaction: ['mdr', 'mdrr', 'ptdr', 'jpp', 'ouf', 'nan'],
  },
  {
    id: 'ru',
    locale: 'ru',
    important: ['клип', 'заклипь', 'клипай', 'нарежь'],
    reaction: ['ахах', 'ахахах', 'хаха', 'ору', 'лол', 'кек', 'рофл', 'жиза'],
  },
  {
    id: 'ja',
    locale: 'ja',
    important: ['切り抜き', '切り抜け', 'クリップ'],
    reaction: ['草', 'ｗｗ', 'ww', 'やば', 'すご', 'てぇてぇ', '笑'],
  },
  {
    id: 'ko',
    locale: 'ko',
    important: ['클립', '클립해', '편집점'],
    reaction: ['ㅋㅋ', 'ㅋㅋㅋ', 'ㅎㅎ', '대박', '미쳤', '헐'],
  },
  {
    id: 'zh-TW',
    locale: 'zh-TW',
    important: ['剪片', '剪一下', '切片'],
    reaction: ['哈哈', '笑死', '草', '誇張', '扯'],
  },
  {
    id: 'tr',
    locale: 'tr',
    important: ['klip', 'kliple', 'kesin şunu'],
    reaction: ['hahaha', 'helal', 'valla', 'yok artık', 'kanka'],
  },
];

/** What the user has changed. Persisted as-is; `off` holds `"<kind>:<term>"` keys. */
export interface VocabState {
  /** Enabled language packs by id. English lives in `scoring.ts` and is always on. */
  packs: string[];
  off: string[];
  global: VocabLists;
  /** Channel login → the words that channel adds on top of `global`. */
  byChannel: Record<string, VocabLists>;
}

export const EMPTY_LISTS: VocabLists = { important: [], reaction: [] };
export function emptyState(): VocabState {
  return { packs: [], off: [], global: { important: [], reaction: [] }, byChannel: {} };
}

/** One term, ready to match. */
export interface Term {
  /** As typed, for display. */
  raw: string;
  /** Lower-cased, collapsed whitespace. */
  key: string;
  /** Plain ASCII letters/digits with no spaces: match on word boundaries rather than substring. */
  word: boolean;
}

export interface Vocabulary {
  important: Term[];
  reaction: Term[];
  /** Reaction terms that are single words, for the fast path in `isReaction`. */
  reactionWords: Set<string>;
}

const ASCII_WORD = /^[a-z0-9']+$/;

export function toTerm(raw: string): Term {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return { raw: raw.trim(), key, word: ASCII_WORD.test(key) };
}

function dedupe(terms: Term[]): Term[] {
  const seen = new Set<string>();
  return terms.filter((t) => t.key && !seen.has(t.key) && (seen.add(t.key), true));
}

/**
 * Everything that applies right now: the enabled packs, minus the defaults turned off, plus
 * the user's own global words, plus this channel's.
 */
export function buildVocabulary(state: VocabState, channel?: string | null): Vocabulary {
  const off = new Set(state.off);
  const packs = new Set(state.packs);
  const out: Record<ListKind, Term[]> = { important: [], reaction: [] };
  for (const p of PACKS) {
    if (!packs.has(p.id)) continue;
    for (const kind of ['important', 'reaction'] as const)
      for (const w of p[kind]) if (!off.has(kind + ':' + w)) out[kind].push(toTerm(w));
  }
  const mine = [state.global, channel ? (state.byChannel[channel] ?? EMPTY_LISTS) : EMPTY_LISTS];
  for (const lists of mine)
    for (const kind of ['important', 'reaction'] as const)
      for (const w of lists[kind]) if (!off.has(kind + ':' + w)) out[kind].push(toTerm(w));
  const reaction = dedupe(out.reaction);
  return {
    important: dedupe(out.important),
    reaction,
    reactionWords: new Set(reaction.filter((t) => t.word).map((t) => t.key)),
  };
}

/** The message, ready to test: lower-case text padded with spaces, plus its emote names. */
export interface Ready {
  padded: string;
  words: Set<string>;
  emotes: Set<string>;
}
const TOKEN_RE = /[\p{L}\p{N}']+/gu;

export function ready(m: ChatMessage): Ready {
  const low = m.m.trim().toLowerCase();
  return {
    padded: ' ' + low.replace(/\s+/g, ' ') + ' ',
    words: new Set(low.match(TOKEN_RE) ?? []),
    emotes: new Set(m.e.map((e) => e.toLowerCase())),
  };
}

export function matches(terms: Term[], r: Ready): boolean {
  for (const t of terms) {
    if (t.word ? r.words.has(t.key) : r.padded.includes(t.key)) return true;
    if (r.emotes.has(t.key)) return true;
  }
  return false;
}

/** The terms of `list` this message carries — used for the reason shown on a moment. */
export function found(terms: Term[], r: Ready): string[] {
  const out: string[] = [];
  for (const t of terms)
    if ((t.word ? r.words.has(t.key) : r.padded.includes(t.key)) || r.emotes.has(t.key))
      out.push(t.raw);
  return out;
}

// --- what this VOD actually said -------------------------------------------------

export interface SeenToken {
  token: string;
  /** Distinct people who used it anywhere in the VOD. */
  users: number;
  /** The most people who used it inside one 15 s window — what the heatmap reacts to. */
  peak: number;
  kind: 'emote' | 'word';
}

/** Words shorter than this are noise ("a", "no"); "lol" and "草" still make it. */
const MIN_LEN = 2;
const SEEN_BUCKET_SEC = 15;

/**
 * The vocabulary of a VOD, ranked by **how many people said it at once** rather than how often
 * it appears. Chat says "that" and "good" all day and neither marks anything; a word worth
 * adding is one a crowd reaches for in the same breath, which is exactly what the scoring
 * looks at. Emotes come from each message's own emote list; everything else is a word, which
 * is how third-party emotes (BTTV, 7TV) surface — they reach us as plain text.
 */
export function seenTokens(msgs: ChatMessage[], limit = 60): SeenToken[] {
  /** lower-case key → the form to show (an emote keeps Twitch's own casing) */
  const display = new Map<string, string>();
  const isEmote = new Set<string>();
  const users = new Map<string, Set<string>>();
  /** key → bucket index → the people who used it there */
  const perBucket = new Map<string, Map<number, Set<string>>>();
  for (const m of msgs) {
    const b = Math.floor(m.t / SEEN_BUCKET_SEC);
    const add = (raw: string, emote: boolean) => {
      const key = raw.toLowerCase();
      // an emote and the word for it are the same thing: chat replay writes emotes into the
      // text as well, so counting both would list PogChamp twice (2026-09-18)
      if (emote) {
        isEmote.add(key);
        display.set(key, raw);
      } else if (!display.has(key)) display.set(key, raw);
      let set = users.get(key);
      if (!set) users.set(key, (set = new Set()));
      set.add(m.u);
      let buckets = perBucket.get(key);
      if (!buckets) perBucket.set(key, (buckets = new Map()));
      let here = buckets.get(b);
      if (!here) buckets.set(b, (here = new Set()));
      here.add(m.u);
    };
    for (const e of new Set(m.e)) add(e, true);
    const low = m.m.toLowerCase();
    for (const w of new Set(low.match(TOKEN_RE) ?? [])) if (w.length >= MIN_LEN) add(w, false);
  }
  // a token that turns up in most of the VOD is filler, however many people say it: it cannot
  // mark a moment if it marks every moment ("de", "that", a channel's wallpaper emote)
  const busyBuckets = new Set<number>();
  for (const buckets of perBucket.values()) for (const b of buckets.keys()) busyBuckets.add(b);
  const everywhere = Math.max(1, busyBuckets.size) * 0.6;
  return [...users.entries()]
    .map(([key, set]) => {
      let peak = 0;
      const buckets = perBucket.get(key);
      for (const here of buckets?.values() ?? []) peak = Math.max(peak, here.size);
      return {
        token: display.get(key) ?? key,
        users: set.size,
        peak,
        spread: buckets?.size ?? 0,
        kind: isEmote.has(key) ? ('emote' as const) : ('word' as const),
      };
    })
    .filter((s) => s.peak >= 3 && s.spread < everywhere)
    .map(({ spread: _spread, ...s }) => s)
    .sort((a, b) => b.peak - a.peak || b.users - a.users || a.token.localeCompare(b.token))
    .slice(0, limit);
}

/**
 * Words that belong to no language in particular. Twitch chat says these everywhere, so they
 * must not be the evidence that a chat speaks German (the example VOD's English chat lit up
 * Deutsch *and* Türkçe on `hahaha` alone — 2026-09-18).
 */
const PAN_TWITCH = new Set(['haha', 'hahaha', 'lol', 'wtf', 'omg', 'ez', 'gg', 'xd', 'ww']);

/** The terms that actually identify a pack: distinctive to it, and not pan-Twitch. */
function detectionTerms(): { id: string; terms: Term[] }[] {
  const seenIn = new Map<string, number>();
  for (const p of PACKS)
    for (const w of new Set([...p.important, ...p.reaction]))
      seenIn.set(toTerm(w).key, (seenIn.get(toTerm(w).key) ?? 0) + 1);
  return PACKS.map((p) => ({
    id: p.id,
    terms: dedupe(
      [...p.important, ...p.reaction]
        .map(toTerm)
        .filter((t) => (seenIn.get(t.key) ?? 0) === 1 && !PAN_TWITCH.has(t.key)),
    ),
  }));
}

/**
 * How many distinct people in this VOD used each pack's distinctive words. The UI language is
 * a poor guess at the chat's — plenty of people watch in a language they do not set the app
 * to — so the packs are chosen from the chat itself.
 */
export function detectPacks(msgs: ChatMessage[]): Record<string, number> {
  const terms = detectionTerms().map((p) => ({ ...p, users: new Set<string>() }));
  for (const m of msgs) {
    const r = ready(m);
    for (const p of terms) if (matches(p.terms, r)) p.users.add(m.u);
  }
  return Object.fromEntries(terms.map((p) => [p.id, p.users.size]));
}

/** Packs worth switching on: a real handful of people, not one bilingual regular. */
export const DETECT_MIN_USERS = 5;
export function packsToEnable(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, n]) => n >= DETECT_MIN_USERS)
    .map(([id]) => id);
}
