# Review: phase 5, onboarding on the design system (uncommitted, worktree m8)

Scope: `git diff` in `translate-side-m8`: `src/entrypoints/onboarding/Onboarding.tsx`, `style.css`,
`scripts/bundle-budget.json`, `docs/design-system.md`, `docs/progress/progress-m8.md`.

Checks run: `vitest run src/entrypoints/onboarding` (13/13 passed), `pnpm run typecheck` (clean),
`eslint --max-warnings=0 src/entrypoints/onboarding` (clean), `node scripts/check-tokens.mjs` (clean).
I did not run a build, e2e or check:bundle. The budget line is 754 B x 1.1 = 829.4, rounded up to 830, so the
arithmetic matches the note. I did not re-measure the 754 B.

## Verified unchanged

- Steps, their order and the transitions: 1 -> saveLang -> 2, 2 -> Back(1) / Next(3), 3 connect -> Back(2) or
  ConnectionForm onDone, Sample -> Finish (`close('done')`), Change (`setSaved(undefined)`), Skip.
- Heading focus effect (`Onboarding.tsx:61-67`) is untouched, and every `h2 ref={heading} tabIndex={-1}` is still there.
- Privacy gate: the ack is still a native `<button>` that holds the `noticeButton` ref, so the focus-on-appear effect still
  works. It is one-shot (`gate.acknowledge()`), not a checkbox. `Notice tone="warn"` renders `role="alert"`
  (`src/ui/Notice.tsx`), so the test hook `onboarding-privacy` keeps its role.
- Every hook in `reports/phase-05-hooks.md` is present: ids, test ids, `label[for=onb-path-key]`, `fieldset legend`.
  There is still no select inside a label. `Select` puts `id` and `data-testid` on the native `<select>`.
- One primary per view: step 1 Next; step 2 Next; step 3 connect view has only ConnectionForm's `save-connection`
  (Back and Skip are quiet); the Sample view has Translate sample until `finished`, then Finish. The privacy ack is
  default. The swap condition is correct.
- Tokens: no hex. Every variable used (`--tint`, `--quote`, `--ok`, `--on-accent`, `--space-1..6`, `--text-xs/m/xl`,
  `--font-sans/serif`) is defined in all three themes. Layout only.
- Anti-patterns: the step pills are gone (the circle is a 20px numeral marker, not a pill). Rows use hairlines and
  no shadow. No left border is left (the old `blockquote` `border-left` and the card `box-shadow` are removed).
- Settings stylesheet interplay: `.opt input[type=radio]` does not apply (the root is `.onb`, not `.opt`). Step 1's
  `.opt__row` is a label-first 160px grid holding a `.ui-select`, which fits. Step 3's `.opt__row` holds two buttons
  and no label, so it flows. `.ui-notice` margin and `.onb__notice` have equal specificity, and onboarding's sheet
  loads later, so onboarding wins as intended. `.onb__notice p { color: var(--ink) }` overrides `.ui-notice--warn`
  text color for the body on purpose.
- Step list a11y: the visible numeral or check is `aria-hidden`, and the `.sr-only` "N. " gives the same text as
  before ("1. Language"). `.sr-only` is absolutely positioned, so it adds no flex gap. `aria-current="step"` stays on the same `li`.

## Blocking

### B1. The sample translation is italic and in the quote color, so it does not show the reader's look

`src/entrypoints/onboarding/style.css:24-25`

```css
.onb__sample blockquote { margin: ...; color: var(--quote); font-style: italic; }   /* specificity 0,1,1 */
.onb__reading { color: var(--ink); font-style: normal; line-height: 1.6; font-family: var(--font-sans); } /* 0,1,0 */
```

`sample-translation` is inside `div.onb__sample` (`Onboarding.tsx:305-339`), so `.onb__sample blockquote` beats
`.onb__reading` on specificity, whatever the source order.
- **What goes wrong:** the translation renders italic in `--quote`, the same as the original. That is the look
  requirement 3 says it must not have. `font-family` and `line-height` still apply, because the losing rule does not
  set them, which is why this is easy to miss.
- **Why nobody saw it:** the progress log says step 3 was not visually reviewed ("needs a working connection").
  Its line "the sample's translation takes the reader's typeface and size" is only half true.
- **Fix:** raise the specificity to `.onb__sample .onb__reading { ... }`, or scope the quote rule to
  `.onb__sample blockquote:not(.onb__reading)`. Then check step 3 visually in the three themes, using the
  injected-jobs path from the unit test or a local preset.

## Should-fix

### S1. The sample skips the reading view's per-script fonts and RTL direction

`Onboarding.tsx:238`, `style.css:25-26`

The reading view resolves `font-family` per script on the element with `lang` (`sidepanel/style.css:281-330`:
ja, zh-Hans/Hant, ko, th, ar, he, hi, plus the serif variants). `.onb__reading` sets only `--font-sans` or `--font-serif`.
- **What goes wrong:** a ja, zh-TW, ko, th, ar or he reader sees the sample in a generic fallback font, not the font
  the panel will use. Han characters may also get the wrong regional forms. For ar and he there is no `dir`, so the
  blockquote lays out LTR: it starts at the left, and neutral punctuation lands at the wrong end. The panel sets
  `dir="rtl"` through `isRtl(target)` (`SegmentList.tsx:375`).
- **Fix:**
  - Add `dir={isRtl(lang) ? 'rtl' : undefined}` to the sample blockquote.
  - For fonts, either add the `:lang()` rules for `.onb__reading`, or move the per-script rules in
    `sidepanel/style.css` to a selector both pages can share, keyed on `[data-typeface]`, without moving bytes into
    `base.css`. The onboarding CSS budget is tight, so at least add `dir` now and record the font gap in the phase
    log as an accepted difference.

### S2. No test covers the new behavior that requirements 3 and 4 depend on

`Onboarding.test.tsx` was not touched. These are not asserted anywhere:
- `sample-translation` carries `data-typeface` and `font-size` from the stored `reading` item.
- `translate-sample` is `ui-button--primary` and `onboarding-finish` is not until `finished`, and then they swap.
- A done step renders the check, and the current step does not.

A regression in any of them (for example a refactor that drops `useReading`, or makes both buttons primary) passes CI.
- **Fix:** add two short assertions to the existing sample test. Seed `reading` in the fake `storage.sync`
  (`{ typeface: 'serif', size: 20 }`), then assert the attribute, the inline size and the class swap
  before and after `finished`.

## Nit

### N1. The privacy ack hand-rolls the button

`Onboarding.tsx:327`

`<button class="ui-button" ref=...>` duplicates `Button` only to hold a ref. Preact 11 passes `ref` through function
components as a prop, so `<Button ref={noticeButton} ...>` works and keeps one button implementation.

### N2. A done step is shown only by an `aria-hidden` icon

`Onboarding.tsx:119-124`

Sighted users see a check in `--ok`, but AT hears "1. Language", the same as before. Behavior is unchanged, so this
is not a regression. If wanted, add an sr-only "done" word (a new string in both locales).

### N3. The path row's clickable area is only the label

`style.css:13-17`

The label stretches across column 2 of the first grid row. The description line and the row padding do not select
the radio. Requirement 2 asks for "a large label area". The label is large enough, but a click on the tinted row
below the title does nothing. Optional: `.onb__card { cursor: pointer }` plus a click handler is more code than it
is worth. Leaving it is fine.

### N4. Evergreen doc names phases

`docs/design-system.md` Anti-patterns: "were replaced in phases 3 and 5". The design system is evergreen, so drop the
phase numbers ("The older left-border notices and onboarding step pills are gone."). The old text had the same
pattern, but this line is new.

## Plan follow-ups (for the lead)

- Requirements 1, 2, 4, 5 and 6 are met. Requirement 3 is met for the privacy notice but not for the sample's look
  (B1, S1).
- Acceptance "visual review noted": step 3 is still open. Do it after B1.
- `pnpm check`, `pnpm run e2e` and the re-measured `onboarding.css` (the B1 fix adds a few bytes) are for the
  check-running process.

Status: DONE_WITH_CONCERNS
Summary: Behavior, hooks, focus, the privacy gate, one primary per step and the token rules all hold. A CSS
specificity bug renders the sample translation italic in the quote color, so it does not show the reader's look.
Concerns/Blockers: B1 must be fixed and step 3 looked at visually before the phase is accepted. S1 (per-script fonts,
RTL `dir`) and S2 (tests for the new behavior) are recommended.
