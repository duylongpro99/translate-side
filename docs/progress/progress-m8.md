# M8 progress log — UI/UX refresh (v1.2)

Log for `plans/261018-0900-m8-ui-ux-refresh/` (source spec `docs/plans/M8-ui-ux-refresh.md`).
A fresh session resumes from this file alone.

## Run setup

- Started: 2026-10-18 09:41 (Asia/Saigon), run with `/ak:cook` on the plan. The controller session
  implements each phase itself, then a reviewer subagent reads the diff; the controller fixes and accepts.
- Base: master @ d7b41cc. Branch `m8` in worktree `../translate-side-m8`. The phases run in order on `m8`.
- The plan and its reports stay untracked in the main checkout (`plans/261018-0900-m8-ui-ux-refresh/`), as for
  earlier milestones. Only the screenshots under `plans/261018-0900-m8-ui-ux-refresh/screens/` are committed on
  `m8`, because the plan's acceptance asks for them in git.
- Owner gates: any deviation from the plan, the Windows glyph check (phase 6), store upload and the tag.

## Phases

| # | Phase | Status | Commit |
|---|---|---|---|
| 1 | Foundations: tokens, themes, fonts, components, reading store | **Accepted 2026-10-18 10:20** | ab98e57 |
| 2 | Panel chrome: control row, popovers, menu, progress | Review fixed, checks running | |
| 3 | Reading view: typography, rhythm, block states, scripts | Pending | |
| 4 | Options page on the design system | Pending | |
| 5 | Onboarding on the design system | Pending | |
| 6 | Verification, screenshots, docs and 1.2.0 RC | Pending | |

## Decisions

- Phase 1, serif stack: `scripts/glyph-check.html` shows that Iowan Old Style and Charter on macOS have every
  Vietnamese glyph but draw the horn of ơ ư like a hook above (ơ reads as ỏ). `--font-serif` is
  `Georgia, 'Noto Serif', 'Times New Roman', serif`. The plan left the order to this step. Windows is pending
  for phase 6.
- Phase 1, themes: the mockup defines only direction A light (warm) and dark. Paper takes the mockup's warm
  light values; light is a neutral white with the same ink and accent; dark is the mockup's dark.
- Phase 1, before screenshots: taken from a clean detached worktree at d7b41cc (the unchanged UI) with the new
  `e2e/ui-screens.spec.ts` copied in, so they show the UI before any M8 change. Light and dark only, because
  paper does not exist before the refresh.

- Phase 1, first paint: a module script runs only after its whole import graph loads, so the review (S3) found
  the theme could flash. Added `public/theme-boot.js`, a classic script in each page's `<head>` that sets
  `data-theme` from the mirror before the body is laid out (inline scripts are not allowed on extension pages).
  `applyThemeSync()` still runs first in each `main.tsx`, as the plan says. Its budget line is new.
- Phase 1, hover link: `--tint` is too faint for the linked block (review S5), so it uses `--pressed`, the next
  step in the plan's token set. Phase 3 owns the block states and may refine it.

## Phase 1 log

- Baseline at d7b41cc: `pnpm check` green (117 files, 2104 tests), bundle 291181 B of 309287 B; chunk map and
  numbers in the plan's `reports/baseline.md`. `sidepanel.css` had 2 B of headroom.
- Implemented by the controller (Opus). Review by a code-reviewer subagent: report
  `reports/review-phase-01.md` in the plan folder. Dispositions:
  - B1 (Popover Tab with radio groups): fixed. The Tab check now runs after the browser moved focus and closes
    when focus left the dialog; opening focuses the checked radio. Tests with Segmented first and last.
  - S1 (menu focus invisible): accent focus ring on menu items. S2 (pressed and checked states rely on a faint
    fill): a pressed IconButton also takes the accent icon color; a checked segment is bold with a `--muted`
    outline. S3: `theme-boot.js` (see Decisions). S4 and N4: the dialog takes `tabIndex=-1` and is focused when
    it holds no control. S5: see Decisions. S6: `docs/privacy.md` lists the `reading` sync item and the
    `localStorage` copy. S7: in the header the popovers line up with the row (phase 2 CSS) and the e2e checks
    them at 320px. S8: phase 1 is committed on its own (the mixed files were rebuilt from HEAD for the index)
    and checked in a clean worktree. S9: the anti-pattern section names the two older patterns still to go
    (privacy notice border in phase 3, onboarding pills in phase 5).
  - N1: `check-tokens.mjs` also catches the other system colors in any case and the modern color functions;
    named colors stay a review item. N2: an outside press seen twice closes once. N3: a failed `storage.sync`
    read keeps the mirror. N5: the contrast test finds the system-dark block by its media query. N6 and N8:
    accepted as is (N6 matches the quality precedent; N8 is the expected README merge with the main checkout).
    N7: checked in the after screenshots.
- Visual review against the anti-pattern list (light, paper and dark at 320px, panel, settings and onboarding):
  no gradient, blur, emoji icon, shimmer, decorative motion or second accent. The only shadow is on overlays.
  Remaining older patterns as noted above. The settings page's native buttons stay as they are until phase 4.

- Phase 1 accepted: on the commit alone in a clean worktree, `pnpm check` green and `pnpm run e2e` 42 passed.

## Phase 2 log

- The hook list was written before editing: `reports/phase-02-hooks.md` in the plan folder.
- Decisions:
  - The page view's job bar keeps today's progress sentence as `.sr-only` text inside the bar, which stays the
    live region; visibly it shows only failures, the rest of a long page, kept and edited blocks, notes, errors
    and limits. The selection view keeps its full bar (with Cancel and the cost).
  - The cost is shown only in the Translation popover's page line.
  - `quality-lock-note` stays beside the quality select; when Best is locked and still the stored choice it moves
    to the notice strip (one element either way).
  - Under 380px the Translation button is a sliders icon (its name still says the style) and the header's icon
    buttons are 28px, so the row fits 320px with "Vietnamese" in full. New icon `sliders`, with its test and a line
    in `docs/design-system.md`.
  - The header's popovers and menu open under the whole header, inset to its padding, so they never cover the
    notice strip and fit 320px; they scroll when the panel is short.
  - `jobSettled` waits on the `data-status` attribute: with nothing to say, the bar is a 1px strip.
  - `chunks/sidepanel.js` (26590 B) and `assets/sidepanel.css` (4768 B) budget lines measured again in this phase,
    plus 10%, so `pnpm check` stays green.
    The plan reserved budget edits for phases 1 and 6.
- The first full e2e run had three page tests time out (globalvoices, mkdocs, large-table); all three passed alone
  and in a second full run (43 passed). Treated as load flakes; watched in later runs.
- Review (code-reviewer subagent, `reports/review-phase-02.md`): no blocking findings. Fixed: the Vietnamese e2e
  check now targets the More button and the Settings menu item exactly; the bar is a live region again, with the
  visible "N failed" hidden from screen readers (it is in the sentence); popovers open under the whole header; the
  size stepper uses `aria-disabled` so focus stays at 13 and 24, and two quick clicks are two steps; no empty band
  under the header when only the live region is there; popovers scroll in a short panel; the unused `.panel__error`
  CSS and `panel.header.close` string are gone; a test covers Escape in the More menu while the help is open.
  Kept as planned: the More trigger says expanded while the help is open (the plan moves `aria-expanded` there).
  Not changed: the offer stays a `section` styled as a flat notice (its `role="status"` and hooks are kept).

## Open items

- Windows check of the serif stack (phase 6).
