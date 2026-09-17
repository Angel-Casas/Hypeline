import { t } from '@/i18n';
import { defineStore } from 'pinia';
import type { Moment } from '@/features/hype/scoring';
import { computed, ref, shallowRef, watch } from 'vue';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useClipStore } from '@/features/clips/stores/clipStore';
import { useVodStore } from '@/features/vod/stores/vodStore';
import {
  chat,
  checkBalance,
  listModels,
  transcribe,
  NanoGptError,
  type ModelInfo,
} from '@/lib/nanogpt/client';
import {
  estimateChatUsd,
  estimateTokens,
  estimateTranscriptionUsd,
  pickDefaultChatModel,
} from '@/lib/nanogpt/pricing';
import {
  EXPLAIN_PROMPT_VERSION,
  EXPLAIN_SCHEMA,
  explainMessages,
  parseExplain,
  parseSearch,
  searchMessages,
  SEARCH_SCHEMA,
  formatChunks,
  type ExplainOutput,
  type SearchHit,
  type TranscriptChunk,
} from '@/lib/nanogpt/prompts';
import { extractAudio, type AudioProgress } from '@/lib/video/audio';
import { viaShim } from '@/lib/twitch/hls';
import { formatHms } from '@/lib/twitch/vodUrl';
import type { ChatMessage as TwitchChatMessage } from '@/lib/twitch/types';
import * as db from '@/lib/storage/db';

export interface Transcript {
  inSec: number;
  outSec: number;
  text: string;
  model: string;
  costUsd: number | null;
}
export interface Explanation extends ExplainOutput {
  inSec: number;
  outSec: number;
  model: string;
  costUsd: number | null;
}

export const useAiStore = defineStore('ai', () => {
  const settings = useSettingsStore();
  const clipStore = useClipStore();

  const models = shallowRef<ModelInfo[]>([]);
  const balanceUsd = ref<number | null>(null);
  const busy = ref<'idle' | 'models' | 'transcribing' | 'explaining' | 'bulk' | 'searching'>(
    'idle',
  );
  const progress = ref<AudioProgress | { stage: 'uploading' | 'thinking' } | null>(null);
  const error = ref<string | null>(null);
  const transcript = ref<Transcript | null>(null);
  const explanation = ref<Explanation | null>(null);
  /** Lifetime spend recorded by this browser (sum of reported/estimated costs). */
  const spentUsd = ref(Number(localStorage.getItem('hypeline.spentUsd') ?? 0) || 0);

  const hasKey = computed(() => settings.aiApiKey.trim().length > 0);
  const client = () => ({ apiKey: settings.aiApiKey.trim(), baseUrl: settings.aiBaseUrl });
  const chatModelInfo = computed(() => models.value.find((m) => m.id === settings.chatModel));

  function recordSpend(v: number | null | undefined) {
    if (v == null) return;
    spentUsd.value += v;
    localStorage.setItem('hypeline.spentUsd', String(spentUsd.value));
  }

  async function refreshModels() {
    if (!hasKey.value) return;
    busy.value = 'models';
    error.value = null;
    try {
      const [m, b] = await Promise.all([
        listModels(client()),
        checkBalance(client()).catch(() => null),
      ]);
      models.value = m;
      balanceUsd.value = b;
      if (!settings.chatModel || !m.some((x) => x.id === settings.chatModel))
        settings.chatModel = pickDefaultChatModel(m) ?? '';
    } catch (e) {
      error.value = e instanceof NanoGptError ? `${e.message} (${e.kind})` : String(e);
    } finally {
      busy.value = 'idle';
    }
  }

  /** Estimates shown before each action. */
  const transcribeEstimate = computed(() =>
    estimateTranscriptionUsd(settings.sttModel, clipStore.durationSec),
  );
  function explainEstimate(chatExcerpt: string): number {
    const promptTokens = estimateTokens(chatExcerpt + (transcript.value?.text ?? '')) + 200;
    return estimateChatUsd(chatModelInfo.value, promptTokens, 200);
  }

  function key(
    vodId: string,
    kind: 'transcript' | 'explain',
    inSec: number,
    outSec: number,
    model: string,
  ) {
    return `${vodId}:${inSec}-${outSec}:${kind}:${kind === 'explain' ? EXPLAIN_PROMPT_VERSION + ':' : ''}${model}`;
  }

  async function transcribeRange(vodId: string): Promise<Transcript | null> {
    const inSec = clipStore.inSec;
    const outSec = clipStore.outSec;
    if (inSec == null || outSec == null || !hasKey.value) return null;
    busy.value = 'transcribing';
    error.value = null;
    try {
      const id = key(vodId, 'transcript', inSec, outSec, settings.sttModel);
      const cached = await db.getAi(id);
      if (cached) {
        transcript.value = {
          inSec,
          outSec,
          text: cached.content,
          model: cached.model,
          costUsd: cached.costUsd,
        };
        clipStore.captionSource = { inSec, outSec, text: cached.content };
        return transcript.value;
      }
      const segs = await clipStore.segmentsForRange(vodId, inSec, outSec);
      const wav = await extractAudio({
        segments: segs,
        inSec,
        outSec,
        resolveUrl: (u) => viaShim(settings.relayUrl, u),
        onProgress: (p) => (progress.value = p),
      });
      progress.value = { stage: 'uploading' };
      const r = await transcribe(client(), {
        file: wav,
        filename: 'a.mp3',
        model: settings.sttModel,
      });
      const costUsd =
        r.costUsd ?? estimateTranscriptionUsd(settings.sttModel, r.durationSec ?? outSec - inSec);
      recordSpend(costUsd);
      transcript.value = { inSec, outSec, text: r.text, model: settings.sttModel, costUsd };
      clipStore.captionSource = { inSec, outSec, text: r.text };
      await db.putAi({
        id,
        vodId,
        kind: 'transcript',
        inSec,
        outSec,
        model: settings.sttModel,
        content: r.text,
        costUsd,
        createdAt: Date.now(),
      });
      return transcript.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      busy.value = 'idle';
      progress.value = null;
    }
  }

  /** "mm:ss text" lines, capped so the prompt stays cheap. */
  function chatExcerptFor(
    messages: TwitchChatMessage[],
    inSec: number,
    outSec: number,
    max = 80,
  ): string {
    const inRange = messages.filter(
      (m) => m.t >= inSec && m.t <= outSec && !m.b.includes('bot-badge'),
    );
    const step = Math.max(1, Math.ceil(inRange.length / max));
    return inRange
      .filter((_, i) => i % step === 0)
      .map((m) => `${formatHms(m.t - inSec).slice(2)} ${m.m.slice(0, 80)}`)
      .join('\n');
  }

  async function explainRange(
    vodId: string,
    meta: { streamer: string; game: string | null },
    messages: TwitchChatMessage[],
  ): Promise<Explanation | null> {
    const inSec = clipStore.inSec;
    const outSec = clipStore.outSec;
    if (inSec == null || outSec == null || !hasKey.value || !settings.chatModel) return null;
    busy.value = 'explaining';
    error.value = null;
    try {
      const id = key(vodId, 'explain', inSec, outSec, settings.chatModel);
      const cached = await db.getAi(id);
      if (cached) {
        explanation.value = {
          ...parseExplain(cached.content),
          inSec,
          outSec,
          model: cached.model,
          costUsd: cached.costUsd,
        };
        return explanation.value;
      }
      progress.value = { stage: 'thinking' };
      const excerpt = chatExcerptFor(messages, inSec, outSec);
      const t =
        transcript.value && transcript.value.inSec === inSec && transcript.value.outSec === outSec
          ? transcript.value.text
          : '';
      const msgs = explainMessages({
        streamer: meta.streamer,
        game: meta.game,
        windowStart: inSec,
        windowEnd: outSec,
        transcript: t,
        chatExcerpt: excerpt,
      });
      const r = await chat(client(), {
        model: settings.chatModel,
        messages: msgs,
        jsonSchema: { name: 'clip_moment', schema: EXPLAIN_SCHEMA },
        maxTokens: 400,
      });
      const costUsd =
        r.costUsd ?? estimateChatUsd(chatModelInfo.value, r.promptTokens, r.completionTokens);
      recordSpend(costUsd);
      const parsed = parseExplain(r.content);
      explanation.value = { ...parsed, inSec, outSec, model: settings.chatModel, costUsd };
      await db.putAi({
        id,
        vodId,
        kind: 'explain',
        inSec,
        outSec,
        model: settings.chatModel,
        content: JSON.stringify(parsed),
        costUsd,
        createdAt: Date.now(),
      });
      return explanation.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      busy.value = 'idle';
      progress.value = null;
    }
  }

  // ---------- Whole-VOD transcription (chunked, resumable) ----------

  /** Chunk length for bulk transcription. Search timing precision = this. */
  const BULK_CHUNK_SEC = 120;
  const bulkChunks = shallowRef<TranscriptChunk[]>([]);
  // the streamer's words feed the hype score (features/hype/speech.ts): hand every change over
  const vod = useVodStore();
  watch(
    [bulkChunks, transcript],
    () => {
      const chunks = [
        ...bulkChunks.value.map((c) => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
      ];
      const t = transcript.value;
      if (t && !chunks.some((c) => c.startSec <= t.inSec && c.endSec >= t.outSec))
        chunks.push({ startSec: t.inSec, endSec: t.outSec, text: t.text });
      vod.setSpeech(chunks);
    },
    { deep: false },
  );
  const bulk = ref<{
    done: number;
    total: number;
    costUsd: number;
    fromSec: number;
    toSec: number;
    /** The chunk being extracted + transcribed right now (for the timeline). */
    current: [number, number] | null;
  } | null>(null);
  let bulkAbort: AbortController | null = null;
  let bulkVodId: string | null = null;

  function chunkRanges(fromSec: number, toSec: number): [number, number][] {
    const out: [number, number][] = [];
    for (
      let a = Math.floor(fromSec / BULK_CHUNK_SEC) * BULK_CHUNK_SEC;
      a < toSec;
      a += BULK_CHUNK_SEC
    )
      out.push([a, Math.min(a + BULK_CHUNK_SEC, toSec)]);
    return out;
  }

  /** Load already-transcribed chunks for this VOD (any chunk-aligned transcript counts). */
  async function loadBulk(vodId: string) {
    if (bulkVodId !== vodId) {
      aiMoments.value = [];
      searchHits.value = [];
      lastQuery.value = '';
    }
    bulkVodId = vodId;
    const rows = await db.listAi(vodId);
    bulkChunks.value = rows
      .filter(
        (r) =>
          r.kind === 'transcript' &&
          r.inSec % BULK_CHUNK_SEC === 0 &&
          r.outSec - r.inSec <= BULK_CHUNK_SEC,
      )
      .map((r) => ({ startSec: r.inSec, endSec: r.outSec, text: r.content }))
      .sort((a, b) => a.startSec - b.startSec);
  }

  /** Estimate for transcribing [from, to): only the chunks not cached yet. */
  function bulkEstimate(
    fromSec: number,
    toSec: number,
  ): { chunks: number; cached: number; usd: number; downloadMb: number } {
    const ranges = chunkRanges(fromSec, toSec);
    const have = new Set(bulkChunks.value.map((c) => c.startSec));
    const todo = ranges.filter(([a]) => !have.has(a));
    const seconds = todo.reduce((s, [a, b]) => s + (b - a), 0);
    return {
      chunks: todo.length,
      cached: ranges.length - todo.length,
      usd: estimateTranscriptionUsd(settings.sttModel, seconds),
      downloadMb: (seconds / 10) * 0.27,
    };
  }

  async function transcribeBulk(vodId: string, fromSec: number, toSec: number): Promise<void> {
    if (!hasKey.value) return;
    if (bulkVodId !== vodId) await loadBulk(vodId);
    bulkAbort?.abort();
    bulkAbort = new AbortController();
    const signal = bulkAbort.signal;
    const ranges = chunkRanges(fromSec, toSec);
    const have = new Set(bulkChunks.value.map((c) => c.startSec));
    const todo = ranges.filter(([a]) => !have.has(a));
    busy.value = 'bulk';
    error.value = null;
    bulk.value = { done: 0, total: todo.length, costUsd: 0, fromSec, toSec, current: null };
    try {
      for (const [a, b] of todo) {
        if (signal.aborted) break;
        bulk.value = { ...bulk.value!, current: [a, b] };
        const id = key(vodId, 'transcript', a, b, settings.sttModel);
        const segs = await clipStore.segmentsForRange(vodId, a, b);
        if (!segs.length) throw new Error(t('aiStore.noSegments', { from: a, to: b }));
        const wav = await extractAudio({
          segments: segs,
          inSec: a,
          outSec: b,
          resolveUrl: (u) => viaShim(settings.relayUrl, u),
          signal,
        });
        const r = await transcribe(client(), {
          file: wav,
          filename: 'a.mp3',
          model: settings.sttModel,
          signal,
        });
        const costUsd =
          r.costUsd ?? estimateTranscriptionUsd(settings.sttModel, r.durationSec ?? b - a);
        recordSpend(costUsd);
        await db.putAi({
          id,
          vodId,
          kind: 'transcript',
          inSec: a,
          outSec: b,
          model: settings.sttModel,
          content: r.text,
          costUsd,
          createdAt: Date.now(),
        });
        bulkChunks.value = [...bulkChunks.value, { startSec: a, endSec: b, text: r.text }].sort(
          (x, y) => x.startSec - y.startSec,
        );
        bulk.value = {
          ...bulk.value!,
          done: bulk.value!.done + 1,
          costUsd: bulk.value!.costUsd + costUsd,
          current: null,
        };
      }
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError')
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = 'idle';
    }
  }

  function cancelBulk() {
    bulkAbort?.abort();
  }

  // ---------- Natural-language search ----------

  const searchHits = shallowRef<SearchHit[]>([]);
  const lastQuery = ref('');
  /**
   * Every hit from every search on this VOD, as moments for the heatmap and the grid
   * (2026-09-16, Angel): the user's questions become pins beside chat's. Cleared on demand
   * or when another VOD opens. Two hits within 20 s count as one.
   */
  const aiMoments = shallowRef<Moment[]>([]);
  function addAiMoments(query: string, hits: SearchHit[]) {
    const out = [...aiMoments.value];
    for (const h of hits) {
      if (out.some((m) => Math.abs(m.t - h.t) < 20)) continue;
      out.push({
        id: `ai:${bulkVodId}:${Math.round(h.t)}`,
        t: h.t,
        score: h.confidence,
        n: 0,
        users: 0,
        reasons: [`“${h.quote}”`, h.why],
        source: 'ai',
        query,
        quote: h.quote,
      });
    }
    aiMoments.value = out.sort((a, b) => a.t - b.t);
  }
  function clearAiMoments() {
    aiMoments.value = [];
  }
  const MAX_SEARCH_TOKENS = 100_000;

  function searchEstimate(query: string): { usd: number; tokens: number; truncated: boolean } {
    const text = formatChunks(bulkChunks.value);
    const tokens = estimateTokens(text) + estimateTokens(query) + 150;
    return {
      usd: estimateChatUsd(chatModelInfo.value, Math.min(tokens, MAX_SEARCH_TOKENS), 400),
      tokens,
      truncated: tokens > MAX_SEARCH_TOKENS,
    };
  }

  async function searchVod(query: string, streamer: string): Promise<SearchHit[]> {
    if (!hasKey.value || !settings.chatModel || !bulkChunks.value.length || !query.trim())
      return [];
    busy.value = 'searching';
    error.value = null;
    lastQuery.value = query;
    try {
      // Keep the prompt under the cap by dropping every other chunk if needed (rare: > ~9 h at 120 s chunks).
      let chunks = bulkChunks.value;
      while (estimateTokens(formatChunks(chunks)) > MAX_SEARCH_TOKENS && chunks.length > 10)
        chunks = chunks.filter((_, i) => i % 2 === 0);
      const r = await chat(client(), {
        model: settings.chatModel,
        messages: searchMessages(query, chunks, streamer),
        jsonSchema: { name: 'vod_search', schema: SEARCH_SCHEMA },
        maxTokens: 800,
      });
      recordSpend(
        r.costUsd ?? estimateChatUsd(chatModelInfo.value, r.promptTokens, r.completionTokens),
      );
      searchHits.value = parseSearch(r.content);
      addAiMoments(query, searchHits.value);
      return searchHits.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return [];
    } finally {
      busy.value = 'idle';
    }
  }

  function applySuggestedRange() {
    const x = explanation.value;
    if (!x) return;
    const newIn = x.inSec + x.suggestedInOffset;
    const newOut = x.inSec + x.suggestedOutOffset;
    if (newOut > newIn) {
      clipStore.inSec = Math.round(newIn * 10) / 10;
      clipStore.outSec = Math.round(newOut * 10) / 10;
    }
  }

  return {
    models,
    balanceUsd,
    busy,
    progress,
    error,
    transcript,
    explanation,
    spentUsd,
    hasKey,
    chatModelInfo,
    transcribeEstimate,
    explainEstimate,
    chatExcerptFor,
    refreshModels,
    transcribeRange,
    explainRange,
    applySuggestedRange,
    bulkChunks,
    bulk,
    loadBulk,
    bulkEstimate,
    transcribeBulk,
    cancelBulk,
    searchHits,
    aiMoments,
    clearAiMoments,
    lastQuery,
    searchEstimate,
    searchVod,
  };
});
