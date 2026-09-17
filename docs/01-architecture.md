# 01 — Architecture

## Shape

A static Vue 3 SPA/PWA. No server we own. Three external parties:

```
┌──────────────────────── Browser (PWA) ─────────────────────────┐
│                                                                │
│  UI (Vue) ─── Pinia stores ─── feature modules                 │
│                                   │                            │
│        ┌──────────────────────────┼──────────────────────┐     │
│        ▼                          ▼                      ▼     │
│  lib/twitch                 lib/nanogpt              lib/video │
│  Helix (official)           chat/completions         hls.js    │
│  GQL   (unofficial)         audio/transcriptions     WebCodecs │
│  HLS playlists              images / video           ffmpeg.wasm (fallback)
│        │                          │                      │     │
│        └──────────── lib/storage (IndexedDB) ────────────┘     │
└────────────────────────────────────────────────────────────────┘
          │                        │
          ▼                        ▼
   Twitch (api.twitch.tv,      NanoGPT (nano-gpt.com/api/v1)
   gql.twitch.tv, usher,       user's own API key
   *.ttvnw.net CDN)
```

## Data flow for the core loop

1. **Resolve VOD** — parse URL → video id. Helix `GET /videos?id=` for
   metadata (title, duration, streamer). Requires a Twitch app client-id and
   an app/user token; see research doc for the auth approach (implicit OAuth
   in-browser, or the user's own token).
2. **Chat replay** — page through comments for the VOD (unofficial GQL
   `VideoCommentsByOffsetOrCursor`), normalise to
   `{ offsetSeconds, user, text, emotes[], badges[] }[]`, persist to
   IndexedDB keyed by VOD id. A 6h VOD on a big channel is ~100k–500k
   messages; stream-parse and aggregate as we go, don't hold raw JSON.
3. **Hype scoring** (pure, tested, no network) — bucket messages into
   windows (e.g. 5s), compute per-bucket: message rate vs rolling baseline,
   emote-burst score (weighted emote lexicon: KEKW, LUL, OMEGALUL, PogChamp,
   Pog, W, L, CLIP, monkaS…), keyword hits ("clip it", "clip that"), event
   boosts (subs, raids, bits). Output `HypePoint[]` + peak detection →
   `Moment[]` with a score and a reason string ("emote burst: 340× KEKW").
4. **Playback** — get playlist via unofficial VOD access-token + usher
   → `hls.js` in a `<video>`. Seek to the moment. Cache the master and
   variant playlists.
5. **Transcription (optional)** — extract audio for the window: fetch the
   HLS segments covering it, demux/decode in-browser (WebCodecs
   `AudioDecoder` or ffmpeg.wasm), encode to a small WAV/Opus, POST to
   `/v1/audio/transcriptions` with `model: whisper-large-v3`
   (`response_format: verbose_json` for timestamps). Cache per
   `(vodId, startSec, endSec, model)`.
6. **LLM (optional)** — prompt with transcript + chat excerpt around the
   moment → JSON: `{ title, hook, suggestedIn, suggestedOut, why }`. Use
   structured output where the model supports it. Cost shown before/after.
7. **Cut & export** — fetch segments for in/out, cut precisely at frame
   level. Two paths: WebCodecs (fast, modern Chromium/Safari) and
   `ffmpeg.wasm` (universal fallback, slower, ~30MB wasm loaded lazily).
   Crop to aspect ratio, burn captions (Canvas overlay → re-encode).
   Output MP4 → `File System Access API` save or download.

## Modules

- `lib/twitch/helix.ts` — official Helix client (videos, clips, users).
- `lib/twitch/gql.ts` — the two unofficial calls we need (comments, VOD
  access token), each with an explicit `// UNOFFICIAL` header and a
  fallback note. Isolated so a breakage is one file.
- `lib/twitch/hls.ts` — playlist fetch/parse (m3u8), segment range → URLs.
- `lib/twitch/chat.ts` — comment paging + normalisation + streaming
  aggregation.
- `features/hype/scoring.ts` — pure scoring; the most-tested code in the repo.
- `lib/nanogpt/client.ts` — OpenAI-compatible client (chat, transcriptions,
  images, video, models, balance, usage). Provider-agnostic base URL.
- `lib/nanogpt/pricing.ts` — model catalog + cost estimator (tokens/min/image).
- `lib/video/*` — segment fetching, decoding, cutting, encoding, export.
- `lib/storage/*` — `idb` schemas: `vods`, `chat`, `moments`, `transcripts`,
  `clips`, `settings`.

## Storage

IndexedDB, versioned schema, migrations in `lib/storage/migrations.ts`.
Large blobs (segments, exports) go in the Origin Private File System where
available, else IndexedDB blobs. Everything is per-VOD and evictable; a
"storage" settings panel shows usage and lets the user purge.

## Auth & keys

- **NanoGPT key**: entered once, stored in IndexedDB. Optional passphrase
  encryption (WebCrypto AES-GCM, key derived via PBKDF2). Shown as masked.
  Balance fetched via `/balance` to display in the header.
- **Twitch**: prefer the user logging in via OAuth implicit flow with our
  public client-id (needed for Helix). GQL calls use the public web
  client-id like the Twitch web client does. Document in research; this is
  the main "will it work from a browser" risk (CORS).

## PWA / offline

- `vite-plugin-pwa`, `autoUpdate`, precache app shell; runtime cache for
  Twitch playlists/segments (CacheFirst, capped) and NanoGPT model list.
- Offline: anything already in IndexedDB (chat, moments, transcripts, cut
  clips) is usable; network features show a clear "offline" state.

## Performance notes

- Chat parsing must be incremental (Web Worker) — never block the main thread.
- Hype scoring in a Worker too; UI subscribes to progressive results so the
  heatmap "fills in" while paging.
- Video decode/encode in a Worker; ffmpeg.wasm loaded only on first export
  and only if WebCodecs is unavailable or the user chooses it.

## Testing strategy

- Unit: scoring, m3u8 parsing, cost estimation, storage migrations —
  fixtures from real (anonymised) chat/playlist dumps in `__tests__/fixtures`.
- Contract: recorded responses for Twitch/NanoGPT clients (MSW), replayed in
  tests; a `spikes/` script can refresh recordings.
- e2e (Playwright): paste URL → heatmap → seek → export a 5s clip, using a
  small fixture VOD and mocked network.

## Known risks (tracked in 05-research.md)

1. CORS on `gql.twitch.tv`, `usher.ttvnw.net`, CDN segment hosts,
   `nano-gpt.com`. If any is blocked → options: Cloudflare Worker proxy
   (tiny, stateless, still "no backend" in spirit), Tauri desktop build, or
   a browser extension for the Twitch calls.
2. Unofficial GQL drift. Mitigation: isolation + fallback (Helix Clips API
   density as a weaker hype signal, user-uploaded chat JSON from
   TwitchDownloader).
3. Sub-only VODs / muted segments — detect and message clearly.
4. Browser memory on long VODs — stream everything, cap caches.
