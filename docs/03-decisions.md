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
_compressed_ size (10.3 MB on GitHub Pages) and the comparison can never
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

## ADR-27 — The clip settings become menus, and long lists scroll (2026-09-17)

**Context.** The clip panel spent five stacked rows on settings — preset
pills, then quality, mode and aspect as three pill groups, then captions,
then the thumbnail line — each row full width and mostly empty. On a
desktop the whole dashboard fitted the screen except this, so Export sat
below the fold (Angel, 2026-09-17). The moments grid made it worse: a
sensitive VOD finds twenty peaks and every extra row pushed the clip panel
further down.

Five layouts were mocked against the real tokens and measured
(`design/clips/clip-controls.html`): dropdowns, a preset summary with an
"Adjust" disclosure, an editable sentence, two columns, and a pinned export
bar. Angel chose the dropdowns.

**Decision.** A new `ui/MenuButton.vue`: a pill that shows a setting's
current value and opens a small paper menu — a list of choices via
`options`/`modelValue`, arbitrary content via the slot, or both. Quality,
mode, aspect, captions and thumbnail each become one, and the crop and
cam-strip sliders move inside the shape menu that needs them, so no
conditional row can appear. The preset pills stay pills: one tap is the
point of a preset. The menu is teleported to the body and clamped inside
the viewport rather than anchored to an edge. The pills' labels are short
words of their own (`size`, `cut`, `shape`, `subs`, `thumb`) — "Quality"
and "Aspect" cost a whole row's width in several languages.

Separately, `MomentList`'s grid is capped at 13.5rem with its own scrollbar
from 1024 px up, and the chosen moment is scrolled into view when the
choice came from the timeline. Phones keep the page scroll, which is the
right scroll there.

Also: the default cut mode is now `precise`, not `fast` — a clip that
starts up to two seconds early is the more expensive mistake, and speed is
one menu item away.

**Consequences.** Five rows become two at 1440 px and three at 1280 (the
middle column, not the design, is the limit); Export is above the fold on
every desktop size we checked. A setting now costs a click to change where
it used to cost none — the trade Angel picked knowingly. The menus carry
`data-testid="pick-<name>"`, and `e2e/cut.mjs` and `e2e/ai.mjs` drive them
through a shared `pickSetting` helper. Five new strings per catalog, ten
catalogs.

## ADR-28 — The moments grid takes its column's height (2026-09-17)

**Context.** ADR-27 capped the grid at 13.5 rem. That was solving a problem
the layout does not have: on `xl` the moments card is its own column beside
the player, and below `xl` the three panels are tabs, so a long list never
pushed the clip panel anywhere. Worse, a fixed height on a grid whose card
is stretched by its taller neighbour let the rows share out that height
instead of keeping their own: with 25 moments the chips overlapped each
other by half, inside a card that was two-thirds empty (Angel, 2026-09-17,
with a screenshot).

**Decision.** `.chips` is `flex: 0 1 auto` with `min-height: 6rem`,
`align-content: start` and `grid-auto-rows: max-content` from 1024 px up,
and the component is `min-h-0 flex-1` in its card. It therefore takes the
height its content wants, shrinks and scrolls only when the column is
genuinely shorter than the list, and can never compress a row below a
chip's own height. The hint line stays under the last chip rather than
being pushed to the bottom of the card.

**Consequences.** No cap in practice on a desktop: a VOD with sixty
moments makes that column tall and the page scrolls, which is what it did
before ADR-27 and what the column is for. The scroll-the-selection-into-view
behaviour from ADR-27 stays and still matters when the column is short.
`grid-auto-rows: max-content` is the load-bearing line; without it any
future height constraint brings the overlap straight back.

## ADR-29 — The user teaches the heatmap their chat's words (2026-09-18)

**Context.** The clip-request pattern is the biggest single lever in the
scoring — up to +3.6 for one bucket — and it only knows English: `clip`,
`clip it`, `clipped`. A Spanish chat saying `clipea eso` contributes
nothing to it, and the 37 shipped reaction words are English too. Since we
ship the UI in ten languages, most of the audience was being scored by
rules written for someone else's chat. Angel asked for the word lists to be
editable (2026-09-17) and chose: add words _and_ remove shipped ones;
global lists with per-channel overrides; no per-word weights, because a
user typing 50 would flatten their own heatmap; one overlay behind one
button; and "important words" rather than "words that mean clip this",
since a word can mark a moment without being about clipping.

**Decision.** `features/hype/vocabulary.ts` holds a pure model: two lists
(`important`, `reaction`), nine language packs, a merge of packs + shipped
defaults − disabled + global + channel into a `Vocabulary`, and the two
read-only views the UI needs. `scoring.ts` takes a `Vocabulary` through
`analyse`/`scoreBuckets`/`isReaction`/`isClipRequest`, defaulting to
`NO_VOCAB` so every existing caller and test is untouched. A term matches
by word when it is plain ASCII and by substring otherwise, because `\b` is
meaningless in Japanese, Korean and Chinese; emote names are matched
against the message's own emote list, so casing never matters.

Three things carry the language problem:

1. **Emote names already cross languages** and always have. They feed the
   reaction share only, never the strong lever — which is exactly the gap.
2. **A starter pack per language** for the words that are not emotes.
   English is always on, because Twitch chat code-switches constantly.
3. **Detection, not assumption.** The UI language is a poor guess at the
   chat's, so `detectPacks` counts how many distinct people used each
   pack's _distinctive_ terms and `packsToEnable` switches on those past
   five people.

`seenTokens` ranks a VOD's own vocabulary by **how many people said it
inside one 15-second window**, not by how often it appears, and drops
anything present in more than 60 % of the VOD's buckets. It needs no API
and no sign-in: every stored message already carries its emote names, and
third-party emotes (BTTV, 7TV) arrive as plain words.

**Consequences.** Changing a list re-scores the same messages in memory —
no refetch — which is what makes the live before/after strip in the overlay
affordable. Both rows of that strip share one scale; normalising each by
its own maximum hid a uniform lift, which is the thing it exists to show.
The moment _count_ barely moves, because the sensitivity slider fixes how
many peaks surface, so the overlay reports how many are _different_
instead. State lives in `localStorage` under `hypeline.vocab.v1` and
exports as a small JSON a streamer can hand to their editors. The packs are
a starting point, not a dictionary — the honest fix for a chat we do not
speak is the list of what it actually said.

## ADR-30 — A veil lightens paper, and nothing is grey (2026-09-18)

**Context.** Every overlay in the light theme made the page behind it grey:
the settings sheet, the tour, the rail drawer and the new vocabulary panel
all sat on a flat mid-tone that belongs to no part of the palette. Angel
found the cause before we did — the scrims dimmed towards black in _both_
themes. In night that is correct, because black is the ground and a veil
should push the page away from the reader. In day it is exactly backwards:
paper's ground is white, so dimming walks the whole page towards grey and
stops halfway. A second, smaller version of the same mistake was inside the
panels, where boxes lifted themselves with an ink film.

**Decision.** A veil moves the page towards its own theme's ground.

- Day scrims become white at 45 / 64 / 76 %; night keeps black at
  40 / 58 / 70 %.
- `--box-film` (a box inside a `sheet`) is white in both themes — 66 % by
  day, 5 % by night.
- `--color-muted` is retired as a colour: it is now ink in both themes, so
  the hundred or so existing `text-muted` uses stop being grey without
  being rewritten. Secondary text recedes by size, weight, mono tracking or
  an `opacity` on ink instead. There are other ways to make text less
  important than making it grey (Angel).
- Selection is marked in mint (`--pick`), not the accent violet, which the
  silk ring already owns.

**Consequences.** The palette's five pastels now have nothing competing
with them: the only neutral surfaces in the app are its own paper and its
own black. `--color-muted` staying in place as a token, rather than being
deleted, is deliberate — it keeps one lever should a genuinely quieter ink
ever be wanted, and it kept this change to two lines instead of a hundred
diffs. The tokens all live in `src/style.css`: a theme-varying token
written in a component's scoped block does not work, because
`:global([data-theme='dark']) .x` compiles to `[data-theme=dark]` with the
`.x` dropped, which is how the vocabulary panel spent a build running day
colours at night.

## ADR-31 — Two silks, and English becomes a switch (2026-09-18)

**Context.** Every ringed thing in the vocabulary panel wore the same silk,
and selection was marked with a flat colour on top of it — first violet
(which the ring already owns), then mint (which Angel didn't want). A ring
that means nothing is decoration; a ring that means something can replace
the flat mark entirely. Separately, the English starter pack was labelled
"always on" and the × on each shipped English word did nothing at all,
because those words are not data: they are `CLIP_RE` and `REACT_WORDS`
inside `scoring.ts`.

**Decision — two half-silks.** `--silk-warm` (butter → apricot) is what
Hypeline shipped: the default words, the pack words, the packs. `--silk-cool`
(sky → lilac) is what this user typed in. Both are built like the main ramp —
mirrored, no transparency, no pale tints — so they are recognisably the same
material; each stays inside one half of the palette so a 1.5 px edge still
tells them apart. A user's word changes **only** its edge: same surface, same
weight. `silk-ring` reads `--ring-g`, so a variant costs one custom property
and no second utility. They turn, at 14 s rather than the app's 8 s, because
forty of them on one screen is a lot of motion for a panel you read.

**Decision — English is a pack you can switch off.** `VocabState.enOff`, a
negative flag so everyone who never opens this screen keeps English: Twitch
chat code-switches into it constantly whatever the stream speaks. But it is
now a choice, because a chat that never types a Latin word pays for `clip`,
`lol` and `wtf` in false positives, and telling that user "always on" was us
deciding for them. `Vocabulary` gained `en` and `offWords`, and `scoring.ts`
consults both, which also makes the per-word × on the shipped chips real for
the first time — `CLIP_PHRASE_RE` is tried before `CLIP_RE` so that turning
off "clip it" is not silently swallowed by the bare "clip" inside it.

**Consequences.** The packs are now genuinely symmetrical: nine data packs
and one built into the scoring, all switchable, none privileged in the UI.
Emotes stay language-neutral and unaffected — with English off, `KEKW` is
still a reaction and the mood bonus still fires through emote names, which
is the baseline that made this feature possible. Fields also got a real
hairline (`--field-line` was white at 95 %, an inset highlight from when
fields sat on tinted glass; on the whitened page of ADR-30 an input was
recognisable only by its placeholder).

## ADR-32 — One hover system, and a script that checks it (2026-09-18)

**Context.** Hovers had grown one at a time: `hover:bg-ink/6` in seven
components, `color-mix(ink 7 %)` in the vocabulary rows, `bg-lift/40` in the
rail, `ink 10 %` on the token buttons, four different transition durations,
and a `hover:text-ink` idiom that had silently become a no-op when
`--color-muted` became ink (ADR-30). Most of them were an ink wash, which on
paper is a grey — the thing we keep removing. Angel, finding two of them in
the vocabulary panel: "find a standardized way… make sure we are using the
same for all the app. Every hover over a button or element should include a
hover effect, some more visible and others more succinct."

**Decision.** One wash colour and four tiers, all on `--hover-ease`:

| tier           | for                                                                            | what happens                      |
| -------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| `hover-wash`   | a surface the pointer is _over_: rows, menu items, icon buttons, ghost buttons | accent at 11 % (16 % night)       |
| `hover-lift`   | a thing it could _pick up_: cards, chips, handles, tiles                       | 2 px up + accent shadow           |
| `hover-line`   | a thing it can _type into or open_: fields, selects                            | the border warms to the accent    |
| `hover-danger` | anything that deletes                                                          | the same wash in `--color-danger` |

The wash is the **accent**, not ink and not the warm silk: ink is a grey,
and warm is already `--pick-soft`, "you chose this" — a hover and a selection
must not look alike. Solid surfaces that cannot take a translucent wash
(`btn-ink`, a pressed `seg-opt`, the sensitivity thumb) warm towards the
accent instead, `color-mix(ink 86 %, accent)`. An underlined word is the
control, so a fill would read as a highlighter: its underline thickens and
takes the accent. `hover-lift` flattens under reduced motion, keeping only
the shadow. The tiers are built into `btn-ghost`, `btn-ink`, `seg-opt`,
`field` and interactive `glass-sm`, so most components inherit one without
saying anything.

**Consequences.** `e2e/_hover.mjs` is the part worth keeping: it walks every
visible button, link and field on five screens and asks the CSSOM which
`:hover` rules would match — `:hover` cannot be forced from script, so
matching rules is the only way — then reports anything the pointer would not
move, and anything whose hover is an ink wash. It found 56 on the first run,
including three that were nobody's intent: the "Erase everything" button had
no style at all, the _active_ library row was the one row that did not
respond, and the sensitivity slider's thumb was inert. It is not in the suite
loop (the `_` prefix): it is the check to run after touching a control, and
the answer it should give is "all covered", in both themes.

## ADR-33 — The hover is an inversion, wiped in (2026-09-18)

**Context.** ADR-32 standardised the hovers but chose the accent violet as
the wash, and Angel did not want it. Shown seven alternatives in
`design/hover/inversion.html` — mostly inversions, since that was the
technique he named — he picked straight inversion with the wipe from the
sweeping option.

**Decision.** `hover-invert` replaces `hover-wash`. The hovered thing swaps
with the page: `--invert-bg` (ink) fills, `--invert-fg` (ground) is what sits
on it, and the fill **wipes in from the left** over 220 ms. Night inverts
twice as hard by itself, because ink there is near-white and ground is black.
`hover-line` (fields) and `hover-lift` (cards, chips) are unchanged in shape
but drop the accent: the border goes to ink, the shadow to a neutral dark.
`hover-danger` stays a red wash — red on red would say nothing. Things that
are _already_ ink — `btn-ink`, a pressed `seg-opt` — invert the other way,
becoming paper with an ink hairline. An `<input>` has no pseudo-element, so
`.time` inverts in place, without the sweep.

Three details the mock and the screenshots forced:

1. **Nested controls invert with their row**, or they vanish: ink text on the
   ink fill. And a control the pointer reaches _inside_ an inverted row
   inverts **back** — two inversions cancelling — which is both the honest
   reading of the idea and the only way its own fill stays visible.
2. **No `overflow: hidden`.** The fill is `inset: 0` and takes
   `border-radius: inherit`, so there is nothing to clip — and `overflow`
   other than visible sets a flex item's automatic minimum size to zero,
   which squashed the vocabulary rows to half height the first time this
   shipped.
3. **The colour half is unlayered, with the class doubled.** Tailwind puts
   `@utility` output in `@layer utilities`, and an unlayered rule — which
   every Vue scoped `<style>` is — beats any layered one whatever its
   specificity. The starter-pack chips set `color` on themselves, so they
   stayed ink on the ink fill and went blank. `.hover-invert.hover-invert`
   wins without `!important`.

**Consequences.** The app's one hover is now made of the two colours it is
already made of, which is why it cannot be grey and cannot fight the silk.
`e2e/_hover.mjs` still reports "all covered" in both themes, and its grey
check now has nothing to find: there is no tint left to check.

## ADR-34 — The wipe is a background, not a pseudo-element (2026-09-18)

**Context.** ADR-33's inversion shipped as an absolutely positioned `::after`
revealed with `transform: scaleX()`. Angel found three faults in one look:
the corners started square and rounded off as the fill arrived, the fill
showed _outside_ the element's own border, and its radius did not match the
border's. All three are properties of that mechanism, not bugs on top of it —
scaling a rounded box squashes its radii; an absolutely positioned child is
laid out against the **padding** box while `border-radius: inherit` gives it
the **border** box's radius; and a negative-z-index child paints above the
element's border.

**Decision.** The fill is the element's own `background-image` — a solid
linear-gradient in `--invert-bg` — grown from `0% 100%` to `100% 100%`. A
background layer is clipped by the element's own box and radius, sits under
the border, interpolates without distortion, and works on an `<input>`, which
cannot have a pseudo-element at all. Consequences that follow from it:

- **No component on this path may use the `background` shorthand**, which
  resets `background-image` and erases the fill. `glass-sm`, `btn-ghost` and
  the pack chips did; they use `background-color` now.
- **The declarations are unlayered**, because a layered `@utility` loses to
  both a Vue scoped `<style>` and to `glass-sm`. `hover-invert` is therefore
  a plain class, not an `@utility`.
- **One selector list** covers `hover-invert`, interactive `glass-sm` and
  `btn-ghost`. They had their own copies and drifted: the rail's Clips card
  inverted its background but not the text inside it, so half the card
  vanished.
- **The label flips while the fill is under it.** The fill grows from the
  left and shrinks back to the left, so the colour change is delayed 100 ms
  going in and 160 ms coming out. Without that the label is briefly paper on
  paper.
- **Everything inside inverts**, via `*`, not a list of tags: a `text-muted`
  or `text-ink-2` class colours itself, which is what left the library cards
  with invisible second lines.

**Also.** The vocabulary chips and packs drop the warm silk ring for a plain
**ink** border. A gradient edge cannot invert with the thing it wraps, and an
edge that stays put while its surface flips reads as a mistake; ink inverts
to paper for free, because ink is what the fill is made of. Only the words
the user typed keep a ring — the cool one — since that is the one distinction
this screen still has to draw.

**And** `btn-silk`'s drift no longer jumps. `silk-drift` shifts the
background by exactly one gradient width, so the colour at 0 % and at 100 %
must be the same; it ended on lilac having started on sky. The ramp is
mirrored now, like the ring's, and `e2e/_loop.mjs` proves it: rendered at
`background-position: 0%` and at `300%`, the button is pixel-identical.

## ADR-35 — The hover is frost and the silk edge (2026-09-18)

**Context.** ADR-32 (accent wash), ADR-33/34 (ink inversion, wiped) were all
variations on changing the surface _colour_, and Angel rejected each. Shown
ten techniques that mostly do not (`design/hover/ten.html`), he kept two —
the silk edge appearing, and frost — and then chose them combined from the
follow-up set (`design/hover/edges.html`).

**Decision.** `hover-frost` replaces `hover-invert`. The hovered thing's
glass thickens and the turning silk ring fades in over its hairline. No fill,
no text colour change, which deletes most of the machinery the inversion
needed: nothing can disappear into the hover, and no component has to be told
to follow it.

**The film is the theme's own ground.** White by day, black by night, with the
backdrop brightened by day and darkened by night. Angel found the first cut
whitening the _dark_ theme, which is the ADR-30 mistake one layer down: a
surface moves towards its own ground, away from the page, never towards the
other theme's.

**Two consequences that only a screenshot could find:**

1. **A frost cannot whiten a panel that is already white.** Measured: the
   vocabulary rows go from `254,253,254` to `255,255,255` on hover by day —
   a difference of one. So the frost also carries a highlight along its top
   edge and a soft pane shadow, and on those panels those, plus the ring,
   are the whole cue. The frost proper earns its keep where something sits
   behind: the rail, the dashboard, anything over the mesh.
2. **An element that already wears a silk ring gets a thicker one**
   (1.5 px → 2.5 px) rather than a second ring. Without that the starter-pack
   chips — ringed at rest — had no visible hover at all by day. The hover
   ring lives in `::after` so it can coexist with `silk-ring`, which owns
   `::before`.

**Consequences.** The vocabulary chips get their warm silk back: they went to
plain ink borders only because a gradient edge could not invert with the
thing it wrapped, and the frost does not touch the border. `hover-line`
(fields) and `hover-danger` are unchanged; `hover-lift` stays its own tier.
One open tension, worth watching: the silk ring already means "this one
matters" on the player and the moment chips, and now also means "the pointer
is here". If that reads as noise, the hover ring is the half to change —
`--ring-g` takes a quieter gradient without touching anything else.

## ADR-36 — A gradient token holds stops, never `var(--silk-a)` (2026-09-18)

**Context.** Angel noticed the silk rings had stopped turning — not the hover
ones, the ones that are ringed by default. The animation was _running_:
probing `::before` gave `animation-play-state: running` and `--silk-a:
86.2469deg`, advancing every frame. Not one pixel moved.

**Cause.** A custom property's `var()`s are substituted where the property is
**declared**, not where it is used. ADR deduplicating the ramp put the whole
gradient in one token on `:root`:

```css
--silk-conic: conic-gradient(from var(--silk-a), …); /* declared on :root */
```

so `var(--silk-a)` resolved against `:root`, where the registered property
(`inherits: false`) sits at its initial `0deg` forever. Every ring painted the
same frozen gradient while its own `--silk-a` animated underneath, unread.

**Decision.** The tokens hold **colour stops only** — `--silk-stops`,
`--silk-warm-stops`, `--silk-cool-stops` — and each use site writes its own
`conic-gradient(from var(--silk-a), var(--ring-stops, var(--silk-stops)))`.
The single source of truth for the colours is kept, which is what ADR-34's
deduplication was for; only the angle moves to where it can be animated. The
per-element override is `--ring-stops` rather than `--ring-g`.

**Also.** The frost's fill was painting to the border box while a ring's
`::before` is absolutely positioned and so sits on the **padding** box —
inside the element's own border. That left a hairline of white outside the
ring and the button read as having two borders (Angel's screenshot).
`background-clip: padding-box` on the frost makes the ring the edge, with
nothing drawn beyond it.

**Consequences.** Verified by animation rather than by inspection, which is
the only way this class of bug shows: two screenshots two seconds apart,
diffed. Before, the maximum channel difference across the ring was **0**;
after, **151**, for the resting rings and the hover rings, in both themes.
`e2e/_hover.mjs` cannot see this — it reads rules, not pixels — so any future
change to the ramp should be checked the same way.

## ADR-37 — The suggestion lists drop function words (2026-09-18)

**Context.** "Seen in this VOD" and "Most used words" were offering `is`,
`that`, `it`, `did`, `de`, `la` — grammar, not vocabulary. Angel: they
"contaminate the utility of this section without providing any value".

**Decision.** One `STOPWORDS` set covering all ten languages, applied to the
two suggestion lists only. It holds **articles, pronouns, possessives,
demonstratives, copulas and auxiliaries, prepositions and conjunctions**, and
bare numbers are dropped with it (a timestamp or a count is never a word to
score on).

What is deliberately **not** in it: negations and interjections (`no`, `nope`,
`нет`, `不`), question words (`what`, `why`, `qué`) and intensifiers (`very`,
`muy`, `很`). On Twitch those carry real feeling, and several are already in
the scoring's own reaction and mood lists — filtering them here would have the
suggestion list disagree with the scoring.

Three properties worth stating:

- **Emotes are never filtered**, whatever they are spelled like. A channel
  emote named `THE` stays.
- **Scoring is untouched.** This is a suggestion filter. A user who types a
  stopword in on purpose still gets it, and it still counts.
- **No language detection.** The whole list applies at once, because a chat
  code-switches constantly. A false positive costs one suggestion.

**Consequences.** On the example VOD the two lists went from `is / that / it /
did` near the top to `good / song / what / nice / first / time / chat /
brazil`. Japanese, Korean and Chinese benefit least — `TOKEN_RE` cannot split
`私は` into a pronoun and a particle — which is a known limit of tokenising
without a dictionary, not a reason to skip the other seven. Also cosmetic: the
kind label is now separated by a dash (`POGGERS – EMOTE`), and the `YOURS`
tag is gone from the words a user adds, since the cool silk ring already says
it.

## ADR-38 — "Detect from this VOD" says what it did, and adds (2026-09-18)

**Context.** The button was silent. On an English chat — where English is
already on and nothing else stands out — clicking it changed nothing visible,
so there was no way to tell it had worked at all (Angel, 2026-09-18). A
control whose most common outcome is "nothing to change" has to say so, or it
reads as broken.

**Decision.** Detection reports one of three answers under the pack row, for
eight seconds:

- **"Turned on Español."** — naming what it switched on;
- **"Español was already on — nothing to change."** — the result was right
  before you asked;
- **"No other language stood out. English is on, and whatever this chat
  actually says is in the two lists above."** — which also points at the
  thing that _is_ useful when detection finds nothing.

**And it adds rather than replaces.** `setPacks(packsToEnable(counts))`
overwrote the list, so a pack the user had turned on by hand disappeared the
moment they pressed detect, with no message — a silent undo of their own
choice. It now unions. Reset is still there for starting over, and is the
honest place for "forget what I picked".

**Consequences.** Three strings in ten catalogs. The e2e asserts both that
the note names Español on a Spanish chat and that a _second_ press still
answers, since the silent case was the whole bug.

## ADR-39 — The atmosphere steps aside while a video plays (2026-09-18)

**Context.** Angel: a giant semi-transparent rectangle flickering over the
dashboard while a VOD played — gone on pause, back on play.

**Cause, already written down here once.** `.hl-grain` is a fixed,
full-screen layer with `mix-blend-mode`, and `.hl-mesh` is a 70 px blur
animating forever. Together they put the whole page on Chromium's _blended_
compositing path, where stale tiles are a known artifact. The same pair had
already been turned off for touch devices in 2026-09-17, when the heatmap
card would come back blank after a scroll. A `<video>` repainting sixty times
a second under a blended full-screen layer is the heaviest version of that
same situation, and it produces the same artifact at page scale.

**Decision.** `TwitchPlayer.vue` sets `data-playing` on `<html>` while the
embed reports playing and clears it on pause and on unmount. While it is set,
the grain drops to `mix-blend-mode: normal` at 55 % opacity and the mesh's
animation stops — exactly the compromise phones already get. The atmosphere
comes back the moment playback stops.

**Consequences.** `e2e/smoke.mjs` drives the stubbed player's `playing` and
`pause` listeners and asserts the computed `mix-blend-mode` and the mesh's
`animation-name` in all three states; the probe has to sit while the embed is
still mounted, which is the kind of detail that makes a test like this pass
for the wrong reason. If a flicker is ever reported again with this in place,
the next suspect is `backdrop-filter` on the large cards, not the blend layer.

## ADR-40 — The chat model is chosen in a panel, not a dropdown (2026-09-18)

**Context.** NanoGPT serves close to six hundred chat models and the AI box put every one of
them in a `<select>`. That list is unusable: no prices until after you choose, no families, no
search, and no way to ask the question people actually ask — "what is the cheapest thing that
can read a chat log?". Angel has the same problem solved in another NanoGPT app of his and
asked for the same shape here.

**Decision.** `features/ai/components/ModelPicker.vue`, a sheet with two panels. Left: a search
box, a "use the recommended model" row that names what `pickDefaultChatModel` resolves to, and
the catalogue grouped by family with a count per group. Each row carries the name, the id, the
month the model appeared and input/output price per million tokens. Right: sort (family, name,
cheapest, priciest, newest, oldest) and one toggle per family, folding under the footer's
"Filters" button below 720 px. Arrows and Enter drive it from the search box, so a model can be
chosen without the pointer moving.

The family is **read off the id** (`lib/nanogpt/catalog.ts`): NanoGPT has no provider field, but
it does namespace ids (`anthropic/…`, `qwen/…`, `deepseek-ai/…`), and rehosts like `TEE/…` and
`huihui-ai/…` are caught by matching the tail and the name too. Everything in that module is
pure, so the grouping, the sorts and the search are unit-tested against a slice of the real
catalogue rather than through the DOM.

Provider glyphs are geometry drawn in **ink**, not brand colours (Angel, 2026-09-18): nine real
brand palettes in one panel would fight the hype thread. The chosen row wears the silk ring, the
same "this one" the rest of the app uses; an ink wash would have made it a grey row.

The speech model keeps its `<select>`. Three options do not need search, families or filters.

**Consequences.** `ModelInfo` gained `created`, so the catalogue's dates survive into the UI.
The list is plain DOM — six hundred rows built per query — which is fast enough today and would
want a virtual scroller if the catalogue tripled; that is written on the component. `e2e/ai.mjs`
serves five models across four families and drives the whole panel: search, both price sorts,
the family filter, a click, and a keyboard pick.

## ADR-41 — The rail is a shared shell, not a part of the dashboard (2026-09-18)

**Context.** The library rail — brand, VOD input, the VODs cached in this browser, the clips
link, storage, settings — was written inside `DashboardPage.vue` and existed only there. The
gallery is reached _from that rail_, and then lost it: no library, no settings, no VOD input,
a different header, a "Dashboard" button standing in for the way back. Angel: "it looks like a
completely different page not in syntony with the rest."

**Decision.** `src/ui/LibraryRail.vue`. It owns everything that travels with the rail: the
small-screen top bar, the drawer and its scrim, the library it lists (IndexedDB), the storage
figures, and the settings overlay — the three move together, so they live together. The page
above it says only which VOD is open (`activeVodId`), whether to offer the home button, and
what to do when something is picked: the dashboard loads a VOD in place, every other page
routes to it, so the rail **emits** `open` / `live` / `home` / `purged` rather than acting. It
exposes `openDrawer`, `closeDrawer`, `openSettings` and `refresh` for the two cases the page
does drive — the tour pointing at the rail on a phone, and the AI card's link to Settings.

Both pages now use the same `lg:grid-cols-[260px_minmax(0,1fr)]` shell, so the gallery is the
desk with a different right-hand column.

**Consequences.** `DashboardPage.vue` lost ~120 lines of template, eight imports and the
library/settings/drawer state. `gallery.dashboard` is gone from the ten catalogs: the rail's
home button is the way back. `cut.mjs` walks from the desk to the gallery through the rail's
Clips link and back through the rail's library, which is the loop Angel described. The tour
still targets `data-tour="rail"`, which now lives in the component — anything else that wants
the rail gets it by mounting one, and should not copy it.

**Amended 2026-09-19.** Moving Settings into the rail moved the watcher that closes it when the
tour is asked for, and that turned an ordering into a race: the page's own `tour.requested`
watcher runs first (a parent's setup registers before its child's), calls `tour.start()`, and
`start()` clears `requested` — so the rail's watcher saw `false` and left the overlay up, over
the tour, on two phones in three. The rule now is declarative rather than ordered: the settings
overlay renders on `showSettings && !tour.active`, so it cannot paint over the tour whatever any
flag does in whatever order. `tour.mjs` asserts it on the phone pass. Anything else a page tells
the rail to do while something else is starting deserves the same treatment — a condition, not a
callback.

## ADR-42 — The relay belongs on the Workers paid plan (proposed, 2026-09-21)

**Context.** ADR-16 left one thing open: re-check Cloudflare's terms on
pushing video bytes through a Worker before launch. Checked 2026-09-21,
and the ground has moved since we wrote that. The old blanket rule —
section 2.8, "no non-HTML content through the CDN" — was retired in
Cloudflare's 2023 rewrite. The restriction did not disappear; it became
**service-based** rather than content-based, and now lives in the CDN's
own service-specific terms: you must use one of the named services "in
order to serve video and other large files via the CDN", and Cloudflare
may disable CDN access for anyone serving video without them. The
Developer Platform — Workers — is on that named list, which is the good
news: a Worker relaying video is the shape they point you at, not the
one they forbid. The Developer Platform's own terms add nothing about
media, only a general clause letting Cloudflare throttle anything that
puts "an undue burden" on the network.

Two details keep this from being a clean pass. The clause says *Paid*
Services, and `relay.hypeline.live` is on the free plan. And our worker
sets `cf: { cacheEverything: true, cacheTtl: 300 }`, which deliberately
puts Twitch's segments into Cloudflare's CDN cache — the CDN is exactly
the surface that clause is about, so it is the one part of our path that
invites the question at all.

**Decision (proposed — Angel's call).** Move the relay to the Workers
paid plan, $5/month. It puts us unambiguously inside the named-service
allowance, and it keeps the segment cache, which is worth keeping: two
people trimming the same popular moment hit the cache instead of
Twitch's CDN, and a user re-trimming the same clip pays for the segments
once. The alternative, at no cost, is to drop `cacheEverything` and let
the worker be a pure pass-through with nothing of Twitch's resident in
the CDN — cheaper, and slower for everyone.

**Consequences.** If we take the plan, Hypeline stops being free *to
run* — about $60 a year, borne by whoever operates the deploy — while
staying free to use, which is the promise that matters and the one in
the README. Nothing in the app changes and no user sees a difference.
If we take the one-line change instead, record it here as a reversal
rather than an edit. Either way this is a reading of terms by a
non-lawyer: it is a judgement about what is clearly fine, not advice.
Re-check if the relay ever carries real traffic, because "undue burden"
is measured, not defined.
