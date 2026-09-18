# 06 — How we work (Angel + Claude)

The goal of this doc is that any session — with Claude, a contributor, or
future-you — can pick up the project cold in five minutes and leave it in a
better state than it found it.

## Session ritual

**Start**

1. Read `CLAUDE.md` (short), then `docs/02-roadmap.md` for the current
   milestone, then the last 2–3 entries of `docs/07-worklog.md`.
2. Say what the session will do in one sentence. If it's not on the roadmap,
   decide whether to add it or park it.

**During**

- Spike before building on an assumption. Spikes are throwaway; results are
  not — write them to `05-research.md`.
- Non-trivial choice → ADR in `03-decisions.md` before the code lands.
- Vertical slices. Prefer "heatmap works end-to-end for one VOD" over
  "chat client is perfect".
- Tests alongside logic, not after. The scoring and pricing modules are the
  ones that will bite us if untested.

**End**

1. `pnpm lint && pnpm test` green (or say why not).
2. Worklog entry: date · what changed · what's blocked · next step.
3. Tick roadmap boxes. Add new discoveries to research. Commit.

## Working with Claude specifically

- Give Claude the goal and the constraints, not the steps. It reads the docs.
- When Claude proposes something that isn't in the docs, ask for the ADR
  first; that keeps drift visible.
- Ask Claude to run the spike and report facts, not opinions, for anything
  touching Twitch/NanoGPT behaviour.
- For UI work, ask for a quick mockup or screenshot before a full build.
- Review the worklog entry Claude writes; it's the memory that survives the
  chat.
- If a session goes long, ask for a "state of the world" summary and put it
  in the worklog before context is lost.

## Definition of done (per feature)

- Usable from the UI, keyboard-accessible.
- Errors surfaced with a next step for the user.
- Cost shown before/after for any AI action.
- Tests for pure logic; contract test for any new external call.
- Docs: roadmap ticked, research updated if we learned something, ADR if we
  decided something.

## Cadence suggestion

Short sessions, one slice each. M0 is a handful of evenings; M1 is the first
"show people" moment — plan to post it (Twitch clipper Discords, r/Twitch,
X) the day it works. Feedback from ten real clippers beats a month of
guessing.
