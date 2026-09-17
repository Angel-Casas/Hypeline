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
- Video in the browser: `hls.js` for playback, WebCodecs where available,
  `ffmpeg.wasm` as fallback for cutting/export
- Deployed as static files (GitHub Pages / Cloudflare Pages)
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
```

Until the scaffold exists these are the *target* scripts; keep them true.

## Layout

```
src/
  app/            router, pinia, app shell
  features/       one folder per feature (vod, hype, transcript, clips, ai, settings)
    <feature>/
      components/  ui/       stores/   api/    __tests__/
  lib/
    twitch/       GQL + Helix + HLS clients (all browser-side)
    nanogpt/      OpenAI-compatible client, model catalog, cost estimation
    video/        hls fetching, segment cutting, export
    storage/      IndexedDB wrappers
  ui/             shared primitives (buttons, dialogs, timeline)
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
- Secrets: the NanoGPT key is stored locally (IndexedDB, optionally encrypted
  with a passphrase) and never leaves the browser except to `nano-gpt.com`.
- Tests: unit-test pure logic (hype scoring, cost estimation, playlist
  parsing) with fixtures in `__tests__/fixtures/`. Don't mock what you can
  fixture.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `spike:`).
- No telemetry. No accounts. No server. If a feature needs a server, it's an
  ADR discussion first (see vision: "moment feed" is the one likely exception).

## Working rule from Angel (2026-09-12): function before form

Until Angel explicitly says otherwise, **no design work**: no visual polish,
no animations/transitions, no theming, no custom fonts, no component
library styling passes. Plain Tailwind utilities for layout and legibility
only. Every session goes to making the app *work* end-to-end. When Angel
says "let's make it beautiful", the design pass gets its own milestone.

## Non-goals (for now)

Uploading to TikTok/YouTube from the app, payments/bounties, user accounts,
multi-user collaboration, non-Twitch sources. Revisit only via the roadmap.
