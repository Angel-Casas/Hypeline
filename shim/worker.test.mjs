/**
 * The relay's gates (2026-09-17). Node forbids setting `Origin` on a real Request, and these
 * cases should not touch Twitch, so each test hands the Worker a minimal request object and a
 * stubbed upstream. What matters here: the live app and a developer get through, other sites
 * and other hosts do not, and the health route answers without an Origin at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import worker from './worker.js';

const ENV = { ALLOWED_ORIGINS: 'https://hypeline.live', ALLOW_LOCAL: 'true', RATE_LIMIT_RPM: '0' };
const req = (url, origin, method = 'GET', ip = '1.2.3.4') => ({
  method,
  url,
  headers: new Headers({ ...(origin ? { Origin: origin } : {}), 'cf-connecting-ip': ip }),
});
const relay = (target) => 'https://relay.example/?u=' + encodeURIComponent(target);
const VOD = relay('https://usher.ttvnw.net/vod/123.m3u8');
const call = (r, env = ENV) => worker.fetch(r, env);

let realFetch;
beforeAll(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('upstream-body', {
      status: 200,
      headers: { 'content-type': 'video/mp2t', 'content-length': '13' },
    });
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('the video relay', () => {
  it('answers a plain visit, with no Origin, so a human can check it is up', async () => {
    for (const path of ['https://relay.example/', 'https://relay.example/health']) {
      const res = await call(req(path));
      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/relay/i);
    }
  });

  it('passes the live app, localhost and a phone on the wifi', async () => {
    for (const origin of [
      'https://hypeline.live',
      'http://localhost:5173',
      'http://localhost:4173',
      'http://172.16.150.67:5173',
      'http://192.168.1.20:5173',
    ])
      expect((await call(req(VOD, origin))).status).toBe(200);
  });

  it('turns away another site, and a caller with no Origin', async () => {
    expect((await call(req(VOD, 'https://evil.example'))).status).toBe(403);
    expect((await call(req(VOD, null))).status).toBe(403);
    // ALLOW_LOCAL is what lets a developer in; without it the allowlist is the whole story
    const strict = { ...ENV, ALLOW_LOCAL: 'false' };
    expect((await call(req(VOD, 'http://172.16.150.67:5173'), strict)).status).toBe(403);
    expect((await call(req(VOD, 'https://hypeline.live'), strict)).status).toBe(200);
  });

  it('forwards only https Twitch hosts, and only GET/HEAD', async () => {
    const from = (t) => call(req(relay(t), 'https://hypeline.live'));
    expect((await from('https://example.com/x')).status).toBe(403);
    expect((await from('http://usher.ttvnw.net/x')).status).toBe(403);
    expect((await from('https://vod-secure.twitch.tv/x.ts')).status).toBe(200);
    expect((await from('https://d2nvs31859zcd8.cloudfront.net/x.ts')).status).toBe(200);
    expect((await call(req(VOD, 'https://hypeline.live', 'POST'))).status).toBe(405);
    expect((await call(req(VOD, 'https://hypeline.live', 'OPTIONS'))).status).toBe(204);
  });

  it('rate limits one IP without touching another', async () => {
    const env = { ...ENV, RATE_LIMIT_RPM: '3' };
    const status = [];
    for (let i = 0; i < 4; i++)
      status.push((await call(req(VOD, 'https://hypeline.live', 'GET', '9.9.9.9'), env)).status);
    expect(status).toEqual([200, 200, 200, 429]);
    expect((await call(req(VOD, 'https://hypeline.live', 'GET', '8.8.8.8'), env)).status).toBe(200);
  });
});
