import { describe, expect, it } from 'vitest';
import { contextBlock, REPO_URL, supportUrl, type SupportContext } from '../support';

const ctx: SupportContext = {
  version: '0.1.0',
  userAgent: 'Mozilla/5.0 (test)',
  locale: 'es',
  theme: 'night',
  where: 'dashboard · VOD 2871164819',
  relay: true,
  aiKey: false,
};

describe('support links', () => {
  it('opens the matching issue template with its label and title', () => {
    const u = new URL(supportUrl('feature'));
    expect(u.origin + u.pathname).toBe(`${REPO_URL}/issues/new`);
    expect(u.searchParams.get('template')).toBe('feature_request.yml');
    expect(u.searchParams.get('labels')).toBe('enhancement');
    expect(u.searchParams.get('title')).toBe('[Feature] ');
    expect(new URL(supportUrl('question')).searchParams.get('template')).toBe('question.yml');
    expect(new URL(supportUrl('feature', ctx)).searchParams.has('context')).toBe(false);
  });
  it('prefills a bug report with the non-personal context block', () => {
    const c = new URL(supportUrl('bug', ctx)).searchParams.get('context')!;
    expect(c).toContain('Hypeline 0.1.0 · dashboard · VOD 2871164819');
    expect(c).toContain('language es · night · video relay set · NanoGPT key not set');
    expect(c).not.toMatch(/https?:\/\//); // never the relay URL or a key
    expect(contextBlock(ctx).startsWith('\n---')).toBe(true);
  });
});
