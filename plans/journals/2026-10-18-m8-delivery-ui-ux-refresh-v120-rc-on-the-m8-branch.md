---
title: "M8 delivery: the UI/UX refresh, 1.2.0 release candidate on the m8 branch"
date: 2026-10-18
summary: "All six phases implemented, reviewed and verified in one session; 1.2.0 zipped; not merged, pushed, uploaded or tagged"
---

# M8 delivery: the UI/UX refresh, 1.2.0 RC on the m8 branch

**Date**: 2026-10-18 13:45 (Asia/Saigon)
**Severity**: Low
**Component**: M8 UI/UX refresh (design system, panel header, reading view, settings, onboarding)
**Status**: Agent part done; owner review, merge, push, Windows glyph check, upload and tag open

## What Happened

M8 ran from 09:41 to 13:45 via `/ak:cook` on branch `m8` in `../translate-side-m8`. Unlike M7, the controller
implemented each phase itself and used a code-reviewer subagent per phase. Seven commits, ab98e57 to 093d7cb. Each
phase ended with `pnpm check` and `pnpm run e2e` green. The final tree has 2,180+ unit tests and 49 e2e tests passing
(6 gated specs skipped).

Shipped in 1.2.0:
- One design system in `src/ui/`: tokens, themes, components, and a token check in `pnpm check`.
- The panel header as one control row.
- A book-like reading view on one spacing scale, with per-script fonts and RTL blocks.
- Synced reading settings.
- Settings and onboarding on the same components.

The package is `translate-side-1.2.0-chrome.zip`: 344,624 B, reproducible, built from c1de072.

## The Brutal Truth

Each phase's reviewer found something real.

- **Phase 1:** a blocker. Tab didn't leave the popover when its edge control was a radio group, which is exactly how
  the Aa popover is built.
- **Phase 3:** a blocker. The toolbar was hidden with `display: none`, which broke three existing e2e flows and hid
  the buttons from screen readers.
- **Phase 5:** a blocker. A CSS specificity slip drew the onboarding sample in italic quote style.

None of these would have shown up in my own screenshots.

The 100-screen perf test caught a heap regression late, in phase 3. Every block's toolbar had SVG icons, about
+8 MB. Switching to CSS masks fixed it without raising the budget. Without that perf test it would have shipped.

The plan was wrong in a few places, and the measurements proved it:
- Raw text-box gaps can never meet the li→li threshold, because of line-height leading.
- Iowan Old Style and Charter draw Vietnamese ơ/ư like ỏ/ủ.
- A 32px icon row does not fit 320px with a readable language name.
- The preset picker is a list of actions, not a choice.

Each of these is recorded as a decision in `docs/progress/progress-m8.md`.

## Lessons

- Measure before restyling. The gap measurement confirmed the suspected cause and set honest thresholds.
- Keep hidden-but-interactive UI out of `display: none`. Playwright and screen readers both rely on it being there.
- Run the perf e2e on any change that adds DOM per block.
- Two flaky timing tests showed up under the full parallel coverage run: `sync.test.tsx` and the engine memory
  ranking benchmark. Both passed on rerun. Watch them.

## Next

Owner: merge `m8` into master. The main checkout's uncommitted README and ROADMAP edits are already on `m8`, so set
them aside first. Then push, run `scripts/glyph-check.html` on Windows, confirm the settings index follows the scroll
in a real window, upload 1.2.0 and tag it. M9 (Beyond v1) builds its UI on `src/ui/`.
