/**
 * Cost estimation shown BEFORE every AI call (docs/04-conventions.md).
 * Transcription prices from NanoGPT's table (2026-09-12); chat prices come
 * from /v1/models?detailed=true at runtime, with a conservative fallback.
 */
import type { ModelInfo } from './client';

/** USD per minute of audio. */
export const STT_PRICE_PER_MIN: Record<string, number> = {
  'Whisper-Large-V3': 0.0005,
  'gpt-4o-mini-transcribe': 0.003,
  Wizper: 0.01,
};
export const DEFAULT_STT_MODEL = 'Whisper-Large-V3';

/** Rough token count: ~4 chars per token for English chat text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateTranscriptionUsd(model: string, seconds: number): number {
  const perMin = STT_PRICE_PER_MIN[model] ?? 0.01;
  return (seconds / 60) * perMin;
}

export function estimateChatUsd(
  model: ModelInfo | undefined,
  promptTokens: number,
  expectedCompletionTokens: number,
): number {
  const p = model?.promptPerM ?? 5; // fallback: assume a mid-priced model
  const c = model?.completionPerM ?? 15;
  return (promptTokens / 1e6) * p + (expectedCompletionTokens / 1e6) * c;
}

export function formatUsd(v: number): string {
  if (v < 0.001) return `<$0.001`;
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(3)}`;
}

/** Pick a sensible default chat model from the catalog: cheap, well-known. */
export function pickDefaultChatModel(models: ModelInfo[]): string | null {
  const prefs = [
    /gpt-5.*mini/i,
    /gpt-4o-mini/i,
    /gpt-4\.1-mini/i,
    /claude.*haiku/i,
    /gemini.*flash/i,
    /gpt-5(?!.*pro)/i,
    /llama/i,
  ];
  for (const re of prefs) {
    const m = models.find((x) => re.test(x.id) || re.test(x.name));
    if (m) return m.id;
  }
  return models[0]?.id ?? null;
}
