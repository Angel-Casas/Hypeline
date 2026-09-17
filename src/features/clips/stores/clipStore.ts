import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  fetchPlaybackToken,
  fetchText,
  masterPlaylistUrl,
  parseMasterPlaylist,
  parseVariantPlaylist,
  pickAudioVariant,
  pickVariant,
  segmentsForRange as segmentsForRangeFn,
  viaShim,
  type Segment,
  type Variant,
} from '@/lib/twitch/hls';
import {
  cutClip,
  DEFAULT_SPLIT,
  type Aspect,
  type CutMode,
  type CutProgress,
  type SplitLayout,
} from '@/lib/video/cut';
import { buildCues, type CaptionStyle, type Cue } from '@/lib/video/captions';
import { grabThumbnail } from '@/lib/video/thumbnail';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useQuotaStore } from '@/features/settings/quotaStore';
import {
  estimateClipBytes,
  formatBytes,
  HEADROOM_BYTES,
  isQuotaError,
  wouldExceed,
} from '@/lib/storage/quota';
import * as db from '@/lib/storage/db';
import { t } from '@/i18n';

export interface ExportedClip {
  id: string;
  vodId: string;
  inSec: number;
  outSec: number;
  mode: CutMode;
  aspect: Aspect;
  variant: string;
  captions?: boolean;
  blob: Blob;
  url: string;
  bytes: number;
  createdAt: number;
  title?: string;
  tags?: string[];
}

/** Everything an export needs, frozen — the queue snapshots it per job. */
export interface ExportSpec {
  inSec: number;
  outSec: number;
  mode: CutMode;
  aspect: Aspect;
  cropCenterX: number;
  split: SplitLayout;
  captions?: { cues: Cue[]; style: CaptionStyle };
  /** A title to save on the clip (the AI title when it matches the range). */
  title?: string;
}
export interface QueuedJob {
  id: string;
  spec: ExportSpec;
  status: 'waiting' | 'running' | 'done' | 'failed';
  progress: CutProgress | null;
  clipId?: string;
  error?: string;
}

/** How much earlier than the chat spike the moment itself usually is. */
export const CHAT_LAG_SEC = 10;
/**
 * The second to build a clip range around for a moment: chat moments are shifted back for
 * the lag inside `selectAround`; a transcript hit (AI) is already at the words, so it is
 * pushed forward by the same lag and the range lands on them.
 */
export function clipAnchor(m: { t: number; source?: 'ai' }): number {
  return m.source === 'ai' ? m.t + CHAT_LAG_SEC : m.t;
}

export const useClipStore = defineStore('clip', () => {
  const settings = useSettingsStore();
  const quota = useQuotaStore();

  const inSec = ref<number | null>(null);
  const outSec = ref<number | null>(null);
  // frame-exact by default: a clip that starts up to 2 s early is the more expensive mistake,
  // and 'fast' is one menu item away when the speed matters (Angel, 2026-09-17)
  const mode = ref<CutMode>('precise');
  const aspect = ref<Aspect>('16:9');
  const cropCenterX = ref(0.5);
  const split = ref<SplitLayout>({ ...DEFAULT_SPLIT });
  /** Captions: on/off, style; the transcript text is supplied by the AI store for the current range. */
  const captionsOn = ref(false);
  const captionStyle = ref<CaptionStyle>('bold');
  const captionsUppercase = ref(true);
  /** Transcript for exactly [inSec, outSec], set by the AI store; null when none matches. */
  const captionSource = ref<{ inSec: number; outSec: number; text: string } | null>(null);
  const captionCues = computed<Cue[]>(() => {
    const src = captionSource.value;
    if (
      !src ||
      inSec.value == null ||
      outSec.value == null ||
      src.inSec !== inSec.value ||
      src.outSec !== outSec.value
    )
      return [];
    return buildCues(src.text, outSec.value - inSec.value, { uppercase: captionsUppercase.value });
  });

  const variants = shallowRef<Variant[]>([]);
  const variantSegments = new Map<string, Segment[]>();
  let playlistVodId: string | null = null;

  const exporting = ref(false);
  const progress = ref<CutProgress | null>(null);
  const error = ref<string | null>(null);
  const clips = shallowRef<ExportedClip[]>([]);
  let abort: AbortController | null = null;
  let clipsVodId: string | null = null;

  /** Load persisted clips for a VOD (called when a VOD is opened). */
  async function loadClips(vodId: string) {
    if (clipsVodId === vodId) return;
    for (const c of clips.value) URL.revokeObjectURL(c.url);
    clipsVodId = vodId;
    const stored = await db.listClips(vodId);
    clips.value = stored.map((c) => ({ ...c, url: URL.createObjectURL(c.blob) }));
    inSec.value = null;
    outSec.value = null;
  }

  const durationSec = computed(() =>
    inSec.value != null && outSec.value != null ? Math.max(0, outSec.value - inSec.value) : 0,
  );
  const canExport = computed(
    () => durationSec.value > 0 && durationSec.value <= 600 && !exporting.value,
  );

  /** Drop the range (the ribbon is clean again). */
  function clearRange() {
    inSec.value = null;
    outSec.value = null;
  }
  function setIn(sec: number) {
    inSec.value = Math.max(0, Math.floor(sec * 10) / 10);
    if (outSec.value != null && outSec.value <= inSec.value) outSec.value = inSec.value + 30;
  }
  function setOut(sec: number) {
    outSec.value = Math.max(0, Math.floor(sec * 10) / 10);
    if (inSec.value != null && inSec.value >= outSec.value)
      inSec.value = Math.max(0, outSec.value - 30);
  }
  /**
   * Convenience: a 45 s window around a moment, shifted earlier by CHAT_LAG_SEC — chat
   * reacts a few seconds late (stream delay + typing), so what it is shouting about has
   * usually already happened (Angel, 2026-09-14).
   */
  function selectAround(momentSec: number) {
    inSec.value = Math.max(0, momentSec - 15 - CHAT_LAG_SEC);
    outSec.value = Math.max(inSec.value + 5, momentSec + 30 - CHAT_LAG_SEC);
  }

  async function ensurePlaylists(vodId: string): Promise<void> {
    if (playlistVodId === vodId && variants.value.length) return;
    const token = await fetchPlaybackToken(vodId);
    const master = await fetchText(viaShim(settings.relayUrl, masterPlaylistUrl(vodId, token)));
    variants.value = parseMasterPlaylist(master);
    variantSegments.clear();
    playlistVodId = vodId;
    if (!variants.value.length) throw new Error(t('clipStore.noVariants'));
  }

  /**
   * A variant's segments, fetched once — unless the range asked for runs past what we have,
   * which on a VOD still recording means the playlist has grown: fetch it again (ADR-18).
   */
  async function segmentsFor(v: Variant, needUntil = 0): Promise<Segment[]> {
    let segs = variantSegments.get(v.name);
    const last = segs?.length ? segs[segs.length - 1]! : null;
    if (!segs || (last && last.start + last.duration < needUntil)) {
      segs = parseVariantPlaylist(await fetchText(viaShim(settings.relayUrl, v.url)), v.url);
      variantSegments.set(v.name, segs);
    }
    return segs;
  }

  /** Audio segments covering a range (audio-only variant when Twitch offers it); fetches playlists if needed. */
  async function segmentsForRange(
    vodId: string,
    inSec: number,
    outSec: number,
  ): Promise<Segment[]> {
    await ensurePlaylists(vodId);
    const v = pickAudioVariant(variants.value);
    return segmentsForRangeFn(await segmentsFor(v, outSec), inSec, outSec);
  }

  function currentSpec(): ExportSpec | null {
    if (inSec.value == null || outSec.value == null) return null;
    return {
      inSec: inSec.value,
      outSec: outSec.value,
      mode: mode.value,
      aspect: aspect.value,
      cropCenterX: cropCenterX.value,
      split: { ...split.value },
      captions:
        captionsOn.value && captionCues.value.length
          ? { cues: captionCues.value, style: captionStyle.value }
          : undefined,
      // the thumbnail title doubles as the clip's title in the gallery
      title: thumbTitle.value.trim() || undefined,
    };
  }

  async function exportClip(vodId: string): Promise<ExportedClip | null> {
    const spec = currentSpec();
    if (!canExport.value || !spec) return null;
    abort?.abort();
    abort = new AbortController();
    exporting.value = true;
    error.value = null;
    progress.value = { stage: 'loading-ffmpeg' };
    try {
      return await exportSpec(vodId, spec, abort.signal, (p) => (progress.value = p));
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      exporting.value = false;
    }
  }

  /** Cut one spec, save it, add it to `clips`. Throws on failure (callers decide how to show it). */
  async function exportSpec(
    vodId: string,
    spec: ExportSpec,
    signal: AbortSignal,
    onProgress: (p: CutProgress) => void,
  ): Promise<ExportedClip> {
    {
      await ensurePlaylists(vodId);
      const v = pickVariant(variants.value, settings.preferredHeight);
      const segs = segmentsForRangeFn(await segmentsFor(v, spec.outSec), spec.inSec, spec.outSec);
      const q = await quota.refresh();
      const need = estimateClipBytes(v.bandwidth, spec.outSec - spec.inSec);
      if (wouldExceed(q, need)) {
        throw new Error(
          t('clipStore.notEnoughStorage', {
            need: formatBytes(need),
            free: formatBytes(quota.free),
            headroom: formatBytes(HEADROOM_BYTES),
          }),
        );
      }
      const res = await cutClip({
        segments: segs,
        inSec: spec.inSec,
        outSec: spec.outSec,
        mode: spec.mode,
        aspect: spec.aspect,
        cropCenterX: spec.cropCenterX,
        split: spec.split,
        width: v.width,
        height: v.height,
        resolveUrl: (u) => viaShim(settings.relayUrl, u),
        captions: spec.captions,
        signal,
        onProgress,
      });
      const clip: ExportedClip = {
        id: `${vodId}:${spec.inSec}-${spec.outSec}:${Date.now()}`,
        vodId,
        inSec: spec.inSec,
        outSec: spec.outSec,
        mode: spec.mode,
        aspect: spec.aspect,
        variant: v.name,
        captions: !!spec.captions,
        title: spec.title?.trim() || undefined,
        blob: res.blob,
        url: URL.createObjectURL(res.blob),
        bytes: res.blob.size,
        createdAt: Date.now(),
      };
      clips.value = [clip, ...clips.value];
      const stored: db.StoredClip = { ...clip };
      delete (stored as Partial<ExportedClip>).url;
      try {
        await db.putClip(stored);
        void quota.refresh();
      } catch (e) {
        if (isQuotaError(e)) {
          quota.noteWriteFailure();
          error.value = t('clipStore.savedFailed');
        } else console.warn('could not persist clip', e);
      }
      return clip;
    }
  }

  function cancel() {
    abort?.abort();
    previewAbort?.abort();
    queueAbort?.abort();
  }

  // ---- The export queue: several ranges, one run, one progress (Angel, 2026-09-15) ----
  const queue = ref<QueuedJob[]>([]);
  const queueRunning = ref(false);
  let queueAbort: AbortController | null = null;
  const queueDone = computed(() => queue.value.filter((j) => j.status === 'done').length);
  const queueWaiting = computed(() => queue.value.filter((j) => j.status === 'waiting').length);

  /** Add the current range + settings to the queue (a range already waiting is not added twice). */
  function enqueueCurrent(): QueuedJob | null {
    const spec = currentSpec();
    if (!spec || spec.outSec - spec.inSec > 600) return null;
    const dup = queue.value.find(
      (j) =>
        j.status === 'waiting' &&
        j.spec.inSec === spec.inSec &&
        j.spec.outSec === spec.outSec &&
        j.spec.aspect === spec.aspect,
    );
    if (dup) return dup;
    const job: QueuedJob = {
      id: `${spec.inSec}-${spec.outSec}:${Date.now()}`,
      spec,
      status: 'waiting',
      progress: null,
    };
    queue.value = [...queue.value, job];
    return job;
  }
  /** Queue a 45 s window around each given moment time (chat lag applied), skipping duplicates. */
  function enqueueMoments(times: number[]) {
    for (const t of times) {
      const i = Math.max(0, t - 15 - CHAT_LAG_SEC);
      const o = Math.max(i + 5, t + 30 - CHAT_LAG_SEC);
      const spec = currentSpec();
      const base: ExportSpec = spec
        ? { ...spec, inSec: i, outSec: o }
        : {
            inSec: i,
            outSec: o,
            mode: mode.value,
            aspect: aspect.value,
            cropCenterX: cropCenterX.value,
            split: { ...split.value },
          };
      // captions belong to one range only
      delete base.captions;
      if (
        queue.value.some((j) => j.spec.inSec === i && j.spec.outSec === o && j.status !== 'failed')
      )
        continue;
      queue.value = [
        ...queue.value,
        {
          id: `${i}-${o}:${Date.now()}:${Math.random()}`,
          spec: base,
          status: 'waiting',
          progress: null,
        },
      ];
    }
  }
  function dequeue(id: string) {
    queue.value = queue.value.filter((j) => j.id !== id || j.status === 'running');
  }
  function clearQueueDone() {
    queue.value = queue.value.filter((j) => j.status === 'waiting' || j.status === 'running');
  }
  function patchJob(id: string, patch: Partial<QueuedJob>) {
    queue.value = queue.value.map((j) => (j.id === id ? { ...j, ...patch } : j));
  }
  /** Run every waiting job in order; a failure marks that job and moves on. */
  async function runQueue(vodId: string): Promise<void> {
    if (queueRunning.value || exporting.value) return;
    queueRunning.value = true;
    queueAbort = new AbortController();
    error.value = null;
    try {
      for (const job of queue.value.filter((j) => j.status === 'waiting')) {
        if (queueAbort.signal.aborted) break;
        patchJob(job.id, { status: 'running', progress: { stage: 'loading-ffmpeg' } });
        try {
          const clip = await exportSpec(vodId, job.spec, queueAbort.signal, (p) =>
            patchJob(job.id, { progress: p }),
          );
          patchJob(job.id, { status: 'done', clipId: clip.id, progress: null });
        } catch (e) {
          if ((e as DOMException)?.name === 'AbortError') {
            patchJob(job.id, { status: 'waiting', progress: null });
            break;
          }
          patchJob(job.id, {
            status: 'failed',
            progress: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      queueRunning.value = false;
    }
  }

  // ---- Preview (ephemeral): the first seconds of the range, small variant, real framing ----
  const PREVIEW_MAX_SEC = 10;
  const previewBusy = ref(false);
  const previewProgress = ref<CutProgress | null>(null);
  const previewError = ref<string | null>(null);
  const preview = ref<{
    url: string;
    blob: Blob;
    inSec: number;
    outSec: number;
    /** What it was rendered with, so the panel can say when it is stale. */
    aspect: Aspect;
    cropCenterX: number;
    camShare: number;
    variant: string;
  } | null>(null);
  let previewAbort: AbortController | null = null;
  /** The preview no longer matches the range or the framing. */
  const previewStale = computed(() => {
    const p = preview.value;
    if (!p || inSec.value == null || outSec.value == null) return false;
    return (
      p.inSec !== inSec.value ||
      p.outSec !== Math.min(outSec.value, inSec.value + PREVIEW_MAX_SEC) ||
      p.aspect !== aspect.value ||
      (aspect.value !== '16:9' && p.cropCenterX !== cropCenterX.value) ||
      (aspect.value === 'split' && p.camShare !== split.value.camShare)
    );
  });

  /**
   * Render the first PREVIEW_MAX_SEC of the range from the smallest video variant with the
   * real crop / split applied — a five-second answer to "is the framing right?" before the
   * full export (Angel, 2026-09-15).
   */
  async function previewClip(vodId: string): Promise<void> {
    if (inSec.value == null || outSec.value == null || previewBusy.value) return;
    previewAbort?.abort();
    previewAbort = new AbortController();
    previewBusy.value = true;
    previewError.value = null;
    previewProgress.value = { stage: 'loading-ffmpeg' };
    const pIn = inSec.value;
    const pOut = Math.min(outSec.value, pIn + PREVIEW_MAX_SEC);
    try {
      await ensurePlaylists(vodId);
      const v = pickVariant(variants.value, 360);
      const segs = segmentsForRangeFn(await segmentsFor(v, pOut), pIn, pOut);
      const res = await cutClip({
        segments: segs,
        inSec: pIn,
        outSec: pOut,
        // the framing is the point, so re-encode whenever there is a crop or split
        mode: aspect.value === '16:9' ? 'fast' : 'precise',
        aspect: aspect.value,
        cropCenterX: cropCenterX.value,
        split: split.value,
        width: v.width,
        height: v.height,
        resolveUrl: (u) => viaShim(settings.relayUrl, u),
        signal: previewAbort.signal,
        onProgress: (p) => (previewProgress.value = p),
      });
      if (preview.value) URL.revokeObjectURL(preview.value.url);
      preview.value = {
        url: URL.createObjectURL(res.blob),
        blob: res.blob,
        inSec: pIn,
        outSec: pOut,
        aspect: aspect.value,
        cropCenterX: cropCenterX.value,
        camShare: split.value.camShare,
        variant: v.name,
      };
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError')
        previewError.value = e instanceof Error ? e.message : String(e);
    } finally {
      previewBusy.value = false;
    }
  }
  function clearPreview() {
    if (preview.value) URL.revokeObjectURL(preview.value.url);
    preview.value = null;
  }

  // ---- Thumbnail (frame grab + title), ephemeral: not persisted ----
  const thumbTitle = ref('');
  const thumbBusy = ref(false);
  const thumbProgress = ref<CutProgress | null>(null);
  const thumbError = ref<string | null>(null);
  const thumbnail = ref<{
    url: string;
    blob: Blob;
    atSec: number;
    width: number;
    height: number;
    title: string;
  } | null>(null);

  /** Grab one frame at `atSec`, framed like the current export settings, with `thumbTitle` burned in. */
  async function grabThumbnailAt(vodId: string, atSec: number): Promise<void> {
    if (thumbBusy.value) return;
    thumbBusy.value = true;
    thumbError.value = null;
    thumbProgress.value = { stage: 'loading-ffmpeg' };
    try {
      await ensurePlaylists(vodId);
      const v = pickVariant(variants.value, settings.preferredHeight);
      const segs = segmentsForRangeFn(await segmentsFor(v, atSec + 1), atSec, atSec + 0.05);
      const res = await grabThumbnail({
        segments: segs,
        atSec,
        aspect: aspect.value,
        cropCenterX: cropCenterX.value,
        split: split.value,
        width: v.width,
        height: v.height,
        title: thumbTitle.value,
        resolveUrl: (u) => viaShim(settings.relayUrl, u),
        onProgress: (p) => (thumbProgress.value = p),
      });
      if (thumbnail.value) URL.revokeObjectURL(thumbnail.value.url);
      thumbnail.value = {
        url: URL.createObjectURL(res.blob),
        blob: res.blob,
        atSec,
        width: res.width,
        height: res.height,
        title: thumbTitle.value.trim(),
      };
    } catch (e) {
      thumbError.value = e instanceof Error ? e.message : String(e);
    } finally {
      thumbBusy.value = false;
    }
  }

  /** Rename / retag a clip (in memory and in IndexedDB). */
  async function setClipMeta(id: string, meta: { title?: string; tags?: string[] }) {
    clips.value = clips.value.map((c) => (c.id === id ? { ...c, ...meta } : c));
    await db.updateClipMeta(id, meta).catch((e) => console.warn('could not save clip meta', e));
  }
  function removeClip(id: string) {
    const c = clips.value.find((x) => x.id === id);
    if (c) URL.revokeObjectURL(c.url);
    clips.value = clips.value.filter((x) => x.id !== id);
    void db.deleteClip(id);
  }

  return {
    inSec,
    outSec,
    mode,
    aspect,
    cropCenterX,
    split,
    captionsOn,
    captionStyle,
    captionsUppercase,
    captionSource,
    captionCues,
    variants,
    exporting,
    progress,
    error,
    clips,
    durationSec,
    canExport,
    setIn,
    setOut,
    clearRange,
    selectAround,
    loadClips,
    segmentsForRange,
    exportClip,
    cancel,
    removeClip,
    setClipMeta,
    queue,
    queueRunning,
    queueDone,
    queueWaiting,
    enqueueCurrent,
    enqueueMoments,
    dequeue,
    clearQueueDone,
    runQueue,
    preview,
    previewBusy,
    previewProgress,
    previewError,
    previewStale,
    previewClip,
    clearPreview,
    thumbTitle,
    thumbBusy,
    thumbProgress,
    thumbError,
    thumbnail,
    grabThumbnailAt,
  };
});
