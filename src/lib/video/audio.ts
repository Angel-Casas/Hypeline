/**
 * Extract a small mono 16 kHz MP3 of a VOD range for transcription.
 * NanoGPT caps direct uploads at 3 MB (measured 2026-09-13): WAV would be
 * 1.9 MB/min, MP3 at 32 kbps is ~240 KB/min, so a 10-minute range still fits.
 */
import type { Segment } from '@/lib/twitch/hls';
import { runJob } from './ffmpeg';
import { downloadSegments } from './cut';
import { t } from '@/i18n';

export interface AudioProgress {
  stage: 'loading-ffmpeg' | 'downloading' | 'extracting' | 'done';
  ratio?: number;
  detail?: string;
}

/** NanoGPT's direct-upload limit. Larger files need their "upload URL" flow (not implemented). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const AUDIO_KBPS = 32;

export async function extractAudio(req: {
  segments: Segment[];
  inSec: number;
  outSec: number;
  resolveUrl: (url: string) => string;
  signal?: AbortSignal;
  onProgress?: (p: AudioProgress) => void;
}): Promise<Blob> {
  const { segments, inSec, outSec, onProgress, signal } = req;
  if (!segments.length) throw new Error(t('video.noSegments'));
  onProgress?.({ stage: 'loading-ffmpeg' });
  const { joined } = await downloadSegments(segments, req.resolveUrl, signal, (ratio, detail) =>
    onProgress?.({ stage: 'downloading', ratio, detail }),
  );
  // the ffmpeg part alone is retried on a wasm crash (the bytes are already here)
  return runJob(async (ff) => {
    await ff.writeFile('a.ts', joined);
    const offset = Math.max(0, inSec - segments[0]!.start);
    const duration = outSec - inSec;
    onProgress?.({ stage: 'extracting' });
    const code = await ff.exec([
      '-ss',
      offset.toFixed(3),
      '-i',
      'a.ts',
      '-t',
      duration.toFixed(3),
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${AUDIO_KBPS}k`,
      'a.mp3',
    ]);
    if (code !== 0) throw new Error(t('video.ffmpegExited', { code }));
    const data = (await ff.readFile('a.mp3')) as Uint8Array;
    await ff.deleteFile('a.ts').catch(() => {});
    await ff.deleteFile('a.mp3').catch(() => {});
    onProgress?.({ stage: 'done' });
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(t('video.audioTooLarge', { mb: (data.byteLength / 1048576).toFixed(1) }));
    }
    return new Blob([data.buffer as ArrayBuffer], { type: 'audio/mpeg' });
  });
}
