# CLAUDE.md — Hypeline

Working codename: **Hypeline** (hype + timeline). Rename freely; grep for it.

## What this is

A free, open-source (MIT), browser-only Vue 3 PWA that turns a Twitch VOD into
clips. It has **no backend**. The user's browser talks directly to Twitch and to
NanoGPT (with the user's own API key). Our edge over generic clipping tools:

1. **Twitch chat replay is the hype detector.** Message-rate spikes, emote
   clusters and "CLIP IT" spam mark the moments; that costs nothing.
2. **No uploads.** We fetch only the HLS segments around each moment.
3. **AI is bring-your-own-key** via NanoGPT (LLM, transcription, image, video).
   Revenue = NanoGPT referral link shown in onboarding. Nothing else is monetized.

Read `docs/00-vision.md` before touching product decisions.

## Stack (decided — see docs/03-decisions.md before changing)

- Vue 3 + `<script setup lang="ts">` + Vite, strict TypeScript
- Pinia for state, Vue Router, VueUse
- Tailwind CSS + Reka UI (headless) primitives; no big component library
- Vitest (+ Vue Test Utils) for unit tests, Playwright for e2e
- ESLint (flat config) + Prettier
- PWA via `vite-plugin-pwa`; IndexedDB (via `idb`) for local persistence
- Video: official Twitch embed for viewing/seeking (ADR-9); `ffmpeg.wasm`
  (single-threaded, core served from `public/ffmpeg/`) for cutting/export
  (ADR-10). Video bytes reach the browser through the CORS shim
  (`shim/`, the "video relay": its URL is baked in via `VITE_SHIM_URL`,
  Settings → Advanced only overrides it — ADR-16). Twitch sign-in needs
  `VITE_TWITCH_CLIENT_ID`; the rail's "?" sends feedback to the GitHub
  repo in `VITE_GITHUB_REPO` (`.env.example`, `.github/ISSUE_TEMPLATE/`).
- Languages: `vue-i18n`, ten catalogs in `src/i18n/locales/` (ADR-20,
  `docs/09-languages.md`). Every user-visible string goes through `t()`;
  `node scripts/check-locales.mjs` keeps the catalogs in step. The scoring
  has its own language problem, solved separately: the user's chat
  vocabulary (ADR-29, `features/hype/vocabulary.ts`) — editable word lists,
  per-language starter packs and detection from the VOD's own chat.
- Installable PWA with an update toast, never a silent reload (ADR-22,
  `src/lib/pwa.ts`); NanoGPT referral = a 5 % discount for the user (ADR-23)
- Deployed as static files (GitHub Pages / Cloudflare Pages);
  repo: https://github.com/Angel-Casas/Hypeline
- Package manager: pnpm

## Commands

```
pnpm install
pnpm dev            # Vite dev server
pnpm build          # production build to dist/
pnpm test           # Vitest, run once
pnpm test:watch
pnpm e2e            # Playwright
pnpm lint           # ESLint + type-check (vue-tsc)
pnpm format         # Prettier write
pnpm icons          # re-render every icon from src/ui/Logo.vue (icons:check in CI)
```

`npm` works too (lockfile is npm's). `postinstall` copies the ffmpeg core into `public/ffmpeg/`. `pnpm e2e:fixtures` downloads 4 real segments once for the cut e2e.

## Layout

```
src/
  app/            router, pinia, app shell
  features/       one folder per feature (vod, hype, clips, ai, settings)
    <feature>/
      components/  ui/       stores/   api/    __tests__/
  lib/
    twitch/       GQL + Helix + HLS clients (all browser-side)
    nanogpt/      OpenAI-compatible client, model catalog, cost estimation
    video/        hls fetching, segment cutting, export
    storage/      IndexedDB wrappers
  features/tour/  the first-visit tour (ADR-21); the example VOD is features/vod/example.ts
  ui/             shared primitives (buttons, dialogs, timeline)
  i18n/           locales + the locale module (ADR-20)
docs/             the project's brain — see below
```

## How we work (read this every session)

1. Start by reading `docs/02-roadmap.md` (what's next) and the tail of
   `docs/07-worklog.md` (what just happened). Don't re-derive context from code.
2. Any non-trivial choice gets an ADR entry in `docs/03-decisions.md`
   (short: context → decision → consequences). Reversals are new entries, not edits.
3. Unknowns and external-API facts live in `docs/05-research.md`. If you
   learn something about Twitch or NanoGPT behaviour, write it there with the
   date; those endpoints are undocumented and drift.
4. Every work session ends with a dated entry in `docs/07-worklog.md`:
   what changed, what's blocked, what's next. Keep it to a few lines.
5. Prefer a **spike** (throwaway script under `spikes/`) before building on an
   unverified assumption. Spike results go in `docs/05-research.md`.
6. Ship vertical slices: a feature is done when it's usable end-to-end in the
   UI, tested, and documented — not when the store is written.
7. Keep this file short. Details go in `docs/`; this file points at them.

## Conventions (summary — full version in docs/04-conventions.md)

- TypeScript strict; no `any` without a `// why:` comment.
- Composition API only; one component per file; props/emits typed.
- All network access goes through `src/lib/*` clients — never `fetch` from a
  component or store.
- Every NanoGPT call goes through `lib/nanogpt` so we can show cost before and
  after; never call a model without the user seeing an estimate.
- Twitch undocumented endpoints are isolated in `lib/twitch/gql.ts` with a
  comment noting they are unofficial and a fallback strategy.
- Secrets: the NanoGPT key is stored locally (localStorage, plain — Angel
  decided against a passphrase, 2026-09-13) and never leaves the browser
  except to `nano-gpt.com`.
- Tests: unit-test pure logic (hype scoring, cost estimation, playlist
  parsing) with fixtures in `__tests__/fixtures/`. Don't mock what you can
  fixture.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `spike:`).
- No telemetry. No accounts of ours (Twitch sign-in, read-only, is the
  dashboard home — ADR-19; the token stays in the browser). No server. If a feature needs a server, it's an
  ADR discussion first. Live mode (ADR-18: a recording VOD grows on the
  dashboard, chat read over IRC in the open tab only); the multi-channel
  feed, directory and accounts are parked (2026-09-15).

## Design (since 2026-09-13)

The design system is `docs/08-design-system.md` (ADR-12): pastel paper,
grain, frosted glass, and the **hype thread** (`src/ui/HypeThread.vue`)
as the one piece of colour. Use the utilities in `src/style.css`
(`glass`, `glass-sm`, `eyebrow`, `btn-ink`, `btn-ghost`, `field`) and the
theme tokens — never raw neutral-* / blue-* Tailwind colours. The
"function before form" rule (2026-09-12) is retired; new features ship
in the system from the start.

## Non-goals (for now)

Uploading to TikTok/YouTube from the app, payments/bounties, user accounts,
multi-user collaboration, non-Twitch sources. Revisit only via the roadmap.
