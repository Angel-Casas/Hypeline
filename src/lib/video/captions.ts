/**
 * Captions from a plain transcript. NanoGPT's Whisper returns no timestamps
 * (docs/05-research.md), so cues are timed proportionally to their character
 * length across the clip — good enough for short clips; exact timing can come
 * later from a timestamped STT model.
 */

export interface Cue {
  /** Seconds from clip start. */
  start: number;
  end: number;
  text: string;
}

export type CaptionStyle = 'bold' | 'boxed' | 'top';

export interface CaptionOptions {
  /** Max characters per cue (one or two short lines). */
  maxChars?: number;
  /** Uppercase everything (the usual clip look). */
  uppercase?: boolean;
  /** Minimum cue duration in seconds. */
  minDur?: number;
}

const ABBREV = /\b(mr|mrs|ms|dr|st|vs|etc)\.$/i;

function splitSentences(text: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[.!?]["')\]]?$/.test(w) && !ABBREV.test(w)) {
      out.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

function packWords(sentence: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const w of sentence.split(' ')) {
    const add = (len ? 1 : 0) + w.length;
    if (len + add > maxChars && cur.length) {
      out.push(cur.join(' '));
      cur = [];
      len = 0;
    }
    cur.push(w);
    len += (len ? 1 : 0) + w.length;
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/**
 * Split text into sentences, pack each into cues of ≤ maxChars, then fold tiny
 * fragments (a lone "doing.") into a neighbour, allowing ~20% overflow.
 */
export function chunkTranscript(text: string, opts: CaptionOptions = {}): string[] {
  const maxChars = opts.maxChars ?? 32;
  const cues = splitSentences(text).flatMap((sent) => packWords(sent, maxChars));
  const tiny = Math.max(6, Math.round(maxChars * 0.3));
  const slack = Math.round(maxChars * 1.2);
  for (let i = 0; i < cues.length;) {
    const c = cues[i]!;
    if (c.length >= tiny || cues.length === 1) {
      i++;
      continue;
    }
    const prev = i > 0 ? cues[i - 1]! : null;
    const next = i + 1 < cues.length ? cues[i + 1]! : null;
    if (prev && prev.length + 1 + c.length <= slack) {
      cues[i - 1] = prev + ' ' + c;
      cues.splice(i, 1);
    } else if (next && next.length + 1 + c.length <= slack) {
      cues[i + 1] = c + ' ' + next;
      cues.splice(i, 1);
    } else {
      i++;
    }
  }
  return cues;
}

/** Assign cue times proportional to character weight (with a floor per cue). */
export function timeCues(chunks: string[], durationSec: number, opts: CaptionOptions = {}): Cue[] {
  if (!chunks.length || durationSec <= 0) return [];
  const minDur = opts.minDur ?? 0.6;
  const weights = chunks.map((c) => Math.max(1, c.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  const cues: Cue[] = chunks.map((text, i) => {
    const d = Math.max(minDur, (weights[i]! / total) * durationSec);
    const c = { start: t, end: t + d, text };
    t += d;
    return c;
  });
  // Rescale if floors pushed us past the end.
  const last = cues[cues.length - 1]!;
  if (last.end > durationSec) {
    const k = durationSec / last.end;
    for (const c of cues) {
      c.start *= k;
      c.end *= k;
    }
  }
  return cues;
}

export function buildCues(
  transcript: string,
  durationSec: number,
  opts: CaptionOptions = {},
): Cue[] {
  const chunks = chunkTranscript(transcript, opts).map((c) =>
    opts.uppercase ? c.toUpperCase() : c,
  );
  return timeCues(chunks, durationSec, opts);
}

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function assEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
}

/**
 * Render cues to an ASS script sized to the output frame. Font sizes scale with
 * frame height so a 9:16 crop and a 16:9 frame look alike.
 */
export function toAss(
  cues: Cue[],
  width: number,
  height: number,
  style: CaptionStyle = 'bold',
  fontName = 'DejaVu Sans',
): string {
  const size = Math.round(height * (style === 'top' ? 0.055 : 0.07));
  const marginV = Math.round(height * 0.1);
  const marginH = Math.round(width * 0.06);
  // Alignment: 2 = bottom centre, 8 = top centre. BorderStyle 1 = outline, 3 = opaque box.
  const styleLine =
    style === 'boxed'
      ? `Style: Cap,${fontName},${size},&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,3,3,0,2,${marginH},${marginH},${marginV},1`
      : style === 'top'
        ? `Style: Cap,${fontName},${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,8,${marginH},${marginH},${marginV},1`
        : `Style: Cap,${fontName},${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,${marginH},${marginH},${marginV},1`;
  const events = cues
    .map(
      (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${assEscape(c.text)}`,
    )
    .join('\n');
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

/**
 * ASS script for a thumbnail title: one big bold outlined line block, bottom
 * centre, wrapped by libass within the frame margins. Sized by the smaller of
 * height and width so 16:9 and 9:16 frames both stay legible.
 */
export function titleAss(
  title: string,
  width: number,
  height: number,
  fontName = 'DejaVu Sans',
): string {
  const size = Math.round(Math.min(height * 0.09, width * 0.11));
  const marginV = Math.round(height * 0.08);
  const marginH = Math.round(width * 0.05);
  const outline = Math.max(2, Math.round(size * 0.08));
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,${fontName},${size},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},2,2,${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:10:00.00,Title,,0,0,0,,${assEscape(title.trim())}
`;
}

/** Output frame size after an optional crop filter like "crop=404:720:438:0". */
export function outputSize(
  width: number,
  height: number,
  cropFilter: string | null,
): { width: number; height: number } {
  const m = cropFilter && /crop=(\d+):(\d+)/.exec(cropFilter);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width, height };
}
