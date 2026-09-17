# Hypeline

### → [**hypeline.live**](https://hypeline.live) — open the app

**Free, open-source Twitch clipping that listens to chat.** Paste a VOD link;
Hypeline reads the chat replay, draws the stream as a hype heatmap, ranks the
moments, and cuts captioned vertical clips — entirely in your browser.

No uploads. No account. No sign-up. No server. Your VODs, clips and keys never
leave your machine. Nothing to install either, though you can: it is a PWA, so
your browser will offer to keep it in its own window, offline.

[![Open the app](https://img.shields.io/badge/open-hypeline.live-7a4f8e)](https://hypeline.live) ![MIT](https://img.shields.io/badge/license-MIT-black) ![Browser only](https://img.shields.io/badge/backend-none-black) ![PWA](https://img.shields.io/badge/PWA-installable-black)

## Why it is different

Most clipping tools upload your video and run a model over it. Hypeline starts
from the thing that already knows where the good parts are: **the chat**.
Message-rate spikes, emote walls, copypasta and "CLIP IT" tell you what the
room reacted to, and that costs nothing to read. Only the seconds you actually
clip are ever fetched.

## What it does

- **Hype heatmap** of the whole stream from the chat replay, with ranked
  moments, storyboard frames on hover, zoom and pan (two fingers on a phone).
- **Clip**: trim on the frames, presets for TikTok / Shorts / X / Square,
  captions, quality, queue several and export them in one go — cut with
  `ffmpeg.wasm` in the browser.
- **Live**: paste a channel that is streaming and the VOD grows as it records,
  chat arriving over IRC, with a notification when a new moment appears.
- **AI, with your own key** (optional): transcribe a range, ask what happened,
  or search the whole stream by what was said. Costs are shown before every
  call.
- **Your Twitch home** (optional, read-only): who you follow, who is live,
  their newest VODs — one click from a clip.
- Ten languages, day and night, installable as an app, works offline.

## Run your own copy

The hosted app at [hypeline.live](https://hypeline.live) is this repository,
built and served as static files. To work on it:

```bash
pnpm install        # npm works too (the lockfile is npm's)
pnpm dev            # http://localhost:5173 — use localhost, not 127.0.0.1 (the Twitch embed insists)
pnpm test           # unit tests
pnpm lint           # eslint + vue-tsc
pnpm build          # static site in dist/
pnpm preview        # serve dist/ on :4173
pnpm e2e:fixtures   # once: four real segments for the cut test
pnpm e2e            # browser tests against the preview server (mocked Twitch)
```

Copy `.env.example` to `.env` and fill in what you need:

| variable                | what it is                                                            | needed for                         |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| `VITE_SHIM_URL`         | your deployed video relay (`shim/`, a Cloudflare Worker)              | cutting, thumbnails, transcription |
| `VITE_TWITCH_CLIENT_ID` | a Twitch app's Client ID (public client, redirect `<host>/dashboard`) | the signed-in home                 |
| `VITE_GITHUB_REPO`      | `owner/repo` for the "?" feedback links                               | forks only                         |

Everything else works without configuration. The video relay exists because
Twitch's CDN sends no CORS headers; it passes bytes through and nothing else —
deploy your own from `shim/` (see `shim/README.md`).

## How it is built

Vue 3 + Vite + TypeScript, Pinia, Tailwind, `ffmpeg.wasm`, IndexedDB. The
browser talks to Twitch and (if you bring a key) to NanoGPT, and to nothing
else. There is no backend to run and nothing to pay for.

`CLAUDE.md` is the short version for contributors; `docs/` is the long one —
vision, architecture, decisions (ADRs), research notes on Twitch's
undocumented endpoints, the design system, and a running worklog.

## Deploying

The build is static: `pnpm build` writes `dist/`, which any host can serve.
Two details matter for a single-page app on a static host — both already in
the build: `public/CNAME` carries the custom domain, and `scripts/
spa-fallback.mjs` copies `index.html` to `404.html` so deep links
(`/dashboard/<vod>`, and Twitch's sign-in redirect) survive a hard load.
GitHub Pages needs an Actions workflow to run the build; `dist/` itself is
never committed.

## Contributing

Issues and pull requests are welcome. The three doors in the app's "?" open a
prefilled issue here. If you speak one of the ten languages, corrections to the
machine-drafted catalogs (`docs/09-languages.md`) are especially welcome.

## Money

Hypeline is free and always will be. The only revenue is a NanoGPT referral
link: it gives you **5 % off** your usage and pays the project 10 %, at no
extra cost to you. The app works with any NanoGPT key, referred or not.

## Licence

MIT © 2026 Angel Casas. Not affiliated with Twitch or Amazon.

**[hypeline.live](https://hypeline.live)**
