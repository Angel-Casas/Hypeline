# 05 — Research & external facts

Dated facts about things outside our control. When you learn something new,
add it with the date. When a spike answers a question, replace "unknown"
with the answer and link the spike script.

## NanoGPT (verified 2026-09-12 from docs.nano-gpt.com)

- Base URL `https://nano-gpt.com/api/v1`, Bearer auth with the API key.
- Keys are created at **`https://nano-gpt.com/api`** (checked 2026-09-18) — the "API Keys"
  section of that page, up to 20 per account. An account is optional for using NanoGPT itself;
  a key is not. Wallets top up by card, Apple / Google Pay or crypto (Angel, 2026-09-18).
  OpenAI-compatible for chat completions (streaming, structured output),
  images, and `POST /v1/audio/transcriptions` (STT, sync and async, multiple
  languages, diarization). Also an Anthropic-compatible Messages endpoint.
- Video generation: text-to-video, image-to-video, video-to-video, with a
  unified status endpoint (async).
- Account endpoints: list models (with optional pricing), check balance,
  usage (aggregate spend per key), and **create invitation/referral link**
  (`POST` with optional credit amount) — worth using to generate the
  onboarding link programmatically (spike S6).
- Transcription pricing (from the user, 2026-09-12): Whisper-Large-V3
  ~$0.0005/min, gpt-4o-mini-transcribe $0.003/min, Wizper $0.01/min.
  → a 6h VOD is ~$0.18 on Whisper. Per-moment windows are fractions of a cent.
- Pay-as-you-go from $1 (card) / $0.10 (crypto); optional $12/mo subscription.
  Every response includes the exact cost charged — use it for the "actual
  cost" display.
- Referral: NanoGPT announced permanent referral links giving the referred
  user a 5% discount and the referrer a share ("10%/5%" in their post).
  **Current terms unverified** — spike S6. Sources:
  <https://x.com/NanoGPTcom/status/1829752804493136253>,
  <https://docs.nano-gpt.com/llms.txt>.
- CORS from browsers: **confirmed working** (2026-09-12, Angel — already
  calls the API directly from several browser apps). No proxy needed for
  NanoGPT. S1 now covers Twitch only.

## Twitch

### Official (Helix)

- `GET https://api.twitch.tv/helix/videos?id=…` for VOD metadata; needs
  `Client-Id` + a user or app token. Browser: implicit OAuth flow works with a
  registered app and redirect URL. Helix supports CORS.
- `GET /helix/clips?broadcaster_id=…` — existing clips density is a weak
  secondary hype signal and a fallback if chat is unavailable.

### Unofficial (GQL at `https://gql.twitch.tv/gql`)

- Chat replay: persisted query `VideoCommentsByOffsetOrCursor` (used by
  TwitchDownloader, the "VOD Activity Bar" extension, and various scrapers).
  Requires the public web `Client-Id`. Pages by cursor; returns comments with
  `contentOffsetSeconds`, commenter, message fragments (emotes as fragments),
  badges.
- VOD playback: `PlaybackAccessToken` GQL op → `{ value, signature }`, then
  `https://usher.ttvnw.net/vod/{id}.m3u8?sig=…&token=…` → master playlist →
  variant playlists → segments on `*.cloudfront.net` / `*.ttvnw.net`.
  Sub-only VODs return 403 (streamlink issue #2713). Some regions/quality
  restrictions exist.
- CORS — **S1 results, 2026-09-12, localhost origin** (`spikes/s1-cors`):
  - `gql.twitch.tv` `VideoCommentsByOffsetOrCursor` with the web client-id:
    **works** (59 comments, first page; persisted-query hash valid as of today).
  - `gql.twitch.tv` `PlaybackAccessToken` (VOD): **works** (token returned).
  - `usher.ttvnw.net` master playlist: **blocked by CORS.** DevTools shows
    the request itself succeeds (`200 OK`) — the response simply carries no
    `Access-Control-Allow-Origin`, so the browser refuses to expose it.
    The token/sig in the URL were valid (`forbidden:false`,
    `maximum_resolution: FULL_HD` when not logged in).
  - CDN (`d3vd9lfkzbru3h.cloudfront.net`) variant playlist derived from
    `video.seekPreviewsURL` (raw GQL query works; field exists): **also
    blocked by CORS.** The derivation itself is right
    (`<origin>/<dir>/chunked/index-dvr.m3u8`); it will be useful once
    requests go through a CORS-capable path.
  - Conclusion (S1 closed): **chat replay + playback tokens are fully
    browser-native; video bytes (playlists, segments) are not readable
    from a non-twitch.tv origin.** Repeating from a deployed origin is
    pointless — there is no ACAO header at all, not an origin allowlist.
  - Consequence for the roadmap: M1 (heatmap → seek) can use Twitch's
    official **embed player** (`player.twitch.tv` iframe + `Twitch.Player`
    JS API: `seek()`, `play()`, `getCurrentTime()`), which is CORS-free and
    ToS-clean. M2 (cutting/export) needs raw segments → ADR-9.

### S1b — CORS shim results (2026-09-12, localhost → Angel's Worker)

Through the ~60-line Cloudflare Worker (`spikes/s1b-shim/worker.js`):

- usher master playlist ✅ (5 quality variants), storyboard-derived CDN
  playlist ✅ (2,297 segments for the 6h24 VOD → ~10 s each), first
  segment ✅ (`0.ts`, 9.2 MB, `video/MP2T` — VOD segments are MPEG-TS, so
  the cutter must demux TS, not fMP4).
- **60 s window at source quality: 7 segments, 53 MB, 29.2 s (15 Mbit/s).**
  Video bitrate ≈ 7 Mbit/s. So: a 60 s clip costs ~50 MB and ~30 s of
  download on a typical connection; fetch source only for the final export
  and use a lower variant (720p/480p) for preview and scrubbing.
- Cloudflare cache status unknown in this run (header wasn't passed
  through; fixed in worker.js — re-check on the next deploy).
- ADR-9 confirmed: PWA + embed player + stateless shim is viable. **M0 closed.**

### Options for reading video bytes (input to ADR-9)

1. **Stateless CORS shim on Cloudflare Workers.** ~40 lines: allowlist
   `usher.ttvnw.net` + `*.cloudfront.net` + `*.ttvnw.net`, forward the
   request, add `Access-Control-Allow-Origin` for our origin(s). No state,
   no accounts, open-source, one-click self-hostable (so power users and
   forks don't depend on ours). Free tier: 100k requests/day; a 60 s clip
   at source quality is ~6–12 segments. Bandwidth through Workers is not
   metered on the free plan (verify current Cloudflare terms; historically
   fine for Workers, unlike the old CDN video clause). Risk: abuse as an
   open proxy → check `Origin`, restrict hosts, rate-limit by IP.
2. **Browser extension companion.** Host permissions bypass CORS; the PWA
   talks to it via `externally_connectable`. Zero infra, but installs are
   friction and Firefox/Safari differ.
3. **Tauri desktop build.** Native HTTP, no CORS, can shell out to real
   ffmpeg. Best power-user path; Rust toolchain + release burden.
4. **twitch.tv-origin extension** (content script on VOD pages). Everything
   is same-origin. Most "native" but the app stops being a standalone PWA.
   Recommended: (1) now, (2)/(3) later as optional "no-proxy modes".

- Drift risk: these ops change without notice. Isolate in `lib/twitch/gql.ts`,
  keep the persisted-query hashes and a "last verified" date there.

### Chat replay paging — S2 findings (2026-09-12, `spikes/s2-chat-dump`)

- Paging by **`cursor` fails** without a Client-Integrity token:
  `{"errors":[{"extensions":{"code":"IntegrityCheckFailed"}}], "comments": null}`.
  Paging by **`contentOffsetSeconds` works** with no integrity token, from a
  server _and_ from the browser (S1a was an offset call).
- An offset request returns a fixed chunk of ~60 messages that _contains_
  that second (it may start earlier). Walk with `offset = last_t + 1` and
  de-duplicate by comment `id`. `pageInfo.hasNextPage` is reliable.
- VOD 2871164819 (tokyosims, Just Chatting IRL, 6 h 24 min, 500–1000
  viewers): **5,626 messages, ~100 requests, 53 s** from the cloud shell.
  ≈ 15 msg/min average — a low-chat channel, a good hard case.
- Bot messages (`bot-badge`, StreamElements/Nightbot: Discord link, sponsor
  line) repeat verbatim every few minutes — filter by badge and by repeated
  identical text before scoring.
- Fixture saved (usernames hashed): `spikes/s2-chat-dump/fixture_2871164819.jsonl`.

### Hype scoring — S3 findings (2026-09-12, `spikes/s3-hype-scoring`)

- Prototype score per 15 s bucket: `log2(rate / rolling-median baseline ±10 min)`
  - 1.5 × reaction share (emotes, lol/W/caps/!!!) + 1.2 × "clip it" hits
    (capped) + a bonus for many distinct users. Peaks = local maxima ≥ 2 min apart.
- Top 12 peaks on the low-chat VOD: **~10 look like real clip moments**; in
  **6 of them chat literally says "clip that / CLIP IT / clipped"**. The
  two false positives are a broken-mic complaint (7×–8× rate spike) and the
  "it's fixed" relief 3 min later.
- Improvements queued for the real implementation: a _technical-trouble_
  lexicon (mic, audio, lag, froze, muted, buffering, "we can't hear") that
  demotes a spike; bot filtering (above); treat "1"/"2" vote spam as its
  own moment type (chat polls); explicit "clip it" should probably dominate
  the score, not just add to it; and the LLM "explain this moment" pass is
  the natural second-stage filter for whatever slips through.
- Heatmap render of the whole VOD: `spikes/s3-hype-scoring/heatmap_2871164819.html`.
- Angel watched the top peaks of 2871164819 (0:34:15, 1:34:15, 4:14:30):
  **"a perfect match"** — all three are clip-worthy.

### S3b — the two ends of the range (2026-09-12)

| VOD        | Channel   | Viewers  | Length | Messages | msg/min | Dump time            |
| ---------- | --------- | -------- | ------ | -------- | ------- | -------------------- |
| 2871808638 | caseoh_   | ~100k+   | 3h58   | 103,244  | 417     | ~19 min (~1.5 req/s) |
| 2871164819 | tokyosims | 500–1000 | 6h24   | 5,626    | 15      | 53 s                 |
| 2861002437 | popkreep_ | ~120     | 3h08   | 2,298    | 10      | 22 s                 |

- **Big channel**: every top-12 peak is plausible (failed jump + "NOOO"
  wall, biggest laugh of the stream at 3:24, a "WHAT" reveal, a gift-sub
  bomb, emote walls during songs). Rate ratios are compressed (max ~2.5×
  vs 7× on the small channel) because the baseline is already high —
  reaction share carries the score. Scores are only comparable _within_ a
  VOD; rank per VOD, don't threshold globally.
- **"clip it" is channel-dependent**: 6 of 12 peaks on tokyosims had it;
  caseoh_ had **zero** in 103k messages (auto-mod or just not that
  community's habit). Keep it as a bonus, never a requirement.
- **Sub/gift/raid system messages are in the replay** ("X gifted a Tier 1
  sub to Y", "subscribed at Tier 2", watch-streak notices). Use them as
  event boosts and exclude them from the user/message counts.
- **Tiny channel** (10 msg/min): before the fix, 3-message buckets from
  1–2 users scored as high as real moments. Added a confidence weight
  `min(1, users/5)`; after it, all 8 peaks have ≥5 distinct users and
  look reasonable, but a channel this small will never give more than a
  handful of confident moments — the UI should say so rather than pad
  the list. Even here chat said "smb clip this" once.
- Dumping a big VOD at ~60 messages/request is slow (19 min). For the
  client: fetch offsets in parallel (e.g. 6 workers, each walking a
  1/6th time range, de-dup by id) — offsets are independent, so this is
  safe — and render the heatmap progressively.
- **End-of-VOD**: asking past `lengthSeconds` returns `service error`
  with `comments: null`, not `hasNextPage: false`. Stop at `lengthSeconds`.
- Fixtures: `fixture_2871808638_caseoh.jsonl.gz` (2 MB), `fixture_2861002437_popkreep.jsonl`.

### Scoring v0.2 (as of end of S3b) — port this to TypeScript in M1

Per 15 s bucket, after dropping bot-badged messages and any (user, text)
repeated ≥ 4 times:
`score = max(0, log2(n / rollingMedian±10min)) + 1.5·reactionShare + 0.5·[uniqueShare > 0.6] + 1.2·min(clipUsers, 3)`;
`× 0.3` if techTroubleShare > 0.25; `× min(1, users/5)`; peaks = local
maxima ≥ 2 min apart. Known gaps: "mic fixed" relief buckets still slip
through; emote walls during music rank as hype (arguably fine: "vibe"
moment type); no event boosts yet.

### Chat as a signal — prior art

- "VOD Activity Bar for Twitch" (Chrome extension, ~100 users, 2026-09) draws
  a comment-and-clip density bar on VOD pages using Helix + the unofficial
  comments GQL. Validates the signal; nobody has built clipping on top of it.
  <https://chromewebstore.google.com/detail/vod-activity-bar-for-twit/moklpbjhdpkmiciihnfcpmfnniioonnb>
- Twitch's own "VOD chat replay" exists in the player, so the data is
  unmistakably meant to be readable.
- Live chat via IRC (`irc.chat.twitch.tv`, or the WebSocket at
  `wss://irc-ws.chat.twitch.tv`) is readable anonymously (`justinfan…` nick)
  — relevant to the M5 live moment feed.

### Legal/ToS notes (not legal advice; revisit before launch)

- Downloading segments for the user's own clipping is what the Twitch clip
  editor and countless clipper tools do; we don't host or redistribute
  anything. Keep it that way.
- Respect rate limits; cache; identify our client honestly.

## M2 cutting — S4 findings (2026-09-12)

- 720p variant: 10 s MPEG-TS segments, ~2.8 MB each, H.264 30 fps + AAC,
  keyframes every 2 s. Master playlist lists 5 variants for this VOD:
  chunked (1080p, 6.4 Mbit/s), 720p30, 480p30, 360p30, 160p30. Variant
  names come from the `VIDEO="…"` attribute.
- TS packet timestamps are _not_ VOD time (segment 202 starts at VOD
  2042.8 s but its PTS starts at 2104.9 s). Cut offsets must be computed
  relative to the first fetched segment; concatenated TS is fed to ffmpeg
  with `-ss <offset>`.
- Native ffmpeg benchmarks (30 s @ 720p): stream copy 0.3 s; libx264
  veryfast re-encode 14 s (2 threads); vertical crop 10 s in 2.5 s.
- **ffmpeg.wasm in headless Chromium**: fast cut of 15 s → 1.2–1.6 s wall
  incl. download; precise 9:16 re-encode of 5 s → 3.7–3.9 s wall
  (`-preset ultrafast -crf 23`). Output verified with ffprobe (h264, 404×720).
- Playwright's Chromium has no H.264 decoder: `<video>` never fires
  `loadedmetadata` there. e2e verifies MP4s with ffprobe instead.
- `optimizeDeps.exclude` for `@ffmpeg/ffmpeg` and `@ffmpeg/util` is
  required in Vite dev, otherwise the worker URL breaks.
- In Vite **dev**, passing `/ffmpeg/ffmpeg-core.js` straight to `ff.load()`
  fails: the worker's dynamic `import(coreURL)` is intercepted by the dev
  server ("This file is in /public and … should not be imported"). Load
  core + wasm through `toBlobURL()` from `@ffmpeg/util` (Angel hit this
  2026-09-12; e2e now runs against both dev and preview).

## Captions — S5 findings (2026-09-13)

- NanoGPT STT: **no word/segment timestamps for Whisper-Large-V3 or
  gpt-4o-mini-transcribe** (no `verbose_json` / `timestamp_granularities`).
  Only `Elevenlabs-STT` with `diarize` returns `words[]` with start/end.
  → v1 captions time cues proportionally to character length across the
  clip (`lib/video/captions.ts`). Options later: Elevenlabs-STT for exact
  timing (price TBD), or chunked transcription (same per-minute price,
  timing accurate to the chunk).
- Our ffmpeg.wasm core has `--enable-libass --enable-libfreetype
--enable-libfribidi`: both `subtitles` (ASS) and `drawtext` filters
  exist. libass finds fonts via `subtitles=subs.ass:fontsdir=/fonts` (no
  fontconfig; it logs "can't find selected font provider" but works). Font
  bundled: `public/fonts/DejaVuSans-Bold.ttf` (permissive DejaVu licence,
  708 KB, fetched lazily on first captioned export).
- Burned captions on 5 s of 720p: ~5.8 s wall in headless Chromium. With
  input seeking (`-ss` before `-i`) the filter clock starts at 0 at the cut,
  so ASS cue times are clip-relative. Filter chain order: `crop,subtitles`,
  with PlayResX/Y = post-crop size so fonts scale with the frame.

## Whole-VOD transcription — S6 findings (2026-09-13)

- With `allow_audio_only=true` on the usher URL, Twitch VODs expose an
  **`audio_only` variant**: AAC 48 kHz, ~216 kbps, ~270 KB per 10 s segment
  (`#EXT-X-STREAM-INF:BANDWIDTH=216383,CODECS="mp4a.40.2",VIDEO="audio_only"`,
  no RESOLUTION). A 6 h VOD is ~600 MB of audio download and ~$0.18 of
  Whisper. The app uses it for every transcription (`pickAudioVariant`).
- **NanoGPT direct upload cap: 3 MB** (HTTP 413 "File too large for direct
  upload… Please use the upload URL method", Angel 2026-09-13). A 120 s WAV
  is 3.84 MB → switched all transcription audio to **MP3 16 kHz mono
  32 kbps** (libmp3lame is in our core): ~240 KB/min, so a 10-minute range
  is 2.4 MB. `extractAudio` throws a clear error above 3 MB. The "upload
  URL method" for bigger files is not implemented (not needed at 120 s chunks).
- Bulk transcription runs in 120 s chunks (`BULK_CHUNK_SEC`), each cached
  in the `ai` store keyed `${vod}:${a}-${b}:transcript:${model}`; a chunk is
  one WAV upload (~3.8 MB). Search timing precision = chunk length. Chunks
  are sequential (one ffmpeg instance); resumable and cancellable.
- Search sends all chunks labelled `[h:mm:ss–h:mm:ss | <start>s]` plus the
  question to the chat model with a strict JSON schema (`hits[]` with
  `t`, `endT`, `quote`, `why`, `confidence`). Prompt is capped at ~100k
  tokens by sampling every other chunk beyond that (≈ 9 h of speech).
  A 6 h VOD transcript is ~80k tokens → ~$0.02 per search on a mini model.

## Browser video

- `hls.js` for playback of Twitch VODs (fMP4/TS). Segment fetching for
  cutting can reuse its loader or a plain `fetch`.
- WebCodecs (`VideoDecoder`/`VideoEncoder`/`AudioDecoder`) is in Chromium
  and Safari; Firefox partial. Precise cuts need decode-from-keyframe →
  re-encode of the first GOP, or full re-encode for burned-in captions.
- `ffmpeg.wasm` (~30MB) as the universal fallback; slower, but handles
  everything. Load lazily.
- Origin Private File System for large blobs; File System Access API for
  "save to folder" in Chromium; download fallback elsewhere.

## Open questions

- Twitch app registration: category, redirect URLs for localhost + Pages.
- Does NanoGPT's transcriptions endpoint accept `verbose_json` /
  word timestamps for whisper-large-v3? (S5)
- Max message count we can hold aggregated per VOD in IndexedDB before it's
  slow on a low-end laptop? (S2)
- Hype scoring on small channels (100–500 viewers): is chat rate enough, or
  do we need emote weighting to dominate? (S3)

## Browser storage quota (2026-09-13)

`navigator.storage.estimate()` gives `{usage, quota}` for the origin
(Chromium: quota ≈ 60% of free disk per origin, capped by disk; Firefox:
10% of disk, max 10 GB for non-persisted origins; Safari: ~1 GB then prompts).
Unavailable in some private modes → we treat as unknown and never block.
IndexedDB `put` past the quota throws `QuotaExceededError` (Firefox:
`NS_ERROR_DOM_QUOTA_REACHED`). `navigator.storage.persist()` stops eviction
under disk pressure: Chromium grants silently only for installed PWAs or
sites with high engagement, Firefox prompts the user. Clip size estimate =
variant `BANDWIDTH` × duration (stream copy ⇒ near exact; libx264 crf 23 at
ultrafast lands in the same ballpark).

### Storyboards (2026-09-14, unverified)

`video.seekPreviewsURL` → JSON on the CDN (`.../storyboards/<id>-...json`).
Assumed format (from public write-ups, **not yet observed through the
shim**): an array per quality `{quality,width,height,cols,rows,count,
interval,images[]}`, images relative to the JSON's directory; frame k =
floor(t/interval). The JSON needs the shim (no ACAO); the sprite images are
used as CSS backgrounds, which needs no CORS. If the real format differs,
`lib/twitch/storyboard.ts#parseStoryboard` is the one place to fix.

### Storyboards — verified against real VODs (2026-09-15)

`video.seekPreviewsURL` → `https://<hash>.cloudfront.net/<dir>/storyboards/<id>-info.json`,
served as `binary/octet-stream`, **no ACAO** (goes through the relay). Checked
tokyosims / xqc / kaicenat / pokimane: always two levels,
`{quality:'low', width:160, height:90, cols:5, rows:40, count:200, interval, images:[1]}` and
`{quality:'high', width:220, height:124, cols:5, rows:10, count:200, images:[4]}`; `interval`
= lengthSeconds / 200 (116 s for a 6h24 VOD). Sprite JPGs are relative to the JSON's directory
and load as plain images from any origin (no hotlink check). The parser in
`lib/twitch/storyboard.ts` matches; frames confirmed in the moment chips end-to-end with a
local relay.

### Storyboard levels — which one to draw (2026-09-17)

Of the two levels Twitch publishes, `low` is 160×90 and `high` is 220×124
(one sprite sheet of 200 frames vs four of 50). The moment cards draw a
frame much wider than 160 px, so `low` looked like mush; the default ask is
220 px now. Both load straight from the CDN as CSS backgrounds, so neither
touches the relay.

### Static hosts gzip the ffmpeg core (2026-09-17)

GitHub Pages serves `ffmpeg-core.wasm` (32,232,419 bytes) with
`content-encoding: gzip` and `content-length: 10,327,561`. Anything that
compares streamed bytes against `Content-Length` — `@ffmpeg/util`'s
`downloadWithProgress` does — will decide the download is incomplete. See
ADR-25; `vite dev` and `vite preview` serve it uncompressed, which is why
this only ever appeared in production.

### What a chat's own words look like (2026-09-18)

Ranking a VOD's tokens by total users puts stopwords on top — an English
test chat gave "that", "good", "song" before any emote. Ranking by **the
most users inside one 15 s bucket** puts POGGERS, LUL, OMEGALUL, KEKW
first, which is also what the scoring reacts to. Dropping tokens that
appear in more than 60 % of buckets removes the rest of the filler; on a
synthetic Spanish chat it leaves exactly `clipea`, `crack`, `eso`.

Pack detection has the same trap in reverse: `hahaha` sits in both the
German and Turkish starter packs, so an English chat that laughs lit up
**both**. Detection now ignores any term that appears in more than one pack
and a small pan-Twitch set (lol, gg, wtf, omg, ez, xd, ww, haha).

### Scoring v0.3 — walls, moods, copypasta, sensitivity (2026-09-15)

Per 15 s bucket, on top of v0.2: **wall** = the emote (from `m.e`, not words)
posted by the most users when ≥ 3 users and ≥ 25 % of the bucket's users
(+0.6 × share); **mood** = the reaction family (laugh / hype / shock / grief /
confused, word + emote lists in `MOOD_WORDS`) with the most users when ≥ 3 and
≥ 30 % (+0.4 laugh/hype/shock, +0.3 grief, +0.2 confused); **copypasta** =
the largest group of distinct users posting the same ≥ 12-char line, when ≥ 4
(+0.8 × min(1, n/10)). Reasons are now sentences ("KEKW wall · 44%", "chat is
losing it", "copypasta ×8") ahead of the numbers. **Sensitivity** 1–5 maps to
top 6/9/12/18/25 peaks with a 180/150/120/90/60 s minimum gap
(`sensitivityToOptions`); bucket scores don't change, only how many surface.
The S3/S3b regression fixtures still pass unchanged (tokyosims: 34:15, 94:15,
254:30 kept; the 2:30:15 mic complaint still out). On the caseoh fixture the
walls read `caseohLife wall · 44%`, `caseohHamster wall · 45%`.

### Smart cut (exact start without a full re-encode) — tried, parked (2026-09-15)

Twitch VOD keyframes are every 2 s. A "smart cut" = re-encode [In, next keyframe)
with libx264 + stream-copy the rest + concat demuxer. Natively it works (301 frames,
no timestamp gaps, decodes clean) but the two parts differ in profile (libx264
ultrafast → Constrained Baseline vs Twitch's Main) and the MP4 gets one avcC, so
browser playback of the joint is unreliable. Options if revisited: encode part A
with `-profile:v main -x264-params cabac=1:bframes=0` to match, or mux as
fragmented MP4 with per-fragment parameter sets (`avc3`). Until then, `precise`
(full re-encode) is the exact option.

### Speech in the score (2026-09-15)

Whisper chunks are plain text per 2 min (no word timings), so the streamer's words
enter as a **per-chunk multiplier** on every 15 s bucket inside the chunk
(`features/hype/speech.ts`): < 40 wpm → ×0.85 (dead air / music / AFK); otherwise
1 + up to 0.15 for `!`/`?` density + up to 0.1 for laughs/min + 0.05 per hype
phrase found ("no way", "let's go", "clip that", "did you see that"…), capped at
×1.35. The first phrase found becomes a reason: `streamer: “no way”`. The AI store
hands every transcript (range + bulk) to `vodStore.setSpeech`, which rescores.
Nothing changes without a transcript, so the fixture regressions are untouched.

## Chat export formats (2026-09-15)

TwitchDownloader (CLI `chatdownload`, GUI) writes one JSON object:
`streamer { name, id }`, `video { id, title, start, end, length?, created_at }`,
`comments[]` each with `content_offset_seconds`, `commenter { name,
display_name, _id }`, `message { body, fragments[{ text, emoticon:
{ emoticon_id } | null }], user_badges[{ _id, version }], emoticons[{ _id,
begin, end }] }`. Older dumps (the retired Twitch v5 API shape it mirrors)
have `body` + `emoticons` spans and no `fragments`. `lib/twitch/chatImport.ts`
reads both and a bare array; unknown fields are ignored. The web app never
fetches these files — the user picks one from disk.

## Fonts offline (2026-09-15)

Google Fonts' CSS, requested with a modern UA, returns per-subset woff2 with
`unicode-range`; mirrored under `public/fonts/` with the same ranges
(`src/fonts.css`). Sizes: latin 174 KB, latin-ext 90, cyrillic 74,
cyrillic-ext 14, greek 49, vietnamese 44. All three families are SIL OFL
(`public/fonts/OFL.txt`).

## Live chat without a login (2026-09-15)

`wss://irc-ws.chat.twitch.tv:443`, `CAP REQ :twitch.tv/tags twitch.tv/commands`,
`NICK justinfan<digits>` (no PASS), `JOIN #channel` → PRIVMSG lines with
IRCv3 tags (`tmi-sent-ts`, `display-name`, `emotes=id:a-b,…/id:…` as code-point
spans, `badges=set/version,…`). Verified from a sandbox: 79 messages in 10 s
on xqc. The server sends `PING :tmi.twitch.tv` periodically — answer with
`PONG :tmi.twitch.tv` — and `RECONNECT` before maintenance. This is Twitch's
documented chat protocol; only the anonymous nick is convention.

`user(login) { stream { id createdAt viewersCount title game { name } }
videos(first: 1, type: ARCHIVE, sort: TIME) { edges { node { id createdAt
status } } } }` with the web client-id returns `stream: null` when offline;
when live the newest archive appears ~5 s after `stream.createdAt` with
`status: "RECORDING"` (6 channels checked). `fetchLiveInfo` matches the two
within 2 minutes. The VOD's chat replay is available while it records
(Angel, 2026-09-12), so a live moment can be clipped mid-stream.

Live scoring notes: a bucket at the baseline scores ~0.5 (rate ≈ 0.17 +
unique-user bonus), a real spike ≥ 1.5; the trailing bucket is excluded
until full; the baseline is computed from the join, not the stream start.
Sandbox quirk: headless Chromium there needs `--no-proxy-server` +
`ignoreHTTPSErrors` for the WebSocket (the proxy has no WebSocket support);
irrelevant outside the sandbox.

## Storyboards and live VODs (2026-09-15)

`seekPreviewsURL` is set while a VOD is still `RECORDING`, but the JSON
answers **403 (S3 AccessDenied)** until Twitch renders it after the stream
ends — checked on 20 VODs across 5 channels: every RECORDING one 403, every
ended one 200 (the youngest had ended 2.5 h earlier). The dashboard now
shows "frames not ready yet" for a VOD that is live or ended < 3 h ago and
retries every 2 minutes; a VOD cached while RECORDING is re-fetched on the
next open (its length keeps growing). Angel hit this twice thinking it was
a bug.

## ffmpeg.wasm heap growth (2026-09-16)

The single-threaded core does not give memory back between `exec()` runs;
Angel's whole-VOD transcription died at chunk ~98 with
`RuntimeError: memory access out of bounds`. `lib/video/ffmpeg.ts` now runs
every job through `runJob()`: the instance is terminated and reloaded (from
the cached blob URLs, so no re-download) every 20 jobs, and once more with a
single retry when a job throws a wasm crash (`isWasmCrash`: out of bounds,
unreachable, RuntimeError…). Segment downloads happen before the job so a
retry re-runs only ffmpeg. The caption font is tracked per instance
(`WeakSet`) since a fresh FS is empty. A cached chunk is never redone, so
restarting a bulk run continues where it stopped.

## The embed on a recording VOD (2026-09-16)

The Twitch embed learns a VOD's length when it loads; seeking past it does
nothing and playback stops there, even though the VOD has grown (Angel:
moments after the join point would not play until a refresh). No API grows
it in place, so `TwitchPlayer` recreates the embed with `time=XhYmZs` and
`autoplay` when, in live mode, a seek goes past the length known at
creation (READY's `getDuration()` refines it) or playback reaches it. The
HLS variant playlists grow too: `clipStore.segmentsFor(v, needUntil)`
refetches a playlist whose last segment ends before the range asked for.
Note: the embed never reaches READY in headless Chromium (no H.264), so this
path is verified with the mocked player in `e2e/live.mjs`, not on a real VOD.

## Helix for the home (2026-09-16)

Implicit grant: `id.twitch.tv/oauth2/authorize?response_type=token&client_id&
redirect_uri&scope&state` → back to `redirect_uri#access_token=…&state=…`
(or `#error=access_denied`); the redirect URL must match the registered one
exactly (scheme, host, port, path). `GET id.twitch.tv/oauth2/validate` with
`Authorization: OAuth <token>` → `user_id`, `login`, `expires_in` (Twitch
requires validating hourly). Helix needs `Authorization: Bearer` + `Client-Id`:
`channels/followed?user_id` (paged, `first≤100`), `streams/followed?user_id`
(live follows with `thumbnail_url` `{width}x{height}`), `users?id=…` (100 per
call, `profile_image_url`), `videos?user_id&type=archive&first=1`
(`duration` like `3h2m1s`, `thumbnail_url` with `%{width}x%{height}`). Helix
sends CORS headers, so all of it works from the page. Note: a hash-only URL
change is not a navigation — `handleRedirect` runs from `onMounted`, which is
what Twitch's redirect (a full load) triggers.

## Subscribers-only VODs (2026-09-16)

Angel's player sat on the embed's spinner for 兔兔喵's VOD 2875511531 (in
incognito too). The console said `ErrorAuthorization code 5 -
unauthorized_entitlements` (IVS), and the `PlaybackAccessToken` GQL answer
(`playerType: embed` or `site`, anonymous) has `authorization: { forbidden:
true, reason: "UNAUTHORIZED_ENTITLEMENTS" }` with every quality — 160p to
`chunked` — under `chansub.restricted_bitrates`: the channel keeps past
broadcasts for subscribers. Consequences: the official embed never plays it
for a viewer who is not logged in _inside the iframe_ and subscribed; usher
answers 403 to the playlist, so cutting fails too. `video { status }` is
still `RECORDED` and neither the chat replay nor the storyboard is gated,
which is why the desk looked healthy otherwise. `parsePlaybackAccess` /
`checkPlaybackAccess` (`lib/twitch/hls.ts`) read this; the store exposes
`subOnly`, the desk says so instead of spinning (notice over the player,
VOD-line tag, clip actions locked, no "queue all"). A failed check (network,
endpoint drift) answers null and locks nothing. Not to be worked around —
it is the streamer's setting.

## Why "Storage" stays high after deleting VODs (2026-09-17)

`navigator.storage.estimate()` is the origin's whole footprint: IndexedDB
(VODs, chats, clip blobs, AI results) **plus** the service worker's Cache
Storage (the ~31 MB ffmpeg core, fonts, the precached app shell). And
Chrome's IndexedDB is LevelDB: a delete writes a tombstone, the bytes are
reclaimed on a later background compaction, so the estimate can sit at
the old number for a long time (hours; a reload does not force it).
Angel saw 784 MB after removing every VOD. Settings → Storage now measures
each kind itself (chat JSON size, clip `blob.size`, AI JSON, runtime cache
`content-length`) and clears kind by kind, with a note that the browser's
own total lags. Chrome also exposes `estimate().usageDetails` (indexedDB /
caches / serviceWorkerRegistrations) — non-standard; shown when present.
On a **dev origin** (`localhost:5173`) the total also counts every other
project ever run on that port: `indexedDB.databases()` and `caches.keys()`
reveal them, and Settings lists and clears them as "other data".

## Posting a clip back to Twitch (checked 2026-09-19)

Angel asked whether Hypeline could post its clips to Twitch. Two separate things, and the
distinction is the whole answer:

**You cannot upload video to Twitch.** There is no API for putting a file on the platform —
not a clip, not a VOD, not a highlight. Our captioned 9:16 export can therefore never _become_
a Twitch clip. That wall is permanent as far as the public API goes.

**You can ask Twitch to cut its own clip**, and since December there are two endpoints:

- `POST /helix/clips` (the old one) — live only: "You may only capture clips if the broadcaster
  is streaming." It grabs from the recent live buffer and returns an edit URL. The famous
  60 seconds is the **clip length** cap, not a recency window: "from 5 seconds in length to
  60 seconds in length."
- **Create Clip From VOD** — announced 2025-12-20 in open beta, and now in the API reference
  marked NEW ("Creates a clip from the broadcaster's VOD"). Takes `video_id`, `vod_offset` and
  `duration`, plus an optional `title`, and returns the clip with an edit URL. This is the
  shape Hypeline already has: we know the VOD id and the second the moment starts.

The gate is **authorization, not capability**: `channel:manage:clips` as the broadcaster, or
`editor:manage:clips` as an editor of that channel. So a streamer can do this on their own
VODs; someone clipping a streamer they don't work for cannot, and that is a large share of our
users. It would also need a **write scope** at sign-in, where ours is deliberately read-only
(ADR-19) — a product decision, not a feature flag.

Unverified, and worth a spike before anyone builds on this: the beta had acknowledged
**timing-offset problems** as of 2026-01-08 (`vod_offset` landing a few seconds off the
requested point), which for a tool whose pitch is "the exact moment" is the one bug that
matters; and the docs do not state how far back in a VOD you may clip, nor whether the
5–60 s cap applies to the VOD variant.

Sources: <https://dev.twitch.tv/docs/api/reference/#create-clip>,
<https://dev.twitch.tv/docs/api/clips/>,
<https://discuss.dev.twitch.com/t/introducing-clip-api-improvements-and-clip-from-vod-in-open-beta/64492>.

## A fixed blended layer repaints badly on Android (2026-09-17)

Angel: scrolling back to the top of the dashboard on Android (Brave) left
the heatmap card's title area blank — page background where the text and
the glass should be — until a few more scrolls repainted it. Two page-wide
fixed layers are the suspects: `.hl-grain` (full-screen SVG with
`mix-blend-mode: multiply/screen`) and `.hl-mesh` (a 70 px blur animating
forever). A fixed element with a blend mode puts the whole document on
Chromium's blended compositing path, where stale tiles during fast scroll
are a known artifact, and a `position: sticky` sibling (the pinned player,
now removed) adds another compositing boundary. Under `@media (hover: none)`
the grain drops the blend mode (plain opacity at 55 %) and the mesh stops
animating; desktop is untouched. Not reproducible in headless Chromium, so
this is a mitigation, not a proven fix — recheck on the device.

## Cloudflare's terms on video through a Worker (checked 2026-09-21)

For ADR-16's open question. What is true today, with dates, because this is the
kind of thing that drifts:

- **Section 2.8 is gone.** The "no disproportionate non-HTML content through the
  CDN" rule that everyone quoted was retired in Cloudflare's 2023 terms rewrite.
  Quoting it now is quoting a dead clause.
- **The restriction became service-based.** It moved into the CDN's
  service-specific terms: specific paid services "(e.g., the Developer Platform,
  Images, and Stream)" are what you must use "in order to serve video and other
  large files via the CDN", and Cloudflare reserves the right to disable CDN
  access for serving video without them. So what matters is no longer *what* the
  bytes are but *which service* carries them.
- **Workers is on the allowed list.** The Developer Platform is named. Its own
  service-specific terms say nothing about media; the only relevant clause lets
  Cloudflare limit storage or requests that "would put an undue burden on the
  Cloudflare network" — a throttle, not a prohibition.
- **The two loose ends** are that the clause says *Paid* services (we are on the
  free plan) and that our worker opts segments into the CDN cache
  (`cacheEverything`), which is the surface the clause governs. See ADR-42.

Also measured the same day, against the deployed relay rather than the config:
health endpoint answers; `Origin: https://hypeline.live` is allowed and a foreign
origin gets `403 origin not allowed`; `ALLOW_LOCAL` still passes localhost. The
limiter answers `429 rate limited` on the 118th request — but **only on a single
kept-alive connection**. Fired 900 requests in parallel and not one was refused,
because they came from a rotating pool of egress IPs across several colos, and
the limit is per IP. Worth remembering before concluding from a burst test that a
rate limit is missing: distributed traffic is exactly what it does not stop.

## S7 — emotion axes in chat (spike, 2026-09-21)

Angel's idea: a second layer on the heatmap, one emotion drawn above the centre
and its opposite below, behind a toggle and an axis dropdown. `spikes/s7-sentiment/`
answers the only question that decides whether it is worth building — **is an
emotion curve anything other than a fatter copy of the volume curve?** Method:
15 s buckets, the app's own ±600 s rolling-median baseline, bot badges dropped,
and every pole counted in **distinct users** rather than messages, so one person
spamming PepeHands forty times is one vote (the S3b lesson).

**1. Emotion is independent of volume.** Correlation between a pole's share of
the people talking and the bucket's message count: **−0.14 to +0.19** across
three fixtures and six poles. Not a re-skin. The share of chat feeling something
is simply a different quantity from how much chat is saying.

**2. It finds moments the scorer cannot see, and they are real.** Buckets where a
pole sits well above its own baseline while volume sits at or below its own:
caseoh_ gives 76 for joy, 97 for hype, 60 for letdown, 16 for sorrow. The two
best are worth quoting, because they are exactly the clips a human would cut:

- `00:24:30` — **90 of 130 chatters** posting "W MOM", volume at −0.1× baseline.
- `02:04:15` — **66 of 101 chatters** posting "L DAD", volume at 0.0×.

Chat delivering a unanimous verdict without a rate spike. The current heatmap is
blind to both. `spikes/s7-sentiment/curves.png` shows it: read down the dashed
lines, the volume panel is flat where the emotion panel peaks.

**3. Small chats need a wider window — this is the make-or-break.** Median
distinct users per 15 s bucket: caseoh_ **97**, tokyosims **3**, popkreep_ **2**.
At 15 s the two small fixtures found *literally nothing* on every pole, not
because their chat had no feelings but because four people cannot agree inside
fifteen seconds when only three are talking. Widening the bucket until it holds
~12 users (tokyosims → 60 s, popkreep_ → 90 s) recovered real moments on both.
So the emotion layer needs its own, channel-adaptive time resolution; the hype
heatmap can stay at 15 s, because it only needs messages and one person supplies
those. Corollary: `lift` saturates at log2(1.02/0.02) ≈ 5.7 when the baseline
share is zero, so on sparse data a single user produces a maximal lift — the
crowd floor, not the lift threshold, is what keeps this honest.

**4. Only one axis is universal; one does not exist at all.**

| axis | caseoh_ | tokyosims | popkreep_ | verdict |
| --- | --- | --- | --- | --- |
| joy ↔ sorrow | 448 / 98 buckets | 24 / 0 | 4 / 0 | ship it |
| hype ↔ letdown | 537 / 142 | 3 / 0 | 2 / 0 | offer it; it is W/L culture, and big chats have it |
| dread ↔ relief | 11 / 0 | 0 / 0 | 0 / 0 | **do not build** |

Relief never cleared the threshold on any fixture: 140 tagged users in 110k
messages, zero qualifying buckets. Chat does not *say* relief, it goes quiet or
laughs. Dread exists but is thin, and all three fixtures are Just Chatting — a
horror or competitive VOD would likely show it. Park the axis, do not ship it.

**5. Asymmetry vindicates not subtracting.** Joy outnumbers sorrow 4–5 : 1. Drawn
as separate curves the sorrow lobe is thin and stands out when it appears; as a
difference it would be erased in every bucket by the louder pole. Angel's mirror
was right and the arithmetic underneath it was the part that needed changing.

**6. The app's existing `Mood` classes are cut wrong for this.** `scoring.ts`
already has `MOOD_WORDS`, per-bucket mood and distinct-user counting — most of the
machinery — but `grief` mixes sorrow (sadge, pepehands, rip) with defeat (L,
copium, aware), and `shock` mixes dread (monkaS) with surprise (wtf, omg). Those
split across different axes, so the lexicon has to be re-cut rather than reused,
and `mood` should probably become a projection of the new poles rather than a
second, disagreeing classifier.
