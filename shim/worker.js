/**
 * Hypeline CORS shim — Cloudflare Worker (ADR-9).
 *
 * Stateless. Forwards GET/HEAD requests to an allowlist of Twitch video hosts
 * and adds CORS headers so the browser app can read playlists and segments.
 * No logging of URLs, no storage. Self-host it: `wrangler deploy`, then paste
 * the Worker URL into Hypeline → Settings.
 *
 *   GET https://<worker>/?u=<encoded twitch url>
 *
 * Config (wrangler.toml [vars]):
 *   ALLOWED_ORIGINS  comma-separated page origins allowed to call the shim
 *                    ("*" = anyone; lock it to your app origin in production)
 *   RATE_LIMIT_RPM   requests per minute per client IP (0 = off). Uses the
 *                    Workers Rate Limiting binding when configured (see toml),
 *                    otherwise a best-effort in-isolate counter.
 */

const ALLOWED_HOSTS = [
  /^usher\.ttvnw\.net$/,
  /^[a-z0-9-]+\.cloudfront\.net$/,
  /^[a-z0-9.-]+\.ttvnw\.net$/,
  /^[a-z0-9.-]+\.twitch\.tv$/,
];
const PASS_RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'cf-cache-status'];
const MAX_UPSTREAM_BYTES = 64 * 1024 * 1024; // a single segment is ~3–10 MB; refuse anything absurd

// Best-effort fallback limiter (per isolate, resets when the isolate recycles).
const buckets = new Map();
function softLimit(ip, rpm) {
  const now = Date.now();
  const b = buckets.get(ip) ?? { start: now, n: 0 };
  if (now - b.start > 60_000) {
    b.start = now;
    b.n = 0;
  }
  b.n++;
  buckets.set(ip, b);
  if (buckets.size > 10_000) buckets.clear();
  return b.n <= rpm;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
    const anyOrigin = allowed.includes('*');
    const originOk = anyOrigin || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': anyOrigin ? '*' : origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, Cf-Cache-Status',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const deny = (status, msg) => new Response(msg, { status, headers: cors });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!originOk) return deny(403, 'origin not allowed');
    if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405, 'method not allowed');

    const rpm = Number(env.RATE_LIMIT_RPM || 0);
    if (rpm > 0) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      if (env.LIMITER) {
        const { success } = await env.LIMITER.limit({ key: ip });
        if (!success) return deny(429, 'rate limited');
      } else if (!softLimit(ip, rpm)) {
        return deny(429, 'rate limited');
      }
    }

    const target = new URL(request.url).searchParams.get('u');
    if (!target) return deny(400, 'missing ?u=');
    let url;
    try {
      url = new URL(target);
    } catch {
      return deny(400, 'bad url');
    }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.some((re) => re.test(url.hostname))) return deny(403, 'host not allowed');

    const upstream = await fetch(url.toString(), {
      method: request.method,
      headers: { Range: request.headers.get('Range') || '', 'User-Agent': 'Hypeline-shim/0.2 (+https://github.com/hypeline)' },
      cf: { cacheEverything: true, cacheTtl: 300 },
    });
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len > MAX_UPSTREAM_BYTES) return deny(502, 'upstream too large');

    const headers = new Headers(cors);
    for (const h of PASS_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    const cr = upstream.headers.get('content-range');
    if (cr) headers.set('content-range', cr);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
