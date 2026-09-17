# Hypeline CORS shim

Twitch's playlist and segment hosts don't send CORS headers, so a browser page
can't read them directly (see `docs/05-research.md`, S1). This tiny Cloudflare
Worker forwards requests to an allowlist of Twitch hosts and adds the headers.
It keeps no state and logs nothing.

## Deploy your own (free)

```
cd shim
npm i -g wrangler
wrangler login
wrangler deploy
```

Put the printed URL in the app's `.env` as `VITE_SHIM_URL=…` and build:
it is baked in and users never see it (ADR-16). Settings → Advanced still
accepts a per-browser override for forks and local workers.

## Lock it down

Edit `wrangler.toml`:

- `ALLOWED_ORIGINS`: the origins your app runs on. Anything else gets 403.
- `RATE_LIMIT_RPM`: per-IP requests per minute (0 disables). For accurate
  limiting across Cloudflare's edge, enable the `LIMITER` binding block.

Redeploy after changes. The spike version in `spikes/s1b-shim/` is kept for
history; use this one.
