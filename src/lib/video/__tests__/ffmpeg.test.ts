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
vi.mock('@ffmpeg/util', () => ({ toBlobURL: async (u: string) => `blob:${u}` }));

import { isWasmCrash, recycleFfmpeg, runJob } from '../ffmpeg';

describe('ffmpeg instance lifecycle', () => {
  beforeEach(() => {
    recycleFfmpeg();
    made.length = 0;
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
