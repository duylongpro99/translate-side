---
phase: 5
title: "Onboarding on the design system"
status: completed
priority: P2
effort: "1d"
dependencies: [1, 4]
---

# Phase 5: Onboarding

## Goal

The first-run flow looks like the rest of the extension and follows its theme. It shows a clear
step indicator, one primary action per step and calm sample output. The steps, their order and
their behavior do not change.

## Context

- **`Onboarding.tsx`** (345 lines) has a `step` state from 1 to 4 (`:43`) and an `ol.onb__steps`
  list of three items (`:112-118`).
  - Step 1 is the language select `#onb-lang` (`:126`) with Next (`:136`).
  - Step 2 has the path radios `path-key`, `path-local` and `path-builtin` (disabled)
    (`:150, 167, 184`), preset selects (`:156, 173`) and Back/Next (`:190, 193`).
  - Step 3 is `Sample` (`:251`): translate (`:327`), change (`:330`), privacy ack (`:305`),
    finish (`:336`) and skip (`:339`).
  - The closed screen is at `:91-104`. Focus moves to the step heading (`:55-62`).
- **`onboarding/style.css`** is 21 lines with hard-coded colors (`#8884`, `#4a7bd8`, `#c9a227`)
  and no dark theme. It loads after the options CSS (`main.tsx:5-6`). Its budget headroom is
  about 59 B gzip.
- **Tests:** `Onboarding.test.tsx` (326 lines).

## Requirements

1. **Step indicator.** The existing `ol` is styled as "1 · 2 · 3" with labels. The current step
   has `aria-current="step"` and done steps get a check icon. No progress-bar gradient.
2. **Path choice.** The step 2 radios become selectable rows: a native radio with a large label
   area, a one-line description, and the preset `Select` revealed under the chosen row. The
   disabled built-in path keeps its reason text.
3. **Sample.** The step 3 sample output uses the reading view's typography (the `data-typeface`
   rules, size and rhythm from phase 3) so the user sees the real reading look. The privacy
   acknowledgement stays a one-shot button (`onboarding-privacy-ok`) inside a `Notice tone="warn"`,
   which keeps `role="alert"` as today (`Onboarding.tsx:298-307`). It is not a checkbox.
4. **Actions.** One `Button primary` per step (Next, Translate sample, Finish). Back and Skip are
   `quiet`.
5. **Styles.** `onboarding/style.css` keeps only layout. Colors come from tokens, and the
   hard-coded hex values are removed. The page follows the theme through `theme.ts`.
6. All ids, `data-testid`s and the focus behavior are kept.

## Steps

1. Write the hook list from `Onboarding.test.tsx` and any e2e use into the phase report.
2. Restyle steps 1 to 3 and the closed screen with the components.
3. Run the onboarding tests and `pnpm run check:bundle`. `onboarding/style.css` imports no tokens
   (phase 1), so it carries only onboarding-only layout. If it is still over its line, remove
   rules that duplicate options styles, then hand-edit the line with a measured size and a note.
   Never move bytes into `base.css` just to get under the budget.
4. Run `pnpm check` and `pnpm run e2e`, then do a visual review in light, paper and dark.

## Files

- Modify: `src/entrypoints/onboarding/Onboarding.tsx`, `style.css`, `Onboarding.test.tsx` where
  markup moved, `src/locales/en.yml` and `vi.yml` only if a label is added, and
  `docs/design-system.md` (onboarding notes).

## Acceptance

- [x] Every step works as before, and the hook list is fully ticked.
- [x] No hex color remains in `onboarding/style.css`, and dark and paper themes work.
- [x] Each step has one primary action.
- [x] `pnpm check` and `pnpm run e2e` are green, and the visual review is noted.

## Risks

- **Bundle line for `onboarding.css`.** See step 3.
