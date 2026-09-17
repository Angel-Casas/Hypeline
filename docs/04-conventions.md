# 04 — Conventions

## Code

- Vue 3, `<script setup lang="ts">`, Composition API only. One component per
  file, PascalCase filenames, props and emits typed with `defineProps<>()` /
  `defineEmits<>()`.
- State: Pinia setup stores, one per feature (`useVodStore`, `useHypeStore`,
  `useClipStore`, `useAiStore`, `useSettingsStore`). Stores call `lib/*`
  clients; components never fetch.
- `lib/*` is framework-free TypeScript (no Vue imports) so it's testable in
  isolation and reusable in Workers.
- Workers: `*.worker.ts` files, typed messages via a discriminated union in
  `types.ts` next to them. Use `comlink` if boilerplate grows.
- Errors: throw typed errors (`TwitchError`, `NanoGptError`, `VideoError`)
  with a `kind` field the UI can switch on. Never swallow errors; surface
  them in a toast with a "copy details" action.
- Naming: seconds are `…Sec` (`startSec`), milliseconds `…Ms`. Twitch video
  ids are strings. Moments have stable ids (`${vodId}:${startSec}`).
- Formatting: Prettier defaults, 100 cols. ESLint flat config with
  `eslint-plugin-vue` + `@typescript-eslint` recommended-type-checked.
- No `any` without `// why: …`. No `// eslint-disable` without `// why: …`.

## Tailwind / UI

- Design tokens in `src/ui/theme.css` (CSS variables), dark theme default,
  light supported. Tailwind reads the variables.
- Reka UI primitives wrapped once in `src/ui/` (Button, Dialog, Popover,
  Slider, Tooltip, Toast). Use those wrappers, not raw Reka in features.
- Keyboard-first: every action on the timeline has a shortcut, documented
  in a `?` dialog.

## Undocumented endpoints

- Live only in `lib/twitch/gql.ts`. File header lists each operation, its
  persisted-query hash if used, the date last verified, and the fallback.
- Every call site handles the "endpoint broke" case with a user-facing
  message that links to the fallback (chat JSON import, etc.).

## AI calls

- Go through `lib/nanogpt`. Each call declares a `task` (`explain`,
  `transcribe`, `caption`, `search`, `thumbnail`) so cost, model choice and
  caching are per task.
- Estimate first (`pricing.estimate(task, input)`), show it, then call.
  Read the actual cost from the response and record both in the `usage`
  store; show a per-VOD and lifetime spend figure in settings.
- Prompts live in `lib/nanogpt/prompts/*.ts` as functions returning
  messages; include a version string so cached results invalidate when a
  prompt changes.
- Prefer structured output (JSON schema) and validate with `zod`.

## Tests

- Vitest. Pure logic gets thorough unit tests. Network clients get contract
  tests against recorded fixtures (MSW). e2e with Playwright for the golden
  path only.
- Fixtures under `__tests__/fixtures/`; anonymise usernames in chat dumps.
- A PR that touches `features/hype/scoring.ts` must update or add a fixture
  case.

## Git & releases

- Conventional Commits. `main` is deployable; feature branches, squash merge.
- CI (GitHub Actions): `pnpm lint && pnpm test && pnpm build` on PRs; deploy
  on `main`.
- Semantic versioning via tags; a `CHANGELOG.md` generated from commits.

## Docs

- `docs/` is the source of truth; `CLAUDE.md` points at it.
- ADRs for non-trivial decisions. Research facts dated. Worklog every session.
- README targets a clipper, not a developer: what it does, a GIF, how to
  install, how to get a NanoGPT key (referral link), privacy statement.
  Developer setup goes in `CONTRIBUTING.md`.

## Privacy statement (keep true)

Hypeline stores everything on your device. It talks to Twitch to load VODs
and chat, and to your AI provider (NanoGPT by default, with your own key)
when you ask it to. It has no server, no accounts, no analytics.
