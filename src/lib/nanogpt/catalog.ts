/**
 * The model catalog, arranged for a human (ADR-40, Angel 2026-09-18).
 *
 * NanoGPT serves ~600 models in one flat list. `/v1/models?detailed=true` gives us an id, a
 * name, a price and (usually) a creation date — no provider field — so the family a model
 * belongs to is read off its id, which is where NanoGPT puts it (`anthropic/claude-opus-5`,
 * `qwen/qwen3.8-max`, `deepseek-ai/DeepSeek-R1`). Everything here is pure so the picker's
 * behaviour can be tested without a fixture of the whole catalogue.
 *
 * The glyphs are plain geometry, not brand marks, and they are drawn in ink: nine real brand
 * colours would import a palette that fights the hype thread (Angel chose this, 2026-09-18).
 * They exist so a group is recognisable at a glance in a list this long, not to identify a
 * company.
 */
import type { ModelInfo } from './client';

export interface Provider {
  key: string;
  /** Not translated: these are company names. */
  label: string;
  glyph: string;
}

/**
 * Matched in order, first hit wins, against the id and then the name. `Other` is the bucket
 * for everything else — a third of the catalogue, and growing every week.
 */
const RULES: (Provider & { re: RegExp })[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    glyph: '◐',
    re: /^(openai\/|gpt-|o[134]-|nano-gpt|nanogpt\/|fastgpt)/i,
  },
  { key: 'anthropic', label: 'Anthropic', glyph: '◈', re: /^anthropic\/|claude/i },
  { key: 'google', label: 'Google', glyph: '◆', re: /^(google\/|gemini|gemma)/i },
  { key: 'deepseek', label: 'DeepSeek', glyph: '◇', re: /deepseek/i },
  { key: 'alibaba', label: 'Alibaba', glyph: '◉', re: /^(qwen|qwq|qvq)/i },
  { key: 'meta', label: 'Meta', glyph: '◎', re: /^(meta|meta-llama\/|llama)/i },
  {
    key: 'mistral',
    label: 'Mistral',
    glyph: '▲',
    re: /^(mistral|ministral|codestral|devstral|mixtral)/i,
  },
  { key: 'xai', label: 'xAI', glyph: '✕', re: /^(x-ai\/|grok)/i },
  { key: 'moonshot', label: 'Moonshot', glyph: '☾', re: /^(moonshotai\/|kimi)/i },
  { key: 'zai', label: 'Z.ai', glyph: '◭', re: /^(z-ai\/|glm-|glm\d|thudm\/)/i },
  { key: 'minimax', label: 'MiniMax', glyph: '◮', re: /^minimax/i },
  { key: 'bytedance', label: 'ByteDance', glyph: '◧', re: /^(bytedance|doubao|seed-)/i },
  { key: 'nvidia', label: 'Nvidia', glyph: '◫', re: /^(nvidia\/|nemotron)/i },
];
export const OTHER: Provider = { key: 'other', label: 'Other', glyph: '●' };

const cache = new Map<string, Provider>();

export function providerOf(m: Pick<ModelInfo, 'id' | 'name'>): Provider {
  const hit = cache.get(m.id);
  if (hit) return hit;
  const tail = m.id.includes('/') ? m.id.slice(m.id.indexOf('/') + 1) : '';
  const found =
    RULES.find((r) => r.re.test(m.id) || (tail && r.re.test(tail)) || r.re.test(m.name)) ?? OTHER;
  const p: Provider = { key: found.key, label: found.label, glyph: found.glyph };
  cache.set(m.id, p);
  return p;
}

export type SortKey = 'provider' | 'name' | 'cheap' | 'pricey' | 'new' | 'old';

/** What a model costs to run, for sorting: input plus output, so `$0.05/$0.40` beats `$1/$1`. */
function cost(m: ModelInfo): number {
  return (m.promptPerM ?? 0) + (m.completionPerM ?? 0);
}

/**
 * Free-text match. Every word has to appear somewhere in the name, the id or the provider,
 * so "claude opus" finds Claude Opus 5 and "openai mini" finds the small GPTs.
 */
export function matches(m: ModelInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${m.name} ${m.id} ${providerOf(m).label}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export interface Group {
  provider: Provider;
  models: ModelInfo[];
}

/**
 * The list the picker draws: filtered, sorted, and — when sorting by provider — grouped.
 * Every other sort returns one unnamed group, because a price order broken up by company is
 * not a price order.
 */
export function arrange(
  all: ModelInfo[],
  opts: { query?: string; sort?: SortKey; providers?: Set<string> | null },
): Group[] {
  const sort = opts.sort ?? 'provider';
  const kept = all.filter(
    (m) =>
      matches(m, opts.query ?? '') &&
      (!opts.providers || opts.providers.size === 0 || opts.providers.has(providerOf(m).key)),
  );
  if (sort !== 'provider') {
    const by: Record<string, (a: ModelInfo, b: ModelInfo) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      cheap: (a, b) => cost(a) - cost(b),
      pricey: (a, b) => cost(b) - cost(a),
      new: (a, b) => (b.created ?? 0) - (a.created ?? 0),
      old: (a, b) => (a.created ?? 0) - (b.created ?? 0),
    };
    return [{ provider: OTHER, models: [...kept].sort(by[sort]!) }];
  }
  const by = new Map<string, Group>();
  for (const m of kept) {
    const p = providerOf(m);
    let g = by.get(p.key);
    if (!g) by.set(p.key, (g = { provider: p, models: [] }));
    g.models.push(m);
  }
  // biggest family first, but `Other` last however big it is — it is a bucket, not a company
  return [...by.values()].sort((a, b) => {
    if (a.provider.key === OTHER.key) return 1;
    if (b.provider.key === OTHER.key) return -1;
    return b.models.length - a.models.length;
  });
}

/** Every provider present in the catalogue, with its size — the filter list. */
export function providerCounts(all: ModelInfo[]): { provider: Provider; count: number }[] {
  const by = new Map<string, { provider: Provider; count: number }>();
  for (const m of all) {
    const p = providerOf(m);
    const e = by.get(p.key);
    if (e) e.count++;
    else by.set(p.key, { provider: p, count: 1 });
  }
  return [...by.values()].sort((a, b) => {
    if (a.provider.key === OTHER.key) return 1;
    if (b.provider.key === OTHER.key) return -1;
    return b.count - a.count;
  });
}

/**
 * A price, short enough to sit at the end of a row: whole dollars once it is a dollar or more,
 * cents below that: `$1/$10`, `$0.35/$1.4`, `$0/$0` for the models NanoGPT serves free.
 */
export function shortUsd(v: number | undefined): string | null {
  if (v == null) return null;
  if (v === 0) return '0';
  if (v >= 1) return String(Math.round(v));
  return v.toFixed(2).replace(/0$/, '');
}

/** "Jun 2026" in the user's language, or null when the catalogue gave us no date. */
export function monthOf(m: ModelInfo, locale: string): string | null {
  if (!m.created) return null;
  const d = new Date(m.created * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(d);
}
