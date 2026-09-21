# 07 — Worklog

Newest at the bottom. A few lines per session: what changed · blocked · next.

---

## 2026-09-12 — Project kickoff (Angel + Claude)

**What changed.** Explored the Twitch clipping market and landed on a
direction: a free, MIT, browser-only Vue 3 PWA that uses the VOD chat replay
as the hype detector, never uploads, and offers BYOK AI through NanoGPT
(referral link = income). Decided stack (TS, Tailwind + Reka UI, Pinia,
Vitest/Playwright, PWA). Wrote `CLAUDE.md` and `docs/00–07`.

Research: NanoGPT is OpenAI-compatible with STT, image, video, balance,
usage and referral-link endpoints; Whisper is ~$0.0005/min. Twitch chat
replay and VOD playlists are reachable via unofficial GQL; a small Chrome
extension already draws chat-density bars on VOD pages (validates the
signal). CORS behaviour for Twitch GQL/usher/CDN and NanoGPT from a browser
is **unverified** for Twitch; NanoGPT is confirmed browser-callable (Angel
uses it that way in other apps).

**Blocked.** Nothing yet.

**Next.** M0 spikes, starting with S1 (CORS). Its result decides whether
"PWA only" holds or we need a tiny proxy/extension (new ADR). Then S2/S3
on a real chat dump to see if the heatmap finds the moments.

## 2026-09-12 (later) — S1 first run

**What changed.** Ran S1 from localhost. GQL chat replay and playback token
both work from the browser → the heatmap needs no server. usher.ttvnw.net is
CORS-blocked. Added (c2) to the spike: derive the CDN playlist from
`video.seekPreviewsURL` and fetch a segment directly. Research doc updated
with a fallback ladder.

**Blocked.** Playback/segment strategy until (c2)/(d) run.

**Next.** Re-run the spike (c2, d). If CDN is open → ADR-9 "CDN-direct
playback, no usher". If not → ADR-9 picks from the fallback ladder. Then
S2 (full chat dump) — can start in parallel since GQL works.

## 2026-09-12 (later still) — S1 closed

**What changed.** Second run: usher returns 200 with no ACAO; CloudFront
CDN the same (storyboard-derived playlist URL is correct but unreadable).
S1 closed. Wrote ADR-9 (proposed): Twitch embed player for viewing in M1,
stateless open-source CORS shim on Cloudflare Workers for segment bytes in
M2, fetch layer swappable for future no-proxy modes. Added S1b/S1c spikes.

**Blocked.** Nothing. ADR-9 accepted (Cloudflare shim).

**Next.** S1b (shim spike) and S1c (embed seek spike), then S2/S3 (chat
dump + scoring). S2/S3 don't depend on S1b and can go first if preferred.

## 2026-09-12 (evening) — S2 + S3 done

**What changed.** Dumped the full chat of VOD 2871164819 (tokyosims, 6h24,
~15 msg/min) from the cloud shell in 53 s. Found that cursor paging trips
Twitch's integrity check but offset paging doesn't — the browser client
must page by `contentOffsetSeconds` + id de-dup. Wrote a scoring prototype
(rate vs rolling baseline, reaction share, "clip it", unique users); on a
deliberately quiet channel it surfaced ~10 real moments in the top 12, six
of which chat itself labelled "clip that". Rendered a whole-VOD heatmap.
Scripts, fixture and heatmap under `spikes/`.

**Blocked.** Nothing.

**Next.** S3b on a big and a tiny channel (send VOD ids). S1b (shim) and
S1c (embed seek). Then M1 scaffold — the scoring port is the first real
module, with `fixture_2871164819.jsonl` as its first test.

## 2026-09-12 (night) — S3b, S1c done; S1b in progress

**What changed.** Angel verified the tokyosims peaks by eye ("perfect
match"). Ran S2/S3 on caseoh_ (103k msgs) and popkreep_ (2.3k msgs):
scoring holds at both ends after adding bot filtering, a tech-trouble
demotion, a per-user-scaled "clip it" bonus and a crowd-confidence
weight (v0.2, in research doc). Learned: "clip it" is channel-dependent,
sub/gift system messages are in the replay, end-of-VOD is signalled by
`service error`, big VODs need parallel offset fetching. Wrote the S1b
Cloudflare shim (worker.js + wrangler.toml + README) and added shim
routing + a 60 s bandwidth test to the S1 page. Wrote S1c embed spike;
Angel ran it — seek from JS works (parent must be localhost/hostname).
Three fixtures saved under `spikes/s2-chat-dump/`.

**Blocked.** S1b result (Angel deploying the Worker).

**Update, same night.** S1b green through Angel's Worker: playlist,
segments, 60 s = 53 MB / 29 s at source. Segments are MPEG-TS. **M0
closed.** Worker now passes `cf-cache-status` through.

**Next.** **M1 scaffold**: Vite + Vue 3 +
TS + Tailwind + Reka UI + Pinia + Vitest; first module is
`features/hype/scoring.ts` ported from `score.py` with the three fixtures
as tests; then the chat fetcher (Worker, parallel offsets), the timeline
heatmap, and the embed player.

## 2026-09-12 (late) — M1 scaffold built

**What changed.** Angel's rule recorded in CLAUDE.md: function before form,
no design work until he says so. Built the M1 app: Vite + Vue 3 + TS +
Tailwind v4 + Pinia + Router + Vitest + PWA. Modules: `lib/twitch/gql.ts`
(unofficial GQL: VOD info + comments-by-offset, typed errors),
`lib/twitch/chat.ts` (8-lane parallel offset walker, de-dup, tail; exact
match with the Python dump: 5,626 msgs in 3.5 s), `lib/storage/db.ts`
(IndexedDB cache), `features/hype/scoring.ts` (v0.2 port; regression tests
on all three fixtures incl. 100k msgs in 0.6 s), `HypeTimeline.vue`,
`MomentList.vue`, `TwitchPlayer.vue` (official embed, seek + time),
`VodPage.vue`. 16 unit tests green, lint + vue-tsc clean, build 46 kB gz.
Mocked-Twitch Playwright smoke test passes (paste → heatmap → click →
seek → cache hit on reload).

**Blocked.** Nothing. Not yet run in a real browser against live Twitch
(sandbox limitation) — Angel does that first.

**Next.** Angel: `npm install && npm run dev`, open http://localhost:5173,
paste the tokyosims VOD. Then: deploy to Pages (check embed `parent` on
the real hostname), public repo + CI, recent-VODs list. Then M2 (cutting).

## 2026-09-12 (night, part 2) — M2 first slice: cutting works

**What changed.** Angel confirmed M1 works on old and live VODs. Spiked
real segments in Node (S4): TS/H.264/AAC, 10 s, keyframes 2 s, PTS offset
vs VOD time. ADR-10: ffmpeg.wasm single-threaded, fast (copy) + precise
(re-encode) modes. Built `lib/twitch/hls.ts` (playback token, usher URL,
master/variant parsing, range selection; tests on real playlists),
`lib/video/ffmpeg.ts` + `cut.ts` (parallel segment download, TS concat,
ffmpeg exec with crop filter, progress from ffmpeg logs),
`features/settings` (shim URL, quality), `features/clips` (store + panel:
Set In/Out, mode, aspect, crop centre, export, in-page preview, download).
`scripts/copy-ffmpeg-core.mjs` (postinstall) and
`scripts/fetch-e2e-segments.mjs`. e2e `cut.mjs`: fast 15 s clip in ~1.5 s,
precise 9:16 5 s clip in ~3.8 s, both ffprobe-verified. 25 unit tests, lint,
build green.

**Blocked.** Nothing.

**Next.** Angel: `npm install` (postinstall copies the ffmpeg core), set the
Worker URL in Settings, export a clip for real. Then: persist the clip
library, timeline in/out handles, draggable crop over the preview,
harden the shim (Origin lock, rate limit) and move it into `shim/`.
Deploy to Pages + public repo are still pending from M1.

## 2026-09-13 — M2 second slice: it's an editor now

**What changed.** Angel exported two real clips through his Worker (after a
Vite-dev fix: ffmpeg core via blob URLs). Then: clips persist in IndexedDB
(schema v2, `clips` store with a byVod index; loaded when a VOD opens);
timeline shows the in/out range with draggable handles and a second,
zoomed strip around the clip (sticky window so drags don't shift the
mapping); draggable crop window over the player for 9:16 / 1:1; keyboard
shortcuts (I/O/[ ]/arrows/J/K/L/Space/E) via `useShortcuts`; Settings shows
local storage usage. e2e `cut.mjs` now also checks persistence across
reload, handle dragging and the O key. Lint/tests/build green.

**Blocked.** Nothing.

**Next (M2 leftovers).** Purge-per-VOD in Settings; harden + relocate the
shim (`shim/`, Origin lock, rate limit); "webcam corner" two-region layout
later. Then either ship (Pages + public repo + CI) or M3 (NanoGPT).

**Delivery note.** The earlier stale-file incident: after committing, verify
md5 on the device; fall back to writing via device_bash if they differ.

## 2026-09-13 — M3 first slice: BYOK AI on a range

**What changed.** Shim hardened and moved to `shim/` (origin allowlist,
rate limit). M3: `lib/nanogpt` (OpenAI-compatible client: models with
pricing, balance, chat with json_schema, multipart transcription; cost
extraction; typed errors), `pricing.ts` (estimates, default-model pick),
`prompts.ts` (versioned explain prompt + schema + defensive parse),
`lib/video/audio.ts` (16 kHz mono WAV from segments; segment download
shared with cut.ts), IndexedDB v3 `ai` store, `aiStore` + `AiPanel`
(onboarding with referral link, model pickers, transcribe / explain with
estimate → actual cost, apply suggested range, lifetime spend). Settings
now hold key/base URL/models. 34 unit tests; e2e `ai.mjs` mocks NanoGPT and
verifies a real 469 KB WAV upload, schema'd chat call, applied range, and
IndexedDB caching across reload. Lint/build green.

**Angel's rule (2026-09-13).** No GitHub / Cloudflare Pages publishing
until the app is complete. Everything stays local.

**Blocked.** Real NanoGPT run needs Angel's key (never share it with me).
`REFERRAL_URL` placeholder needs his real link.

**Next.** Angel tests transcribe + explain on a real moment. Then M3
leftovers: burned-in captions (needs word timestamps → check whether the
STT endpoint supports `response_format=verbose_json`; else caption by
sentence with even timing), thumbnail via image model, key encryption
option. Then M4 (whole-VOD transcript + natural-language search).

## 2026-09-13 (cont.) — Captions burned in

**What changed.** S5 spike: NanoGPT Whisper has no timestamps; our wasm
core has libass + freetype. Built `lib/video/captions.ts` (sentence-first
packing with tiny-fragment folding, proportional timing, ASS writer with
three styles, post-crop sizing) + tests; `cut.ts` accepts `captions`
(font copied into ffmpeg FS once, `crop,subtitles` chain, forces
re-encode); clip store exposes captions toggle/style/uppercase and derives
cues from the AI store's transcript for the exact range; ClipPanel shows
the controls (disabled until the range is transcribed). e2e `ai.mjs` now
exports a captioned 9:16 clip and checks the frame's caption band. 41 unit
tests, lint/build green. Bundled DejaVu Sans Bold + licence in `public/fonts`.

**Blocked.** Nothing.

**Next.** Thumbnail via image model (frame + prompt) and/or a caption
preview overlay on the player; key encryption option; then M4 (whole-VOD
transcript + natural-language search). Angel: try transcribe → captions →
export on a real moment.

## 2026-09-13 (cont.) — M4 first slice: whole-VOD transcript + search

**What changed.** Found Twitch's `audio_only` variant (S6) and switched all
transcription to it. AI store: `transcribeBulk` (120 s chunks, resumable,
cancel, per-chunk cache, live cost), `bulkEstimate` (chunks/$/MB with
cached ones subtracted), `searchVod` (labelled chunks + strict schema,
100k-token cap), `loadBulk` on VOD open. New `SearchPanel` (from/to,
estimate, progress, query, hits with seek + clip this) and
`CaptionPreview` over the player. Search prompt/schema/parser in
`prompts.ts` with tests. e2e `search.mjs` (real audio extraction, mocked
STT/chat, cache check, reload). Fixture range widened by one segment
(`e2e:fixtures` now fetches 2035–2075). 44 unit tests, all four e2e green.

**Blocked.** Nothing.

**Next.** Real-key run by Angel on a long VOD (watch NanoGPT rate limits
on ~180 sequential STT calls; add small concurrency if fine). Then:
thumbnails (image model), key encryption, purge-per-VOD, and the M5 bets
(style clone, moment feed, streamer directory).

## 2026-09-13 (cont.) — 413 on bulk transcription → MP3 uploads

**What changed.** Angel's first real bulk run hit NanoGPT's 3 MB direct
upload cap (a 120 s WAV is 3.84 MB). Transcription audio is now MP3 16 kHz
mono 32 kbps (~8× smaller, 60 KB per 15 s); `MAX_UPLOAD_BYTES` guard with a
clear message. Both AI e2e tests updated and green.

**Next.** Angel re-runs bulk transcription + search for real.

## 2026-09-13 (cont.) — Split layout + home page

**What changed.** New aspect `split` (9:16, facecam strip on top, main view
below): `splitFilter` builds a `filter_complex` (split → two crops → scale
→ vstack) sized to the source height, even dimensions, clamped boxes;
`SplitOverlay.vue` gives a draggable/resizable cam box and a draggable main
window over the player; cam-strip height slider; captions sized to the
stacked frame. e2e `cut.mjs` exports a split clip (406×720 verified) and
persistence now checks 3 clips. Home page at `/` (placeholder, plain by
Angel's request): VOD input + recent cached VODs with clips/transcript
counts, open and purge. VodPage title links home. 46 unit tests, lint,
build, e2e green.

**Next.** Thumbnail/frame grab with title text; key encryption option;
quota warning; M5 bets (moment feed, streamer directory, style clone) each
need an ADR before starting. Design pass when Angel says so.

## 2026-09-13 (cont.) — Thumbnail frame grab

**What changed.** `lib/video/thumbnail.ts`: downloads the one segment
covering the target second, `-ss` input seek + `-frames:v 1` through the
same crop / split filter graph as the export, optional title via a
`titleAss` ASS style (yellow, bold, outlined, bottom centre, wrapped by
libass; font size = min(9% height, 11% width)). Clip store: `thumbTitle`,
`grabThumbnailAt(vodId, sec)`, result kept in memory only. ClipPanel:
title input, "use AI title" (when Explain matches the range), "Grab frame
at playhead" / "at In", preview + PNG download. Split layout: Angel says it
needs a live preview — parked in the roadmap's Upgrade backlog. 47 unit
tests, lint, build, e2e green (cut.mjs now checks a titled split
thumbnail's size and yellow pixels; saves `e2e/last-thumb.png`).

**Next.** Optional passphrase for the API key; storage quota warning; then
M5 bets need ADRs. Design pass when Angel says so.

## 2026-09-13 (cont.) — Storage quota warning

**What changed.** `lib/storage/quota.ts` (pure helpers, tested):
`quotaLevel` (warn ≥ 70% or < 300 MB free; critical ≥ 90% or < 100 MB),
`wouldExceed` with a 100 MB headroom, `estimateClipBytes` from the variant
bandwidth, `isQuotaError`; `estimateQuota` / `requestPersist` wrappers.
`quotaStore` + `QuotaBanner.vue` on both pages. Clip export checks the
estimate before downloading anything and reports a clear message; a failed
`putClip` keeps the clip in memory and turns the banner red. VOD/chat
caching no longer fails the load when storage is full. Settings shows the
browser quota and a "Request persistent storage" button. Angel: no
passphrase for the API key (decided 2026-09-13) — dropped from the list.
53 unit tests, lint, build, 5 e2e suites green (`e2e/quota.mjs` stubs
`navigator.storage.estimate`).

**Next.** Main features are now all in. Remaining before the design pass:
Angel's real-VOD check of thumbnail + quota; then decide M5 bets (each
needs an ADR) or start the design pass when Angel says so.

## 2026-09-13 — Design pass begins: landing directions

**What changed.** Angel opened the design pass: "genuinely good aesthetics
with pastel colours, unique, not stock". Ten landing-page directions
authored as design-canvas artboards in `design/landing/*.dc.html`
(Heatmap, Riso, ChatLog, Desk, Swiss, Windows, Vertical, Blueprint,
FilmStrip, Sentence) plus an index (`Main.dc.html`) and `canvas.json`;
published as the "Hypeline Landing Directions" canvas. Each board is a
different thesis of what the page is, all on real app facts, one CTA.
The seeded canvas HTML is gitignored (2 MB editor payload).

**Next.** Angel picks a direction (or a mix) → extract a design system
(palette, type, radii, spacing, components) → apply to Home, VOD page,
panels. Motion only after the system is set.

## 2026-09-13 — Design pass: the hype thread, built into the app

**What changed.** After the boards were rejected as flat, a live
technique board, then a Stripe-inspired silk-ribbon prototype where the
heatmap _is_ the ribbon (Angel's idea), then 10 → 9 → 9 thread variations
(chosen: **Spindle · hue**) and 10 compositions (chosen: **Masthead**).
Then built for real: `src/style.css` tokens + glass/ink utilities +
atmosphere; `src/ui/HypeThread.vue` (WebGL, transparent, DPR-capped,
off-screen pause, reduced-motion, CSS fallback) with
`src/ui/thread/series.ts` (resample, smooth, percentile floor, gamma,
per-moment hue families; 5 tests) and `shader.ts`; landing page rebuilt
as the Masthead with `demo/demoSeries.json` generated from the tokyosims
fixture (`scripts/gen-demo-series.ts`, tsx dev dep); `HypeTimeline`
draws the thread under its SVG interaction layer (zoom strip too); all
panels swapped from neutral/blue classes to the system; VodInput has a
pill mode. e2e selectors updated (`svg:not(.hl-grain)`), offline font
loads ignored. Docs: `08-design-system.md`, ADR-12, roadmap M6, CLAUDE.md
rule updated. 58 unit tests, lint, build, 5 e2e suites green.
Design artifacts (claude.ai): landing directions canvas, technique board,
hype thread prototype, variations, studies, finalists, compositions,
masthead. Sources under `design/`.

**Next.** Angel runs it for real (`npm run dev`) and we polish on the
live app: moment list, AI/search panels, mobile, the reveal when a VOD
finishes loading. Self-host fonts for offline. Then M5 bets.

## 2026-09-13 (cont.) — Thread fidelity fix

**What changed.** Angel: "why does the thread look so bad now?" Two
causes: the transparent canvas was blending colour twice (pre-mixed with
paper in the shader, then again with the page) → bleached; and real chat
is noisy → wobbly wire. Fixed: shader outputs pure silk + alpha on
transparent canvases, a cooler back ribbon behind the main one (the fold),
base width 0.045 + 0.24·h, stronger smoothing (landing sigma 22), 3%
taper at both ends, hue follows moments (resting sky between them,
distinct families per top moment), more colour variation across the
width. Docs updated. 58 tests, lint, build, 5 e2e green.

## 2026-09-13 (cont.) — Back to the approved masthead

**What changed.** Angel: "it looks horrible" (side-by-side with the
masthead prototype). Root cause: I had changed the thread's geometry
while chasing real chat data (fat base band, extra back ribbon, other
colour drift) and replaced the scroll reveal with a load animation.
Reverted the shader to the approved numbers; the landing hero is pinned
(280vh) and the thread draws with scroll again, with a "drawn / peaks"
readout; the example thread is the prototype's curated five-moment curve
(`seriesFromPeaks`) with the same card titles; palette anchored so the
strongest moment is petal. Real-data tuning (floor/gamma/smoothing) now
only applies to the VOD timeline. Lesson recorded in the design-system
doc: never change the thread's geometry to fit data — shape the series.

## 2026-09-13 (cont.) — Palette settled; tip fade fixed

**What changed.** The grey smear left of the tip dot was the canvas not
being cleared between frames (alpha accumulating); now cleared, blend off.
Five thread palettes shown on `hypeline-thread-colours.html`; Angel chose
**Stripe silk**, softened ~15% towards white (saturation ×1.05). Shader
palette and the CSS tint tokens updated; design-system doc updated.

## 2026-09-13 (cont.) — Thread behaviour

**What changed.** Tapered thread ends (no cut edge); idle "creature" dot
before the first scroll (breathe, bob, ripple); global mouse parallax
replaced by a spring-driven jelly pull towards the pointer; canvas uniforms
for the pull registered (a reformatted list had hidden the miss); recent
VODs section removed from the landing page. Design-system doc updated.

## 2026-09-13 (cont.) — Ripple on click

**What changed.** Jelly pull removed entirely. Five candidate pointer
interactions on `design/thread/hypeline-thread-interactions.html`; Angel
kept **ripple on click**, now in the app (`shader.ts` `u_click`/`u_clickT`,
`HypeThread` prop `ripple`, `page` on the landing). Lint/tests/build/e2e
green. Idle-dot board `design/thread/hypeline-dot-idle.html` (Heartbeat,
Moon, Drip, Eye, Peek) published for Angel to pick from. **Next:** build
the chosen idle effect, then M6 polish.

## 2026-09-13 (cont.) — Idle dot: Eye

**What changed.** Angel chose **Eye** from the idle-dot board; the idle
breathe/bob/ring is replaced by the eye (glint, looks towards the pointer,
blinks) in `shader.ts` (`u_look`) and `HypeThread.vue`. Lint/tests/build/
e2e green. **Next:** M6 polish on the real app (moment list, AI/search
panels, mobile), reveal of the real thread when a VOD finishes loading.

## 2026-09-13 (cont.) — Dashboard route

**What changed.** Landing stripped to the essentials (Angel): example-VOD
label, drawn/peaks HUD and the settings panel removed; the top-right button
is now a `Dashboard` link. New `/dashboard` (`DashboardPage.vue`): VOD
input, VODs cached in this browser with clip counts (open / remove),
quota banner, Settings. `e2e/quota.mjs` reads the banner and Settings there.
**Next:** M6 polish (the dashboard is plain — give it the same care as the
landing), reveal of the real thread when a VOD finishes loading.

## 2026-09-13 (cont.) — Landing fits one screen

**What changed.** The footer line moved inside the pinned hero and the
trailing section is gone, so the page ends exactly where the thread
finishes (scrollHeight == track height at 1280×800, 1920×1080, 390×844).
Pitch line slightly smaller/wider to clear the axis. All checks green.

## 2026-09-13 (cont.) — Eye at the end; moment-card board

**What changed.** The eye also sits at the tip once the thread is fully
drawn (`u_end` / `endDot` prop, landing only — the VOD timeline keeps no
dot). Board `design/thread/hypeline-moment-cards.html`: 20 designs for the
peak moment cards (Glass … Ribbon) for Angel to narrow down. e2e cut.mjs's
handle-drag check is timing-sensitive under swiftshader (passed on rerun).
**Next:** build the chosen card design; M6 polish.

## 2026-09-13 (cont.) — Moment cards: Tab + Pin

**What changed.** Angel combined Tab (ink meta pill on the top edge) with
Pin (hairline stem + dot on the peak); built on the landing (`HomePage.vue`
cards), stem shortened to 20 px so the tallest card clears the tagline at
1280×800. Design-system doc has the spec. **Bug found via e2e:** the
timeline playhead line sat above the In handle and swallowed the
pointerdown once the player had seeked to In (the earlier "flaky" drag
check was this race) — playhead is now `pointer-events="none"`; the drag
check waits for frames. All checks green.

## 2026-09-13 (cont.) — Card motion board

**What changed.** Angel noticed the card's backdrop blur arrives late on
the landing (the glass layer gets promoted only when the opacity
transition starts). Board `design/thread/hypeline-card-motion.html`: the
Tab + Pin card with 10 entrance/exit animations (Rise fixed, Pin first,
Pop, Unfold, Wipe, Bloom, Lift, Ripple, Type, Stagger); all keep the glass
box pre-promoted (`will-change`) and animate the box/stem/dot separately
from the wrapper. **Next:** build the chosen one on the landing.

## 2026-09-13 (cont.) — Card motion: Stagger

**What changed.** Angel chose **Stagger**; built on the landing (scoped
CSS in `HomePage.vue`, classes `mc`, `mc-box/-tab/-title/-sub/-stem/-dot`).
Blur-arrives-late fixed via `will-change` on the glass box. Reduced motion
honoured. All checks green. **Next:** M6 polish (dashboard, VOD page).

## 2026-09-13 (cont.) — Axis motion board

**What changed.** Board `design/thread/hypeline-axis-motion.html`: 10
scroll-driven animations for the timestamp axis (Reveal, Counter, Cursor,
Rule, Odometer, Magnet, Ruler, Ink, Sweep, Drift), on the landing with the
Tab + Pin cards and Stagger. **Next:** build the chosen one.

## 2026-09-13 (cont.) — Axis: Ruler + Ink + Drift

**What changed.** Built on the landing (`HomePage.vue`: `axis` computed
with per-label colour/dir/edge, `.ax-ticks` + `.ax-lab` scoped CSS).
Labels are positioned by time (not justify-between) so they align with the
ruler; the 6:00 label is dropped when it would collide with 6:24:02.
All checks green.

## 2026-09-13 (cont.) — Axis: Drift → Reveal, + Magnet

**What changed.** On the live landing (Angel): labels now reveal (rise in)
instead of drifting, and the label nearest the tip lifts/scales/bolds
(magnet, `near`/`hot` in the `axis` computed). Ruler ticks and the silk
colours unchanged. All checks green.

## 2026-09-13 (cont.) — 0:00:00 waits for the first scroll

**What changed.** Axis labels (incl. 0:00:00) stay hidden until
`progress > 0.005` (Angel: cleaner first view). All checks green.

## 2026-09-13 (cont.) — CTA entrance board

**What changed.** Board `design/thread/hypeline-cta-entrance.html`: the
pitch, VOD pill and footer stay hidden until the thread is fully drawn
(`progress ≥ 0.985`), then enter with one of 10 animations (Rise, Focus,
Curtain, Words, Pill first, From below, Written, Ripple, Meet, Typed).
**Next:** build the chosen one on the landing (also: the group should
leave again when the user scrolls back up).

## 2026-09-13 (cont.) — CTA: Pill first + silk ribbon

**What changed.** Built on the landing: `.cta` group (`cta-pitch`,
`cta-pill`, `cta-foot`) toggled by `ctaOn` (progress ≥ 0.985); pill
springs open first; a turning conic ribbon of the silk colours rings the
pill. Two gotchas recorded in the design-system doc (Tailwind `translate`
vs `transform`; scoped `position: relative` overriding `absolute`). All
checks green.

## 2026-09-14 — Pill glow ring

**What changed.** The uniform ribbon became a glow ring like Angel's
reference: separate iridescent arcs with gaps, a sharp layer and a blurred
glow layer turning at different speeds/directions. All checks green.

## 2026-09-14 — Thread depth: three sheets, fibres

**What changed.** `silk()` gained `detail/soft/veil`; main composites two
soft hazy sheets behind a sharp, finely threaded front sheet (Angel: like
Stripe — sharp in front, blurred behind, "hundreds of threads"). Card
shadow lightened. All checks green. Previous shader kept in the session
scratchpad only; if Angel dislikes it, the revert is: one `silk()` call
with `detail 1, soft 0, veil 0` and the fibre term removed.

## 2026-09-14 (cont.) — Thread depth v2 (Stripe reference)

**What changed.** Angel: the first depth pass looked worse (grey halos,
ring-like lines). Root cause of the grey: layer compositing mixed rgb by
alpha instead of a straight-alpha over → black edges at low alpha. Fixed
(`over()`), and `silk()` rewritten Stripe-style: smooth bands, streaks
along the flow (coarse + fine, fine only when wide enough), crisp
pixel-based edge in front, soft pale sheets behind. All checks green.

## 2026-09-14 (cont.) — Thread depth v3: one ribbon

**What changed.** Angel: the blurred sheets looked like different colours
from the front. Cause: the noise `phase` also offset the palette. Now all
sheets share colour, and depth is a `focus` field along the ribbon (in
focus = crisp + streaks; receding = soft + paler + back sheets stronger).
All checks green.

## 2026-09-14 (cont.) — Thread depth v4: one continuous ribbon

**What changed.** Angel: gaps between sheets at thin sections, and the
crisp-over-soft edge read as two threads. Layers removed; depth is now
inside the one ribbon (per-edge depth along the length + bands across the
width → local edge softness, streak detail, paleness). All checks green.

## 2026-09-14 (cont.) — Smooth edge

**What changed.** Angel: the ribbon's edge looked polygonal. Series now
16-bit in the texture + Catmull-Rom sampling in the shader (`u_n`). All
checks green.

## 2026-09-14 (cont.) — Landing done; dashboard layouts board

**What changed.** Angel: landing page is done. Board
`design/dashboard/hypeline-dashboard-layouts.html`: 10 dashboard layouts
in the design system (Desk, Studio, Filmstrip, Cards, Focus, Library,
Canvas, Editorial, Console, Split), with a static SVG stand-in for the
thread. Note: the dashboard designs assume the dashboard _is_ the working
surface (VOD input, thread, moments, player, clip, AI, library, settings) —
i.e. it absorbs today's VOD page. **Next:** narrow down with Angel, then
build.

## 2026-09-14 (cont.) — Dashboard built (Desk + Library)

**What changed.** Angel chose Desk + the Library rail. `DashboardPage.vue`
rewritten as the app (absorbs `VodPage.vue`, deleted; `/vod/:id` →
`/dashboard/:id`); `VodInput` gained `compact`; `MomentList` restyled;
timeline markers are ink pins; e2e selectors updated (`section:has-text
("Export clip") ul li`, `/\d+ moments/`, Settings toggle). All checks
green. **Next:** Angel reviews the built dashboard; then M6 leftovers
(mobile pass, reveal of the real thread on load, self-hosted fonts).

## 2026-09-14 (cont.) — Dashboard ribbon + pins to the spine

**What changed.** `HypeTimeline` no longer mounts `HypeThread`; it draws
the clean SVG ribbon from the board (gradient, halo, thread pattern,
spine). Pins now run from the spine to a dot above the peak; zoom windows
normalise the ribbon to their own peak. All checks green.

## 2026-09-14 (cont.) — Interactive timeline

**What changed.** All eight interactions built (hover readout + chat
burst, storyboard frame preview, pins ↔ list, brush, wheel zoom + minimap,
clip/thumbnail marks, peak keys, seek pulse). New: `features/hype/burst.ts`
(+test), `lib/twitch/storyboard.ts` (+test, format noted as observed —
verify on a real VOD through the shim), `HypeTimeline` rewritten (view is
controlled by the parent), `DashboardPage` owns `view`/`hoverMomentId`,
`useShortcuts` gained `jumpPeak`/`selectPeak`. The clip-zoom strip is
gone (main timeline zooms around a selected moment; e2e updated). 64 unit
tests, e2e 5/5. **Next:** Angel tries it on a real VOD — especially the
storyboard preview (needs the shim) and brush feel.

## 2026-09-14 (cont.) — Click = clip; chat lag

**What changed.** Moment rows have no button: a click enters clip mode
(range + seek to In + zoom). Clip windows lead the spike by 10 s (ADR-13,
`CHAT_LAG_SEC`). e2e expectations updated (0:33:50). All checks green.

## 2026-09-14 (cont.) — Moment hover

**What changed.** Hovering a moment row: row lifts + silk bar; on the
timeline a spotlight band over its clip window, a ring from its pin and the
readout above it (`focusMoment` in `HypeTimeline`). Fixed: the earlier
hover wiring in `MomentList` had been lost in a later edit. All checks green.

## 2026-09-14 (cont.) — Night mode

**What changed.** Day / night (ADR-14): tokens + surface vars in
`style.css`, `theme`/`dark`/`toggleTheme` in `settingsStore`, pre-apply in
`index.html`, `ui/ThemeToggle.vue` on the landing and in the rail, shader
`u_dark`, timeline strokes via CSS vars, `bg-lift` surfaces. Gotcha: GLSL
helpers must be declared before use (`paperCol()` above `silk()`). All
checks green.

## 2026-09-14 (cont.) — Theme switch transition

**What changed.** `toggleTheme(origin)` wraps the change in
`document.startViewTransition`; CSS animates `::view-transition-new(root)`
as a growing circle from the toggle. All checks green.

## 2026-09-14 (cont.) — No more flat tops

**What changed.** `seriesFromPeaks` clipped the sum of clustered moments at
1 → flat-topped waves on the dashboard. It now normalises to the tallest
point when the sum exceeds 1 (empty/quiet series untouched). Unit test
added (65). All checks green.

## 2026-09-14 (cont.) — Readout below the spine; ranges drag shut

**What changed.** Hover readout moved under the spine (pins visible).
Brushing a range back to ~nothing, or dragging a handle onto the other,
clears the range (`clear-range` → `clipStore.clearRange()`). All checks
green.

## 2026-09-14 (cont.) — Timeline glides

**What changed.** `HypeTimeline` draws an animated `shown` window that
glides to the parent's `view` (pan + zoom together); wheel/minimap changes
stay instant. Zoom windows use local contrast instead of max-normalisation
(no flat slabs). e2e waits for the glide. All checks green.

## 2026-09-14 (cont.) — Glide: smoother, and always

**What changed.** Easing → smootherstep, 900 ms. Bug: after wheeling
fully out the next selection teleported (a one-shot "instant" flag was
left set when the emitted view equalled the current one). The wheel /
minimap path now writes the shown window directly instead of flagging, so
every parent-driven change glides. All checks green.

## 2026-09-14 (cont.) — Loading choreography; van Wijk glide

**What changed.** `chat.ts` progress reports per-lane coverage; the
timeline (shown from the first batch) tweens its curve between rescores,
reveals the ribbon per lane with scan heads, pops pins in. Glide now uses
van Wijk–Nuij smooth pan-and-zoom so pan and zoom arrive together (Angel).
All checks green.

## 2026-09-14 (cont.) — Scan heads by night

**What changed.** Timeline lights (scan heads, spotlight, seek pulse) use
`--glow`: white by day, lilac by night; scan heads are soft radial ovals
instead of full-height bars. All checks green.

## 2026-09-14 (cont.) — Lane fronts in ink

**What changed.** The loading scan-head glow (white, then lilac) is gone;
each fetch lane's front is now an ink hairline + beating ink dot on the
spine, and the covered ribbon fades out over a soft 22-unit leading edge
(mask) instead of a hard clip. `--glow` stays for spotlight / seek pulse.
Lint, build, unit and e2e green. **Next:** Angel's verdict — remove the
markers entirely if disliked (the fade + tween stay either way).

## 2026-09-14 (cont.) — Finished lanes go solid; stale HomePage resent

**What changed.** Angel liked the ink fronts. Fix: a lane whose fetch has
finished no longer keeps its soft leading edge (all fades vanished at once
when the last lane ended). Also found `HomePage.vue` in Angel's folder was
a stale pre-night-mode copy (no ThemeToggle, `text-white` tab pills) — a
silent stale write; resent and md5-verified. Whole-tree md5 diff showed
nothing else stale.

## 2026-09-14 (cont.) — No flashbang

**What changed.** `index.html` carries an inline `<style>` giving `html` its
ground colour (and `color-scheme`) per `data-theme` before any stylesheet
loads — the app CSS arrives via the module script, so a night reload used
to paint white first. Verified with the CSS blocked: dark paints `#16121a`.

## 2026-09-14 (cont.) — Scroll hint

**What changed.** Landing: `↓ scroll down` under the resting eye, bobbing,
fading out on the first scroll. Checks green.

## 2026-09-14 (cont.) — Playhead clock

**What changed.** `TwitchPlayer.vue` keeps its own clock instead of
forwarding `getCurrentTime()` every 500 ms: a seek moves it at once (the
embed keeps answering the old position while paused, so the bar used to
stick), it runs between polls while playing (emitted at ~30 Hz via rAF, so
the bar glides), polls correct it gently and snap only on a real jump.
Checks green.

## 2026-09-14 (cont.) — Red playhead

**What changed.** Playhead (timeline + minimap) is red via `--color-playhead`.
**Next:** mobile pass on the landing page (thread too compact, cards overlap).

## 2026-09-14 (cont.) — Portrait landing (ADR-15)

**What changed.** Vertical thread on portrait screens: `u_vert` in the
shader, `vertical` prop on `HypeThread` (pointer / click mapped into the
thread frame), and a portrait branch of the landing (cards alternating
sides, left-edge ruler, hint under the eye). Desktop verified unchanged.
Checks green. **Next:** Angel's verdict on a real phone; then the
dashboard on mobile.

## 2026-09-14 (cont.) — Eye / hint alignment

**What changed.** The spine's slow sway is faded out at the thread's ends
(`sway(T)` in the shader) so the resting eye holds still; the hint's tracked
text is padded so the word is centred. Measured: eye 194.7 px, hint 195 px
at 390 px wide. Checks green.

## 2026-09-14 (cont.) — Dashboard on phones; one-line hint

**What changed.** Landing hint is one line (`scroll down ↓`, arrow bobbing
inline) so nothing has to align with the eye. Dashboard: top bar + Library
drawer below `lg`, pinned player + Moments/Clip/AI tabs below `xl`,
moment tap → Clip tab, wheel/keyboard hints hidden on phones. Verified at
390×844 (idle, loaded, clip, AI, drawer). Checks green. **Next:** Angel to
try on a phone; the URL pill placeholder on narrow screens.

## 2026-09-15 — Portrait spacing, pitch copy, brisker silk

**What changed.** Portrait landing: wordmark down to 11 vh, thread span
30–68 %, pill / footer spaced (`portrait:` variants). Pitch copy is now
one line, set in Cinzel (added to the Google Fonts link). The silk's internal clock (colour, waves, focus) runs 1.3× —
the spine sway unchanged. Checks green.

## 2026-09-15 (cont.) — Footer copy

**What changed.** Landing footer ends in "AI" (was "AI with your own NanoGPT key").

## 2026-09-15 (cont.) — Pitch in Gloock

**What changed.** Pitch set in `font-display` (Gloock) like the moment-card titles; Cinzel removed from the fonts link.

## 2026-09-15 (cont.) — Moments box board

**What changed.** `design/dashboard/hypeline-moments-box.html`: ten redesigns of the Moments list (Ledger, Ranked, Cards, Thread strip, Chat quote, Filmstrip, Spine, Heat grid, Dial, Index), day + night. Published as an artifact for Angel to pick from. **Next:** build the chosen one in `MomentList.vue`.

## 2026-09-15 (cont.) — Moments heat grid

**What changed.** Angel picked a mix of board #6 + #8 + #9 (added as #11):
`MomentList.vue` rebuilt as the heat grid with ring meters and storyboard
frames; `silkAt` moved to `src/ui/thread/silk.ts`; the active moment is now
the one inside the clip range (was playhead-only, so a clicked moment never
showed active); `clippedIds` from the clip store; the phone top bar is more
opaque so the VOD card doesn't read through it. Verified with a fake
storyboard sprite (day / night / phone). Checks green.

## 2026-09-15 (cont.) — Readout with a frame

**What changed.** Timeline hover readout: frame beside the text (336 px wide, clamped to the box) instead of above it; it used to overflow the ribbon box and get painted over by the panels below when the shim provided frames. Checks green.

## 2026-09-15 (cont.) — Round pins on phones

**What changed.** Timeline pin dots / ring / lane fronts sized in screen px (ellipses scaled by the box's aspect) with a 28 px hit area; they were squashed to slivers on narrow screens. Checks green.

## 2026-09-15 (cont.) — Forgiving handles

**What changed.** In / Out handle grabs resolved by screen distance (12 px mouse, 26 px touch) with the grab offset kept; the old 12-unit rects were ~4 px on a phone so drags became brushes and lost the range. Verified with synthetic touch pointers at −20 / +10 / +24 / −40 px. Checks green.

## 2026-09-15 (cont.) — Tap a handle to seek

**What changed.** Tapping the In / Out line (within the grab reach, no drag) seeks to that exact second; a drag still moves it. Checks green.

## 2026-09-15 (cont.) — Clip panel board

**What changed.** `design/dashboard/hypeline-clip-panel.html`: ten redesigns of the Clip panel (Ticket, Stepped, Chips, Preview, Ledger, Summary bar, Filmstrip, Card deck, Gauge, Sentence), published as an artifact. **Next:** build the chosen one in `ClipPanel.vue`.

## 2026-09-15 (cont.) — Clip panel: filmstrip

**What changed.** `ClipPanel.vue` rebuilt as board #7: frame handles at In / Out (storyboard or silk), duration on a silk bar, segmented pills instead of selects (`seg`/`seg-opt` in style.css), `frameBackground()` shared with the moment chips. Verified with a fake storyboard; tapping a handle seeks. Checks green.

## 2026-09-15 (cont.) — Clip panel tightened

**What changed.** Removed the In/Out ← playhead buttons; `play from In` moved under the silk bar. Checks green.

## 2026-09-15 (cont.) — AI panel board

**What changed.** `design/dashboard/hypeline-ai-panel.html`: the no-key pastel state (three tints) plus ten redesigns of the AI box (Two acts, Receipt, Card result, Thread, Tabs, Spend meter, Instrument, Editorial, Search first, Deck), published as an artifact. **Next:** build the chosen one across `AiPanel.vue` / `SearchPanel.vue`.

## 2026-09-15 (cont.) — AI panel: instrument

**What changed.** `AiPanel.vue` rebuilt as board #7 and absorbs `SearchPanel.vue` (deleted); the NanoGPT key moved to `SettingsPanel.vue`; no-key state is the pastel card (tint B) linking to Settings (`settings` emit → `openSettings()` in the dashboard). e2e `ai.mjs` / `search.mjs` updated for the new labels. Checks green.

## 2026-09-15 (cont.) — Silk button

**What changed.** `btn-silk` utility (animated pastel gradient) used for Transcribe VOD in the AI panel. Checks green.

## 2026-09-15 (cont.) — All AI actions silk

**What changed.** Transcribe, Explain and Search are `btn-silk` too; the Transcribe-VOD row is always visible (disclosure removed). Checks green.

## 2026-09-15 (cont.) — Silk primaries

**What changed.** Export clip and Find the moments (rail / desk) are `btn-silk`; landing pill keeps ink inside its silk ring. Checks green.

## 2026-09-15 (cont.) — Red ×, settings overlay

**What changed.** Library rail: remove is a red ×, always visible. Settings is a modal over the blurred page (×, backdrop, Escape close it); the inline panel is gone; the AI no-key link opens it. Checks green.

## 2026-09-15 (cont.) — Key remove ×

**What changed.** The NanoGPT key's remove in Settings is the red × too.

## 2026-09-15 (cont.) — Silk ring

**What changed.** `silk-ring` utility (turning pastel hairline) on the rail's library box and Settings button. Checks green.

## 2026-09-15 (cont.) — Pointer cursors, shortcuts popover

**What changed.** Global `cursor: pointer` for pressables; `SHORTCUT_HELP` string replaced by a `SHORTCUTS` table and a `?` popover (`ui/ShortcutsHelp.vue`). Checks green.

## 2026-09-15 (cont.) — Shortcuts win over the embed

**What changed.** The player iframe can't keep focus (blurred on window blur), so shortcuts are consistent. Verified: focus returns to body, `[` seeks after a click on a moment. Checks green.

## 2026-09-15 (cont.) — Relay baked in (ADR-16)

**What changed.** `VITE_SHIM_URL` build default (`DEFAULT_RELAY_URL`), `settings.relayUrl` used everywhere, Settings → Advanced override, no 'shim' wording in the UI; VOD placeholder is `twitch.tv/videos/…`. **Next:** Angel puts his Worker URL in `.env` and sets `ALLOWED_ORIGINS` in `shim/wrangler.toml`.

## 2026-09-15 (cont.) — Storyboard check

**What changed.** Angel saw no frames on a new VOD. Verified the real storyboard format across four channels (matches the parser) and frames end-to-end through a local relay. Likely cause: a VOD cached before `seekPreviewsURL` existed — the store now refreshes such entries; storyboard failures now `console.warn` with the URL/status so the next report is diagnosable.

## 2026-09-15 (cont.) — Scoring v0.3 + sensitivity

**What changed.** Emote walls, moods (laugh / hype / shock / grief / confused) and copypasta as signals with sentence reasons; `sensitivityToOptions` + a slider in the Moments header (6 / 9 / 12 / 18 / 25 peaks). 68 unit tests, e2e green. **Next (Angel's list, in order):** clip preview, batch export + exact trim, transcript-blended scoring, gallery/presets/example VOD, fonts + chat import.

## 2026-09-15 (cont.) — Clip preview

**What changed.** `clipStore.previewClip()` (360p, first 10 s, real framing, ephemeral) + Preview button and player in the Clip panel with a stale marker. Verified on the real tokyosims VOD through a local relay: 9:16 preview in 6 s, 202×360 h264. Checks green.

## 2026-09-15 (cont.) — Export queue; "exact" mode

**What changed.** `exportSpec()` (a frozen range + settings) under
`exportClip()`; a queue (`enqueueCurrent`, `enqueueMoments`, `runQueue`,
`dequeue`, `clearQueueDone`) with per-job progress, one bar, download all;
"queue all moments" on the Moments box. Exact trim: a smart cut
(re-encode to the next keyframe + copy + concat) was tried natively — it
decodes cleanly in ffmpeg but the concatenated MP4 carries one SPS for two
different encodes, which browsers may not play; not shipped. Instead the
existing re-encode is labelled **exact** and fast says **±2 s**. Verified
the queue end-to-end on fixture segments (2 clips, no errors). Checks green.

## 2026-09-15 (cont.) — Transcript-blended scoring

**What changed.** `features/hype/speech.ts` (per-chunk boost 0.85–1.35 + quoted phrase), `scoreBuckets(..., speech)`, `vodStore.setSpeech` fed by the AI store on every transcript change. 70 unit tests, e2e green.

## 2026-09-15 (cont.) — Gallery, presets, example VOD

**What changed.** `/clips` gallery (`GalleryPage.vue`; `listAllClips`,
`updateClipMeta`; `StoredClip.title/tags`; Web Share with the file where
supported), rail link with the count, export presets in the Clip panel,
"copy title & hook" in the AI instrument, "Try it with an example stream"
on the empty desk. 70 unit tests, 5/5 e2e. **Next:** self-hosted fonts +
chat-JSON import fallback, then the i18n and support buttons.

## 2026-09-15 (cont.) — Self-hosted fonts + chat-file import

**What changed.** Gloock / Manrope / JetBrains Mono served from `public/fonts/`
(39 woff2 subsets, 448 KB; `src/fonts.css` keeps Google's unicode-ranges;
latin + latin-ext precached, the rest runtime-cached; two preloads in
`index.html`; Google Fonts gone). `lib/twitch/chatImport.ts` parses
TwitchDownloader JSON (both shapes, or a bare array); `vodStore.importChat`
attaches it to the requested VOD (or the one in the file), builds a VodInfo
from the file if Twitch can't be asked, and caches it like a fetch. Buttons:
in the error banner and on the empty desk. 74 unit tests, 6/6 e2e
(`e2e/import.mjs` new). **Next:** explain the three parked ideas to Angel,
then i18n + support buttons.

## 2026-09-15 (cont.) — Live mode

**What changed.** Angel picked the serverless half of the moment feed.
`lib/twitch/irc.ts` (anonymous IRC over WebSocket, tags → ChatMessage,
reconnect), `fetchLiveInfo` (stream + recording VOD), `features/live`
(store: scoring from the join, warm-up, min score, feed, notifications,
title badge; page: status card, live timeline, feed, second-screen aside),
`?t=` landing on the dashboard, `twitch.tv/<channel>` accepted by the VOD
input. Verified on xqc for 5 min: two real moments, two notifications while
hidden. 84 unit tests, 7/7 e2e (`e2e/live.mjs` mocks GQL + the WebSocket
with a faked clock). **Parked for good (Angel):** multi-channel feed,
streamer directory, accounts. **Next:** i18n (10 languages), then the
support overlay.

## 2026-09-15 (cont.) — Frames on live VODs

**What changed.** Angel's missing frames were a VOD whose stream was still
on: Twitch serves the storyboard only after the stream ends. `VodInfo.status`
from GQL; the VOD card says "live now" (links to live mode) and "frames not
ready yet" (retry every 2 min); VODs cached while recording are re-fetched.
Verified: quin69 (live) → note, kentakey_live (ended 2.5 h) → 12 framed
chips. 84 unit tests, e2e unchanged.

## 2026-09-15 (cont.) — Live mode: stream end → VOD

**What changed.** Angel came back to a blank live page after the stream
ended (the dev server's HMR had remounted the page with the store stopped,
and the offline state had nothing to say). Now: a stream that ends while
watched flips the store to `ended` and the page replaces itself with the
dashboard on that VOD; returning to the tab re-checks the stream at once
(not only on the 60 s timer); the page restarts an idle store on mount; the
offline / idle card always says something. Covered in `e2e/live.mjs` and
the store test.

## 2026-09-15 (cont.) — Moment card

**What changed.** The truncated caption under the heat grid is replaced by a
popover card per moment (frame, time, rank, all reasons, counts), teleported
and fixed-positioned; tap-to-open + "Clip this moment" on touch screens.
Verified on desktop (both themes, frames through the relay) and on a phone
viewport with touch. 84 unit tests, 7/7 e2e.

## 2026-09-15 (cont.) — No edge stripes

**What changed.** Angel: coloured left borders read as generated. The moment
card's silk moved into a tinted drop shadow + the chips' 3 px foot under the
frame; the live feed rows use an 8 px silk dot. Rule added to the design
system.

## 2026-09-15 (cont.) — Night on true black (trial)

**What changed.** Night ground `#000`, ground-2 `#0c0a0f`, lift `#2a2333`,
glass-sm darker, `index.html` pre-paint and PWA colours black, the thread
shader's dark paper black. Old values noted in the design system for a
revert if Angel prefers the plum.

## 2026-09-16 — AI moments on the heatmap

**What changed.** Transcript-search hits become `Moment`s (`source: 'ai'`,
score = confidence, query + quote) in `aiStore.aiMoments`; the dashboard
merges them with chat's for the timeline, the grid, the active/hover logic,
peak jumping and "queue all"; accent pins / AI chips / card and readout
variants; `clipAnchor()` in clipStore; clear link in the AI panel. Covered
by `e2e/search.mjs` (chip, pin, card, In = 0:33:45). 84 unit, 7/7 e2e.

## 2026-09-16 (cont.) — Transcription on the heatmap

**What changed.** `aiStore.bulk.current` (the chunk in flight);
`HypeTimeline` `transcript` prop → coverage band, target range, scanning
light + breathing segment; wired from the dashboard. `e2e/search.mjs` holds
the STT mock 1.5 s and checks the scan appears and the band remains.

## 2026-09-16 (cont.) — ffmpeg crash on long transcriptions

**What changed.** `runJob()` in `lib/video/ffmpeg.ts` (recycle every 20
jobs, reload + one retry on a wasm crash), audio / cut / thumbnail wrapped,
font per instance. 4 new unit tests (88). 7/7 e2e (real ffmpeg in cut, ai,
search).

## 2026-09-16 (cont.) — Silk ring on the player

**What changed.** `silk-ring` on both player wrappers in `DashboardPage.vue`.

## 2026-09-16 (cont.) — Moments header

**What changed.** "Moments" is an ink `h2` like the other panels; the
sensitivity slider is bigger (132 × 6 px track, 18 px thumb, ink-2 labels).

## 2026-09-16 (cont.) — Live merged into the dashboard

**What changed.** ADR-18. `vodStore` live mode (IRC append past the replay,
growing length + live edge, rescoring, "new while live" feed, notifications,
stop on stream end); `openChannel` resolves a channel to its recording VOD
(with retries) and the landing sends `?channel=`; `HypeTimeline` `liveEdge`
prop replaces `live`; `/live` redirects; `features/live/` deleted.
`e2e/live.mjs` rewritten for the dashboard; verified on a real live channel
(length and messages growing, edge shown). 86 unit tests, 7/7 e2e.

## 2026-09-16 (cont.) — Live edge marker

**What changed.** The edge blinked because the fractional edge ran past the
whole-second length; it is clamped now. Marker is a dashed full-height line,
a bigger dot and a red `● LIVE` pill.

## 2026-09-16 (cont.) — Thicker ring on the player

**What changed.** `silk-ring` reads its width from `--ring-w` (default
1.5 px); the player frames set 3 px.

## 2026-09-16 (cont.) — Silk frame

**What changed.** `silk-frame` utility (padded silk pad under a clipped
child) replaces `silk-ring` on the player frames: no dark corner pixels.

## 2026-09-16 (cont.) — Playing past the join point while live

**What changed.** `TwitchPlayer` `live` + `lengthSeconds` props: the embed is
recreated at the target second when a seek or playback runs past what it
loaded; `segmentsFor` refetches a grown playlist for cutting. Covered in
`e2e/live.mjs` (reload at the edge, reload on a seek past it).

## 2026-09-16 (cont.) — The home + rail home button

**What changed.** ADR-19: `lib/twitch/helix.ts` (implicit grant, validate,
follows, live, avatars, latest VOD per channel), `twitchStore`, the home on
the empty desk (invitation / connected view with live + VOD cards), the rail
home button, `vodStore.reset()` so `/dashboard` is always the home.
`.env.example` documents `VITE_TWITCH_CLIENT_ID`. 4 unit tests (90), new
`e2e/home.mjs` (8/8 e2e). **Angel:** register the app at
dev.twitch.tv/console with redirect `http://localhost:5173/dashboard`, put
the Client ID in `.env`, restart the dev server.

## 2026-09-16 (cont.) — Storyboard failures visible

**What changed.** Angel saw no frames on a finished VOD; the storyboard
fetches fine here (direct and through his relay) so the cause is in his
browser. `loadStoryboard` now throws `StoryboardError` (HTTP status /
"could not reach the video relay" / bad format); the VOD line shows
`no frames (reason) · retry` when it is not the fresh-VOD case, and the
2-minute retry runs for every failure.

## 2026-09-16 (cont.) — Subscribers-only VODs say so

**What changed.** The "player stuck loading" was Twitch gating the VOD
behind a sub (research entry). `checkPlaybackAccess` runs alongside every
load (non-blocking); `vodStore.subOnly` drives `SubOnlyNotice` over the
player (paper card on the black box: eyebrow, headline with the streamer,
"watch on Twitch ↗"), a `subscribers only` tag in the VOD line, the locked
Export / Preview / + Queue / thumbnail buttons with a one-line reason, and
hides "queue all". 3 unit tests (93), new `e2e/subonly.mjs` (9/9 e2e).
Angel's relay issue turned out to be a browser extension (fine in
incognito); he cleared the Settings override. **Next:** i18n button, then
the support overlay.

## 2026-09-16 (cont.) — Ten languages (ADR-20)

**What changed.** `vue-i18n` with every string extracted (429 keys, one
namespace per file, `locales/en.json` is the source); nine machine-drafted catalogs
(`docs/09-languages.md` lists them and how to correct them); the
first-visit sheet and the rail globe (`src/ui/LanguageSheet.vue`,
`LanguageMenu.vue`); `<html lang>` follows; `scripts/check-locales.mjs`.
Two rail hints that were glued from pieces became whole messages. Every
e2e suite seeds `hypeline.locale = en`; new `e2e/i18n.mjs` (German first
visit, live preview, stored choice, globe to 日本語 and back, pt-PT → pt-BR,
zh-HK → zh-TW, returning visitor). 93 unit, 10/10 e2e. **Next:** the
support overlay (feature request / bug / question → GitHub).

## 2026-09-17 — Live labels fit in every language

**What changed.** Angel (Spanish): the heatmap's live pill wrapped to two
lines and its dot went oval, and the VOD line's dot touched the word. The
pill no longer wraps (`white-space: nowrap`, dot `flex: none`) and the
VOD-line dot has a 5 px right margin. Checked against the Spanish live
fixture; lint, live/i18n/smoke e2e green. **Next:** the support overlay.

## 2026-09-17 (cont.) — The mark

**What changed.** Angel asked for a logo to replace the rail's wordmark
(space for a coming button). Ten candidates, then five variations of the
"H Spine"; he chose **serif feet**. `src/ui/Logo.vue` (ink via
`currentColor`, silk gradient, per-instance ids) sits in the dashboard rail
and small-screen header in place of "Hypeline" (link keeps `aria-label`);
the gallery shows mark + wordmark. Favicon `public/icons/mark.svg` (dark-
aware), PNG app icons 192/512/apple-touch/maskable rendered from the tile
form, manifest icons filled in. smoke/home/i18n e2e green. **Next:** the
support overlay.

## 2026-09-17 (cont.) — The mark moves

**What changed.** Five hover motions offered (rise, shimmer, trace,
handles, beat); Angel chose **Handles**. `Logo.vue` gained a `hover` prop:
stems close in, peak tightens, keyed to the enclosing link's hover/focus,
off under reduced motion. Rail (both sizes) and gallery links use it.
Lint/build clean; verified in the preview that the rail mark moves on
hover. **Next:** the support overlay.

## 2026-09-17 (cont.) — The "?" and its three doors

**What changed.** `SupportButton.vue` in every rail/header beside the globe;
`lib/support.ts` builds prefilled GitHub new-issue links (feature / bug /
question) from `VITE_GITHUB_REPO` (placeholder `your-name/hypeline` until
the repo exists — `.env.example`), bug reports carry a non-personal context
block (`__APP_VERSION__` from package.json via vite `define`). Issue forms
in `.github/ISSUE_TEMPLATE/` match the links (the `context` field is what
the app prefills). `support.*` strings in all ten catalogs. 2 unit tests
(95), `e2e/support.mjs` (11/11 e2e). **Angel, when the repo exists:** set
`VITE_GITHUB_REPO=owner/repo` in `.env`, push `.github/` with the app, and
enable Issues; nothing else to do.

## 2026-09-17 (cont.) — The tour and the example VOD (ADR-21)

**What changed.** `features/tour/` (store + overlay), `features/vod/
example.ts` (generated 90-min sample stream, six chat bursts → 12 moments,
0 bot drops), `vodStore.load('example')` short-circuits to it and caches
it; `isExample` locks ClipPanel/AiPanel with a reason and swaps the player
for a black card; five `data-tour` anchors on the desk; first-visit start
after the language sheet; Settings row "Show the tour"; × on the example
sends the desk home. `example.*` and `tour.*` strings in all ten catalogs.
`e2e/tour.mjs` (desktop + 390 px phone: every card inside the viewport,
tabs follow the steps, Done persists, Settings restarts, delete works);
every suite seeds `hypeline.tour.v1 = done`. 95 unit, 12/12 e2e. The
"try an example stream" link on the home now opens this example (the real
tokyosims VOD is still the design fixture in tests).

## 2026-09-17 (cont.) — Rounded tour hole

**What changed.** The veil was four rectangles, so the hole's corners were
square under the rounded ring; it is now one veil with a rounded-rect mask
subtracted (`mask-composite: exclude` / `-webkit-mask-composite: xor`),
animated via mask-position/size. tour e2e green.

## 2026-09-17 (cont.) — Settings → Storage

**What changed.** Angel: 784 MB "used" after deleting every VOD (research
entry: caches + LevelDB compaction lag). `lib/storage/cleanup.ts`:
`storageBreakdown()` (VODs & chats, clips, AI results, app cache — count
and bytes, measured directly) and `clearVods/Clips/Ai/AppCache`,
`eraseEverything` (settings and key kept); `db.ts` gained
`listAllChat/listAllAi/clearStore`, lost `storageUsage`. Settings shows
the four rows with per-kind Clear, the browser total, the lag note, and a
two-click "Erase everything"; clearing the open VOD sends the desk home;
the dashboard re-reads the library when Settings closes. `storage.*`
strings in ten languages; smoke e2e covers the flow. 95 unit, 12/12 e2e.

## 2026-09-17 (cont.) — Storage: what is not ours

**What changed.** Angel still saw 784 MB with every row at 0 KB (dev
origin `localhost:5173`, no service worker). The section now also lists
**other data on this site** — IndexedDB databases and caches that are not
Hypeline's (other dev projects on the same port) — with its own Clear, and
prints Chrome's `usageDetails` split (caches / indexedDB / service worker)
when the browser offers it, so the lag case and the foreign-data case tell
themselves apart. "Erase everything" drops the foreign data too. smoke +
quota e2e green.

## 2026-09-17 (cont.) — Four phone fixes

**What changed.** From Angel's Android screenshots. (1) Dark-mode overlays
lightened instead of dimming: new `--scrim*` tokens (ink by day, black by
night) behind the rail drawer, settings, tour, language and help sheets.
(2) The player no longer sticks below `xl`; the tab strip sticks instead
and `showPlayer()` scrolls the video back when a moment sends you to Clip.
(3) The tour's phone sheet flips to the top when the target sits low (it
covered the AI panel), and steps scroll the target's top under the sticky
bars; measured on a 412 px viewport: 0 % of each target covered (the rail
drawer fills the screen, 22 %). (4) Heatmap blanking on scroll: `.hl-grain`
loses its blend mode and `.hl-mesh` its animation on touch devices
(research entry) — mitigation, Angel to recheck. 95 unit, 12/12 e2e.

## 2026-09-17 (cont.) — The tour owns the drawer

**What changed.** Re-taking the tour on a phone left the rail drawer open
over the desk (Settings lives inside it there), so step 1 pointed at the
heatmap from behind the drawer. Each step now declares the whole desk —
tab _and_ drawer (`desk(tab, rail)`) — and `TourOverlay` stops re-applying
the current step once the tour ends, which was re-opening the drawer on
Done. `e2e/tour.mjs` covers the phone re-take: drawer closed on step 1,
the hole on the heatmap, the rail step re-opens it, Done closes it. Angel
confirms the cut-heatmap artifact is gone on the device.

## 2026-09-17 (cont.) — Two fingers on the ribbon

**What changed.** Phones had no way to zoom the heatmap (the wheel path is
mouse/trackpad only). `HypeTimeline` now tracks touches in the **capture**
phase (the moment pins stop propagation, so a finger on one was invisible)
and pinches: distance sets the span, the midpoint's content point stays
put, so two fingers zoom and pan in one gesture. The gesture cancels the
brush it interrupted and suppresses taps — including the pin the fingers
lift over, which used to fire `select` and re-zoom the view — until the
next gesture's first finger. New `e2e/pinch.mjs` drives real two-finger
touches over CDP: spread zooms in, two fingers together pan without
changing the zoom, squeeze returns to the whole VOD, no page scroll, no
accidental pick, and a single tap still works right after. 95 unit,
13/13 e2e.

## 2026-09-17 (cont.) — Installable, update toast, referral, repo

**What changed.** ADR-22: `lib/pwa.ts` + `InstallChip` (rail, only when the
browser offers it, "not now" remembered) + `UpdateToast` (bottom paper
toast; Reload or Later — `registerType` moved from `autoUpdate` to
`prompt`), strings in ten catalogs, `e2e/pwa.mjs`. ADR-23: the real
referral link, framed as the 5 % discount it gives, in Settings and on the
AI no-key card. The repo now exists
(https://github.com/Angel-Casas/Hypeline): `VITE_GITHUB_REPO` defaults to
it, so the "?" links work out of the box; new public `README.md`, `LICENSE`
(MIT © 2026 Angel Casas), `_to_delete`/`*.tgz`/`Claude outputs/` ignored.
The working folder is now a git repo on `main` with `origin` set and one
initial commit (245 files, author Angel Casas); Angel pushes it himself.
95 unit, 14/14 e2e.

## 2026-09-17 (cont.) — hypeline.live

**What changed.** The app has a home: `README.md` opens with
[hypeline.live](https://hypeline.live) (badge + a line under the title, and
a closing link), `package.json` gained `homepage`/`repository`,
`.env.example` names the real OAuth redirect. For a static host:
`public/CNAME` and `scripts/spa-fallback.mjs` (copies `index.html` to
`404.html` after the build) so `/dashboard/<vod>` and the Twitch redirect
survive a hard load. **Blocked/next:** the domain resolves to GitHub Pages
but 404s — nothing is published yet (the repo is still local, and Pages
needs an Actions workflow to build a Vite app).

## 2026-09-17 (cont.) — Pages needs a workflow

**What changed.** Angel pushed and set Pages' source to GitHub Actions, but
the Actions tab was empty and the domain still 404'd: Pages builds only
Jekyll, so with that source _something_ has to produce the site.
`.github/workflows/deploy.yml` does it on every push to `main` (and on
demand): checkout, Node 22 with an npm cache, `npm ci`, **lint, unit
tests**, `npm run build`, then `upload-pages-artifact` + `deploy-pages`
with the `pages`/`id-token` permissions and a `pages` concurrency group.
`VITE_SHIM_URL` and `VITE_TWITCH_CLIENT_ID` come from repository
_variables_ (public values, not secrets); `VITE_GITHUB_REPO` is
`github.repository`. Verified `npm ci` + the ffmpeg postinstall from a
clean tree. **Angel:** add the two variables, then push (or run the
workflow by hand) — the first green run publishes hypeline.live.

## 2026-09-17 (cont.) — The relay, before the crowd

**What changed.** ADR-24. `shim/wrangler.toml`: `ALLOWED_ORIGINS` =
hypeline.live, new `ALLOW_LOCAL` for dev and phones, `[[ratelimits]]`
binding (the stable syntax; the old `[[unsafe.bindings]]` form is gone) at
120/min. `worker.js`: the local-origin matcher, a `/` and `/health` route
that answers 200 without an Origin, and an honest User-Agent pointing at
the repo. New `shim/worker.test.mjs` (5 tests) is in `npm test` — vitest's
include now covers `shim/*.test.mjs`. `shim/README.md` rewritten: what the
gate is and is not, the curl-gets-403 gotcha, and the custom-domain path.
100 unit tests. **Angel:** `cd shim && wrangler deploy`; optionally move
the zone to Cloudflare for `relay.hypeline.live`, then update the
`VITE_SHIM_URL` repository variable.

## 2026-09-17 (cont.) — Why the first real export broke

**What changed.** ADR-25. `lib/video/ffmpeg.ts` loads the core through its
own `blobUrl` instead of `@ffmpeg/util`'s `toBlobURL`: gzip on GitHub Pages
made `Content-Length` disagree with the streamed bytes, and the library's
fallback re-read a drained body — the `body stream already read` error
Angel hit on the first export from hypeline.live. New
`lib/video/coreSize.ts` (`CORE_WASM_BYTES`, rewritten by
`scripts/copy-ffmpeg-core.mjs`) keeps the progress bar honest behind gzip.
Storyboards now take Twitch's 220×124 level rather than 160×90, so the
moment cards are sharp. Verified by serving `dist/` gzipped and running the
old and new code side by side (old threw Angel's exact error, new got all
32,232,419 bytes) and then the full cut e2e against that server: fast 16:9,
precise 9:16 and split all exported. 101 unit tests, lint and build clean.
**Angel:** nothing to do; ships with the next push. Still open: the
nameserver move, then `relay.hypeline.live` and `VITE_SHIM_URL`.

## 2026-09-17 (cont.) — The update toast, before the reload

**What changed.** ADR-26. The toast never appeared on its own because
nothing ever asked the service worker to look: `lib/pwa.ts` now holds the
registration and calls `update()` every 15 minutes, on tab focus, and on
`online`, throttled to one check a minute and skipped while offline.
`e2e/pwa.mjs` gained a real-worker section — install, reload into its
control, append to `dist/sw.js` as a stand-in deploy, and the untouched tab
raises the toast without reloading. 101 unit tests, lint and build clean.
**Angel:** after this ships, the _next_ deploy is the one an open tab will
announce by itself.

## 2026-09-17 (cont.) — hypeline.live moved to Cloudflare

**What changed.** The zone is on Cloudflare's nameservers (major/aisha),
with the four GitHub Pages A records and the `www` CNAME intact and
**unproxied** — verified from outside: both apex and `www` still answer 200
from `server: GitHub.com` with no `cf-ray`, so Pages keeps managing its own
certificate. The email records are gone (unused). `shim/wrangler.toml` now
declares `relay.hypeline.live` as a `[[routes]]` custom domain, so
`wrangler deploy` creates the route and its DNS record itself; `shim/README.md`
and `.env.example` follow. **Angel:** `cd shim && wrangler deploy`, check
`https://relay.hypeline.live/health`, then set the `VITE_SHIM_URL`
repository variable to `https://relay.hypeline.live` and re-run the deploy
workflow. **Careful:** deploying the custom domain switched the
`*.workers.dev` URL off (wrangler disables it unless `workers_dev = true` is
in the file), so it 404s and the live build has no relay until the variable
is updated — deploy and rebuild in one sitting. Verified from outside:
`relay.hypeline.live/health` 200, `origin not allowed` for other sites,
`host not allowed` for non-Twitch URLs.

## 2026-09-17 (cont.) — The clip panel stops eating the screen

**What changed.** ADR-27. New `ui/MenuButton.vue` (value pill + teleported
paper menu, clamped to the viewport, arrow keys, Escape); `ClipPanel` now
spends one wrapped line on settings instead of five rows, with the crop
sliders living inside the shape menu and the thumbnail fields inside theirs.
`MomentList`'s grid is capped and scrolls on desktop, and follows the
selection. Default cut mode is `precise`. Ten catalogs gained `sizeLabel`,
`cutLabel`, `shapeLabel`, `capsLabel`, `thumbLabel`, `captionsOn/Off`,
`thumbSet/None` (488 strings each). `e2e/cut.mjs` and `e2e/ai.mjs` drive the
menus through a `pickSetting` helper and `cut.mjs` now asks for `fast`
explicitly. 101 unit tests, 14/14 e2e, lint and build clean. Measured in the
real dashboard: settings row 65 px at 1440 and above, 100 px at 1280, from
~170 px before. The five mocks Angel chose from are in
`design/clips/clip-controls.html`.

## 2026-09-17 (cont.) — The moments grid, uncramped

**What changed.** ADR-28, correcting ADR-27's cap. The chips grid now takes
its own content height (`flex: 0 1 auto`, `align-content: start`,
`grid-auto-rows: max-content`) inside a `min-h-0 flex-1` list, so it fills
the column instead of huddling in 216 px of a 745 px card, and rows can no
longer be squeezed into each other — which is what made the chips overlap in
Angel's screenshot. Measured in the dashboard at 1800×1150: grid 466 px of a
745 px card, rows at their full 61 px, no scrollbar; the hint sits under the
last chip. 101 unit tests, e2e green, lint and build clean.

## 2026-09-17 (cont.) — A black icon and a readable drawer

**What changed.** The maskable icon was drawn on `#0c0a0f`, so the installed
app's launcher icon and Android's splash showed a faintly purple square on
the app's true black; its background is pure black now (the mark is
untouched — a linear stretch sending the old background to 0). The
apple-touch icon was transparent, which renders inconsistently, so it is
baked onto black too. New `sheet` utility in `src/style.css` for panels that
float over the page: 86 % `--color-ground` plus a 24 px blur, near-opaque in
both themes — 94 % first, eased back a notch because it read as flat
(Angel). The settings modal keeps its own 94 %. The rail drawer below `lg` and `ShortcutsHelp` use it, and the
drawer's scrim blur went from 2 px to 6 px — the drawer was `glass` over
live content and unreadable (Angel, screenshot). At `lg` the rail is a
column on the page background and keeps the glass. `docs/08-design-system.md`
now says which of the two to reach for. 101 unit tests, e2e green.

## 2026-09-17 (cont.) — The drawer really is translucent now

**What changed.** Two goes at this were wrong because I measured the panel's
`background-color` rather than what gets painted: the scrim is _between_ the
page and the drawer, so at 58 % it halved the page before the drawer's own
transparency saw it, and 94 % then 86 % both came out as flat black. The
panel and its scrim are now one pair of tokens, `--sheet-bg` and
`--sheet-scrim`, set per theme — night 76 % over a 40 % scrim, day 88 % over
32 %, since paper shows dark bleed-through much more readily than black
shows bright. Verified from screenshots in both themes: the heatmap ghosts
through the night drawer, the player is a soft grey wash behind the day one,
and the text stays crisp in both. `docs/08-design-system.md` records the
trap. 101 unit tests, e2e green.

## 2026-09-18 — Chat vocabulary

**What changed.** ADR-29, a whole vertical slice. New
`features/hype/vocabulary.ts` (pure model: two lists, nine language packs,
merge, matching, `seenTokens`, `detectPacks`) and `vocabStore.ts`
(persisted, global + per-channel). `scoring.ts` threads a `Vocabulary`
through with a `NO_VOCAB` default, so nothing that existed behaves
differently. New `VocabularyOverlay.vue` behind a button beside the
sensitivity slider: two chip lists with shipped words removable rather than
deleted, what this VOD actually said with one tap to add, starter packs
with "Detect from this VOD", a live before/after strip, and export/import.
534 strings per catalog, ten catalogs. 111 unit tests (10 new), new
`e2e/vocab.mjs`, 15/15 e2e suites, lint and build clean.

Two findings worth the note in `docs/05-research.md`: ranking a VOD's words
by total users surfaces stopwords, so the list ranks by _people within one
15 s window_ and drops anything spread across more than 60 % of the VOD;
and `hahaha` in two packs made an English chat detect as German _and_
Turkish, so detection now uses only each pack's distinctive terms.
Verified end to end on a flat-rate Spanish chat where only the words change
at four points: the English lists surface 1 of the 4, the Spanish pack
surfaces all 4. **Angel:** nothing to do; ships with the next push.

## 2026-09-18 (cont.) — The silk ring, without the grey

**What changed.** The ring's four `transparent` arcs are gone: it now turns
petal → apricot → butter → sky → lilac and back through pale tints of the
palette, with one gap left at the seam that fades to a transparent _petal_
rather than plain transparent. Two causes of the grey, both now named in
`docs/08-design-system.md`: the faint hairline underneath showed through
every gap, and sRGB fades to `transparent` desaturate, so the bright arcs
greyed at both ends as well. One block in `src/style.css`, so every ring
follows — the button, the player frame, the moment chips, the tour hole.
Checked in both themes on the real dashboard; 111 tests and the e2e suites
that touch the ring are green. The four options Angel chose from are in
`design/ring/silk-ring.html`.

## 2026-09-18 (cont.) — The vocabulary panel, and where the grey came from

**What changed.** The vocabulary overlay is now the layout Angel asked for:
no eyebrow, titled **"Adapt the heatmap to your chat"**, with Important
words and Reactions sharing the top row, "Seen in this VOD" beside a new
**"Most used words"** (`topTokens` — plain frequency, the companion to the
people-at-once ranking), then the starter packs and the before/after strip.
Deletable words and packs all wear a still slice of the one silk gradient,
and a chosen thing is marked mint rather than violet. Ten catalogs gained
`vocab.most.*` and lost the unused `vocab.eyebrow`.

Underneath it, ADR-30: the light theme's scrims dimmed towards black, which
is what had been greying every overlay in the app, and `--color-muted` is
no longer a grey. Two tokens in `src/style.css`, so settings, the tour and
the rail drawer are fixed by the same change.

**Trap worth remembering.** The panel's theme tokens were first written as
`:global([data-theme='dark']) .vocab`, which compiles to `[data-theme=dark]`
with the class silently dropped — the night values landed on `<html>` and
the day rule overrode them. Night ran day colours and looked grey; the
screenshot said so and the CSS looked innocent. Theme-varying tokens go in
`style.css`.

**Checked.** 111 unit tests, all 15 e2e suites, `check-locales` (536
strings × 10), lint and build green; both themes reviewed from screenshots
of the dashboard, the settings sheet and the panel, including its selected
state. **Next:** Angel has 5 local commits to push.

## 2026-09-18 (cont.) — Warm silk, cool silk, and English gets a switch

**What changed.** The vocabulary panel's rings now carry meaning (ADR-31):
warm for everything Hypeline shipped, cool for the words this user added,
which change nothing but their edge. Both animate. The mint selection colour
is gone; `--pick` is the warm silk's own hue, kept for the plain controls
that have no ring.

Inputs have a visible border again — `--field-line` was white at 95 %, which
was an inset highlight back when fields sat on tinted glass and is invisible
on the whitened page from ADR-30.

English is no longer "always on". It is a switch like the other nine packs,
on by default, and turning it off actually reaches `scoring.ts` — as does
the × on each shipped English word, which until today was a picture. 114
unit tests (3 new), all 15 e2e suites green, both themes checked from
screenshots including the English-off state. **Next:** Angel has 7 commits
to push.

## 2026-09-18 (cont.) — Hover, standardised

**What changed.** ADR-32: four hover tiers (`hover-wash`, `hover-lift`,
`hover-line`, `hover-danger`) on one accent wash, built into the shared
primitives so most components get one for free, and every ad-hoc ink wash in
the app replaced. No hover is a grey any more, and several that had quietly
become no-ops when `--color-muted` became ink are real again.

`e2e/_hover.mjs` is new and is the useful half: it asks the CSSOM which
`:hover` rules would match every visible control on five screens and reports
the ones that would do nothing. First run: 56. It caught the "Erase
everything" button (no style at all), the active library row and the
sensitivity thumb — none of which anyone would have noticed by clicking
around. Both themes now report "all covered".

114 tests, all 15 e2e suites, lint and build green. **Next:** Angel has 8
commits to push.

## 2026-09-18 (cont.) — The hover becomes an inversion

**What changed.** Angel rejected the accent violet from ADR-32, so I mocked
seven hovers on the real elements (`design/hover/inversion.html`) and he
chose straight inversion with the wipe. ADR-33: `hover-invert` — ink fills,
content becomes the paper, and the fill sweeps in from the left over 220 ms.
The other tiers keep their shape and lose the accent.

**Three traps, all caught by screenshots rather than by reading the CSS.**
`overflow: hidden` on the fill zeroed the flex rows' automatic minimum size
and squashed them to half height; nested buttons disappeared into their row's
fill until they inverted with it (and invert _back_ when hovered themselves);
and the pack chips went blank because Tailwind's `@utility` output is layered
while Vue scoped styles are not, so the components' own `color` won.

114 tests, all 15 e2e suites, lint and build green; `e2e/_hover.mjs` reports
"all covered" in both themes. **Next:** Angel has 9 commits to push.

## 2026-09-18 (cont.) — The wipe, rebuilt on the right mechanism

**What changed.** Angel found three faults in the inversion — square corners
that rounded off mid-sweep, a fill that showed outside the element's border,
and a radius that did not match it — all of which were properties of doing it
with a transformed pseudo-element. ADR-34 rebuilds it as the element's own
`background-image` grown from 0 % to 100 % width. Same look, none of the
faults, and it works on `<input>` too.

Four more things fell out of it: components on this path may not use the
`background` shorthand (it erases the fill); the rules had to leave
`@layer utilities`, so `hover-invert` is a plain class now; `glass-sm`,
`btn-ghost` and `hover-invert` share one selector list, having already
drifted (the Clips card inverted its background but not its text); and the
label's colour flip is delayed so it happens while the fill is under it.

The vocabulary chips and packs now have plain ink borders that invert with
them — a gradient edge cannot. Only the user's own words keep a silk ring.

Separately, `btn-silk`'s drift no longer jumps: the ramp ended on lilac
having started on sky, and `silk-drift` shifts by exactly one gradient width.
`e2e/_loop.mjs` renders the seam both ways and diffs it — zero pixels.

114 tests, 15 e2e suites, lint and build green; the hover audit still says
"all covered" in both themes. **Next:** Angel has 10 commits to push.

## 2026-09-18 (cont.) — The hover, fourth time: frost and the silk edge

**What changed.** Three rounds of colour-fill hovers were all rejected, so I
mocked ten techniques that mostly leave the surface alone
(`design/hover/ten.html`); Angel kept the silk edge and frost, and picked
them combined from the follow-up (`design/hover/edges.html`). ADR-35:
`hover-frost` — the glass thickens and the silk ring fades in over the
hairline. No fill, no text colour change, so all the descendant and
re-inversion machinery is gone.

**What the screenshots caught.** The first cut whitened the _night_ theme
(the film has to move towards each theme's own ground); a frost cannot
whiten an already-white panel, so it needed a top highlight and a pane
shadow to read at all on the vocabulary boxes; and an element that already
wears a ring got nothing, so those now thicken their own ring instead of
growing a second one. The vocabulary chips took their warm silk back, since
a gradient edge no longer has to invert with anything.

114 tests, 15 e2e suites, lint and build green; the hover audit reports "all
covered" in both themes. **Next:** Angel has 11 commits to push.

## 2026-09-18 (cont.) — The rings were frozen, and the frost overshot the ring

**What changed.** Two things Angel spotted in one screenshot. The frost's
fill painted to the border box while the ring sits on the padding box, so a
hairline of white showed _outside_ the ring and the button read as having two
borders; `background-clip: padding-box` makes the ring the edge.

And the default silk rings had stopped turning. The animation was running and
`--silk-a` was advancing — but the gradient lived in a token declared on
`:root`, and a custom property's `var()`s are substituted where they are
declared, so every ring was painting the angle frozen at `:root`'s initial
0deg. ADR-36: the tokens hold the colour stops, each use site writes its own
`conic-gradient(from var(--silk-a), …)`. The hover rings animate too, which
is what Angel asked for alongside.

Proved with two frames two seconds apart, diffed: max channel difference went
from **0** to **151**, resting and hovered, both themes. The hover audit reads
rules rather than pixels and could never have caught this.

114 tests, 15 e2e suites, lint and build green. **Next:** Angel has 12 commits
to push.

## 2026-09-18 (cont.) — The suggestion lists stop suggesting grammar

**What changed.** ADR-37: a ten-language `STOPWORDS` set filters articles,
pronouns, copulas, prepositions and conjunctions — plus bare numbers — out of
"Seen in this VOD" and "Most used words". Not out of the scoring, and not out
of what a user may type: it is a suggestion filter. Emotes are never touched.
Negations, question words and intensifiers stay, because Twitch means them.

On the example VOD the lists went from `is / that / it / did` to `good / song
/ what / nice / first / time / chat / brazil`.

Also: the kind label is separated from the word by a dash now, and the
`YOURS` tag is gone from user-added chips — the cool ring already said it.

118 tests (4 new), 15 e2e suites, lint and build green.

## 2026-09-18 (cont.) — Detection answers, and stops undoing your choices

**What changed.** ADR-38. "Detect from this VOD" now says which packs it
turned on, or that they were already on, or that no other language stood out
— the last being the common case on an English chat, and the reason the
button looked broken. It also **adds** to the enabled packs instead of
replacing them: pressing detect used to silently switch off a pack the user
had chosen by hand.

118 tests, 15 e2e suites (vocab.mjs now checks the message, including on a
second press), lint, build and locale parity green.

## 2026-09-18 (cont.) — A flicker over the video, and truncated words on phones

**What changed.** ADR-39: while the embed is playing, `<html>` carries
`data-playing` and the page's atmosphere steps out of the compositor's way —
the grain stops blending and the mesh stops animating. A fixed full-screen
`mix-blend-mode` layer over a video repainting 60 times a second is the
heaviest case of the blended-compositing trap this file already described for
touch devices, and it showed up as a huge translucent rectangle flickering
over the dashboard, gone on pause. `smoke.mjs` now asserts all three states.

Also: on screens under 640 px the "– WORD" / "– EMOTE" aside is hidden in the
two token lists. It was what pushed the word itself into an ellipsis, and a
truncated word is useless — you cannot tell what you would be adding
(Angel, 2026-09-18). Measured at 390 px: 8 truncated words before, 0 after.

118 tests, 15 e2e suites, lint, build and the hover audit green.

## 2026-09-18 (cont.) — The mark, revised, and handles that end

**What changed.** Four small things Angel asked for, and one that followed
from them.

The mark: the peak sits 2 units lower, and the silk ramp ends on **sky**
instead of butter. Yellow arriving at a stem drawn in `currentColor` — near
white at night — had nowhere to land; blue reads on both grounds. The README
now opens with the mark, as `docs/assets/logo-{light,dark}.svg` behind a
`<picture>`; GitHub cannot render a Vue component and gives an embedded SVG
no page CSS, so it is two files, one per ink, kept in step by hand.

The landing subtitle is one string now: **"Turn Twitch VODs into memorable
moments ready to clip"**. `landing.tagline1/2/3` are gone from all ten
catalogs (537 strings each, parity green).

Then Angel noticed what the mark was actually saying: the stems around the
peak are a clip's In and Out. So the timeline's **In / Out handles now wear
the same serif feet** — inset 4 px from the ribbon's edges, a 14 px foot at
each end. A line running off the top and bottom read as a cut _through_ the
ribbon; a capped stem reads as the clip's edge. I left the playhead full
height at first, on the theory that a position is not a boundary; Angel
wanted them to match, and he is right — the mixed treatment read as an
oversight, not a distinction. So the playhead and the live edge wear the feet
too, and the selection's ink wash now starts and ends at the feet instead of
running the ribbon's full height. Nothing vertical on the ribbon runs off its
top or bottom any more; the playhead stays apart by weight (2 px against
1.5 px), which is enough.

Two traps worth remembering: duplicate SVG gradient `id`s in one document
collide and the first wins (it cost a render that showed the "after" mark
still ending in yellow — the exact trap `Logo.vue`'s own comment describes),
and `vector-effect` is **not** an inherited property, so it belongs on every
`<line>` rather than the wrapping `<g>`.

118 tests, 15 e2e suites, lint, build and locale parity green.

## 2026-09-18 (cont.) — Choosing a model out of six hundred

**What changed.** ADR-40: the chat model now opens a panel instead of a `<select>` — search,
families with counts, prices per million tokens, the model's id and month, six sorts and a
filter per family, arrows and Enter from the search box. Angel asked for the shape of the
picker in his other NanoGPT app; it arrives here in ink and silk rather than brand colours,
which was his call on seeing the options.

The family a model belongs to is read off its id (`lib/nanogpt/catalog.ts`, pure and unit
tested against a slice of the real catalogue), because NanoGPT's `/v1/models` has no provider
field. `ModelInfo` gained `created`, which the rows show as "Nov 2025". The speech model keeps
its select: three options need no search.

Two things the screenshots caught that the code did not: a `width: 100%` row with side margins
overflows its parent, which pushed the recommended row's tick off a phone screen; and a dashed
keyboard cursor sitting on row one of an untouched list reads as a selection, so the cursor now
starts nowhere and appears when you type or press a key.

131 tests (13 new), 15 e2e suites, lint, build and locale parity (555 strings) green.

## 2026-09-18 (cont.) — Getting a key, in three steps

**What changed.** Settings told people to "create an account, add a few dollars, copy an API
key" in one run-on sentence with a single link. Most users have never done any of those things,
so it is a numbered list now: open nano-gpt.com and create an account — or skip it, NanoGPT
works without one — top up the wallet with a card, Apple or Google Pay or crypto, then open the
API page, create a key, and paste it below. The two links sit in the two steps that need them;
`API_KEYS_URL` is `https://nano-gpt.com/api`, checked against the page itself and written down
in `docs/05-research.md` with the date, since that is exactly the kind of URL that moves.

`settings.createAccount` and `settings.keyOutro` are gone from all ten catalogs, replaced by
`keyStep1..3` and the two link labels; `keyIntro` lost the clause that used to run into the old
link. 558 strings each. `quota.mjs` (which already opens Settings) checks the three steps and
the API link.

131 tests, 15 e2e suites, lint, build and locale parity green.

## 2026-09-18 (cont.) — The rail follows you to the gallery

**What changed.** ADR-41: the library rail is `src/ui/LibraryRail.vue` now, and the clips
gallery wears it. Opening a clip from the rail used to drop you on a page with no rail, no
library and no settings — reached from the rail, and then nothing to go back to but a button
(Angel, 2026-09-18).

The component owns the top bar, the drawer, the library, storage and the settings overlay,
and emits rather than acts: the dashboard loads a VOD in place, the gallery routes to it. Four
methods are exposed for the two things the page really does drive — the tour opening the drawer
to point at it, and the AI card opening Settings. The dashboard shed ~120 lines of template and
eight imports in the move, and both pages share one grid.

`cut.mjs` now walks the loop that was broken: export clips, follow the rail's Clips link, find
the VOD still listed in the rail there, click it, and land back on the desk with it open.

131 tests, 15 e2e suites, lint, build and locale parity (557 strings, `gallery.dashboard`
retired) green.

## 2026-09-19 — The icons caught up with the mark, and a list that would not scroll

**What changed.** Two things Angel found.

The logo revision on the 18th changed `Logo.vue` and the README, and nothing else: the favicon,
both PWA icons, the Apple touch icon and the maskable tile were hand-made copies of the old
mark and still carried the high peak and the yellow tip — the very tip the revision existed to
remove. They are generated now: `scripts/render-icons.mjs` reads the component's own template,
lifts the gradient and the paths out of it, and writes all seven files; `npm run icons:check`
fails when any of them has drifted. The tile it draws was measured off the icons it replaces
(ring's outer edge 0.375 in, outer radius 16.8 of 64, mark at 66 %), so the set Angel approved
on the 17th is intact and only the wave moved. `vocab.mjs` joined the `e2e` script while I was
in there; it had been missing since it was written.

The model picker could not be scrolled on a phone: `.models` is a column flex item, and without
`min-height: 0` its automatic minimum size is its content, so the list never shrank to the sheet
— measured at **2207 px of list inside a 688 px sheet**, clipped by the sheet's own overflow,
leaving the page behind as the only thing that moved under a finger. With that one line the
list gets 481 px and scrolls; `overscroll-behavior: contain` on the list, the filters and the
scrim stops a flick that reaches the end from taking the page with it.

131 tests, 15 e2e suites, lint, build and locale parity green.

## 2026-09-19 (cont.) — The tour ran under the settings overlay

**What changed.** Re-taking the tour from Settings left the settings overlay open on a phone
about two times in three, so the spotlight pointed at a step nobody could see (Angel).

It was a race I introduced when Settings moved into `LibraryRail`: the dashboard's
`tour.requested` watcher runs before the rail's (a parent registers its watchers before its
child's), it calls `tour.start()`, and `start()` clears `requested` — so the rail's watcher read
`false` and did nothing. It only worked when the example VOD was not ready yet, which is the one
case that leaves the flag set.

The fix is a condition rather than an ordering: the overlay renders on `showSettings &&
!tour.active`, so no sequence of flags can put it over the tour, and the watcher now takes both
`requested` and `active` so the state is cleared either way. `tour.mjs` asserts the overlay is
gone on the phone pass — it reproduced the bug on the first run, which is how I knew it was this
and not the drawer.

131 tests, 15 e2e suites, lint, build and locale parity green.

## 2026-09-19 (cont.) — Could we post clips to Twitch? (research only)

**What changed.** Nothing in the app. Angel asked whether Hypeline could post its clips to
Twitch; the answer is written down in `docs/05-research.md` and parked on the roadmap before it
goes stale.

Short version: you cannot upload video to Twitch at all, so our captioned export can never
_become_ a Twitch clip — but **Create Clip From VOD** (beta since 2025-12-20, now in the
reference) takes `video_id` + `vod_offset` + `duration`, which is exactly what we hold. One
browser → Helix call, no relay, no ffmpeg, no upload: it fits the no-backend rule better than
anything else we could add. The gate is authorization — own channel or an editor of it, and a
write scope where ADR-19 keeps us read-only.

It is parked, not scheduled, and the reason is Angel's rather than mine: **most clips streamers
post do not go to Twitch.** They go to X, TikTok and Instagram, where an audience that has not
heard of them is. A Twitch clip reaches people already on Twitch. He is asking a few streamers
whether they would use it at all, and that answer decides whether the milestone exists.

Also noted for whoever builds it: the beta's `vod_offset` was landing a few seconds off the
requested point as of 2026-01-08. For an app whose pitch is "the exact moment", that is the one
bug it cannot ship with — spike it first.

## 2026-09-19 (cont.) — Icons that an installed app will actually pick up

**What changed.** Angel had to delete and reinstall the PWA to see the new mark, and asked
whether that is simply how it is. On iOS, yes — Safari copies the icon at "add to home screen"
and never looks again. Everywhere else it is our fault, not the platform's: an installed PWA is
re-checked by comparing the **manifest**, and ours still said `icons/icon-512.png` before and
after, so there was nothing to notice. Chrome on Android checks at most once a day and re-mints
the WebAPK when the manifest differs; it never differed.

The app icons are content-hashed now (`icon-512.673a0732.png`). `scripts/render-icons.mjs`
writes the names into `scripts/icons.generated.json`, deletes the previous hashes, and
`vite.config.ts` reads that one file for both the manifest and the `<link>` tags it injects into
`index.html` — so the HTML and the manifest cannot disagree, and neither can be edited by hand
into disagreeing. Verified by faking a mark change end to end: every hash moved, `icons:check`
failed until the icons were re-rendered, reverting restored the exact previous filenames.

`e2e/pwa.mjs` now fetches the manifest and the page and fails if any referenced icon is
unhashed or 404s. iOS still costs a reinstall; that one is beyond us and is written down.

131 tests, 15 e2e suites, lint, build and locale parity green.

## 2026-09-19 (cont.) — The link has a face now

**What changed.** Angel has started sending hypeline.live to streamers to try, and the page had
no description and no social tags at all — just a `<title>`. Pasted into Discord, X or a group
chat it unfurled as a bare URL: no card, no image, no line saying what it is, for a tool people
are being asked to open on trust.

`scripts/render-icons.mjs` now also renders the card (1200×630) from the same mark: night
ground, the mark beside the Gloock wordmark, the landing's own "Turn Twitch VODs into memorable
moments ready to clip", and the thread as a silk bar along the bottom. Fonts are embedded as
data URIs so the render never depends on the network, and the file is content-hashed like the
icons. `index.html` carries the copy; `vite.config.ts` injects `og:image` and `twitter:image`
absolute, because an unfurler has no page to resolve a relative path against. Two
`theme-color` metas so mobile browser chrome matches the theme a first visit would pick.

`e2e/pwa.mjs` now also fails if the card tags are missing, if the description is gone, or if
either social image 404s.

131 tests, 15 e2e suites, lint, build and locale parity green.

## 2026-09-21 — the pre-launch item was already done

Angel said he had exported fine from his phone, which did not match my claim that
the video relay was unwired. He was right and the roadmap was stale. Probed the
live site and the live relay instead of reading config: `hypeline.live`'s bundle
carries `https://relay.hypeline.live` as the baked default, a foreign origin is
refused 403, and the limiter cuts in at 120/min per IP. Ticked the item with the
method, so the next person does not re-doubt it.

The burst test nearly produced a second wrong claim: 900 parallel requests drew
no 429 at all, because our egress rotates across half a dozen IPs and the limit is
per IP. Only a single kept-alive connection showed the limiter working. Noted in
the research doc.

That leaves ADR-16's last clause, the Cloudflare terms, which had genuinely not
been checked. Section 2.8 is retired; the rule is service-based now and Workers
is on the allowed list, so the relay's shape is right. Two loose ends — the free
plan against a clause that says _paid_, and our own `cacheEverything`, which puts
Twitch's segments in the CDN cache. ADR-42 proposes the $5 plan and names the
free alternative. Angel decides.

Next: sentiment axes on the heatmap — spike first on the three fixtures.

## 2026-09-21b — S7: the emotion layer is real, with one condition

Spiked Angel's sentiment idea before building any of it. Three fixtures, poles
counted in distinct users, compared against the app's own baseline method.

It works. Emotion share correlates with volume at roughly zero, and on caseoh_ it
turns up 76 joy / 97 hype / 60 letdown buckets that the rate scorer cannot see.
The showpiece: 90 of 130 chatters posting "W MOM" while volume sat _below_
baseline. That is a clip, and today we miss it.

The condition is density. Median chatters per 15 s bucket: caseoh_ 97, tokyosims
3, popkreep_ 2 — and at 15 s both small fixtures found nothing at all on every
pole. Widening to 60–90 s recovered them. So the layer needs a channel-adaptive
window of its own while the heatmap keeps 15 s.

Also settled by data rather than taste: dread ↔ relief should not be built —
relief has no vocabulary, 0 qualifying buckets anywhere. And the app's existing
`Mood` classes cut across the axes, so the lexicon gets re-cut rather than reused.

Roadmap now carries M7 with the findings; nothing in `src/` has moved.

Next: ADR for M7, then the lexicon and the adaptive bucket.

## 2026-09-21c — S7c: dread lives, relief was mislabelled

Angel sent an xqc VOD (GTA, not horror — he corrected me while it was
downloading). 241,195 messages over 11.5 hours, 353 a minute, 71 chatters per
15 s bucket: our densest fixture by a wide margin, and the first one where the
crowd floor is never the binding constraint.

Dread is real. 11 volume-invisible buckets, the best of them 15 of 41 chatters
posting `ohno` while volume sat at **half** its baseline. That is the layer's
strongest case so far: some emotions make chat quieter, and a rate scorer is
structurally blind to those.

Relief is real too, and is not what I called it. The pole is almost entirely the
word `finally` — "FINALLY JAIL RP", 15 of 147 — which is impatience resolved,
not fear released. Right signal, wrong pairing; the ADR decides whether dread
goes unpaired or the axis becomes Dread ↔ Payoff.

Also found and fixed a lexicon bug with a general moral: `ez` was in relief and
is 2,801 taunts in this VOD alone. Tokens need checking against a big reactive
chat before they are trusted, language packs included.

Caveat recorded: joy's correlation with volume is 0.34 here versus ~0.05 on the
smaller fixtures, so S7's "independent of volume" is size-dependent.

Next: the M7 ADR.

## 2026-09-21d — M7 built: the chat-mood layer

`features/hype/emotion.ts` (pure, 19 tests against the real fixtures), the
mirrored layer on the timeline, the axis control, emotion moments folded into the
one ranked list, and ten locales. ADR-43 has the reasoning; two decisions were
Angel's: the third axis ships as **Dread ↔ Payoff** rather than pretending relief
is dread's opposite, and emotion moments merge into the existing list rather than
getting their own.

The e2e is the part worth keeping. Its fixture is a chat so quiet the rate scorer
scores every bucket zero and finds **no moments at all**; the only thing that
changes all hour is what chat says, and in two windows the room tenses up and
_halves_ its message rate. With the layer off: 0 moments. With it on: three on
joy ↔ sorrow, two on dread ↔ payoff, both reading "chat said less, but was on
edge — 6 of 6". Every moment it finds is one the app could not have found
yesterday, and it exercises bucket widening on the way (90s steps, and the
control says so).

Two things fixed by looking rather than reasoning. The first fixture was a pure
emote wall, which the _existing_ mood term already catches — the test was proving
nothing until it got quieter. And in the first render the thread kept its silk
while the layer was on, so its lower half read as the lower pole, directly under a
label saying otherwise; it is greyed now.

150 unit tests, 16 e2e suites, hover, locales (574 × 10), icons, lint and build
all green.

Next: per-language pole packs, and folding `scoring.ts`'s `mood` into the poles.

## 2026-09-21e — the mood layer, rebuilt in the app's own language

Angel looked at it and was right: the layer was a foreign chart sitting on top of
the app rather than part of it. Flat fills, stepped edges, its own palette. It is
now the hype ribbon's twin — same silk, same halo/fill/sheen, same smooth curve,
sampled between bucket centres — and the only thing that differs is that its two
edges are two different poles, so the asymmetry carries the meaning. The thread
survives underneath at 13 % and greyed.

Two follow-on changes he asked for, both right. The ribbon's pins now belong to
the chosen mood; the rate peaks keep their place in the list at a third opacity,
still ranked, still clickable. And a third I found by looking at the render: a
pin for a lower-pole moment pointed up, over empty sky, so pins now hang towards
the lobe they mark.

The e2e grew a pair of ordinary volume spikes so there are rate moments to dim in
the first place — without them the fixture proved nothing about dimming — and it
now checks the ribbon is asymmetric, that the thread has given up its colour, that
the pin count matches the mood moments, and that a dimmed chip is still
selectable. Polling for the dim rather than reading it once: it is a 140 ms fade,
and the first version of the assertion was racing it.

150 unit tests, 16 e2e suites, hover, locales, lint and build green.

## 2026-09-21f — the mood ribbon is a curve now, and provably so

Angel: it still looked like lines rather than curves. He was right, and the fix
was three separate causes hiding behind one symptom. The measure that found them
was the second difference of the drawn path — smooth curves spread it thinly,
corners spike it.

Linear interpolation between bucket centres: 2.74. Evaluating the gaussian at the
sampled second instead — smoothing the _function_ rather than the array and then
joining the results with straight lines — brought it to 1.31. Doubling the sample
count to 480: 0.82. And the one I would not have found by reading the code: the
scale clamped at the 98th percentile, so every real peak was clipped into a flat
top with a corner at each end. Dropping it gave 0.20, against 0.22 predicted for
a pure gaussian. That clamp was the same mistake `seriesFromPeaks` made and fixed
on 2026-09-14 — the note was right there in the file.

The e2e now asserts that number stays under 0.45, so the ribbon cannot quietly go
back to being a polygon.

150 unit tests, 16 e2e suites, hover, lint and build green.

## 2026-09-21g — peaks you can see are peaks you can clip

Angel found a hype swell with no moment on it; clicking the heatmap there showed a
raid landing with the whole room hyped. He also had a dread axis with visible peaks
and no moments at all. Both were the same root cause, and the numbers on the
tokyosims fixture were worse than the report: on hype, peaks at 90 %, 75 % and 64 %
of the ribbon height offered nothing, and dread-payoff offered **zero** while
drawing full-height peaks.

The ribbon drew `share`; the list picked on `lift` against a rolling baseline with a
hard four-chatter floor. Two different quantities, so they disagreed all the time.
Moments are now the peaks of `curve` — the same smoothed series the ribbon is drawn
from, against the same scale.

Two supporting changes. A pole's height is the lower bound of a Wilson interval
rather than the raw proportion, so 1-of-2 (0.21) and 15-of-30 (0.41) stop being the
same 50 %; that replaces the hard floor with a smooth discount and keeps a lone
chatter from painting a full-height peak. And the drawn scale has a floor, so a
quiet axis draws quietly rather than normalising noise to full height — which is
why the honest fix made dread _smaller_ rather than lowering its bar. A peak
qualifies on either an absolute or a relative bar, so a weak axis still offers its
own best moments, which is what Angel asked for.

Separately: a rate peak the mood also claims is now tagged rather than dropped. The
raid was exactly that case — the mood moment was discarded as a duplicate and then
the rate pin was hidden because a mood was on, leaving the swell bare.

tokyosims went from 2 hype moments to 12, and from 0 dread moments to 3. The e2e
gained a raid that is both a volume spike and a mood peak, and asserts it is pinned,
undimmed, and says the room was hyped.

156 unit tests, 16 e2e suites, hover, locales, lint and build green.

## 2026-09-21h — the mood control is ours, and it is silk

The axis picker was a native `<select>` — the only browser chrome left on that
panel. It is now a `MenuButton` (ADR-27), the same component the clip pills use, so
there is one dropdown in the app rather than two, and it inherited the teleporting,
the Escape and outside-click close and the arrow-key walk for free.

The pill wears the animated pastel ramp. No other dropdown does, on purpose: SIZE
and SHAPE are settings people arrive looking for, and a mood axis is an offer of a
second way to read the stream that nobody knows to look for. To share the ramp
without a second copy of it, it moved out of `btn-silk` into a `--silk-btn-bg`
token — a scoped component style cannot borrow a Tailwind `@utility`, because that
output is layered and an unlayered scoped rule wins over it regardless of
specificity. `silk` is a prop on `MenuButton`, so any future pill can ask for it.

The e2e now clicks the pill and picks from the menu like a person, which means every
run exercises the teleport, the close and the label, and it asserts the pill is
announced as a menu.

156 unit tests, 16 e2e suites, hover, locales, lint and build green.
