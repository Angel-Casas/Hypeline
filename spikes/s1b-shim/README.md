# S1b — CORS shim spike

Question: with a ~60-line stateless Cloudflare Worker in front of Twitch's
video hosts, can the browser read a VOD playlist and pull segments, and what
does a 60 s range cost in requests, bytes and time?

## Deploy (free Cloudflare account)

```
cd spikes/s1b-shim
npm i -g wrangler
wrangler login
wrangler deploy
```

It prints a URL like `https://hypeline-shim.<you>.workers.dev`.

## Test

Open `spikes/s1-cors/index.html` again, but this time paste the shim URL in
the "Shim URL" field. Steps (c), (c2) and (d) will route through it; a new
step (f) fetches every segment in a 60 s window and reports count, bytes and
elapsed time. Copy the output into `docs/05-research.md`.

## What to record

- Did (c) usher succeed through the shim? Did (d) segments?
- Segment size and duration at source quality (Twitch VOD segments are
  usually ~10 s of fMP4/TS; 1080p60 runs roughly 6–12 Mbit/s).
- Time to fetch 60 s. Whether Cloudflare's cache (`cf-cache-status` header)
  hits on a second run.
- Anything in the Worker logs (`wrangler tail`) worth knowing.

## Before this becomes real (M2)

- Lock `ALLOWED_ORIGINS` to the app origin(s).
- Add a per-IP rate limit (Workers Rate Limiting binding) and a per-request
  size cap.
- Add a "Deploy to Cloudflare" button in the repo README so forks/self-hosters
  run their own; the app exposes the shim URL in Settings.
- Check Cloudflare's current terms for proxying media through Workers.
