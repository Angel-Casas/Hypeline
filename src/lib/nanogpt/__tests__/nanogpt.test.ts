import { describe, expect, it } from 'vitest';
import { chat, extractCost, listModels, transcribe, checkBalance } from '../client';
import {
  estimateChatUsd,
  estimateTranscriptionUsd,
  formatUsd,
  pickDefaultChatModel,
} from '../pricing';
import {
  EXPLAIN_SCHEMA,
  explainMessages,
  formatChunks,
  parseExplain,
  parseSearch,
  searchMessages,
} from '../prompts';

const fake = (handler: (url: string, init?: RequestInit) => unknown) =>
  (async (url: string, init?: RequestInit) =>
    new Response(JSON.stringify(handler(url, init)), { status: 200 })) as unknown as typeof fetch;

describe('client', () => {
  it('lists models with pricing', async () => {
    const fetchImpl = fake((url) => {
      expect(url).toBe('https://nano-gpt.com/api/v1/models?detailed=true');
      return {
        data: [
          { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', pricing: { prompt: 0.25, completion: 2 } },
        ],
      };
    });
    const m = await listModels({ apiKey: 'k', fetchImpl });
    expect(m).toEqual([
      { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', promptPerM: 0.25, completionPerM: 2 },
    ]);
  });

  it('chat sends json_schema and reads content + usage', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = fake((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return {
        choices: [{ message: { content: '{"a":1}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        nanoGPT: { cost: 0.00012 },
      };
    });
    const r = await chat(
      { apiKey: 'k', fetchImpl },
      {
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        jsonSchema: { name: 'x', schema: { type: 'object' } },
      },
    );
    expect(r.content).toBe('{"a":1}');
    expect(r.promptTokens).toBe(10);
    expect(r.costUsd).toBeCloseTo(0.00012);
    expect((sent.response_format as { type: string }).type).toBe('json_schema');
    expect(sent.model).toBe('m');
  });

  it('transcribe posts multipart and reads text', async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://nano-gpt.com/api/v1/audio/transcriptions');
      const fd = init?.body as FormData;
      expect(fd.get('model')).toBe('Whisper-Large-V3');
      expect((fd.get('file') as File).name).toBe('a.wav');
      return new Response(JSON.stringify({ text: 'hello chat', language: 'en', duration: 12.3 }));
    }) as unknown as typeof fetch;
    const r = await transcribe(
      { apiKey: 'k', fetchImpl },
      { file: new Blob([new Uint8Array(10)]), filename: 'a.wav', model: 'Whisper-Large-V3' },
    );
    expect(r.text).toBe('hello chat');
    expect(r.durationSec).toBe(12.3);
  });

  it('balance only for NanoGPT base', async () => {
    const fetchImpl = fake(() => ({ usd_balance: '12.5' }));
    expect(await checkBalance({ apiKey: 'k', fetchImpl })).toBe(12.5);
    expect(
      await checkBalance({ apiKey: 'k', fetchImpl, baseUrl: 'https://api.openai.com' }),
    ).toBeNull();
  });

  it('rejects missing key and auth failures', async () => {
    await expect(
      chat({ apiKey: '', fetchImpl: fake(() => ({})) }, { model: 'm', messages: [] }),
    ).rejects.toMatchObject({ kind: 'no-key' });
    const f401 = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(
      chat({ apiKey: 'k', fetchImpl: f401 }, { model: 'm', messages: [] }),
    ).rejects.toMatchObject({ kind: 'auth' });
  });

  it('extractCost looks in the usual places', () => {
    expect(extractCost({ nanoGPT: { cost: 0.5 } })).toBe(0.5);
    expect(extractCost({ usage: { cost: '0.25' } })).toBe(0.25);
    expect(extractCost({ usage: { prompt_tokens: 1 } })).toBeUndefined();
  });
});

describe('pricing', () => {
  it('estimates', () => {
    expect(estimateTranscriptionUsd('Whisper-Large-V3', 60)).toBeCloseTo(0.0005);
    expect(estimateTranscriptionUsd('unknown', 60)).toBeCloseTo(0.01);
    expect(
      estimateChatUsd(
        { id: 'm', name: 'm', promptPerM: 1, completionPerM: 10 },
        1_000_000,
        100_000,
      ),
    ).toBeCloseTo(2);
    expect(formatUsd(0.0004)).toBe('<$0.001');
    expect(formatUsd(0.0042)).toBe('$0.0042');
  });
  it('picks a cheap default model', () => {
    const models = [
      { id: 'openai/gpt-5.1', name: 'GPT-5.1' },
      { id: 'openai/gpt-5-mini', name: 'GPT-5 mini' },
    ];
    expect(pickDefaultChatModel(models)).toBe('openai/gpt-5-mini');
    expect(pickDefaultChatModel([])).toBeNull();
  });
});

describe('prompts', () => {
  it('builds messages and parses output defensively', () => {
    const msgs = explainMessages({
      streamer: 's',
      game: null,
      windowStart: 100,
      windowEnd: 145,
      transcript: 't',
      chatExcerpt: '00:05 LOL',
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.content).toContain('Window: 45 s');
    expect(EXPLAIN_SCHEMA.required).toContain('title');
    const out = parseExplain(
      '{"title":"T","hook":"H","why":"W","suggestedInOffset":-3,"suggestedOutOffset":20,"clipWorthiness":9}',
    );
    expect(out).toEqual({
      title: 'T',
      hook: 'H',
      why: 'W',
      suggestedInOffset: 0,
      suggestedOutOffset: 20,
      clipWorthiness: 5,
    });
  });
});

describe('search prompts', () => {
  it('labels chunks with time and seconds', () => {
    const txt = formatChunks([{ startSec: 3665, endSec: 3785, text: ' hello ' }]);
    expect(txt).toBe('[1:01:05–1:03:05 | 3665s] hello');
    const msgs = searchMessages('rage moments', [{ startSec: 0, endSec: 120, text: 'x' }], 's');
    expect(msgs[1]!.content).toContain('Request: rage moments');
  });
  it('parses and sorts hits defensively', () => {
    const hits = parseSearch(
      '{"hits":[{"t":100,"endT":90,"quote":"q","why":"w","confidence":2},{"t":50,"endT":80,"quote":"z","why":"w","confidence":9}]}',
    );
    expect(hits[0]).toEqual({ t: 50, endT: 80, quote: 'z', why: 'w', confidence: 5 });
    expect(hits[1]!.endT).toBe(105); // endT below t is fixed to t+5
    expect(parseSearch('{}')).toEqual([]);
  });
});
