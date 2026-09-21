# 02 — Roadmap

Ordered. Each milestone ends with something usable and a worklog entry.
Check boxes as we go; move items rather than deleting them.

## M0 — Spikes (de-risk before building) — target: a few evenings

Throwaway scripts in `spikes/`, results written to `docs/05-research.md`.

- [x] S1 **CORS from a browser** — done 2026-09-12:
      (a) GQL comments ✅ (b) GQL playback token ✅ (c) usher ❌ no ACAO
      (c2) CDN playlist via storyboard path ❌ no ACAO (d) segment ❌.
      NanoGPT ✅. → ADR-9 (proposed): embed player for viewing, stateless
      CORS shim for bytes.
- [x] S1b **CORS shim spike** — done 2026-09-12: usher ✅ CDN playlist ✅
      segment ✅ (MPEG-TS, ~10 s, 9 MB at source). 60 s window = 7 segs,
      53 MB, 29 s. Use lower variants for preview; source for export.
- [x] S1c **Embed player spike** — works (Angel, 2026-09-12) from
      `http://localhost`. Gotchas: `parent` must be `localhost` or a real
      hostname — `file://` and `127.0.0.1` are rejected with `[NoParent]`.
      Still to check from the deployed origin once M1 is on Pages.
- [x] S2 **Chat volume & paging** — done 2026-09-12 on VOD 2871164819
      (6h24, 500–1000 viewers): 5,626 msgs, ~100 requests, 53 s. Cursor
      paging needs Client-Integrity; **offset paging doesn't** → use offsets.
      Fixture saved. See research doc.
- [x] S3 **Hype scoring prototype** — done 2026-09-12: top 12 peaks, ~10
      real, 6 with literal "clip it" in chat; 2 false positives (broken mic).
      Heatmap rendered. Improvements listed in research doc.
- [x] S3b — done 2026-09-12: caseoh_ (103k msgs, 417/min) and popkreep_
      (2.3k msgs, 10/min). Both work after a crowd-confidence weight;
      "clip it" is channel-dependent; sub/gift events are in the replay;
      parallel offset fetching needed for big VODs. Scoring v0.2 in research doc.
- [ ] S4 **Browser cutting**: fetch ~60s of HLS segments, cut 10s precisely,
      export MP4 via WebCodecs; repeat with ffmpeg.wasm. Note browser support
      and speed.
- [ ] S5 **Transcription round-trip**: extract 60s of audio in-browser, POST
      to NanoGPT `/v1/audio/transcriptions` (whisper-large-v3), get
      timestamps. Note latency and actual cost from the response.
- [ ] S6 **NanoGPT referral mechanics**: confirm current referrer % and the
      referred user's discount, and whether `POST /invitation` lets us generate
      the link programmatically. Write it down with a date.

**M0 exit criteria met 2026-09-12** — all spikes green, ADR-9 accepted.

Exit criteria: S1 answered for the four Twitch hosts; a decision (ADR) on whether a
tiny proxy/extension is needed.

## M1 — Scaffold + hype heatmap (the "oh, that's different" demo)

- [x] Vite + Vue 3 + TS + Tailwind v4 + Pinia + Router + Vitest +
      ESLint/Prettier + PWA plugin (2026-09-12). Reka UI deferred until the
      design pass (Angel: function before form). CI on GitHub Actions: TODO.
- [x] VOD URL/id → metadata via GQL (no Twitch login needed for M1; Helix
      OAuth deferred until a feature needs it).
- [x] Chat replay fetch: offset paging, 8 parallel lanes, de-dup by id,
      tail past `lengthSeconds`, progress + progressive heatmap, IndexedDB
      cache. Runs on the main thread for now (network-bound; 6 h VOD in
      ~4 s). Move to a Worker if scoring 100k+ messages ever janks.
- [x] Hype scoring v0.2 ported to TS with the three fixtures as tests
      (`src/features/hype/scoring.ts`).
- [x] Timeline: SVG heatmap + peak markers + hover readout + playhead +
      click-to-seek. Moment list with reasons and active highlight.
- [x] Player: official Twitch embed, seeks on moment/timeline click,
      reports time back for the playhead.
- [x] Mocked-Twitch e2e smoke test (`pnpm e2e`).
- [x] Angel ran it for real on localhost against live Twitch (2026-09-12):
      works on old VODs **and on a currently-live VOD**.
- [ ] Deploy to Cloudflare/GitHub Pages. Public repo, MIT, README with a GIF.
      **Deferred by Angel (2026-09-13): no publishing until the app is
      complete and working. Keep everything local until then.**
- [x] Landing (`/`): the Masthead (design system). **Dashboard**
      (`/dashboard`, 2026-09-13): VOD input, VODs cached in this browser
      (open / remove), Settings — where the app itself lives. Landing
      declared done 2026-09-14; dashboard rebuilt as Desk + Library the same
      day (`/dashboard/:id?` is the app; `/vod/:id` redirects).

Done when: paste a VOD URL → see the heatmap → click → video jumps there.

## M2 — Cut & export (a real clipping tool)

- [x] In/out via "Set In/Out" at the player time, editable h:mm:ss fields,
      and "clip this" on a moment (15 s before → 30 s after). (2026-09-12)
- [x] In/out range drawn on the timeline with draggable handles, plus a
      sticky zoomed strip around the clip for fine trimming. (2026-09-12)
- [x] Keyboard: I/O set in/out, [ ] jump, ←/→ ±1 s (Shift ±5), J/L ±10 s,
      K/Space play/pause, E export.
- [x] CORS shim moved to `shim/` with Origin allowlist, per-IP rate limit
      (Workers binding or in-isolate fallback), size cap, README. Angel:
      redeploy from `shim/` and set `ALLOWED_ORIGINS`.
- [x] Segment fetch through the shim (quality selectable, 720p default),
      ffmpeg.wasm cut, MP4 export, progress + cancel (ADR-10). Verified in
      headless Chromium with real segments (`pnpm e2e`).
- [x] Aspect presets 16:9 / 9:16 / 1:1 with a crop-centre slider.
- [x] Draggable crop window over the video preview for 9:16 / 1:1.
- [x] "9:16 cam + game" split layout: draggable/resizable facecam box +
      draggable main window over the player, cam-strip height slider,
      `filter_complex` crop/scale/vstack, captions sized to the stacked
      frame. e2e verifies 406×720 output. (2026-09-13)
- [x] Clip library persisted in IndexedDB (schema v2), survives reload.
- [x] Storage: usage readout in Settings; purge per VOD from the home page.
      Quota warning (2026-09-13): banner on home/VOD pages at 70% / 90% or
      < 300 MB free; export refused up front when the estimated clip would
      leave < 100 MB; QuotaExceededError on save → red banner, clip stays in
      memory; chat/VOD caching is best-effort; "Request persistent storage"
      in Settings. e2e `quota.mjs`.
- [ ] Angel: first real export on his machine through his Worker.

Done when: a clipper can produce a vertical clip from a VOD without leaving
the browser or uploading anything.

## M3 — AI layer (BYOK via NanoGPT)

- [x] Onboarding in the AI panel: referral link, paste key, balance shown.
      Provider base URL is a setting (not yet exposed in the UI). (2026-09-13)
      **Angel: set your real referral link in `src/lib/nanogpt/client.ts`
      (`REFERRAL_URL`).**
- [x] Model catalog from `/v1/models?detailed=true` with per-M pricing;
      estimate before every action, reported/estimated cost after; lifetime
      spend shown. Cheap default model auto-picked.
- [x] Per-range transcription (Whisper-Large-V3 default; WAV extracted in
      ffmpeg.wasm), cached in IndexedDB. Word timestamps: not exposed by the
      endpoint docs — revisit when captions need them.
- [x] "Explain this moment": title, hook, why, suggested in/out,
      clip-worthiness 1–5, strict JSON schema; "apply to in/out". Cached
      by prompt version. (ADR-11)
- [x] Captions: transcript → cues (sentence-aware packing, proportional
      timing) → ASS → libass burn-in; presets bold/boxed/top, UPPERCASE
      toggle; 9:16-aware sizing. Verified by e2e frame analysis. (2026-09-13)
      Exact word timing: later (see research S5).
- [x] Thumbnail: frame grab at the playhead or In point, framed like the
      export (16:9 / crop / split), optional title burned in via libass (the
      AI title is one click away), PNG download. Ephemeral — not persisted.
      Verified by e2e pixel check. (2026-09-13) Image-model thumbnails
      (frame + prompt): later, optional.
- [ ] Settings for default models per task (cheap/fast vs best).

Done when: a moment can go from heatmap peak to titled, captioned vertical
clip with two clicks and a visible cost.

## M4 — Search & polish

- [x] Whole-VOD transcription on demand: audio-only variant, 120 s
      chunks, resumable, cancellable, cached; estimate (chunks, $, MB)
      shown up front; optional from/to range. (2026-09-13)
- [x] Natural-language search over the transcript → ranked hits with
      quote, why, confidence; seek and "clip this" from a hit. Chat signal
      isn't in the search prompt yet (the heatmap covers it). (2026-09-13)
- [x] Caption preview overlay on the player (cue at the playhead).
- [x] Batch export (queue, 2026-09-15); export presets (TikTok / Shorts /
      X·Discord / Square); clips gallery at `/clips` with titles, tags, share.
      Keyboard-first workflow: shortcuts exist, a full pass is still open.
- [x] Fallback when the comments endpoint breaks: import a TwitchDownloader
      chat JSON (2026-09-15). Helix Clips density as a weak signal: not done.
- [x] A home on the dashboard: Twitch sign-in (read-only), followed
      channels, live now, latest VODs (2026-09-16, ADR-19). **Angel: register
      the app and put the Client ID in `.env`.**
- [x] i18n: ten languages, first-visit sheet, rail globe (ADR-20, 2026-09-16).
- [x] First-visit tour on an example VOD, re-runnable from Settings (ADR-21, 2026-09-17).
- [ ] Accessibility pass.

## M5 — Community bets (each gets its own ADR before starting)

- [ ] Style clone from a user's exports.
- [x] Live mode, the serverless half (2026-09-15, ADR-17; folded into the
      dashboard 2026-09-16, ADR-18): a channel opens its recording VOD, which
      grows in place; new moments are listed and can notify. A multi-channel feed still needs a server;
      parked with the directory and accounts (Angel, 2026-09-15).
- [ ] Streamer clipping-program directory (could be a static JSON in the repo
      with PR-based contributions — no server needed).
- [ ] Video-model intro cards / B-roll.

## M6 — Design pass (started 2026-09-13)

- [x] Explorations: 10 static boards → technique board → Stripe-style
      thread prototype → 10 thread variations → 9 studies → 9 finalists →
      **Spindle · hue** → 10 compositions → **Masthead**. Sources in
      `design/`, artifacts linked from the worklog.
- [x] Design system written (`docs/08-design-system.md`, ADR-12); tokens
      in `src/style.css`; fonts; atmosphere in the App shell.
- [x] `HypeThread` WebGL component + `thread/series.ts` (tested) fed by
      real scored buckets; timeline and zoom strip use it.
- [x] Landing page rebuilt as the Masthead composition with the example
      thread from the tokyosims fixture.
- [x] VOD page and all panels moved to glass / ink / field utilities.
- [ ] Polish pass with Angel on the real app: panel spacing, moment list,
      AI/search panels, empty states.
- [x] Mobile (2026-09-14): portrait landing (vertical thread, ADR-15) and the
      dashboard as top bar + Library drawer + pinned player + tabs.
- [x] Before launch (probed against the live relay, 2026-09-21):
      `VITE_SHIM_URL` is baked into the Pages build (`relay.hypeline.live`);
      a foreign origin gets 403; the limiter bites at 120/min per IP. All
      three verified from outside, not read off the config. Cloudflare's
      terms: ADR-42 — fine as built; the $5 Workers plan is a lever held
      in reserve for the day real traffic causes a problem.
- [ ] Mobile leftovers: URL pill placeholder on narrow screens; touch
      gestures on the timeline (pinch is wheel-only today).
- [ ] Motion: reveal the real thread when a VOD finishes loading; hover on
      moments lights the peak.
- [x] Offline: the three fonts self-hosted under `public/fonts/` (2026-09-15).

## Upgrade backlog (after design pass — Angel, 2026-09-13)

Working features that need a second pass once the main feature set and the
design are done:

- [ ] **Cam + game split layout**: no live preview — the user drags boxes
      blind and only sees the result after export. Needs a real preview of
      the stacked frame (grab a frame from the segments via ffmpeg into a
      canvas, or a WebCodecs frame) and clearer labels/handles.
- [ ] Crop window (9:16 / 1:1): same — show the cropped result, not just a box.
- [ ] Captions: exact word timing (Elevenlabs-STT or chunked STT); style editor.
- [ ] Search: chat signal in the prompt; finer chunks (30 s) for tighter hits.

## M7 — Emotion axes on the heatmap (spiked 2026-09-21, not yet scheduled)

S7 says the idea works: emotion share is independent of volume (r ≈ 0), and on a
big chat it surfaces dozens of moments the rate scorer is blind to — "W MOM" from
90 of 130 chatters with no volume spike at all. Findings, tables and the caveats
in `docs/05-research.md`; the throwaway is `spikes/s7-sentiment/`.

- [ ] Re-cut the lexicon into poles (the app's `grief`/`shock` split across axes).
- [ ] Channel-adaptive bucket width for the emotion layer: widen until a bucket
      holds ~12 distinct chatters (15 s on caseoh_, 60–90 s on a small channel).
      **This is the make-or-break** — at 15 s the two small fixtures found nothing.
- [ ] Ship **joy ↔ sorrow**; offer **hype ↔ letdown**. Do not build dread ↔ relief:
      relief has no vocabulary (0 qualifying buckets on all three fixtures).
- [ ] Mirror on the heatmap, warm above / cool below, **never subtracted**; the
      hype thread recedes while the layer is on. Centre-anchored drawing means the
      zoom strip and the In/Out handle feet follow.
- [ ] Moments list: a second source alongside the rate peaks, labelled by pole;
      "chat did not know whether to laugh or cry" when both poles are high.
- [ ] Optional, one cheap AI call per VOD: classify the channel's own unknown
      emotes into poles, which is the per-channel drift problem solved for a
      fraction of a cent while everything else stays keyless.
- [ ] ADR before building.

## Parked: "Clip on Twitch" (asked 2026-09-19, not scheduled)

Twitch's **Create Clip From VOD** endpoint (beta since 2025-12-20, now in the reference) would
let Hypeline turn a moment into a real `twitch.tv/clip/…` — `video_id` + `vod_offset` +
`duration`, one browser → Helix call, no relay, no ffmpeg, no upload. It fits the no-backend
rule perfectly and gives something our `.mp4` cannot: a clip that lives on the channel with
Twitch's player, its view count and its feed. Facts and caveats in `docs/05-research.md`
(2026-09-19).

**Why it is parked rather than next.** Two reasons, and the second is the real one:

1. It only works on your own channel, or one you are an editor of (`channel:manage:clips` /
   `editor:manage:clips`), and it needs a write scope where our sign-in is deliberately
   read-only (ADR-19).
2. **The clips streamers care about mostly do not go to Twitch.** Angel, 2026-09-19: the posts
   that grow a channel go to X, TikTok and Instagram, because that is where an audience that
   has not heard of them is. A Twitch clip is for people already on Twitch. He is asking a few
   streamers whether they would use this at all before we spend anything on it — **that answer
   decides whether this milestone exists.**

If it does get built: a second button beside Export, own-channel only, reusing the In/Out
already set, clamped to Twitch's 5–60 s; the captioned vertical export stays exactly as it is,
because it is the one that goes where the growth is. Spike first — the beta's `vod_offset` was
landing a few seconds off in January, which is the one bug this app cannot ship with.

## Parking lot

Ideas we like but aren't scheduling: Tauri desktop build, browser extension
overlay on twitch.tv VOD pages, YouTube/Kick sources, collab/team features,
posting to TikTok/YouTube via their APIs, bounties/payments.
