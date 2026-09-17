/**
 * Browser storage quota: everything we keep (chat, transcripts, clips) lives
 * in IndexedDB, and browsers evict non-persisted origins under pressure or
 * refuse writes (QuotaExceededError) when the origin's quota is full.
 * Pure helpers here are unit-tested; the navigator calls are thin wrappers.
 */

export interface QuotaInfo {
  /** Bytes the origin currently uses (0 when unknown). */
  usage: number;
  /** Bytes the browser allows the origin (0 when unknown). */
  quota: number;
  /** usage / quota, 0 when unknown. */
  ratio: number;
  /** Whether the browser promised not to evict this origin's data. */
  persisted: boolean;
  /** navigator.storage.estimate is unavailable (older Safari, private modes). */
  unknown: boolean;
}

export type QuotaLevel = 'ok' | 'warn' | 'critical';

export const WARN_RATIO = 0.7;
export const CRITICAL_RATIO = 0.9;
/** Below this much free space we warn regardless of ratio (one 1080p clip ≈ 100–200 MB). */
export const MIN_FREE_BYTES = 300 * 1048576;

export function quotaLevel(q: Pick<QuotaInfo, 'usage' | 'quota' | 'unknown'>): QuotaLevel {
  if (q.unknown || q.quota <= 0) return 'ok';
  const free = q.quota - q.usage;
  const ratio = q.usage / q.quota;
  if (ratio >= CRITICAL_RATIO || free < MIN_FREE_BYTES / 3) return 'critical';
  if (ratio >= WARN_RATIO || free < MIN_FREE_BYTES) return 'warn';
  return 'ok';
}

/** Rough size of a clip export from the variant bitrate; fast mode copies the stream so it's close, precise re-encodes similar. */
export function estimateClipBytes(bandwidthBitsPerSec: number, durationSec: number): number {
  return Math.round((bandwidthBitsPerSec / 8) * durationSec);
}

/** Headroom we always leave so the browser's own bookkeeping and the chat cache keep working. */
export const HEADROOM_BYTES = 100 * 1048576;

/** True when saving `bytes` more would leave less than HEADROOM_BYTES free. */
export function wouldExceed(
  q: Pick<QuotaInfo, 'usage' | 'quota' | 'unknown'>,
  bytes: number,
): boolean {
  if (q.unknown || q.quota <= 0) return false;
  return q.usage + bytes > q.quota - HEADROOM_BYTES;
}

export function formatBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export async function estimateQuota(): Promise<QuotaInfo> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.estimate) return { usage: 0, quota: 0, ratio: 0, persisted: false, unknown: true };
  try {
    const [est, persisted] = await Promise.all([
      s.estimate(),
      s.persisted?.().catch(() => false) ?? false,
    ]);
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    return { usage, quota, ratio: quota ? usage / quota : 0, persisted, unknown: false };
  } catch {
    return { usage: 0, quota: 0, ratio: 0, persisted: false, unknown: true };
  }
}

/** Ask the browser not to evict our data. Chromium grants silently for installed PWAs / engaged sites; Firefox prompts. */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
