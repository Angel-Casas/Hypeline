/**
 * Spike S1b — Hypeline CORS shim (Cloudflare Worker).
 *
 * Stateless. Forwards GET requests to an allowlist of Twitch video hosts and
 * adds CORS headers so a browser on our origin can read playlists/segments.
 *
 * Usage from the app:   GET https://<worker>/?u=<encoded twitch url>
 *
 * Deploy:  npm i -g wrangler && wrangler login && wrangler deploy
 * Set ALLOWED_ORIGINS in wrangler.toml (comma-separated) — "*" for the spike.
 */

const ALLOWED_HOSTS = [
  /^usher\.ttvnw\.net$/,
  /^[a-z0-9-]+\.cloudfront\.net$/,
  /^[a-z0-9.-]+\.ttvnw\.net$/,
  /^[a-z0-9.-]+\.twitch\.tv$/, // vod-secure.twitch.tv, etc.
];

const PASS_RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'cf-cache-status'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
    const originOk = allowedOrigins.includes('*') || allowedOrigins.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigins.includes('*') ? '*' : origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!originOk) return new Response('origin not allowed', { status: 403 });
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('method not allowed', { status: 405 });

    const target = new URL(request.url).searchParams.get('u');
    if (!target) return new Response('missing ?u=', { status: 400 });
    let url;
    try { url = new URL(target); } catch { return new Response('bad url', { status: 400 }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.some((re) => re.test(url.hostname)))
      return new Response('host not allowed', { status: 403 });

    const upstream = await fetch(url.toString(), {
      method: request.method,
      headers: { Range: request.headers.get('Range') || '' , 'User-Agent': 'Hypeline-shim/0.1 (+https://github.com/)' },
      cf: { cacheEverything: true, cacheTtl: 300 },
    });

    const headers = new Headers(cors);
    for (const h of PASS_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (upstream.headers.get('content-range')) headers.set('content-range', upstream.headers.get('content-range'));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
