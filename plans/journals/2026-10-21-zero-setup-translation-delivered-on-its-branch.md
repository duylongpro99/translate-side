---
title: Zero-setup translation delivered on its branch
date: 2026-10-21
summary: "Keyless on-device translation implemented on feat/chrome-builtin-zero-setup; S8 Q1–Q6 and the Chrome stable check wait for the owner"
---

# Zero-setup translation delivered on its branch

## What happened

The plan at `plans/261020-1216-chrome-builtin-zero-setup/plan.md` was implemented on branch
`feat/chrome-builtin-zero-setup`, in the worktree `../translate-side-zero-setup`. A keyless install now translates on
the device: Chrome Translator by default, and Gemini Nano when it can write the target language. The first use of
each pair needs one "Turn on" click.

Phase 1 ran in provisional mode, as the user chose. Chrome 137+ won't load an unpacked extension from the command
line, so the spike extension (`spikes/s8/`) was built for the owner to run by hand. Only question 7 (e2e fake
injection) was answered by the agent: Playwright init scripts reach extension pages before their bundle. The other
answers in `docs/decisions/S8-chrome-builtin.md` are provisional defaults: the marker format, 1,000-token Nano
chunks, one combined "can't run" reason, and pairs that persist.

## What the tests and the review caught

- The first e2e run failed almost every flow on a console error. Chrome for Testing's real `LanguageModel` logs an
  error when `availability()` is asked about a language Nano can't handle, and the onboarding page (opened on
  install) asked it about Vietnamese. Nano is now asked only about `en, es, ja, de, fr`.
- The code review found that a job waiting on the privacy notice sent over the route it resolved before the wait. The
  route is now resolved again after the notice is acknowledged, for runs, explain and redo.
- Two medium findings were also fixed: a promoted Nano fallback lost its on-device handling, and a pair turned on
  mid-run never re-ran.

## Verification state

- The unit suite passes (2,232 tests), with lint, typecheck, the token check, the build, the bundle budget (the
  onboarding chunk was re-measured, 4,138 B plus 10%) and the manifest check.
- The e2e suite has 51 passed. The panel perf spec fails at 124–149 ms against its 100 ms budget, and master fails
  the same way (126–149 ms) on this loaded machine. The budget was not changed.
- `pnpm run e2e:upgrade` passes: an M3 install with a key keeps its settings, key and cache, and one without a key
  reaches the on-device route and sends nothing.

## Open

- The owner's run of spike S8 on Chrome stable (Q1–Q6), and the manual checks in the decision record's "Shipped
  behavior" table.
- Merging the branch by PR; the owner opens it, since `gh` here is read-only.
