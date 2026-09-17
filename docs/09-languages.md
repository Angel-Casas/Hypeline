# Languages

Hypeline ships in ten languages (ADR-20). **English is the source**;
every other catalog was drafted by Claude on 2026-09-16 and has not yet
been reviewed by a native speaker. Corrections are welcome — edit the JSON,
run `node scripts/check-locales.mjs`, open a PR.

| code    | language                | status          |
| ------- | ----------------------- | --------------- |
| `en`    | English                 | source          |
| `es`    | Spanish (international) | machine-drafted |
| `pt-BR` | Portuguese (Brazil)     | machine-drafted |
| `de`    | German (du)             | machine-drafted |
| `fr`    | French                  | machine-drafted |
| `ru`    | Russian                 | machine-drafted |
| `ja`    | Japanese (です/ます)    | machine-drafted |
| `ko`    | Korean (해요체)         | machine-drafted |
| `zh-TW` | Chinese (Traditional)   | machine-drafted |
| `tr`    | Turkish                 | machine-drafted |

## How it works

- Catalogs: `src/i18n/locales/<code>.json`, one nested object, the same
  keys everywhere (`namespace.camelCase`; one namespace per file —
  `dashboard`, `clip`, `ai`, `moments`, `timeline`, `settings`, `landing`,
  `gallery`, `vodStore`, `twitchLib`, `scoring`, `language`, `common`…).
- Components: `const { t } = useI18n()`; stores and libs:
  `import { t } from '@/i18n'` (`t(key, named?, count?)`).
- Plurals: `"no moments | one moment | {n} moments"`; keep the same number
  of forms in every language even when the language has fewer.
- vue-i18n specials: never a bare `|` outside plurals; `@` as `{'@'}`,
  `$` as `{'$'}`, braces as `{'{'}`.
- Keep the placeholders (`{n}`, `{name}`…), glyphs (↗ → × · —), `h:mm:ss`,
  keyboard keys, model and brand names.
- Locale choice: browser language on the first visit + the confirmation
  sheet; then `localStorage['hypeline.locale']`; the rail's globe changes
  it. `pt-*` maps to `pt-BR`, `zh-*` to `zh-TW`.
- `node scripts/check-locales.mjs [codes…]` — key / placeholder / plural
  parity against `en.json`. It runs first in `e2e/i18n.mjs`.

## Adding a language

1. Add `{ code, name, native }` to `LOCALES` in `src/i18n/index.ts` and
   import the file into `messages`.
2. Copy `en.json`, translate, run the checker.
3. If the browser tag needs a special mapping (like `pt` → `pt-BR`), add it
   to `matchLocale`.
4. Add a row above and a line to the worklog.

## Glossary (keep these consistent)

VOD (untranslated) · moment (a hype peak) · clip · chat replay · live edge ·
video relay (never "shim") · hype · heatmap / ribbon · storyboard frames ·
transcript · subscribers only.
