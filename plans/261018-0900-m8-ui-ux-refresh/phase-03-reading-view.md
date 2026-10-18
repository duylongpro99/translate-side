---
phase: 3
title: "Reading view: typography, rhythm, block states, scripts"
status: completed
priority: P1
effort: "2.5d"
dependencies: [1, 2]
---

# Phase 3: Reading view

## Goal

The translation reads like a book page in the chosen typeface, size, width and theme, on one
even spacing scale. The per-block toolbar never hides text, and blocks that are not ready stay
readable. Every script gets the right font and direction. Changing a reading setting never
moves the source page.

## Context

- **`SegmentList.tsx`** (667 lines):
  - region `div.segments role=region` (`:661`);
  - `.seg` blocks with `data-id` and `data-status`, `tabIndex: -1` and roving focus
    (`:367-368, 659`);
  - `BlockActions` (`:131-137`, mounted at `:422, :489`, `aria-keyshortcuts` at
    `:150, 172, 191, 200`).
- **Text and language:**
  - Text renders as `state?.text ?? seg.inlineMarkup` (`:62-66`). A pending block already shows
    its source, but without `lang`.
  - `lang={target}` sits on inline spans (`:65, 223, 281`) and `lang={source}` on the original
    (`:212`).
- **Structure:**
  - Headings are `div role=heading` (`:470-475`).
  - Lists are merged `div role=list` and `div role=listitem` groups (`:625-652`) with a `'•'`
    pseudo-element (`style.css:180-189`).
  - `Segment` has no ordered or unordered flag (`src/engine/types.ts:9-44`).
- **Re-rendering and retranslate:**
  - `Block.shouldComponentUpdate` re-renders a block only when its own state changes
    (`:439, 463-465`).
  - A retranslate keeps pending blocks' old text (`jobs.ts:975, 1539`).
- **Follow is two-way.** A panel scroll sends `panelAnchor()` to the page (`follow.ts:89-104,
  150-166`, wired at `App.tsx:269`). `data-linked` comes from page hover (`follow.ts:181-217`).
- **Sticky offsets.** `coveredBy` and `coveredTop` measure `.panel__header, .job`
  (`blocks-nav.ts:44`, `follow.ts:62-65`).
- **Languages users can pick** (`settings.ts:380-401`): the list includes `zh-CN`, `zh-TW` and
  `ar`, with no `he`. The default target is the UI language without its region (`:287`), so a
  bare `zh` or `he` is possible. `normalizeLang` exists (`language.ts:53`).
- Red team findings 3, 8, 9, 10 and 11 are in `reports/red-team-261018-0900-m8.md`.

## Requirements

1. **Measure first.**
   - An e2e loads the store fixture and translates it with the mock provider.
   - It records the vertical gap between neighbouring blocks' **text boxes**, measured with a
     `Range` around the text, not the `.seg` box, which includes notes and badges. The gaps are
     grouped by kind pair: p→p, li→li, h→p, p→h.
   - The numbers go into the phase report. The fix follows the measurement. The expected cause
     is the always-mounted `opacity: 0` actions row.
2. **Per-block toolbar.**
   - `.seg` is `position: relative` and reserves `padding-inline-end` equal to the toolbar width
     only while the toolbar is shown, so text is never covered.
   - The toolbar is absolutely positioned with `inset-block-start` and `inset-inline-end`, so it
     mirrors in RTL.
   - It shows on `:hover` and `:focus-within` only, not on `[data-linked]`.
   - On `(hover: none)` it sits in flow at the end of the block, as today.
   - Its buttons keep their labels, `aria-keyshortcuts` and test ids. "Original" stays a text
     button and the others are icon buttons with `title`.
3. **The reading text follows the reading item.**
   - The region gets `data-typeface="sans|serif"` and the custom properties `--reading-size`
     (px) and `--reading-measure` (narrow 34em, medium 40em, full none, centred).
   - **Font rules:**
     - `.segments[data-typeface=sans]` sets `font-family: var(--font-sans)`, and
       `[data-typeface=serif]` sets `var(--font-serif)`.
     - Each script declares `font-family` directly on the lang-bearing element, for example
       `.segments[data-typeface=serif] :lang(ja) { font-family: var(--font-ja-serif) }`.
     - Overrides cover `ja`, `zh`, `zh-CN`/`zh-Hans`, `zh-TW`/`zh-Hant`, `ko`, `th`, `ar`,
       `he` and `hi`. Bare `zh` maps to Simplified.
   - **No job.** The values come from `readReading` and the `onChanged` handler, always through
     `cleanReading`. Segments are not re-rendered and no job starts. A unit test asserts that a
     reading change sends no message to `jobs`.
4. **Changing settings never moves the page.**
   - Before applying a reading change, capture `panelAnchor()`.
   - Apply the change, then `scrollToAnchor` back to that anchor under the follow guard
     (`guard.mark()`), so no scroll echo reaches the page.
   - The panel's first follow exchange waits until the reading item has been applied.
   - An e2e turns follow on, scrolls to the middle, changes the size and the width, and asserts
     that the page's `scrollY` is unchanged and the same block is at the top of the panel.
5. **Rhythm, every value in `rem` derived from `--reading-size`.**
   - Line height is 1.65 for serif and 1.6 for sans.
   - Paragraph gap is `calc(var(--reading-size) * 0.9)`, and list items are `* 0.25` apart.
   - Space above a heading is `calc(var(--reading-size) * 1.5)` and below it `* 0.5`, whatever
     the heading level. h1, h2 and h3 sizes are 1.55, 1.2 and 1.05 × the reading size, at weight
     650 to 700.
   - Markers: `[role=listitem]` gets `display: list-item; list-style: disc` with logical
     padding, replacing the `'•'` pseudo-element. Every list keeps a bullet. Ordered numbering
     is out of scope, because the segment model has no list type.
   - Quotes are italic and indented, with no left border, in `--quote`.
   - Code blocks use `--code-bg` and `--font-mono` at 0.85em, scroll on the x axis, and keep the
     do-not-translate label in the muted UI font. Tables use hairlines.
6. **Block states.** All `data-status`, `data-linked`, `data-refined` and `data-id` hooks are
   kept.
   - **Pending with no text yet** (`state.text` undefined): the fallback source text gets
     `lang={source}` and `--muted`. The first pending block in a run shows a small "Waiting"
     label through a CSS sibling selector (`:not(.seg--pending) + .seg--pending`, and
     `.seg--pending:first-child` inside a list), not through props.
   - **Pending with old text** during a retranslate: it keeps showing the old translation as
     today, with its target `lang`.
   - **Streaming:** the text ends in a static 1.5px accent caret (`aria-hidden`), with no
     blinking.
   - **Failed:** a `Notice` tone `danger` inside the block, with the existing retry button.
   - **Refined, hidden and basic markers** become small muted text labels, not pills.
   - **Linked:** a `--tint` background with `--radius-s`.
7. **Scripts and direction.**
   - A helper in `src/shared/language.ts`, `isRtl(lang)`, runs on `normalizeLang(lang)` and
     returns true for `ar`, `he`, `fa` and `ur`. It has a test that covers case, `_` separators
     and region subtags.
   - When the job's target is RTL, the region and each translated `.seg` block get
     `dir="rtl"` and `lang={target}` on the block element, not only the inline span, so
     `text-align: start` and logical padding mirror.
   - The original view (`:212`) gets `dir` for an RTL source.
   - Block CSS uses logical properties only.
8. **Secondary views.** `StateMessage`, `SelectionView`, `AboutDocument` (glossary as a
   definition list, no chips), `ShortcutList`, `ErrorBoundary` and `DevView` (light touch) move
   to the phase 1 components and tokens.
   - `PrivacyNotice` stays at least as prominent as today: the same position, a primary
     `Button`, focus on mount, and `aria-modal`.
9. **Sticky offsets.** Any sticky element added in phase 2 is already in `coveredBy` and
   `coveredTop`. This phase adds a J/K e2e that checks the focused block's text top is below the
   header, the progress bar and the strip.

## Steps

1. Add the gap measurement e2e and record the "before" numbers.
2. Rework the toolbar and the rhythm. Rerun and record the "after" numbers. Add an e2e
   assertion whose thresholds are derived from the same values: p→p ≤ 0.9 × size + 2px,
   li→li ≤ 0.25 × size + 2px, any → heading ≤ 1.5 × size + 2px.
3. Wire the reading item into the region (`data-typeface` and the custom properties), with the
   unit test that no job message is sent and the follow-anchor preservation.
4. Add the per-script `font-family` rules. Move the "computed `font-family` differs for ja,
   zh-CN and ko, and for ar against vi" assertion into `e2e/reading.spec.ts` here.
5. Add the block states and restyle the markers, with unit tests in `blocks.test.tsx` and
   `snippet.test.tsx`, including pending with old text.
6. Add `isRtl` and the block-level `dir`, with tests for an `ar` target, a `he` target set
   through storage, and an `ar` source.
7. Restyle the secondary views.
8. Run `pnpm check` and `pnpm run e2e`. Do a visual review in serif and sans, at sizes 14 and
   20, in light, paper and dark, at 320px and 480px, including an Arabic page.

## Files

- Modify:
  - `src/entrypoints/sidepanel/SegmentList.tsx`, `App.tsx`, `follow.ts`, `StateMessage.tsx`,
    `SelectionView.tsx`, `AboutDocument.tsx`, `PrivacyNotice.tsx`, `ShortcutList.tsx`,
    `ErrorBoundary.tsx`, `DevView.tsx`, `style.css`
  - `src/ui/tokens.css` (only if a per-script stack needs a fix)
  - `src/shared/language.ts` and its test
  - the related unit tests where markup moved
  - `src/locales/en.yml`, `vi.yml` (the "Waiting" label)
  - `docs/design-system.md` (the reading view section)
- Create: `e2e/reading.spec.ts`, covering gap measurement, rhythm, reading settings without a
  job, follow-anchor preservation, the per-script font cascade and the J/K offset.

## Acceptance

- [x] The before and after gap numbers are in the report, and the rhythm assertion is green.
- [x] Reading settings change the text at once. No job starts and the source page does not move (e2e).
- [x] The per-script `font-family` reaches ja, zh-CN and ko text, and ar and he render right to left with mirrored blocks.
- [x] The toolbar never overlaps text, in LTR or RTL, on hover or J/K focus.
- [x] Pending, streaming, failed, refined and linked states render as specified, and every hook is kept.
- [x] `a11y.test.tsx` and `blocks-nav` behavior pass unchanged.
- [x] `pnpm check` and `pnpm run e2e` are green, and the visual review is noted.

## Risks

- **Showing the source for pending blocks.** It is muted, tagged with the source `lang`, and
  marked by one "Waiting" label per run. The translation replaces it in place.
- **The reserved toolbar padding narrows the line while hovering.** It only applies while the
  toolbar shows. If the reflow on hover is distracting in the review, the fallback is a fixed
  `padding-inline-end` on every block, or a toolbar placed in the block's margin at widths of
  400px and up.
