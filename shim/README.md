# Hypeline video relay

Twitch's playlist and segment hosts don't send CORS headers, so a browser page
can't read them directly (see `docs/05-research.md`, S1). This small Cloudflare
Worker forwards requests to an allowlist of Twitch hosts and adds the headers.
It is stateless: it keeps nothing and logs nothing.

    GET https://<relay>/?u=<url-encoded twitch url>
    GET https://<relay>/            → "Hypeline video relay · ok"

The app calls it for playlists, segments and the storyboard JSON. The preview
frames themselves load straight from Twitch (they are plain images in CSS, no
CORS involved), so they keep working even when the relay is locked down.

## Deploy your own (free)

```bash
cd shim
npm i -g wrangler     # 4.36 or newer, for the rate-limit binding
wrangler login
wrangler deploy
```

Then put the URL where the build can see it — locally in `.env`
(`VITE_SHIM_URL=…`), and for hypeline.live in the repository variable of the
same name (Settings → Secrets and variables → Actions → Variables). It is baked
into the build and users never see it (ADR-16); Settings → Advanced still
accepts a per-browser override for forks and local workers.

## What is locked down (`wrangler.toml`)

| var               | now                     | what it does                                                                                                          |
| ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS` | `https://hypeline.live` | other sites get 403                                                                                                   |
| `ALLOW_LOCAL`     | `true`                  | localhost, 127.0.0.1 and private-LAN origins are allowed too, so `vite dev` and a phone on the same wifi keep working |
| `RATE_LIMIT_RPM`  | `120`                   | per IP, per minute. One person cutting a 60 s clip at source quality spends ~9 requests                               |

The `[[ratelimits]]` block binds Cloudflare's own limiter, which counts across
the edge; without it the Worker falls back to a per-isolate counter, which is
better than nothing but easy to walk around. Redeploy after any change.

**Be honest about what this is.** Browsers always send `Origin` on a
cross-origin `fetch`, so the allowlist keeps other _sites_ from using your
relay, and the rate limit keeps one address from hammering it. Neither stops a
script that sets its own headers — it is a courtesy gate on a public, stateless
proxy, not authentication. Nothing sensitive passes through it and it grants no
access a viewer does not already have.

Two things follow from that: a `curl` with no `Origin` gets a 403 once the
allowlist is on (that is correct, not a fault — use `/health` to check the
relay is alive), and if you ever need to open it up, `ALLOWED_ORIGINS = "*"`
is one edit away.

## A domain of your own

`*.workers.dev` is blocked by some DNS resolvers, networks and privacy
extensions — we hit exactly that during development, and it looks like the app
is broken when it happens. If the relay's domain is on Cloudflare you can give
it a subdomain of your own: Workers & Pages → the Worker → Settings → Domains &
Routes → Add → Custom domain (say `relay.hypeline.live`), then update
`VITE_SHIM_URL` and rebuild.

That needs the zone's DNS to be on Cloudflare. `hypeline.live` is on the
registrar's nameservers today, so moving it is the prerequisite: add the zone in
Cloudflare, copy the existing records across (the four GitHub Pages A records
and the AAAA ones, **proxy off / grey cloud**, so Pages keeps serving and
managing its own certificate), switch the nameservers at the registrar, and then
add the Worker's custom domain.

## Tests

`npm test` at the repo root covers this Worker too (`shim/worker.test.mjs`):
the live app and a developer get through, other sites and other hosts do not,
and the health route answers without an Origin.

The spike version in `spikes/s1b-shim/` is kept for history; use this one.
