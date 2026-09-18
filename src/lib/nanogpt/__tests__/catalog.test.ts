import { describe, it, expect } from 'vitest';
import { arrange, matches, monthOf, providerCounts, providerOf, shortUsd } from '../catalog';
import type { ModelInfo } from '../client';

const m = (id: string, name: string, p?: number, c?: number, created?: number): ModelInfo => ({
  id,
  name,
  promptPerM: p,
  completionPerM: c,
  created,
});

/** A slice of the real catalogue, ids copied verbatim from /v1/models. */
const CATALOG: ModelInfo[] = [
  m('openai/gpt-5.1', 'GPT 5.1', 1.25, 10, 1_763_000_000),
  m('openai/gpt-5-nano', 'GPT 5 Nano', 0.05, 0.4),
  m('anthropic/claude-opus-5', 'Claude Opus 5', 5, 25, 1_753_000_000),
  m('anthropic/claude-haiku-4.5:thinking', 'Claude Haiku 4.5 Thinking', 1, 5),
  m('google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro (Preview)', 2, 12),
  m('deepseek-ai/DeepSeek-R1-0528', 'DeepSeek R1 0528', 0.4, 1.7),
  m('qwen/qwen3.8-max', 'Qwen3.8 Max', 2, 6),
  m('meta-llama/llama-4-scout', 'Llama 4 Scout', 0.085, 0.46),
  m('mistralai/codestral-2508', 'Codestral 2508', 0.3, 0.9),
  m('x-ai/grok-4.6', 'Grok 4.6', 2, 6),
  m('moonshotai/kimi-k3', 'Kimi K3', 2, 10),
  m('z-ai/glm-5.3', 'GLM 5.3', 1, 3.2),
  m('unbiased/pareto', 'Pareto', 2.5, 7.5),
  m('celeris-1', 'Celeris 1', 2, 6),
];

describe('providerOf', () => {
  it('reads the family off the id', () => {
    expect(providerOf(CATALOG[0]!).label).toBe('OpenAI');
    expect(providerOf(CATALOG[2]!).label).toBe('Anthropic');
    expect(providerOf(CATALOG[4]!).label).toBe('Google');
    expect(providerOf(CATALOG[5]!).label).toBe('DeepSeek');
    expect(providerOf(CATALOG[6]!).label).toBe('Alibaba');
    expect(providerOf(CATALOG[7]!).label).toBe('Meta');
    expect(providerOf(CATALOG[8]!).label).toBe('Mistral');
    expect(providerOf(CATALOG[9]!).label).toBe('xAI');
    expect(providerOf(CATALOG[10]!).label).toBe('Moonshot');
    expect(providerOf(CATALOG[11]!).label).toBe('Z.ai');
  });
  it('falls back to Other for a house model with no family in its id', () => {
    expect(providerOf(CATALOG[12]!).key).toBe('other');
    expect(providerOf(CATALOG[13]!).key).toBe('other');
  });
  it('matches a bare name too: TEE/ and huihui-ai/ rehost other families', () => {
    expect(providerOf(m('TEE/deepseek-v3.2', 'DeepSeek V3.2 TEE')).label).toBe('DeepSeek');
    expect(
      providerOf(m('huihui-ai/Qwen2.5-32B-Instruct-abliterated', 'Qwen 2.5 32B Abliterated')).label,
    ).toBe('Alibaba');
  });
});

describe('matches', () => {
  it('needs every word, anywhere in the name, the id or the maker', () => {
    expect(matches(CATALOG[2]!, 'claude opus')).toBe(true);
    expect(matches(CATALOG[2]!, 'anthropic 5')).toBe(true);
    expect(matches(CATALOG[2]!, 'claude sonnet')).toBe(false);
  });
  it('is case- and space-insensitive, and an empty query keeps everything', () => {
    expect(matches(CATALOG[0]!, '  GPT   5.1 ')).toBe(true);
    expect(matches(CATALOG[0]!, '')).toBe(true);
  });
});

describe('arrange', () => {
  it('groups by family, biggest first, with Other last however big', () => {
    const g = arrange([...CATALOG, m('house-2', 'House 2'), m('house-3', 'House 3')], {});
    expect(g[0]!.provider.label).toBe('OpenAI'); // two models
    expect(g.at(-1)!.provider.key).toBe('other'); // four, still last
    expect(g.at(-1)!.models).toHaveLength(4);
  });
  it('drops the groups for any other sort: a price order split by company is not one', () => {
    const g = arrange(CATALOG, { sort: 'cheap' });
    expect(g).toHaveLength(1);
    expect(g[0]!.models[0]!.name).toBe('GPT 5 Nano');
    expect(g[0]!.models.at(-1)!.name).toBe('Claude Opus 5');
  });
  it('sorts by age, with undated models at the far end', () => {
    const newest = arrange(CATALOG, { sort: 'new' })[0]!.models;
    expect(newest[0]!.name).toBe('GPT 5.1');
    const oldest = arrange(CATALOG, { sort: 'old' })[0]!.models;
    expect(oldest.at(-1)!.name).toBe('GPT 5.1');
  });
  it('filters by provider, and an empty filter set means every provider', () => {
    const only = arrange(CATALOG, { providers: new Set(['anthropic', 'xai']) });
    expect(only.flatMap((g) => g.models).map((x) => x.name)).toEqual([
      'Claude Opus 5',
      'Claude Haiku 4.5 Thinking',
      'Grok 4.6',
    ]);
    expect(arrange(CATALOG, { providers: new Set() }).flatMap((g) => g.models)).toHaveLength(
      CATALOG.length,
    );
  });
  it('searches and filters together', () => {
    const g = arrange(CATALOG, { query: 'claude', providers: new Set(['anthropic']) });
    expect(g.flatMap((x) => x.models)).toHaveLength(2);
    expect(arrange(CATALOG, { query: 'nothing here' }).flatMap((x) => x.models)).toEqual([]);
  });
});

describe('providerCounts', () => {
  it('counts every family present, Other last', () => {
    const c = providerCounts(CATALOG);
    expect(c[0]).toEqual({ provider: providerOf(CATALOG[0]!), count: 2 });
    expect(c.at(-1)!.provider.key).toBe('other');
    expect(c.reduce((s, x) => s + x.count, 0)).toBe(CATALOG.length);
  });
});

describe('shortUsd', () => {
  it('rounds dollars and keeps cents', () => {
    expect(shortUsd(10)).toBe('10');
    expect(shortUsd(1.25)).toBe('1');
    expect(shortUsd(0.35)).toBe('0.35');
    expect(shortUsd(0.4)).toBe('0.4');
    expect(shortUsd(0)).toBe('0');
    expect(shortUsd(undefined)).toBe(null);
  });
});

describe('monthOf', () => {
  it('formats in the given language, and says nothing when there is no date', () => {
    expect(monthOf(m('a', 'A', 1, 1, 1_763_000_000), 'en')).toMatch(/2025/);
    expect(monthOf(m('a2', 'A', 1, 1), 'en')).toBe(null);
  });
});
