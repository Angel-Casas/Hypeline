import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/lib/twitch/types';
import {
  buildVocabulary,
  detectPacks,
  emptyState,
  matches,
  packsToEnable,
  ready,
  seenTokens,
  toTerm,
} from '../vocabulary';
import { isClipRequest, isReaction } from '../scoring';
import { analyse, isClipRequest, isReaction, NO_VOCAB } from '../scoring';

const msg = (m: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  t: 0,
  u: 'u',
  m,
  e: [],
  b: [],
  ...extra,
});

describe('terms', () => {
  it('matches a plain word by word and anything else by substring', () => {
    const word = [toTerm('clip')];
    const cjk = [toTerm('切り抜き')];
    const phrase = [toTerm('clipea eso')];
    expect(matches(word, ready(msg('someone clip that')))).toBe(true);
    // a word must not fire inside a longer one, or "clip" would match "clipboard"
    expect(matches(word, ready(msg('check the clipboard')))).toBe(false);
    // Japanese has no word boundaries, so it matches wherever it sits
    expect(matches(cjk, ready(msg('これ切り抜きたい')))).toBe(true);
    expect(matches(phrase, ready(msg('CLIPEA ESO YA')))).toBe(true);
    expect(matches(phrase, ready(msg('clipea')))).toBe(false);
  });

  it('matches an emote by name whatever Twitch capitalised it as', () => {
    const t = [toTerm('pagman')];
    expect(matches(t, ready(msg('x', { e: ['PagMan'] })))).toBe(true);
  });
});

describe('building the vocabulary', () => {
  it('stacks packs, global words and the channel on top of each other', () => {
    const state = {
      ...emptyState(),
      packs: ['es'],
      global: { important: ['sube eso'], reaction: ['uwu'] },
      byChannel: { qshiyunn: { important: ['qshiyClip'], reaction: [] } },
    };
    const here = buildVocabulary(state, 'qshiyunn');
    const elsewhere = buildVocabulary(state, 'someoneelse');
    expect(here.important.map((t) => t.key)).toContain('clipea');
    expect(here.important.map((t) => t.key)).toContain('qshiyclip');
    expect(elsewhere.important.map((t) => t.key)).not.toContain('qshiyclip');
    expect(elsewhere.important.map((t) => t.key)).toContain('sube eso');
  });

  it('drops a default the user turned off, and never duplicates', () => {
    const state = {
      ...emptyState(),
      packs: ['es'],
      off: ['reaction:jaja'],
      global: { important: [], reaction: ['jajaja'] },
    };
    const v = buildVocabulary(state);
    expect(v.reaction.map((t) => t.key)).not.toContain('jaja');
    expect(v.reaction.filter((t) => t.key === 'jajaja')).toHaveLength(1);
  });
});

describe('scoring with a vocabulary', () => {
  it('leaves the shipped behaviour alone when there is nothing added', () => {
    expect(isClipRequest(msg('CLIP IT'))).toBe(true);
    expect(isClipRequest(msg('clipea eso'))).toBe(false);
    expect(isReaction(msg('jaja'))).toBe(false);
  });

  it('treats an added word as its list says', () => {
    const v = buildVocabulary({
      ...emptyState(),
      global: { important: ['clipea eso'], reaction: ['jaja'] },
    });
    expect(isClipRequest(msg('clipea eso porfa'), v)).toBe(true);
    expect(isReaction(msg('jaja'), v)).toBe(true);
    // still not a clip request: it is in the other list
    expect(isClipRequest(msg('jaja'), v)).toBe(false);
  });

  it('lifts a moment that the English lists would have missed', () => {
    // thirty people chatting quietly for twenty minutes, and one burst where six of them
    // ask for a clip in Spanish
    const msgs: ChatMessage[] = [];
    for (let t = 0; t < 1200; t += 2)
      msgs.push({ t, u: 'u' + (t % 30), m: 'hablando de la vida', e: [], b: [] });
    for (let i = 0; i < 6; i++)
      msgs.push({ t: 600 + i, u: 'clipper' + i, m: 'CLIPEA ESO', e: [], b: [] });
    const at600 = (ms: ChatMessage[], v = NO_VOCAB) =>
      analyse(ms, 'v', 1200, 12, undefined, [], v).buckets.find((b) => b.t === 600)!.score;
    const v = buildVocabulary({ ...emptyState(), packs: ['es'] });
    expect(at600(msgs, v)).toBeGreaterThan(at600(msgs) * 1.5);
  });
});

describe('what a VOD said', () => {
  const chat: ChatMessage[] = [];
  // "nice" is said all day by different people; KEKW happens in one burst
  for (let t = 0; t < 600; t += 10) chat.push({ t, u: 'u' + (t % 40), m: 'nice', e: [], b: [] });
  for (let i = 0; i < 8; i++)
    chat.push({ t: 300 + i, u: 'watcher' + i, m: 'KEKW KEKW', e: ['KEKW'], b: [] });

  it('ranks by how many people said it at once, not how often it appears', () => {
    const seen = seenTokens(chat);
    expect(seen[0]!.token).toBe('KEKW');
    expect(seen[0]!.kind).toBe('emote');
    // the emote and the word for it are one row, not two
    expect(seen.filter((s) => s.token.toLowerCase() === 'kekw')).toHaveLength(1);
    // "nice" is said by 40 different people over ten minutes and never by a crowd at once,
    // so it is not offered at all — which is the whole point of ranking this way
    expect(seen.map((s) => s.token)).not.toContain('nice');
    expect(seen[0]!.users).toBe(8);
  });
});

describe('detecting a language', () => {
  const spanish = Array.from({ length: 12 }, (_, i) => ({
    t: i * 5,
    u: 'es' + i,
    m: i % 2 ? 'jajajaja que crack' : 'clipea eso ya',
    e: [],
    b: [],
  }));
  const english = Array.from({ length: 30 }, (_, i) => ({
    t: i * 5,
    u: 'en' + i,
    m: i % 3 ? 'hahaha that was good' : 'lol gg',
    e: [],
    b: [],
  }));

  it('finds the language a chat actually speaks', () => {
    expect(packsToEnable(detectPacks(spanish))).toContain('es');
  });

  it('is not fooled by words every chat uses', () => {
    // hahaha / lol / gg belong to no language: they used to light up Deutsch and Türkçe
    expect(packsToEnable(detectPacks(english))).toEqual([]);
  });
});

describe('turning English off', () => {
  const msg = (m: string): ChatMessage => ({ t: 0, u: 'a', m, e: [], b: [] });

  it('stops the shipped English words counting', () => {
    const on = buildVocabulary(emptyState());
    expect(isClipRequest(msg('CLIP IT'), on)).toBe(true);
    expect(isReaction(msg('lol'), on)).toBe(true);

    const off = buildVocabulary({ ...emptyState(), enOff: true });
    expect(isClipRequest(msg('CLIP IT'), off)).toBe(false);
    // "lol" is three letters, so only the English list could have made it a reaction
    expect(isReaction(msg('lol'), off)).toBe(false);
  });

  it('leaves emotes alone, which is the language-neutral baseline', () => {
    const off = buildVocabulary({ ...emptyState(), enOff: true });
    expect(isReaction({ t: 0, u: 'a', m: 'KEKW', e: ['KEKW'], b: [] }, off)).toBe(true);
  });

  it('lets one shipped word be switched off on its own', () => {
    // the × on a default chip has to reach scoring's regex and word set, not just the UI
    const v = buildVocabulary({ ...emptyState(), off: ['important:clip it', 'reaction:lol'] });
    expect(isClipRequest(msg('clip it'), v)).toBe(false);
    expect(isClipRequest(msg('someone clip that'), v)).toBe(true);
    expect(isReaction(msg('lol'), v)).toBe(false);
    expect(isReaction(msg('kekw'), v)).toBe(true);
  });
});
