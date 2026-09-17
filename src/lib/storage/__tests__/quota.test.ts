import { describe, expect, it } from 'vitest';
import {
  estimateClipBytes,
  formatBytes,
  HEADROOM_BYTES,
  isQuotaError,
  quotaLevel,
  wouldExceed,
} from '../quota';

const GB = 1073741824;

describe('quotaLevel', () => {
  it('is ok when unknown or roomy', () => {
    expect(quotaLevel({ usage: 0, quota: 0, unknown: true })).toBe('ok');
    expect(quotaLevel({ usage: 1 * GB, quota: 10 * GB, unknown: false })).toBe('ok');
  });
  it('warns at 70% or under 300 MB free', () => {
    expect(quotaLevel({ usage: 7.5 * GB, quota: 10 * GB, unknown: false })).toBe('warn');
    expect(quotaLevel({ usage: 1.8 * GB, quota: 2 * GB, unknown: false })).toBe('critical'); // 90%
    expect(quotaLevel({ usage: 0.5 * GB, quota: 0.75 * GB, unknown: false })).toBe('warn'); // 256 MB free, 67%
  });
  it('is critical at 90% or under 100 MB free', () => {
    expect(quotaLevel({ usage: 9.1 * GB, quota: 10 * GB, unknown: false })).toBe('critical');
    expect(quotaLevel({ usage: 0.45 * GB, quota: 0.5 * GB, unknown: false })).toBe('critical');
  });
});

describe('wouldExceed / estimateClipBytes', () => {
  it('estimates from bitrate', () => {
    expect(estimateClipBytes(3_000_000, 60)).toBe(22_500_000);
  });
  it('flags writes that do not fit', () => {
    const q = { usage: 9.7 * GB, quota: 10 * GB, unknown: false };
    expect(HEADROOM_BYTES).toBe(100 * 1048576);
    expect(wouldExceed(q, 50 * 1048576)).toBe(false); // 300 MB free − 50 leaves 250 > 100
    expect(wouldExceed(q, 250 * 1048576)).toBe(true); // would leave 50 < 100
    expect(wouldExceed({ usage: 0, quota: 0, unknown: true }, 1e12)).toBe(false);
  });
});

describe('helpers', () => {
  it('formats bytes and recognises quota errors', () => {
    expect(formatBytes(1.5 * GB)).toBe('1.5 GB');
    expect(formatBytes(20 * 1048576)).toBe('20 MB');
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(new Error('nope'))).toBe(false);
  });
});
