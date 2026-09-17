# 08 — Design system: "the hype thread"

Chosen by Angel on 2026-09-13 after three rounds of explorations (see
`design/`): ten static boards (rejected as flat), a live technique board,
a Stripe-inspired silk-ribbon prototype, ten thread variations, nine
studies, nine finalists → **Spindle · hue** as the thread, and ten hero
compositions → **Masthead** as the landing layout.

## Idea

The chat hype curve _is_ the brand. It is drawn as a silk ribbon (a WebGL
fragment shader) whose thickness follows the scored chat: thin and calm
in quiet stretches, swelling and brightening at every moment. The data is
also drawn literally as a thin ink spine through the ribbon. Everything
else on the page is quiet paper and frosted glass so the thread is the
only colour.

## Tokens (`src/style.css`, Tailwind `@theme`)

| token                                    | value                                     | use                                                                 |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `ground`                                 | `#fbf9fa`                                 | page background (never pure white)                                  |
| `ground-2`                               | `#f3eef2`                                 | subtle alt surfaces                                                 |
| `ink`                                    | `#221c2a`                                 | text, primary buttons, the spine                                    |
| `ink-2`                                  | `#3b3444`                                 | body copy                                                           |
| `muted`                                  | `#6f6779`                                 | labels, captions, axes                                              |
| `line`                                   | `rgba(34,28,42,.12)`                      | hairlines, dividers                                                 |
| `petal / apricot / butter / sky / lilac` | `#ffd0e4 #ffdcc4 #fff0bd #cfdcff #ddd0ff` | tints of the thread palette for alerts and chips, never large fills |
| `accent`                                 | `#7a4f8e`                                 | the italic word, links, playhead                                    |
| `danger / warn`                          | `#b03a4a / #8a6a10`                       | on petal / butter tints                                             |

Type: **Gloock** (display: wordmark, headlines, moment titles),
**Manrope** (body, buttons), **JetBrains Mono** (eyebrows, timestamps,
numbers — always `tabular-nums`). Self-hosted under `public/fonts/` since 2026-09-15 (`src/fonts.css`).

Utilities: `glass` (panel), `glass-sm` (chips/buttons), `eyebrow`,
`btn-ink`, `btn-ghost`, `field`. Rounded 12–18 px. Shadows only on glass.

Atmosphere (App shell): `.hl-mesh` — four blurred pastel radials drifting
30 s, opacity .55 — and `.hl-grain` — SVG fractal noise multiplied at 30%.
Grain is what makes pastel read as paper, not UI kit.

## The thread (`src/ui/HypeThread.vue`, `src/ui/thread/`)

- `series.ts` — `buildSeries(scores, {n, sigma, gamma, peaks})`: box-resample
  to `n` samples, gaussian-smooth (`sigma` in samples), floor at the 55th
  percentile so the baseline is thin, normalise the strongest moment to 1,
  power curve `gamma`. `hueField` gives each top moment a hue family
  (`HUE_FAMILIES`, palette-cycle offsets) with soft gaussian blending.
  Uploaded as an RGBA8 1-D texture (R = hype, G = hue).
- `shader.ts` — Spindle · hue: symmetric silk, width `(0.015 + 0.21·h)·scale` (the approved masthead numbers — do not fatten it for real data; tune the _series_ instead)
  of the canvas height, fbm warp + streaks + fold + centre sheen, palette
  **Stripe silk, softened** — blue `#8fb0ff` → violet `#af84ff` → pink `#ff77b5` → orange `#ffa969` → yellow `#ffde69` (Stripe's hues ~15% towards white, saturation ×1.05; chosen by Angel 2026-09-13 from five candidates in `design/thread/hypeline-thread-colours.html`) shifted by hue + position; ink spine
  (`u_ink`); reveal from left by `u_prog` with a tip dot; `u_t0/u_t1`
  show a sub-window; `u_ground` paints the atmosphere itself (off in the
  app — the shell's mesh is behind).
- Props: `series, progress, window, cy, scale, span, ink, ground, still`.
  Transparent canvas, DPR capped at 1.5, pauses when off-screen, honours
  `prefers-reduced-motion`, releases the GL context on unmount. Fallback
  when WebGL is missing: a quiet CSS band.
- Tuning that works on real chat (not the hand-drawn demo curve):
  the landing page uses a curated example curve (`seriesFromPeaks`, the five moments from the prototype) revealed by scroll (hero pinned 280vh); the VOD timeline uses real buckets with `sigma 8, gamma 1.25, floor .55`. Palette anchor `0.77` so the strongest moment lands on petal, comeback on sky, raid on lilac; hue drifts with time very slowly (0.003/s). On a transparent canvas the shader outputs the pure silk colour with alpha — never pre-mixed with the paper, or it bleaches.

### Behaviour

- Ends: the thread starts and finishes as a point (width tapered over the
  first 5% / last 4.5%), never a cut edge.
- Idle: before the first scroll only the ink dot is visible — it breathes,
  is an **eye** (chosen from `design/thread/hypeline-dot-idle.html`,
  2026-09-13): a glint top-left, it looks ~6 px towards the pointer
  (`u_look`, eased in `HypeThread`), and blinks every 3.3 s, sometimes
  twice. Off under reduced motion; gone while the thread draws and back at
  the tip once it is fully drawn (`endDot` prop, landing only).
- Pointer: no global parallax and no pull (removed 2026-09-13). The one
  pointer interaction is **ripple on click**: a bright pulse runs along the
  silk both ways from the click for ~3 s (`u_click`/`u_clickT`, same clock
  as `u_time`). `HypeThread` prop `ripple`: `'page'` on the landing (any
  click that is not on a control), `'canvas'` (default) on the VOD
  timeline, `'off'` to disable. Off under reduced motion.

### Depth (2026-09-14, v4 — one ribbon)

After Stripe's ribbons (Angel's reference video). **One continuous sheet**,
no layers (v2/v3's extra sheets left white gaps at thin sections and their
hard-over-soft edges read as two threads). Depth is a property of the
ribbon itself, `silk(x, dS, px, hue, T)` with `dS` the _signed_ distance
from the spine in half-widths: each edge has its own depth field along the
length (`farTop`/`farBot`, `sin(T*7 + …)`, out of phase so the ribbon
twists, drifting slowly), and bands across the width are nearer or farther
than their neighbours (`band`). **Near**: crisp ~1.5 px edge (from the
pixel width), a coarse brush of streaks along the flow plus a fine one
(hundreds; faded out under ~60 px wide so it never aliases), fold shadow,
full colour. **Far**: a wide soft edge that spreads a little beyond the
width, streaks fade, 14 % paler, slightly translucent. Colour is one smooth
band field for the whole ribbon (no per-layer hue). Geometry, palette and
widths unchanged. Compositing is a single straight-alpha output (the v2
`over()` helper is gone).

**Series precision (2026-09-14).** The hype series is stored in the 1-D
texture as 16 bits (R = high byte, B = low byte; G = hue) and the shader
reconstructs it with a Catmull-Rom spline over the four nearest texels
(texture filtering is NEAREST; `u_n` = sample count). With 8 bits and
linear filtering the ribbon's edge showed as straight segments and steps
once its edge was crisp.

## Moment cards (Tab + Pin, chosen 2026-09-13)

From `design/thread/hypeline-moment-cards.html`: a glass card whose
timestamp/meta line is an **ink pill sitting on the card's top edge** (tab),
**pinned to the peak** by a 1 px ink stem (20 px) ending in a 7 px ink dot on
the thread's top edge. The wrapper is anchored at the peak's top edge and
translated up by its own height. Motion **Stagger** (chosen 2026-09-13 from
`design/thread/hypeline-card-motion.html`): when the reveal passes the
moment the dot scales in, the stem grows up, the box fades in, then pill /
title / sub rise in turn (~100 ms apart, ~0.9 s total); leaving runs the
parts in reverse. The glass box carries `will-change` so its backdrop blur
is present from the first frame (the old fade of the whole wrapper made the
blur arrive late). Reduced motion: instant. Cards are `pointer-events-none`.

## Axis (Ruler + Ink + Reveal + Magnet, 2026-09-13)

From `design/thread/hypeline-axis-motion.html`: a ruler of 10-minute ticks
(1 px, ink 32 %, 4 px; hour ticks 55 %, 7 px) drawn in with the thread via
`clip-path`. Hour labels (mono 11 px) sit at their true position along the
span; nothing shows before the first scroll (the 0:00:00 label waits for
`progress > 0.005`, so the first view is only the eye); once the thread
passes a label it **reveals** (fades in rising 8 px,
0.5 s) and takes the **silk's colour at that position**; the label nearest
the tip (within 8 % of the VOD) is the **magnet**: it lifts 3 px, scales to
1.3× and goes bold, easing back as the tip moves on (`--near`) (palette interpolated in `silkAt()`, 22 % towards ink for
legibility, weight 600). An hour label that would collide with the end
label is dropped.

## Call to action (Pill first + ribbon, 2026-09-13)

From `design/thread/hypeline-cta-entrance.html`: the pitch line, VOD pill
and footer are hidden until the thread is fully drawn (`progress ≥ 0.985`).
Then the **pill springs open** from the centre (scale .2×.6 → 1, 0.7 s with
overshoot), the pitch fades in rising 12 px 0.45 s later, the footer at
0.9 s; scrolling back up reverses quickly. The pill wears a **glow ring**
(after a reference Angel sent, 2026-09-14): not a uniform border but a few
iridescent arcs of the silk colours with gaps between them, travelling
around the pill — a sharp 2 px ring (`.ribbon::before`, 7 s) over a faint
white hairline, and a wider blurred band behind it for the glow
(`.ribbon::after`, 8 px, blur 7 px, 11 s the other way). Both are masked to
the ring so the glass stays glass (`@property --ribbon-a/-b`; static where
unsupported, off under reduced motion). Note:
Tailwind v4 centres with the `translate` property, so entrance transforms
must not include `translateX(-50%)`.

## Landing page (Masthead)

Wordmark `clamp(60px, 11vw, 168px)` at the top with the eyebrow tagline
(line-height 1.04 + `.08em` padding so Gloock's descenders never touch it);
the example thread (tokyosims fixture, `demo/demoSeries.json`, regenerate
with `npx tsx scripts/gen-demo-series.ts`) at `cy .52, scale .85, span
4–96%`, drawing itself in 2.6 s on load; up to three glass moment cards
above the peaks (≥10% of the VOD apart); hour axis; one-sentence deck;
the VOD pill, a `Dashboard` link top-right, and the one-line footer — all inside the pinned hero, so nothing follows it: when the thread finishes drawing the page has also reached its end (no extra scroll to a footer). Nothing else (Angel, 2026-09-13): no recent-VOD list, no settings, no example-VOD label, no drawn/peaks readout on the landing — those live on `/dashboard` (`DashboardPage.vue`).

## VOD page

Same shell. The `HypeTimeline` keeps its SVG interaction layer (markers,
playhead in accent, in/out in ink, drag handles) over a `HypeThread` fed
by the real buckets; the zoom strip is the same component with a
`window`. Panels are `glass`; controls `btn-ink / btn-ghost / field`.

## Rules

- No coloured edge stripes on cards or rows (2026-09-15). Colour lives in
  the thread, the chips' silk foot, dots, rings and tinted shadows — never
  as a left border.

- One piece of colour per screen: the thread. Alerts use pastel tints.
- Motion: the thread drifts on its own; UI transitions ≤ 500 ms, eased;
  nothing else animates unless it carries information (reveal = "found").
- Glass panels belong to the background: blur + saturate, 1 px white top
  highlight, no borders in ink.
- Text on the thread is fine (Stripe rule): ink stays legible on pastel.
- Keep the split-layout / crop previews on the upgrade list; design does
  not change function.

## Dashboard (Desk + Library, chosen 2026-09-14)

From `design/dashboard/hypeline-dashboard-layouts.html`. `/dashboard/:id?`
(`DashboardPage.vue`) is the app; the old VOD page is gone (`/vod/:id`
redirects). Grid `260px | 1fr` (stacks under `lg`):

- **Rail** (glass, sticky): wordmark → `/`, compact VOD input, "In this
  browser" list (title, streamer · length · clips; hover shows _remove_),
  then storage / shim / NanoGPT summary and a Settings toggle that opens
  `SettingsPanel` at the top of the main column.
- **Main**: quota banner; a glass **VOD card** (eyebrow streamer · game,
  Gloock title, mono meta, the `HypeTimeline`); then three columns
  `1fr | 1.35fr | 0.9fr` (single column under `xl`): **Moments**
  (`MomentList`: petal time pill, reason, `#n · score`; clicking a row
  enters clip mode — no button),
  **player + shortcuts + zoom timeline + ClipPanel**, **AI + Search**.
- Empty state: a glass card "Paste a VOD link to start."
- The dashboard timeline (`HypeTimeline`) draws the thread as a **clean SVG
  ribbon**, not the WebGL silk (Angel, 2026-09-14: the silk stays on the
  landing; the quieter ribbon reads better at timeline size): the curated
  series (`seriesFromPeaks`) as a symmetric path, filled with the silk
  gradient along x, a blurred copy behind at 50 % as a halo, a faint
  horizontal-thread pattern on top, the ink spine through the middle. In a
  zoom window the amplitude is normalised to the window's own peak.
- Moment markers are **pins**: a 1 px hairline from the spine up through
  the peak to a filled ink dot just above it (the white dot with a border is
  retired). Hovered / active pins grow (dot r 2.6 → 4.2).
- **Timeline interactions (2026-09-14):** hover → glass readout (time,
  hype ×, chatters, the top repeated chat lines from `burst()`, and the
  storyboard frame when `seekPreviewsURL` could be fetched through the
  shim); pins ↔ moment rows highlight each other (`hoverMomentId`), clicking
  a pin selects the moment (seek + clip range + zoom around it); **drag on
  the ribbon brushes** the In→Out range (a click without movement seeks;
  a range dragged shut — under 6 px on screen, by brush or by pulling a
  handle onto the other — clears the range entirely, `clear-range`);
  wheel / pinch zooms around the pointer, Shift+wheel or horizontal wheel
  pans, and a **minimap** (36 px, the whole VOD with the window as a glass
  box) appears under the ribbon when zoomed — drag it to move the window;
  exported clips show as **ink brackets** along the bottom, grabbed
  thumbnails as tiny frames; `,` / `.` jump peak to peak, `Enter` selects
  the nearest; a **seek pulse** (white band spreading both ways, 0.9 s)
  marks where you clicked. The separate clip-zoom strip is gone: selecting
  a moment zooms the main timeline instead — **gliding** there (van
  Wijk–Nuij smooth pan-and-zoom, ρ 1.42, 0.7–1.4 s by path length,
  smootherstep — pan and zoom are one coupled motion and arrive together;
  instant for the user's own
  wheel / minimap steering and under reduced motion). In a zoom window the
  ribbon shows the window's own shape (lowest point near the spine, highest
  near the top) so a slice of a broad bump still reads as a curve.
- **Grabbing the In / Out handles** (2026-09-15): a press within 12 px
  (mouse) or 26 px (touch / pen) of a handle line grabs it — resolved in
  `onDown` by screen distance, nearer handle wins — and the handle keeps
  the finger's offset while dragging instead of jumping under it. A **tap** on a handle (no
  drag past 4 px) seeks the player to exactly that In / Out second with the
  seek pulse. Further away, a drag is a new brush selection as before. The transparent rects on
  the lines only carry the resize cursor now.
- **Pins in screen pixels** (2026-09-15): the timeline SVG is stretched
  (`preserveAspectRatio="none"`), so round things drawn in viewBox units
  squash as the box narrows — on phones the pin dots were slivers. Pin
  dots, the seek ring and the lane-front dots are `<ellipse>`s with
  `rx = px · sx`, `ry = px · sy` (`sx = W / box width` from a
  ResizeObserver, `sy = H / 176`): 3 px dots (4.5 px hot), 5 px ring, and
  a 28 px-wide hit area from above the dot down to the spine.
- **Shortcuts vs. the embed** (2026-09-15): the Twitch embed is a
  cross-origin iframe; once it had focus our shortcuts went deaf and the
  player's own keys took over. `TwitchPlayer.vue` hands focus back to the
  page whenever the iframe takes it (`window` blur → next tick → blur the
  iframe), so keys always reach Hypeline's shortcuts; the player's own
  keyboard bindings are effectively off.
- **Shortcuts help** (2026-09-15): the robot-looking shortcut line under
  the player is a `?` (`ui/ShortcutsHelp.vue`, glass-sm, 28 px) that opens a
  glass popover on hover or tap — a `KEYBOARD` eyebrow and a two-column
  list of `<kbd>` keys → plain-language actions (from `SHORTCUTS` in
  `useShortcuts.ts`); Escape or a click outside closes it. Desktop only.
  Also: every pressable thing (`button`, `[role=button]`, `select`,
  `summary`, checkbox labels) has `cursor: pointer`; disabled buttons don't.
- **Silk ring** (2026-09-15): `silk-ring` — a 1.5 px hairline of turning
  pastel arcs (the landing pill's ribbon, quieter: one layer, 8 s, over the
  faint `--color-line`) via a masked conic-gradient `::before`; the element
  needs a border radius. Used on the rail's **In this browser** box and its
  **Settings** button.
- **Settings overlay** (2026-09-15): Settings opens as a modal over the
  blurred page (`bg-ink/35 backdrop-blur-md`, teleported to body, z-70) with
  a near-solid glass panel (`max-w 560`, scrolls past 88 vh), a `×` top-right;
  the ×, a click on the backdrop or Escape close it; 0.2 s fade + lift.
  In the Library rail, a cached VOD's remove is a red `×` (`--color-danger`,
  always visible, red wash on hover).
- **Silk buttons** (2026-09-15): `btn-silk` is the primary action in the
  dashboard — Export clip, Find the moments (rail and empty desk), and the
  AI panel's Transcribe / Explain / Search / Transcribe VOD. `btn-ink`
  remains for the landing pill (its ring is already silk) and segmented
  choices; `btn-ghost` for secondary actions (thumbnail grabs, cancel,
  Library, Settings).
- **AI panel as an instrument** (2026-09-15, board
  `design/dashboard/hypeline-ai-panel.html` #7): one box for the moment
  and the whole VOD (the old Search panel is folded in). **Readouts** in
  mono rows — `RANGE` (In → Out · s, transcribed / chat only), `CHAT MODEL`
  and `SPEECH` (pickers styled as readouts, price beside), `COVERAGE` (a
  silk bar of the transcribed stretches, h:mm:ss / total), `WALLET`
  (balance, spent here); in a narrow column (`@container` < 380 px) the
  note drops under the value. A **status line**: an LED (amber, blinking
  while busy) + stage text + a 96 px silk progress that sheens while
  working. Two run buttons, `Transcribe` and `Explain`, both **silk** (`btn-silk`), each
  carrying its estimate as a mono `cost`. Results as quiet cards
  (transcript scrollable; explanation with a Gloock title, five silk dots
  for clip-worthiness, suggested trim + apply). Under a rule: the search
  field + `Search` (silk), then from / to /
  `Transcribe VOD…` always visible, as the full-width **silk button** — `btn-silk` in style.css: a
  pastel gradient drifting slowly (7 s loop, off under reduced motion),
  ink text in both themes, its chunks · $ · MB estimate on a second line —
  the one action in the box that wants the eye), hits with seek + `clip this`.
  **No key** (Angel's pick, tint B): the whole box is a sky→lilac pastel
  card — `AI · OFF`, "Bring your own key", one line pointing to
  **Settings** (link opens the settings panel, and the drawer on a phone).
  The key field and referral link now live in `SettingsPanel.vue`.
- **Export queue** (2026-09-15): `+ Queue` beside Export snapshots the range
  and settings as a job; `queue all N as clips` under the Moments header
  queues a 45 s window around every moment. The Clip panel's **Queue** block
  (eyebrow `QUEUE · done / total`, a silk `Export N clips`, `Stop`, `download
all`, `clear done`, one ink progress bar across the run) lists jobs as mono
  rows — range · aspect · mode · state — each with a red × to drop it. Jobs
  run one after another; a failure marks that row and the run continues.
  Modes are now labelled `fast · ±2 s` and `exact` (the re-encode).
- **Clip preview** (2026-09-15): a ghost `Preview` beside the silk Export
  renders the first 10 s of the range from the 360p variant with the real
  crop / split (re-encoded when there is one, ~6 s for 10 s) and shows it
  above the export row as a small looping muted `<video>` sized by its aspect
  with a × to dismiss; a mono caption gives range · variant · aspect, and
  when the range or framing changes afterwards the video dims and the
  caption says "settings changed — preview again".
- **Clip panel as a filmstrip** (2026-09-15, board
  `design/dashboard/hypeline-clip-panel.html` #7): the range is an editor's
  trim — two 16:9 **handles** (the storyboard frame at In / Out, else a
  silk placeholder in the colour of that position, with a silk bottom edge
  and a dark foot) with `IN` / `OUT` tags and the time **editable in place**
  on the frame; tapping a handle seeks there (or sets it at the playhead
  when empty). Between them the duration in Gloock over a silk bar, which
  turns danger-red past 10 minutes. `play from In` sits under the bar (the
  limit note replaces it past 10 min; an empty range says "tap a frame to
  set it"); In / Out are set by tapping an empty handle or with the I / O
  keys — no set buttons (Angel, 2026-09-15, to save height). Settings are **segmented pills**
  (`seg` / `seg-opt` utilities, `aria-pressed` for the chosen one): quality
  (mono) · mode · aspect; crop / cam sliders appear only for the aspects
  that need them; captions row with style pills; thumbnail row (title,
  `Use In frame`, `Grab at playhead`); ink Export with the limit note in
  its place. Exported clips list unchanged.
- **Clips gallery** (2026-09-15, `/clips`, `GalleryPage.vue`): every clip
  cut in this browser across VODs, newest first, as a grid of glass cards —
  the video (sized by its aspect), a **title** in Gloock edited in place, a
  mono line (streamer → link to that VOD · range · aspect · variant ·
  captions · MB), **tags** as mono chips with a `+ tag` inline field and a ×
  per tag, then `Share` (silk; the OS share sheet with the file where the
  browser can, else a download), `download`, and the red `×` (purge). Tag
  chips at the top filter the grid; the h1 counts clips and MB. Title and
  tags are stored on the clip (`StoredClip.title/tags`); the title also names
  the file. The rail links there (`Clips · N in this browser →`, silk-ring
  like Settings) above the storage lines.
- **Export presets** (2026-09-15): a `Preset` seg group above the format
  pills in the Clip panel — TikTok (9:16 · exact · 720p · captions), Shorts
  (9:16 · exact · source · captions), X / Discord (16:9 · fast · 720p),
  Square (1:1 · exact · 720p). A preset is a one-tap fill of the pills below;
  it lights while the pills still match it and goes dark the moment one is
  changed by hand.
- **Copy title & hook** (2026-09-15): in the AI instrument's Explain result,
  beside `apply to in/out`, copies `title` + blank line + `hook` to the
  clipboard and reads "copied" for 1.5 s.
- **Example VOD** (2026-09-15): the empty desk offers a ghost
  `Try it with an example stream` (the tokyosims VOD `2871164819`) so a
  first visit has something to click; it runs the normal load.
- **Chat-file import** (2026-09-15): the error banner on the desk gains a
  ghost `Import a chat file` on its right, and the empty desk a muted one-line
  "Chat replay not reachable? You can also import a chat file saved with
  TwitchDownloader (JSON)." Both open the same hidden file input; the rest is
  the normal ready state (the VOD card says "imported chat" for the streamer
  when Twitch could not be asked).
- **Live on the dashboard** (2026-09-16, ADR-18; the separate live page of
  2026-09-15 is retired): a recording VOD's mono line reads `· ● live · chat
connected · watch on Twitch ↗` (a 7 px pulsing danger dot), the ribbon
  ends in a **live edge** — a dashed danger-red line the full height of the
  box, a 5 px beating dot on the spine and a red `● LIVE` pill (HTML, so
  the ribbon's non-uniform scaling cannot stretch the letters) hanging to
  the left of it; the edge is clamped to the drawn length so it never blinks
  (2026-09-16) — and the whole-VOD view grows to the right as chat arrives.
  In the Moments panel a `NEW WHILE LIVE · n` block sits under the header:
  the `Notify me when chat spikes` ghost button (silk-ring while on) and up
  to six rows (bold mono time → clip it, first reason in muted mono), or
  "Listening — keep this tab open…". The desk shows "Looking up channel…"
  while a channel resolves; an offline channel or one without past
  broadcasts is a plain error line. The VOD input accepts
  `twitch.tv/<channel>` everywhere (VodInput emits `live`).
- **AI moments** (2026-09-16, Angel): every hit of a transcript search is
  pinned beside chat's moments, and looks different at a glance. On the
  timeline the pin is **accent** (lilac): a dashed stem and a hollow dot
  (paper fill, accent stroke) instead of the ink dot; the ribbon's shape
  ignores them (it is chat's). In the grid the chip keeps the silk of its
  place in the VOD but carries a 1.5 px inset **accent ring** and an `AI`
  pill where the rank dial sits; its meter is the confidence (`5/5`). The
  moment card leads with `AI`, "you asked: …", the quote and the reason, and
  its footer reads `found in the transcript · confidence n/5`. The ribbon
  readout on such a pin shows `AI “quote”` above chat's lines. The VOD line
  counts them (`12 moments · 1 from your questions`), and the AI panel shows
  `AI · n hits pinned on the heatmap and in Moments · clear`. Hits from
  every search on the VOD accumulate (two within 20 s are one) until
  cleared or another VOD opens; clicking one builds the clip range on the
  words (`clipAnchor`: +10 s, the mirror of chat's lag shift).
- **Transcript on the ribbon** (2026-09-16, Angel): a 2 px **accent band**
  just above the ticks shows the stretches already transcribed (contiguous
  chunks merge), so what the AI can search is visible at a glance. While a
  whole-VOD transcription runs, the target range is the same band at 22 %,
  and the chunk being worked on gets a **scanning light** — a soft accent
  gradient (28 % at its crest) sweeping across the chunk over 2.4 s, SMIL on
  the gradient stop — while its band segment breathes (1.2 s); both stop
  under reduced motion. Nothing is drawn when there is no transcript.
- **Player frame** (2026-09-16, Angel): the video's rounded black frame
  (desktop column and the pinned phone player alike) sits in a `silk-frame`
  — the same turning silk as the Library card's ring, but as a solid 3 px
  pad _under_ the clipped black box rather than a masked ring on top of it,
  so the box's anti-aliased corners blend into silk instead of leaving dark
  pixels (Angel, 2026-09-16); `--ring-w` sets the width, `--ring-r` the
  child's radius — so the VOD reads as the desk's centrepiece.
- **Sensitivity slider** (2026-09-15; enlarged 2026-09-16): in the Moments
  box header, right of the title (an ink `h2` like Clip and AI, not an
  eyebrow — Angel) — `fewer ——●—— more` in ink-2 mono, a 5-step range on a
  132 × 6 px silk track with an 18 px ink thumb (`.sens`), persisted as
  `settings.sensitivity` (default 3); the grid re-picks its peaks live.
- **Moments as a heat grid** (2026-09-15, board
  `design/dashboard/hypeline-moments-box.html` #11 = Angel's mix of Heat
  grid + Dial + Filmstrip): `MomentList.vue` is a grid of 16:10 chips
  (`minmax(92px, 1fr)`, so three across on a phone and in the desk column).
  A chip's ground is the silk of its place in the VOD mixed with paper by its
  strength (score / best); a 22 px **ring** top-left carries the score as
  the arc and the rank inside; time (bold mono) and the rate multiplier sit
  at the bottom. With a storyboard the chip's ground becomes the **video
  frame** of that moment (sprite sheet as CSS background, 0.5 s fade-in),
  text goes paper over a bottom gradient, and the silk stays as a 3 px
  bottom edge. States: active = 1.5 px ink inset ring (the moment inside the
  clip range, else the one at the playhead); hovered (list or pin) = lift
  2 px + glass hairline; has a clip = a small "clip" tag top-right. The
  caption under the grid is only the hint (`hover a moment · click to clip
it`, or `tap a moment · tap again to clip it` on touch screens).
- **Moment card** (2026-09-15, Angel: the caption truncated): hovering a chip
  (or its pin on the timeline) opens a 272 px popover teleported to the body
  and placed under the chip (above it near the bottom of the viewport),
  `z-60`, never clipped by a panel — 96 % paper with blur, 14 px radius, the
  glass hairline, a drop shadow tinted with the chip's silk (no coloured
  stripe — Angel, 2026-09-15: edge stripes read as generated), a 160 ms
  fade + 4 px slide. Inside: the storyboard frame at 16:9 with the time in
  its bottom-left and the chips' 3 px silk foot (else the time in bold
  mono), `#rank` in the silk colour +
  the multiplier, every reason on its own line in body type, and a mono
  footer `n msgs · users chatters · score`. On a mouse it takes no pointer
  events; on touch screens (`hover: none` / `pointer: coarse`) the first tap
  opens it, a silk `Clip this moment` (or a second tap on the chip) clips,
  and a tap anywhere else closes it.
- **Dashboard on small screens** (2026-09-14): below `lg` the rail is a
  drawer (glass, slides in from the left over a blurred backdrop; opened by
  a **Library** button in a sticky glass top bar with the brand and the
  theme toggle; `inert` while closed) and the idle desk carries its own VOD
  input. Below `xl` the player is pinned under the top bar (`sticky`) and
  the three columns become **tabs** — Moments · Clip · AI — in an ink-pill
  segmented bar; tapping a moment switches to Clip. The shortcut help and
  the wheel hints in the timeline footer are hidden where there is no
  keyboard / wheel.
- **Portrait** (2026-09-14, ADR-15): under `(orientation: portrait)` the
  hero turns: the wordmark sits at 11 vh (clear of the header buttons), the thread runs down the screen (`HypeThread vertical`;
  span 30–68 % of the height, spine at 50 % of the width, scale 0.58),
  cards alternate sides (box shrinks to the room the peak leaves, ≤ 176 px,
  title 17 px, pill shortened to time · multiplier, stem horizontal to the
  dot on the ribbon's edge), the ruler stands at the left edge with labels
  in `writing-mode: vertical-rl` read upward (same reveal / magnet / silk
  colour), the hint sits under the eye at the top; the eyebrow balances
  onto two lines. Landscape is untouched.
- **Pitch copy** (2026-09-15): one line, "Turn a Twitch VOD into a
  collection of memorable moments." set in Gloock (`font-display`, like the moment titles; Cinzel was tried and dropped) (pitch 21 vh, pill 10.5 vh, footer 3 vh
  from the bottom in portrait; 14 / 6.5 / 2.5 vh in landscape).
- **Scroll hint** (2026-09-14): under the eye at its resting spot (thread
  start) a mono `↓ scroll down` in `text-muted` with a 1.6 s bob; it fades
  out (0.45 s) as soon as `progress > 0.005`, i.e. with the first scroll.
- **Playhead** (2026-09-14): a 2 px red line (`--color-playhead`: `#e0323c` day, `#ff5a63` night — the timeline's one signal colour) driven by the player
  component's own clock (seek-immediate, extrapolated while playing, ~30 Hz),
  so it moves the instant you seek and glides while a clip plays.
- **Loading choreography** (2026-09-14): while the chat replay is fetched
  the timeline is shown from the first batch; the drawn curve **tweens**
  to each rescore (450 ms) so peaks grow out of the spine; the ribbon is
  drawn in full only over the stretches the fetch lanes have covered
  (`loading` prop = per-lane `{start,end,covered}`), the rest as a 14 %
  ghost, and the covered stretch ends in a 22-unit **soft leading edge** (SVG
  mask) rather than a hard cut — a lane that has finished is drawn solid to its
  end, so no fade lingers once its front is gone; each lane's front is marked by a 1 px ink
  hairline (35 %) and a small ink dot on the spine that beats (scale 1→1.7,
  1.2 s) — the earlier white / lilac `--glow` scan lights were dropped (Angel,
  2026-09-14: they glared by night and vanished by day); new pins
  grow up from the spine and their dots pop (0.5 s). **Hovering a moment row**
  (2026-09-14) lifts the row 3 px with a silk bar on its left edge, and on
  the ribbon its clip window (−25 s … +20 s) gets a white spotlight band,
  a ring leaves its pin, and the readout opens **below the spine** (top 92 px of the 176 px box, so
  the pins stay visible). With a storyboard the frame (104 px) sits **beside**
  the text in a 336 px readout rather than above it, so the readout stays
  inside the box — the glass panels below are later stacking contexts and
  would paint over anything that overflowed (Angel, 2026-09-15).

## Locked player (2026-09-16)

When Twitch refuses the video (subscribers-only VOD) the player box keeps
its chromatic frame and black ground and carries a **paper card** —
`bg-ground`, eyebrow "Subscribers only", display headline naming the
streamer, one muted sentence, a ghost "watch on Twitch ↗" — over a
`bg-black/70` blur (`SubOnlyNotice.vue`). Not glass: glass over black went
grey and drowned the text. The same wording, shortened, tags the VOD line
in `text-warn` and sits beside the locked clip buttons.

## Ribbon gestures (2026-09-17)

Mouse and trackpad: wheel zooms around the pointer, Shift/horizontal wheel
pans, drag brushes a range. **Touch: two fingers zoom and pan** — the span
between them sets the zoom and the content under their midpoint stays
there, so the same gesture does both. The pinch owns the ribbon: it drops
the brush the first finger started, and nothing the fingers lift over (a
moment pin, most often) counts as a tap until the next gesture begins.
Bookkeeping runs in the capture phase, because the pins stop propagation
themselves. One finger is unchanged: tap seeks, drag brushes, a press near
In/Out grabs that handle.

## Scrims (2026-09-17)

Overlay veils use `--scrim-soft` / `--scrim` / `--scrim-strong`, never
`bg-ink/xx`: `--color-ink` flips to near-white by night, so ink-tinted
veils **lit the page up** instead of dimming it (Angel, on a phone in dark
mode). The tokens are ink-tinted by day and pure black, a little stronger,
by night. The rail drawer and the settings overlay take `--scrim`, the tour
`--scrim-strong`, the language and help sheets `--scrim-soft` (they lean on
their blur).

## Phone layout (2026-09-17)

Below `xl` the player no longer sticks: it ate a third of a phone screen
while the user read the moments. It scrolls away and the **tab strip** is
what sticks (under the top bar, `top-[56px]`), so switching column is
always one tap away; anything that needs the video — tapping a moment,
queueing every moment — switches to Clip and scrolls the player back into
view (`scroll-mt` keeps it clear of the bars).

## Tour (2026-09-17)

`TourOverlay.vue`: the page under one `bg-ink/45` + 3 px blur veil with a
rounded **hole** masked out of it (`mask-composite: exclude`, so blur and
tint both stop at the corner — Angel, 2026-09-17), 8 px padding, 18 px
radius and a 2 px silk ring over the step's target, and a **paper card** (eyebrow "Tour · n of 5",
display title, one muted paragraph, step dots, Skip / Back / Next-or-Done
with Next in `btn-silk`). Placement order: under, over, right, left of the
hole — never on top of it. Under 640 px it is a full-width sheet at the
**bottom, or at the top when the target sits low** (it used to cover the
very thing it described), and the step scrolls the target's top just under
the sticky bars so tall panels show their heading. Veil, hole
and card glide between steps on the app's ease (320 ms); reduced motion
snaps. The example VOD's player is a black card with a mono whisper
("Example VOD · no video"), its VOD line carries an accent "example" tag,
and its locked actions explain themselves in `text-warn`.

## Help sheet (2026-09-17)

The rail's **?** (`src/ui/SupportButton.vue`, `glass-sm`, between home and
the globe) opens a paper sheet like the language one: eyebrow "Help &
feedback", display headline, three **doors** — Suggest a feature, Report a
bug, Ask a question — each a row with an icon on its own pastel tile
(butter / petal / sky), a title, one muted line and a ↗, plus a mono
footer saying everything is a public issue on GitHub. Each door is a
prefilled GitHub new-issue link (`lib/support.ts`: template, label, title;
the bug one carries a short context block — version, browser, language,
theme, page and VOD id, whether the relay and the key are set, never a URL
or a key). The repo is `VITE_GITHUB_REPO`; the matching issue forms live in
`.github/ISSUE_TEMPLATE/`. Escape, the × and the backdrop close it.

## The mark (2026-09-17)

**H Spine · serif feet** (`src/ui/Logo.vue`), chosen by Angel from ten
candidates and five variations: a Gloock-weight H with slab feet and heads
whose crossbar is a hype-thread peak in silk. The stems are a clip's In and
Out handles; the peak between them is the moment. Ink follows
`currentColor`, the silk is the app gradient (peach → pink → lilac → sky →
butter, `userSpaceOnUse` so it survives straight strokes). It replaces the
wordmark in the dashboard rail (34 px) and the small-screen header (26 px)
to give the rail's buttons room; the gallery keeps mark + wordmark; the
landing page keeps its big Gloock masthead. Icons: `public/icons/mark.svg`
(favicon, ink flips with `prefers-color-scheme`), `icon-192/512.png` and
`apple-touch-icon.png` (the mark on a night tile with the silk hairline
ring), `maskable-512.png` (tile fills the square, mark in the safe zone).
**Hover ("Handles", chosen from five motions, 2026-09-17).** With the
`hover` prop, and only when the surrounding link or button is hovered or
focus-visible, the stems nudge 4 units inward and the peak tightens
(`scaleX .78, scaleY 1.12` from its base) over 380 ms on the app's ease,
then settle back: the clip's In/Out handles closing on a moment. The rail
and gallery links use it; the favicon and icons stay still; reduced motion
turns it off.

The PNGs were rendered from the tile SVG (mark on `#0c0a0f`, rx 16 of 64,
silk ring 2.2) with headless Chromium; redo them the same way if the mark
changes.

## Live labels in other languages (2026-09-17)

Two-word live labels ("EN VIVO", "AO VIVO") wrapped the heatmap's live pill
onto a second line and squashed its dot into an oval: the pill is
`white-space: nowrap` and its dot `flex: none`. The VOD line's dot carries
its own `margin-right` — Vue's template compiler drops the newline between
the dot and the word, so there is no space to inherit.

## Language sheet + globe (2026-09-16)

The first visit opens a **paper sheet** (`LanguageSheet.vue`): `bg-ground`
card, eyebrow "Language", display headline, one muted sentence, a 2-column
grid of language pills (native name over the English name), the current one
wearing the `silk-ring`, a `btn-silk` "Continue" and a mono "change it later"
whisper. Backdrop: a 10 px blur with only a faint ink tint (`bg-ink/8`) — the pastel
desk stays visible behind it (Angel 2026-09-16: blur, don't grey it out); it rises 14 px on entry
(`sheet-in`). Tapping a pill previews the language at once, so the headline
itself is the confirmation. The rail's **globe** (`LanguageMenu.vue`,
`glass-sm`, beside day/night on every page) opens a paper menu of the same
ten names, current one ringed and dotted. Both are paper, not glass: text
on glass over the dashboard read badly. Gloock and JetBrains Mono carry no
CJK or Cyrillic, so those scripts fall back to the system font in headlines
and mono labels — accepted.

## Night (2026-09-14)

Day / night is a second set of token values under `[data-theme="dark"]`
in `style.css`; `settingsStore.theme` (`system | light | dark`, persisted)
resolves to `dark` and stamps the attribute, and `index.html` pre-applies
it before first paint, with an inline `<style>` that colours `html` per theme
so the browser never paints white before the app CSS lands. `ThemeToggle.vue` (sun / moon, glass-sm) sits
top-right on the landing and in the dashboard rail. Night is a design, not
an inversion:

- **Paper** true black `#000000` since 2026-09-15 (Angel wanted to see it;
  raised surfaces `#0c0a0f`, lift `#2a2333`, glass-sm a 78 % near-black;
  the shader's dark paper is black too). Before that it was the player's
  plum-black `#16121a` / `#1e1824` / lift `#3a3146` / glass-sm
  `rgba(40,33,48,.72)` — the way back if he prefers it. Ink
  `#f3edf6`, ink-2 `#d6cddb`, muted `#9b91a5`, line white 14 %.
- **Tints** deep and slightly desaturated (petal `#5b2a46`, apricot
  `#5e3a26`, butter `#5a4b1e`, sky `#273258`, lilac `#3b2c60`); accent
  lifts to `#c9a3df`; `lift` (hover surfaces) `#3a3146`.
- **Glass** white 6 % over ink, line white 12 %; glass-sm a dark plum
  72 %; fields / ghost buttons white 7 % / 6 %. `btn-ink` text is the
  ground colour so it flips with the theme.
- **Atmosphere**: mesh at 35 %, grain switches to `screen` at 16 %.
- **Thread**: `u_dark` — spine, eye and pins become paper-coloured, the
  far haze goes towards the dark ground; palette unchanged. The dashboard
  ribbon's strokes use `var(--color-ink)` etc.; the landing's axis labels
  mix 22 % towards paper-white instead of ink.
- Everything else follows the tokens; components use `bg-lift/…` instead
  of `bg-white/…` for raised surfaces.
- **Switching** uses the View Transitions API: the new theme is revealed as
  a circle growing from the toggle (0.7 s, `hl-theme-reveal` in
  `style.css`, origin via `--vt-x/y/r`); a plain swap where unsupported or
  under reduced motion.
