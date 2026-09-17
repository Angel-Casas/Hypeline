# 03 — Decisions (ADR log)

Append-only. Newest at the bottom. To reverse a decision, add a new entry
that supersedes the old one; don't edit history.

Format: **ADR-N — Title** · date · status · context → decision → consequences.

---

## ADR-1 — Product direction: chat-driven, browser-only Twitch clipper

2026-09-12 · accepted

**Context.** Generic clipping tools compete on the same upload-and-batch loop.
Solo developer, no funding, wants a free tool with referral-based income.

**Decision.** Build a Twitch-specific clipping tool whose moment detection
comes from the chat replay, that runs entirely in the browser, and that uses
BYOK AI (NanoGPT default). Free and open source.

**Consequences.** Near-zero hosting cost; distinctive feature set generic tools
won't copy; dependence on undocumented Twitch endpoints (mitigated by
isolation + fallbacks); income scales with users' AI spend, so AI features
must be worth using often.

## ADR-2 — Packaging: PWA only (for now)

2026-09-12 · accepted

**Context.** Options were PWA, PWA + Tauri desktop, or decide after spikes.

**Decision.** PWA only. Static hosting, installable, offline-capable.

**Consequences.** Simplest build/release; everything must work under browser
CORS rules — spike S1 validates this. If CORS blocks a required host, revisit
with a new ADR (tiny Cloudflare Worker proxy vs Tauri vs extension).

## ADR-3 — Language: TypeScript (strict)

2026-09-12 · accepted

**Context.** Growing codebase, AI-assisted development.

**Decision.** TypeScript with `strict: true`, `vue-tsc` in CI.

**Consequences.** Typed API clients double as documentation; slightly more
ceremony.

## ADR-4 — UI: Tailwind CSS + Reka UI headless primitives

2026-09-12 · accepted

**Context.** Wanted a distinctive product look and a small bundle; alternatives
were PrimeVue or a batteries-included library.

**Decision.** Tailwind + Reka UI (shadcn-vue style components copied into
`src/ui`). Custom timeline/heatmap components.

**Consequences.** More UI work up front; full control; no library lock-in.

## ADR-5 — License & openness: MIT, public from the first commit

2026-09-12 · accepted

**Context.** Trust and contributions matter more than protecting the code.
Referral link is the business model and is fine to expose.

**Decision.** MIT, public GitHub repo, referral link lives openly in the
onboarding flow and README.

**Consequences.** Anyone can fork and strip the referral; we accept that. The
brand, community and momentum are the moat, not the code.

## ADR-6 — AI provider: OpenAI-compatible client, NanoGPT as default

2026-09-12 · accepted

**Context.** Income depends on NanoGPT referrals, but a single-provider
dependency is a risk if terms change.

**Decision.** `lib/nanogpt` is an OpenAI-compatible client with a configurable
base URL. NanoGPT is the default and the only provider promoted in the UI;
others are reachable via an "advanced" setting.

**Consequences.** Provider risk contained; some NanoGPT-specific endpoints
(balance, usage, video, invitation) are feature-flagged on the provider.

## ADR-7 — Chat replay is the primary hype signal; AI is opt-in and per-moment

2026-09-12 · accepted

**Context.** Whole-VOD transcription + LLM is what competitors do; it's slow
and costs the user money before they've seen any value.

**Decision.** Heatmap first, free. AI runs only on windows the user picks (or
explicitly on the whole VOD), always with a cost estimate shown first.

**Consequences.** Instant first value; lower AI spend per user than an
"AI everything" design, offset by more frequent, higher-value calls (search,
explain, captions, thumbnails).

## ADR-8 — No backend. Exceptions require an ADR.

2026-09-12 · accepted

**Context.** Cost, simplicity, privacy, and the "runs on your machine" story.

**Decision.** No server we operate for v1–v4. The live moment feed (M5) is
the recognised candidate exception and gets its own ADR when scheduled.

**Consequences.** Everything is client-side; heavy work goes to Workers; the
CORS spike is mandatory.

## ADR-9 — Video access: embed player for viewing, stateless CORS shim for bytes

2026-09-12 · accepted (Angel, same day)

**Context.** S1 showed Twitch chat replay and playback tokens are callable
from the browser, but `usher.ttvnw.net` and the CloudFront CDN return no
CORS headers, so playlists and segments can't be read from our origin
(research doc, S1). ADR-8 says "no backend"; ADR-2 says "PWA only".

**Decision.**

- **Viewing/seeking (M1)** uses Twitch's official embed player
  (`player.twitch.tv` iframe + `Twitch.Player` JS API). No proxy, ToS-clean.
- **Cutting/export (M2+)** fetches playlists and segments through a
  **stateless CORS shim** on Cloudflare Workers: host-allowlisted, `Origin`
  checked, no logging beyond aggregate counts, no state, MIT, with a
  one-click self-host deploy so anyone can run their own. The app's
  settings expose "proxy URL" so self-hosters and forks point at theirs.
- The client is written so that a **no-proxy mode** (browser extension or
  Tauri) can be added later by swapping the fetch layer (`lib/video/fetch.ts`).

**Consequences.** ADR-8 is amended: a stateless shim is not "a backend" in
the sense we cared about (no accounts, no data, no cost at our scale), but
it is infrastructure we operate; it's isolated to one file and one deploy.
ADR-2 (PWA only) still holds. Abuse controls and a bandwidth check are
part of the M2 definition of done. If Cloudflare terms or abuse make the
shim untenable, fall back to option (2)/(3) in the research doc.

## ADR-10 — Cutting: ffmpeg.wasm (single-threaded) first; WebCodecs later if needed

2026-09-12 · accepted

**Context.** Twitch VOD segments are MPEG-TS (H.264 + AAC, ~10 s, keyframes
every 2 s). Cutting in the browser needs a TS demuxer, a cutter, and an MP4
muxer; cropping to 9:16 needs a re-encode. The architecture doc proposed
WebCodecs with ffmpeg.wasm as fallback.

**Decision.** Ship ffmpeg.wasm first, as the only path. Single-threaded build
(the multi-threaded one needs COOP/COEP headers, which would break the
Twitch embed iframe). Core (31 MB) served from our own origin
(`public/ffmpeg/`, copied on postinstall, runtime-cached by the service
worker), loaded lazily on first export. Two modes: **fast** (stream copy,
keyframe-aligned, ≤2 s early, ~1 s wall) and **precise** (libx264
`ultrafast` re-encode, frame-accurate, needed for crops; measured ~0.8×
real-time at 720p in headless Chromium).

**Consequences.** One code path that handles every case; a 31 MB one-time
download per browser; re-encodes are CPU-bound and single-threaded, so
long precise/vertical exports will be slow on weak machines — show
progress and keep clips ≤ 10 min. Revisit WebCodecs (ADR) only if users
report exports being too slow.

## ADR-11 — AI layer: BYOK key in the browser, per-range calls, cached by (range, model, prompt version)

2026-09-13 · accepted

**Context.** M3 needs a NanoGPT key, cost transparency (ADR-7), and no
server. Whole-VOD transcription would cost the user before they see value.

**Decision.** The key lives in `localStorage` alongside other settings for
now (encryption-at-rest with a passphrase is a later item; the threat model
is a shared machine, not the network — the key only ever goes to the
provider over HTTPS). AI actions operate on the current in/out range:
_Transcribe range_ extracts a 16 kHz mono WAV in ffmpeg.wasm from the
480p-or-lower variant and posts it to `/v1/audio/transcriptions`;
_Explain this moment_ sends the transcript (if any) plus a sampled chat
excerpt to a chat model with a strict JSON schema. Every action shows an
estimate first and the reported (or estimated) cost after; lifetime spend is
tracked locally. Results are cached in IndexedDB keyed by
`vodId:in-out:kind:promptVersion:model`, so repeated clicks are free and a
prompt change invalidates old answers. Provider base URL is configurable
(ADR-6); balance is fetched only for NanoGPT.

**Consequences.** No AI spend without a range and an explicit click; costs
are fractions of a cent per moment; the referral link is the only place
NanoGPT is promoted. Whole-VOD transcription/search (M4) builds on the same
client with chunking.

## ADR-12 — Visual identity: the hype thread (2026-09-13)

**Context.** Angel opened the design pass wanting "genuinely good
aesthetics with pastel colours, unique, not stock". Static boards were
rejected as flat; a screen recording of stripe.com's silk ribbon set the
bar. Angel's own idea: make the hype heatmap _be_ the ribbon.

**Decision.** The chat hype curve is rendered as a WebGL silk thread
("Spindle · hue": symmetric, per-moment colour families, ink spine) and is
the app's one piece of colour; everything else is pastel paper, grain
and frosted glass. Landing page uses the "Masthead" composition. Full
spec in `docs/08-design-system.md`. Gloock / Manrope / JetBrains Mono
from Google Fonts.

**Consequences.** A WebGL dependency (with a CSS fallback), fonts loaded
from Google (offline PWA shows fallbacks), and the thread is now shared
between marketing and product — the timeline on the VOD page is the same
component, so any scoring change is visible on the landing page too.
The "function before form" rule is retired; the design system is the
form.

## ADR-13 — Clip windows lead the chat spike by 10 s (2026-09-14)

**Context.** Moments come from chat, and chat reacts late: stream delay
plus typing means the spike lands several seconds after the thing that
caused it. Windows centred on the spike kept missing the start of the play.

**Decision.** `clipStore.selectAround(t)` = `[t − 25, t + 20]` (45 s,
shifted earlier by `CHAT_LAG_SEC = 10`); entering clip mode seeks to In.
Applies to moment rows, timeline pins, search hits and `Enter`.

**Consequences.** Users see the cause, not just the reaction. If Twitch
delay differs a lot per channel, make the lag a setting.

## ADR-14 — Night mode as a token theme (2026-09-14)

**Decision.** One `[data-theme="dark"]` block redefines the theme tokens
and a few surface variables; components never branch on theme except the
thread shader (`u_dark`). Default follows the OS; a toggle persists an
explicit choice in `settingsStore`.

**Consequences.** New UI must use tokens (never raw whites / inks) or it
will not follow the theme.

## ADR-15 — Portrait landing: the thread turns vertical (2026-09-14)

**Context.** On phones the landscape hero collapsed: four 212 px cards
piled onto a 380 px thread and the scroll-to-draw had nowhere to travel.
Options were fewer/smaller cards, one card at a time, or a vertical thread.

**Decision.** In `(orientation: portrait)` the thread runs top → bottom
(`vertical` prop on `HypeThread`, `u_vert` in the shader turns the frame;
nothing else in the shader changes), spine centred, scroll draws it
downward; cards alternate sides of the spine, pinned to the ribbon's edge;
the ruler stands along the left edge with labels written upward; the CTA
stays at the bottom. Angel chose this as "a good compromise" to try.

**Consequences.** Same ideas on both orientations (draw, pins, magnet,
CTA entrance). Dashboard mobile is still open (M6).

## ADR-16 — The video relay is the app owner's, baked into the build (2026-09-15)

**Context.** ADR-9's CORS shim was exposed as a user setting during
development. Angel: asking users to deploy a Cloudflare Worker would lose
most of them; the "no backend" ideal is worth less than "paste a link and
go".

**Decision.** The shim is called the **video relay** in anything a user
reads. The owner deploys `shim/` once and bakes its URL into the build as
`VITE_SHIM_URL` (`.env`, not committed; `.env.example` documents it); the
worker is locked to the app's origin(s) and rate-limited. Settings keeps
the URL only under **Advanced · video relay** as an override
(`settings.shimUrl`); `settings.relayUrl` = override || built-in default,
and is what every fetch uses. With neither, cutting / thumbnails /
transcription are off and say so.

**Consequences.** Hypeline now has one tiny piece of infrastructure the
owner operates (free tier ≈ thousands of clips a day). Forks and power
users keep the override. Re-check Cloudflare's terms on video bytes
through Workers before launch (docs/05-research.md, option 1).

## ADR-17 — Live mode is a second screen, not a feed service (2026-09-15)

**Context.** The vision's "live moment feed" (watch many channels, publish
spikes in real time) needs a server that stays connected to Twitch when
nobody has the app open. Angel chose the halfway version: something for a
viewer who is watching one stream and steps away. Twitch IRC over
WebSocket accepts an anonymous `justinfan…` nick with no token, so the
browser can read live chat by itself.

**Decision.** `/live/:channel` joins that channel's chat from the browser
(`lib/twitch/irc.ts`), scores it with the VOD detector from the moment of
joining (a rolling baseline, 3-minute warm-up, a minimum score of 1.5 so a
steady chat surfaces nothing), and shows the last half hour as the hype
thread plus a feed of moments since joining. A moment links into the
dashboard on the VOD Twitch is recording (`user.videos` with `status:
RECORDING`, `?t=` lands on that second with the clip range set). Optional
browser notification + a `(n)` in the tab title when a moment appears while
the tab is hidden. Everything stops when the tab closes; there is no
history, no multi-channel view, no server.

**Consequences.** Still no backend. The unofficial GQL surface grows by one
query (`user { stream, videos }`), isolated in `gql.ts`. A "watch many
channels" feed remains a server decision for later. Notifications depend on
the browser and OS allowing them; the tab title badge is the fallback.

## ADR-18 — Live is the dashboard on a recording VOD (2026-09-16)

**Context.** ADR-17 gave live mode its own page: a since-you-joined thread,
a feed, notifications, and links into the VOD. Angel: why not one page?
Twitch lists the VOD ~5 s into a stream and serves its chat replay while it
records, so everything the dashboard does already works on a live VOD.

**Decision.** `/live` is gone (the route redirects). A channel pasted
anywhere resolves to the VOD recording it (`openChannel`, retried for a
stream that just started) and opens the normal dashboard. For a
`RECORDING` VOD the store enters live mode after the replay loads: it joins
the channel's chat over IRC and appends messages past the replay's end,
grows `lengthSeconds` and a **live edge** every second, rescores every few
seconds, lists moments that appear near the edge as "new while live" (with
the tab-title count and the optional notification while hidden), and stops
when the stream ends — keeping what it appended and refreshing the VOD's
final metadata. A recording VOD's replay is never cached (it is a snapshot).

**Consequences.** One page, one set of strings for i18n, the whole VOD
available to clip while live, a real baseline from the first second (no
warm-up). The player is the VOD player (seekable, some seconds behind live);
"watch on Twitch ↗" is the low-latency view. `features/live/` is deleted;
`lib/twitch/irc.ts` and `fetchLiveInfo` stay.

## ADR-19 — Twitch sign-in for a home, not an account (2026-09-16)

**Context.** `/dashboard` reopened the last VOD, and finding the next VOD
meant leaving for Twitch to copy a link. Angel: the dashboard's empty state
should be a home — connect Twitch, see your followed streamers, who is live,
their latest VODs. "No accounts" is a Hypeline principle; this is not one of
ours.

**Decision.** Twitch's **implicit grant** (`response_type=token`, scope
`user:read:follows` only) from the browser, redirecting back to
`/dashboard`; the token lives in localStorage like the NanoGPT key and is
validated on load and hourly. Helix (`lib/twitch/helix.ts`) gives the
follows, `streams/followed`, avatars and one `videos?type=archive&first=1`
per channel (six at a time). The app owner registers the app once and bakes
the Client ID as `VITE_TWITCH_CLIENT_ID`; without it the home shows a note
and the paste-a-link path. `/dashboard` without an id always resets to the
home; the rail's home button (beside day/night, only while a VOD is open)
goes there.

**Consequences.** Still no server and no data of ours; Twitch sees the same
sign-in it sees for any embed-based site. Helix's rate limit (800 points a
minute) allows ~100 follows per refresh; refreshes are throttled to two
minutes. Tokens expire in ~60 days; a 401 disconnects with a message.

## ADR-20 — Ten languages, chosen on the first visit (2026-09-16)

**Context.** Clippers are global; the app was English only. Angel asked
for a language button in the rail, and for the first visit to offer the
languages in an overlay that matches the design.

**Decision.** `vue-i18n` v11 (composition mode) with every catalog bundled
(`src/i18n/locales/*.json`, ~430 strings each; they are small). English is
the source; the other nine — Spanish, Portuguese (Brazil), German, French,
Russian, Japanese, Korean, Chinese (Traditional), Turkish, Twitch's largest
communities — were drafted by Claude and are marked so in
`docs/09-languages.md`. The start locale follows `navigator.languages`
(`pt-*` → pt-BR, `zh-*` → zh-TW, else the base tag, else English); a
first-visit **sheet** asks the user to keep it or pick another (tapping a
language previews it live; Continue, Escape or the backdrop keep the
current one), then the choice lives in `localStorage` (`hypeline.locale`).
The rail's **globe** (beside day/night, on every page) changes it any time.
Components use `useI18n().t`; stores and libs import `t` from `@/i18n`.
Plurals use vue-i18n's `a | b | {n} c` form; text with inline links uses
`<i18n-t>` slots so word order can move. `scripts/check-locales.mjs`
checks key, placeholder and plural-form parity and runs at the start of
`e2e/i18n.mjs`. `<html lang>` follows the choice.

**Consequences.** ~110 KB more JavaScript (gzipped ~35 KB) for all ten
catalogs — acceptable at this size; split by locale when the catalogs grow.
Moment reasons (`scoring.reasonsFor`) are localized too, so the English
unit-test expectations hold only in the default locale. Gloock (display)
and JetBrains Mono have no CJK/Cyrillic glyphs: those scripts fall back to
system fonts in headlines and mono labels, by design. Native speakers are
welcome to correct the nine drafts; the app's own e2e suites seed
`hypeline.locale = en` so the sheet does not cover the page.

## ADR-21 — A first-visit tour on an example VOD (2026-09-17)

**Context.** The desk has four areas and no explanation; a newcomer with no
VOD link sees an empty home. Angel asked for a very short tour that
highlights each area and dims the rest, with an example VOD that is not
real, deletable, and a way to run the tour again from Settings.

**Decision.** `features/tour/`: a Pinia store (`seen` in localStorage
`hypeline.tour.v1`, `active`, `step`, `requested`) and `TourOverlay.vue`,
which cuts a hole over `[data-tour="<id>"]` with four blurred, tinted
panels and a silk ring, and places a paper card under, over or beside the
target — whichever fits without covering it — or as a bottom sheet on
narrow screens, so the text is never off-screen. Five steps: heatmap,
moments, clip, AI, rail; steps switch the phone tabs / open the drawer
first. The **example VOD** (`features/vod/example.ts`, id `example`) is
generated, never fetched: a 90-minute "sample stream" with a seeded
synthetic chat (six bursts), cached like any VOD so it sits in the library
and its × removes it (which also sends the desk home). It has no video: the
player is a black card, clip and AI actions are locked with a one-line
reason. First visit: once the language is chosen, `/dashboard` with no id
opens the example and starts the tour when the desk is ready (a deep-linked
VOD gets the tour on itself); Done and Skip both mark it seen; Settings →
"Show the tour" runs it again (loading the example if nothing is open).

**Consequences.** Every e2e suite seeds the seen flag (like the locale) so
the tour does not cover the page. The example's chat is English-only and
the moment reasons on it are what the scorer finds, not scripted.
`useVodStore().isExample` is the one switch other panels read.

## ADR-22 — Installable, and updates on the user's word (2026-09-17)

**Context.** The app is already a PWA but never said so, and
`vite-plugin-pwa` was on `autoUpdate`: a new build could swap itself in
while a clip was exporting. Angel asked for both signals, unobtrusive.

**Decision.** `src/lib/pwa.ts` owns the two. Install: keep the browser's
`beforeinstallprompt` (Chromium only — Safari and Firefox never fire it, and
we would rather show nothing than a "how to install" lecture), expose
`installable`, and show one line in the rail above Settings; a "not now" is
remembered in `hypeline.install.dismissed`, and an accepted install (or
running standalone) hides it for good. Update: `registerType: 'prompt'`,
`onNeedRefresh` raises a paper toast at the bottom — Reload applies the
waiting worker (with a plain reload as a backstop) and Later keeps the old
build until the next visit. A `hypeline:update-ready` window event raises
the toast too, which is how `e2e/pwa.mjs` provokes it.

**Consequences.** Nothing reloads by itself any more; a user who never
installs never sees a second prompt. The service worker still precaches the
shell, so offline is unchanged.

## ADR-23 — The NanoGPT referral is a discount (2026-09-17)

**Context.** The project's only revenue (docs/00-vision.md) is NanoGPT's
referral programme. Angel's link gives the user 5 % off and the project
10 %, at no extra cost to the user.

**Decision.** `REFERRAL_URL = https://nano-gpt.com/r/BnfJfghE`, shown in
Settings ("Create a NanoGPT account — 5 % off") and as one mono line on the
AI panel's no-key card ("5 % off with our link"). It is always presented as
what it gives the user, never as a tracker, and the app works with any key.
The README says plainly what the link pays the project.

**Consequences.** Two places to change if the programme ends; the string is
`settings.referralNote` in all ten catalogs.

## ADR-24 — The relay is locked to the app, politely (2026-09-17)

**Context.** hypeline.live is public, so the video relay's URL is now
discoverable by anyone. It is a stateless proxy for Twitch video the
viewer could already fetch, but an open proxy is still someone else's
bandwidth bill and a nuisance magnet.

**Decision.** `ALLOWED_ORIGINS = https://hypeline.live` plus
`ALLOW_LOCAL = true` (localhost, 127.0.0.1 and private-LAN origins, so
`vite dev` and a phone on the same wifi keep working), and the
`[[ratelimits]]` binding at 120 requests per minute per IP — Cloudflare's
own limiter, counted across the edge, with the in-isolate counter as the
fallback. `GET /` and `/health` answer 200 without an Origin, because
opening the relay in a tab is the first thing anyone does when frames stop
loading and "missing ?u=" reads like a fault. `shim/worker.test.mjs` runs
in `npm test`, so CI would catch the app being locked out of its own relay.

**Consequences.** A `curl` with no `Origin` now gets 403 — by design; use
`/health`. The gate is a courtesy, not authentication: browsers always send
`Origin` on a cross-origin `fetch`, so it stops other _sites_, not a script
that sets its own headers, and the README says so plainly. Storyboard
frames are unaffected (they load straight from Twitch as images).
`*.workers.dev` stays a liability for some users' networks; the fix is a
custom domain, which needs the zone on Cloudflare (hypeline.live is on the
registrar's nameservers today) — steps in `shim/README.md`.

## ADR-25 — Load the ffmpeg core ourselves, and take Twitch's larger storyboard (2026-09-17)

**Context.** The first export from hypeline.live failed with
`Failed to execute 'arrayBuffer' on 'Response': body stream already read`,
while `vite dev` was fine. The culprit is `toBlobURL` in `@ffmpeg/util`
0.12.2: its progress path reads the body as a stream and then compares the
bytes it got against `Content-Length`, throwing `incompleted download` when
they disagree; its `catch` calls `arrayBuffer()` on that same, already
drained response, so the real reason is replaced by a stream error. On a
static host the 32 MB core is served gzipped, so `Content-Length` is the
*compressed* size (10.3 MB on GitHub Pages) and the comparison can never
hold. Reproduced exactly by serving `dist/` with gzip and running the old
code and the new one side by side in Chromium.

Separately, the frames on the moment cards read as mush: Twitch publishes
two storyboard levels, 160×90 (`low`) and 220×124 (`high`), and we asked
for 160 — the cards draw them far larger than that.

**Decision.** Download the core ourselves (`blobUrl` in
`lib/video/ffmpeg.ts`): read the body once, never touch the response again.
An encoded body hides its decoded size, so progress runs against
`CORE_WASM_BYTES` in `lib/video/coreSize.ts`, which
`scripts/copy-ffmpeg-core.mjs` rewrites whenever `@ffmpeg/core` is bumped.
`parseStoryboard`/`pickLevel` now default to 220 px.

**Consequences.** One dependency less at the loading edge — `@ffmpeg/util`
is no longer imported at all — and a progress bar that stays honest behind
gzip. Sharper frames cost four sprite sheets per VOD instead of one (~2×
the pixels, still a few hundred KB, straight from Twitch's CDN and outside
the relay). If a future core changes size and the postinstall script has
not run, the bar is merely wrong, never broken. The unit test streams more
bytes than it declares, so the old shape would fail it.

## ADR-26 — An open tab checks for its own updates (2026-09-17)

**Context.** ADR-22's update toast only ever appeared after a reload, which
is the one moment it is useless: the reload already fetched the new build.
A browser re-fetches `sw.js` when the page navigates, and otherwise not at
all, so a tab left open through a deploy — the normal way Hypeline is used,
one long editing session — never hears about it.

**Decision.** `lib/pwa.ts` keeps the registration from `onRegisteredSW` and
calls `registration.update()` every 15 minutes, when the tab becomes
visible again, and (forced, past the gap) when the network returns. Checks
are throttled to one a minute so flicking between tabs costs nothing, and
skipped outright while `navigator.onLine` is false.

**Consequences.** One conditional request for `sw.js` per quarter hour per
open tab — a few hundred bytes against a static host, and nothing at all
while offline. Nothing else changes: the worker still waits, the toast
still asks, and the reload is still the user's. The e2e now proves the
whole path against a real service worker — install, take control, publish a
new `sw.js`, and watch a tab that never navigated raise the toast.
