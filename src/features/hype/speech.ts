/**
 * What the streamer's own words add to the hype score (2026-09-15). Whisper gives plain
 * text per 2-minute chunk (no word timings), so this is a coarse per-chunk signal: how
 * excited the speech is. Blended into the chat score as a multiplier, with the loudest
 * phrase as a reason ("streamer: “no way”").
 */

/** Phrases that mark a moment when the streamer says them (lower-case, matched as words). */
const HYPE_PHRASES = [
  "let's go",
  'lets go',
  'no way',
  'oh my god',
  'oh my gosh',
  'what the',
  'are you kidding',
  'no shot',
  'holy',
  'insane',
  'unreal',
  'clip that',
  'clip it',
  'did you see that',
  'i cannot believe',
  "i can't believe",
  'chat look',
  'look at this',
  'wait wait',
  'bro',
  'dude',
  'yooo',
  'ayo',
  'nooo',
  'jesus',
  'oh no',
];
const LAUGH_RE = /\b(ha(ha)+|lol|lmao|\[laugh(s|ter)?\]|\(laugh(s|ter)?\))\b/gi;

export interface SpeechSignals {
  /** Words per minute of the chunk (0 when empty). */
  wpm: number;
  /** Exclamation / question marks per 100 words. */
  punch: number;
  /** Laughs per minute. */
  laughs: number;
  /** Hype phrases found, most telling first. */
  phrases: string[];
  /** Multiplier for the chat score of buckets inside this chunk: 0.85 (dead air) … 1.35. */
  boost: number;
}

export function speechSignals(text: string, durationSec: number): SpeechSignals {
  const t = text.trim();
  const words = t ? t.split(/\s+/).length : 0;
  const minutes = Math.max(1 / 60, durationSec / 60);
  const wpm = words / minutes;
  const marks = (t.match(/[!?]/g) ?? []).length;
  const punch = words ? (marks / words) * 100 : 0;
  const laughs = (t.match(LAUGH_RE) ?? []).length / minutes;
  const low =
    ' ' +
    t
      .toLowerCase()
      .replace(/[^a-z' ]+/g, ' ')
      .replace(/\s+/g, ' ') +
    ' ';
  const phrases = HYPE_PHRASES.filter((p) => low.includes(' ' + p + ' '));
  let boost = 1;
  if (words === 0)
    boost = 1; // no transcript → no opinion
  else if (wpm < 40)
    boost = 0.85; // dead air, AFK, music
  else {
    boost += Math.min(0.15, punch * 0.02); // "!" and "?" dense speech
    boost += Math.min(0.1, laughs * 0.05);
    boost += Math.min(0.15, phrases.length * 0.05);
  }
  return { wpm, punch, laughs, phrases, boost: Math.max(0.85, Math.min(1.35, boost)) };
}

export interface SpeechChunk {
  startSec: number;
  endSec: number;
  text: string;
}

/** Per-bucket multiplier and phrase from the chunks that cover it (1 / none when uncovered). */
export function speechForBucket(
  chunks: SpeechChunk[],
  t: number,
  bucketSec: number,
): { boost: number; phrase: string | null } {
  const c = chunks.find((x) => t >= x.startSec && t < x.endSec);
  if (!c) return { boost: 1, phrase: null };
  const s = speechSignals(c.text, c.endSec - c.startSec);
  void bucketSec;
  return { boost: s.boost, phrase: s.phrases[0] ?? null };
}
