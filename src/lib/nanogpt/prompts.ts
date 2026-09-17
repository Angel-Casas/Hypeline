/**
 * Prompts live here with a version string so cached results invalidate when a
 * prompt changes (docs/04-conventions.md). Keep them short: the user pays per token.
 */
import type { ChatMessage } from './client';

export const EXPLAIN_PROMPT_VERSION = 'explain-v1';

export interface ExplainInput {
  streamer: string;
  game: string | null;
  /** VOD seconds of the analysed window. */
  windowStart: number;
  windowEnd: number;
  /** Transcript of the window (may be empty if not transcribed). */
  transcript: string;
  /** A sample of chat lines in the window, "mm:ss text" per line. */
  chatExcerpt: string;
}

export interface ExplainOutput {
  title: string;
  hook: string;
  why: string;
  /** Seconds relative to windowStart. */
  suggestedInOffset: number;
  suggestedOutOffset: number;
  /** 1–5 */
  clipWorthiness: number;
}

export const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'hook', 'why', 'suggestedInOffset', 'suggestedOutOffset', 'clipWorthiness'],
  properties: {
    title: {
      type: 'string',
      description: 'Short, punchy clip title (max 60 chars), no quotes, no hashtags',
    },
    hook: {
      type: 'string',
      description: 'First line of an on-screen caption or post text (max 90 chars)',
    },
    why: { type: 'string', description: 'One sentence: what happens and why chat reacted' },
    suggestedInOffset: {
      type: 'number',
      description: 'Seconds after windowStart where the clip should begin',
    },
    suggestedOutOffset: {
      type: 'number',
      description: 'Seconds after windowStart where the clip should end',
    },
    clipWorthiness: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: '5 = must clip, 1 = skip (e.g. technical issue)',
    },
  },
} as const;

export function explainMessages(i: ExplainInput): ChatMessage[] {
  const len = Math.round(i.windowEnd - i.windowStart);
  return [
    {
      role: 'system',
      content:
        'You help Twitch clippers. Given a transcript and chat reactions from a short window of a stream, identify the clip-worthy moment. Be concrete and specific to what was said; never invent events. Titles should sound like real viral clip titles, not marketing copy. Answer with JSON only.',
    },
    {
      role: 'user',
      content: `Streamer: ${i.streamer}${i.game ? ` · Category: ${i.game}` : ''}
Window: ${len} s (offsets are seconds from the start of this window).

TRANSCRIPT:
${i.transcript.trim() || '(no transcript available)'}

CHAT (sampled):
${i.chatExcerpt.trim() || '(no chat)'}`,
    },
  ];
}

export function parseExplain(content: string): ExplainOutput {
  const j = JSON.parse(content) as Partial<ExplainOutput>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    title: String(j.title ?? '').slice(0, 80),
    hook: String(j.hook ?? '').slice(0, 120),
    why: String(j.why ?? ''),
    suggestedInOffset: Math.max(0, num(j.suggestedInOffset, 0)),
    suggestedOutOffset: Math.max(1, num(j.suggestedOutOffset, 30)),
    clipWorthiness: Math.min(5, Math.max(1, Math.round(num(j.clipWorthiness, 3)))),
  };
}

// ---------- Natural-language search over a VOD transcript ----------

export const SEARCH_PROMPT_VERSION = 'search-v1';

export interface SearchHit {
  /** VOD seconds. */
  t: number;
  endT: number;
  quote: string;
  why: string;
  /** 1–5 */
  confidence: number;
}

export const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hits'],
  properties: {
    hits: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['t', 'endT', 'quote', 'why', 'confidence'],
        properties: {
          t: {
            type: 'number',
            description:
              'Start time in VOD seconds, taken from the chunk label the quote came from',
          },
          endT: {
            type: 'number',
            description: 'End time in VOD seconds (start + a few seconds to a minute)',
          },
          quote: {
            type: 'string',
            description: 'Short verbatim quote from the transcript (max 120 chars)',
          },
          why: { type: 'string', description: 'One short sentence on why this matches' },
          confidence: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
  },
} as const;

export interface TranscriptChunk {
  startSec: number;
  endSec: number;
  text: string;
}

function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Transcript chunks as "[h:mm:ss–h:mm:ss] text" lines. */
export function formatChunks(chunks: TranscriptChunk[]): string {
  return chunks
    .map(
      (c) => `[${hms(c.startSec)}–${hms(c.endSec)} | ${Math.round(c.startSec)}s] ${c.text.trim()}`,
    )
    .join('\n');
}

export function searchMessages(
  query: string,
  chunks: TranscriptChunk[],
  streamer: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You search a Twitch stream transcript for a clipper. Each chunk is labelled with its VOD time range and its start in seconds. Return the moments that best match the request, with `t` equal to the labelled start seconds of the chunk (plus an offset if the quote is clearly later in the chunk). Quote the transcript verbatim; never invent. Prefer fewer, better hits. JSON only.',
    },
    {
      role: 'user',
      content: `Streamer: ${streamer}\nRequest: ${query}\n\nTRANSCRIPT:\n${formatChunks(chunks)}`,
    },
  ];
}

export function parseSearch(content: string): SearchHit[] {
  const j = JSON.parse(content) as { hits?: Partial<SearchHit>[] };
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return (j.hits ?? [])
    .map((h) => {
      const t = Math.max(0, num(h.t, 0));
      return {
        t,
        endT: Math.max(t + 5, num(h.endT, t + 30)),
        quote: String(h.quote ?? '').slice(0, 160),
        why: String(h.why ?? ''),
        confidence: Math.min(5, Math.max(1, Math.round(num(h.confidence, 3)))),
      };
    })
    .sort((a, b) => b.confidence - a.confidence || a.t - b.t);
}
