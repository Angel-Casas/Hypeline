import { beforeEach, describe, expect, it, vi } from 'vitest';

const { made } = vi.hoisted(() => ({
  made: [] as { loaded: boolean; terminated: boolean }[],
}));
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    loaded = false;
    terminated = false;
    constructor() {
      made.push(this);
    }
    async load() {
      this.loaded = true;
    }
    terminate() {
      this.terminated = true;
    }
  },
}));

/** A response that streams `bytes` while declaring whatever `headers` say. */
function streamed(bytes: Uint8Array, headers: Record<string, string>): Response {
  let sent = false;
  return {
    ok: true,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes }),
      }),
    },
    arrayBuffer: async () => {
      throw new TypeError("Failed to execute 'arrayBuffer' on 'Response': body stream already read");
    },
  } as unknown as Response;
}

const fetched: string[] = [];
beforeEach(() => {
  fetched.length = 0;
  // production serves the wasm gzipped: Content-Length is the compressed size, so it is
  // smaller than what the stream yields (ADR-25)
  vi.stubGlobal('fetch', async (u: string) => {
    fetched.push(String(u));
    return String(u).endsWith('.wasm')
      ? streamed(new Uint8Array(3000), { 'content-length': '1000', 'content-encoding': 'gzip' })
      : streamed(new Uint8Array(10), { 'content-length': '10' });
  });
  vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => `blob:${b.size}` });
});

import { isWasmCrash, recycleFfmpeg, runJob } from '../ffmpeg';

describe('ffmpeg instance lifecycle', () => {
  beforeEach(() => {
    recycleFfmpeg();
    made.length = 0;
  });

  it('loads the gzipped core without re-reading the response body', async () => {
    const seen: (number | undefined)[] = [];
    await runJob(
      async () => 'ok',
      (p) => seen.push(p.ratio),
    );
    expect(fetched.filter((u) => u.endsWith('.wasm'))).toHaveLength(1);
    // Content-Length lies about an encoded body, so progress runs against the known
    // decoded size and never exceeds 1
    expect(seen.every((r) => r == null || (r >= 0 && r <= 1))).toBe(true);
  });

  it('recognises wasm crashes but not input errors', () => {
    expect(isWasmCrash(new RangeError('memory access out of bounds'))).toBe(true);
    expect(isWasmCrash(new Error('RuntimeError: unreachable'))).toBe(true);
    expect(isWasmCrash(new Error('ffmpeg exited with code 1'))).toBe(false);
    expect(isWasmCrash(new Error('No segments for that range'))).toBe(false);
  });

  it('reloads a fresh instance after a crash and retries the job once', async () => {
    let calls = 0;
    const out = await runJob(async () => {
      calls++;
      if (calls === 1) throw new RangeError('memory access out of bounds');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(calls).toBe(2);
    expect(made).toHaveLength(2);
    expect(made[0]!.terminated).toBe(true);
    expect(made[1]!.loaded).toBe(true);
  });

  it('does not retry ordinary failures', async () => {
    await expect(
      runJob(async () => {
        throw new Error('ffmpeg exited with code 1');
      }),
    ).rejects.toThrow(/code 1/);
    expect(made).toHaveLength(1);
  });

  it('recycles the instance every 20 jobs', async () => {
    for (let i = 0; i < 41; i++) await runJob(async () => i);
    // 1 initial + recycles at jobs 21 and 41
    expect(made).toHaveLength(3);
  });
});
