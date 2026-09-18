/**
 * NanoGPT client (OpenAI-compatible). Base URL is configurable so other
 * providers work (ADR-6); NanoGPT-specific endpoints (balance) are used only
 * when the base URL is NanoGPT's.
 *
 * Verified against docs.nano-gpt.com on 2026-09-13:
 *   POST {base}/v1/chat/completions       (OpenAI shape; response_format json_schema ok)
 *   POST {base}/v1/audio/transcriptions   (multipart: file, model[, language]) → { text, language, duration }
 *   GET  {base}/v1/models?detailed=true   → { data: [{ id, name, pricing: { prompt, completion } per M tokens }] }
 *   POST {base}/check-balance             (NanoGPT only) → { usd_balance: "12.34", ... }
 */

import { t } from '@/i18n';

export const NANOGPT_BASE = 'https://nano-gpt.com/api';
/**
 * Angel's NanoGPT referral link (2026-09-17). It gives the person 5 % off their usage and
 * pays Hypeline 10 % at no extra cost to them — the app's only revenue (docs/00-vision.md).
 * Always shown as a discount, never as a tracker, and the app works with any NanoGPT key.
 */
export const REFERRAL_URL = 'https://nano-gpt.com/r/BnfJfghE';
/** Where a key is created (verified 2026-09-18): the "API Keys" section, up to 20 per account. */
export const API_KEYS_URL = 'https://nano-gpt.com/api';

export class NanoGptError extends Error {
  constructor(
    public kind: 'no-key' | 'network' | 'http' | 'auth' | 'parse',
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'NanoGptError';
  }
}

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per million tokens. */
  promptPerM?: number;
  completionPerM?: number;
  /** Unix seconds, OpenAI-style. Absent for a good part of the catalogue. */
  created?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  /** Exact cost when the provider reports it; otherwise undefined (caller estimates). */
  costUsd?: number;
  raw: unknown;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSec?: number;
  costUsd?: number;
  raw: unknown;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function headers(key: string, json = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${key}`, 'x-api-key': key };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function call(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new NanoGptError('network', t('nanogpt.couldNotReach'), e);
  }
  if (res.status === 401 || res.status === 403)
    throw new NanoGptError('auth', t('nanogpt.keyRejected'));
  if (!res.ok)
    throw new NanoGptError(
      'http',
      t('nanogpt.httpError', { status: res.status, body: (await res.text()).slice(0, 200) }),
    );
  return res;
}

/** Cost field is not standardised; look in the usual places. */
export function extractCost(raw: unknown): number | undefined {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return undefined;
  const candidates = [
    (r.nanoGPT as Record<string, unknown> | undefined)?.cost,
    (r.nanogpt as Record<string, unknown> | undefined)?.cost,
    r.cost,
    (r.usage as Record<string, unknown> | undefined)?.cost,
    (r.usage as Record<string, unknown> | undefined)?.total_cost,
  ];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return undefined;
}

export function isNanoGpt(baseUrl: string): boolean {
  return /nano-gpt\.com/.test(baseUrl);
}

export async function listModels(o: ClientOptions): Promise<ModelInfo[]> {
  const base = (o.baseUrl ?? NANOGPT_BASE).replace(/\/$/, '');
  const res = await call(
    `${base}/v1/models?detailed=true`,
    { headers: headers(o.apiKey, false) },
    o.fetchImpl ?? fetch,
  );
  const json = (await res.json()) as {
    data?: {
      id: string;
      name?: string;
      created?: number;
      pricing?: { prompt?: number; completion?: number };
    }[];
  };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    promptPerM: m.pricing?.prompt,
    completionPerM: m.pricing?.completion,
    created: typeof m.created === 'number' ? m.created : undefined,
  }));
}

export async function checkBalance(o: ClientOptions): Promise<number | null> {
  const base = (o.baseUrl ?? NANOGPT_BASE).replace(/\/$/, '');
  if (!isNanoGpt(base)) return null;
  const res = await call(
    `${base}/check-balance`,
    { method: 'POST', headers: headers(o.apiKey) },
    o.fetchImpl ?? fetch,
  );
  const json = (await res.json()) as { usd_balance?: string | number };
  const n = Number(json.usd_balance);
  return Number.isFinite(n) ? n : null;
}

export async function chat(
  o: ClientOptions,
  req: {
    model: string;
    messages: ChatMessage[];
    jsonSchema?: { name: string; schema: unknown };
    maxTokens?: number;
    signal?: AbortSignal;
  },
): Promise<ChatResult> {
  if (!o.apiKey) throw new NanoGptError('no-key', t('nanogpt.noKey'));
  const base = (o.baseUrl ?? NANOGPT_BASE).replace(/\/$/, '');
  const body: Record<string, unknown> = { model: req.model, messages: req.messages, stream: false };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.jsonSchema)
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true },
    };
  const res = await call(
    `${base}/v1/chat/completions`,
    { method: 'POST', headers: headers(o.apiKey), body: JSON.stringify(body), signal: req.signal },
    o.fetchImpl ?? fetch,
  );
  const raw = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = raw.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new NanoGptError('parse', t('nanogpt.noContent'), raw);
  return {
    content,
    promptTokens: raw.usage?.prompt_tokens ?? 0,
    completionTokens: raw.usage?.completion_tokens ?? 0,
    costUsd: extractCost(raw),
    raw,
  };
}

export async function transcribe(
  o: ClientOptions,
  req: { file: Blob; filename: string; model: string; language?: string; signal?: AbortSignal },
): Promise<TranscriptionResult> {
  if (!o.apiKey) throw new NanoGptError('no-key', t('nanogpt.noKey'));
  const base = (o.baseUrl ?? NANOGPT_BASE).replace(/\/$/, '');
  const form = new FormData();
  form.append('file', req.file, req.filename);
  form.append('model', req.model);
  if (req.language) form.append('language', req.language);
  const res = await call(
    `${base}/v1/audio/transcriptions`,
    { method: 'POST', headers: headers(o.apiKey, false), body: form, signal: req.signal },
    o.fetchImpl ?? fetch,
  );
  const raw = (await res.json()) as { text?: string; language?: string; duration?: number };
  if (typeof raw.text !== 'string') throw new NanoGptError('parse', t('nanogpt.noText'), raw);
  return {
    text: raw.text,
    language: raw.language,
    durationSec: raw.duration,
    costUsd: extractCost(raw),
    raw,
  };
}
