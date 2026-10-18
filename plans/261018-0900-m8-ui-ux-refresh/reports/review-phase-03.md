# Review: M8 phase 3 (reading view), uncommitted work on branch m8

Reviewed: `git diff` and the untracked files in the m8 worktree (base 1bb2a02), checked against
`phase-03-reading-view.md`, the plan's invariants, `reports/phase-03-rhythm.md` and the "The reading view"
section of `docs/design-system.md`. Read-only review. I ran no e2e and no build myself. One live e2e
artifact from the other process's run was read, see B1.

Checks I ran: `pnpm run typecheck` passed. `pnpm run lint` passed with 0 warnings. `node scripts/check-tokens.mjs`
passed. `pnpm exec vitest run src/entrypoints/sidepanel src/shared/language.test.ts src/locales` passed: 37 files,
506 tests.

Verified correct, no finding:
- **Context updates reach blocks that skip renders.** In Preact 11, `createContext`'s Provider sets `COMPONENT_FORCE`
  on every subscriber when the value changes, and `diff/index.js:209` skips `shouldComponentUpdate` when that flag
  is set. So `Block`/`Cell` with `contextType = Langs` do pick up a late `sourceLang` or a new target. The
  `useMemo` on `langs` also stops a re-render of every `Text` on each list render.
- **The zh rules resolve the right way.** `:lang(zh)` also matches `zh-TW`. Both `:is()` groups have equal
  specificity and the Hant group comes later, so the Hant rule wins. Bare `zh` goes to Hans.
- **The font tokens exist.** Every per-script token is defined in `src/ui/tokens.css`.
- **The Chrome features are supported.** `float: inline-end` and `:has()` both work on Chrome 138, the manifest
  minimum.
- **Test hooks are kept.** `data-id`, `data-kind`, `data-status`, `data-linked`, `data-refined`, `data-edited`,
  `.seg`, `.state`, every `data-testid` and `aria-keyshortcuts` O/R/E/C are all still there.
- **Icon buttons have names.** Each one has an `aria-label` with the block name, an `aria-hidden` svg and its word
  as `.sr-only` text, so `textContent` still reads "Copy", "Explain again" and so on.
- **The failed notice is a note.** `Notice` spreads `rest` after `role`, so `role="note"` overrides `alert`.
- **The privacy notice keeps its prominence.** It still takes focus on mount, keeps `aria-modal`, and now uses a
  primary `Button`. The left accent border it lost is on the banned list, so removing it is correct.
- **Logical properties.** The block CSS uses logical margins, paddings and insets throughout. The only physical
  properties left are width/height (see N4).
- **Locales.** The new string is in both locale files.

---

## Blocking

### B1. Hidden toolbar uses `display: none`, so e2e can no longer click its buttons and screen readers lose them
`src/entrypoints/sidepanel/style.css:399-418` (`.seg__actions { display: none }`, shown only on
`.seg:is(:hover, :focus-within)`).

Playwright treats `display: none` as not visible. The old `opacity: 0` row counted as visible. Every existing e2e
that clicks a toolbar button without hovering first now times out. This is already confirmed by the live run in
this worktree: `test-results/e2e/flows-Best-drafts-first-...-replaced/error-context.md` shows "flows.spec.ts >>
Best >> drafts first ... Show draft" failing with `locator.click ... 217 × element is not visible` on `seg-draft`
(`e2e/flows.spec.ts:288`). The same pattern appears at `flows.spec.ts:434, 491, 500, 524` (seg-edit and
seg-retranslate), so those tests will fail too.

It is also an accessibility regression. `display: none` removes the buttons from the accessibility tree, so a
screen reader in browse mode cannot find Copy, Original, Explain or Edit unless the block already has focus. The
old comment, "always reachable by Tab", described the opacity approach on purpose.

Fix: the toolbar is now absolutely positioned, so it no longer needs `display: none` to free space. Hide it with
`opacity: 0; pointer-events: none` and switch to `opacity: 1; pointer-events: auto` on `:hover, :focus-within`.
Keep the float rule as it is. The buttons then stay in the accessibility tree and in Tab order: tabbing into one
triggers `:focus-within`, which shows the toolbar and reserves the float. Playwright's click hovers the target, so
the block goes `:hover` before the hit-target check. The `(hover: none)` block stays as it is. Do not fix this by
adding `.hover()` calls in flows.spec.ts. That would hide the accessibility regression.

---

## Should-fix

### S1. The toolbar can be wider than the space reserved for it
`style.css:419-458`.

The float width assumes 28px per button plus a fixed 64px per text button. A text button actually measures
`text + 16px padding`, so the float only covers labels up to about 76px wide at 12px.
- At 12px system-ui, "Hide original" is about 72-76px in en and "Hiện bản nháp" about 78px in vi. Both are at or
  past the limit with SF/Segoe.
- With wider fallback fonts, the overlap is 15px or more. On Linux with DejaVu Sans, "Hide original" comes to
  about 107px against 92px reserved.

Failure scenario: the reader clicks "Original". The block is hovered at that moment, so the label becomes "Hide
original" right then, and the toolbar's start edge covers the end of the first line.

The J/K e2e cannot catch this. It only sees "Original" and "Show draft" labels in en at 360px.

Fix (CSS only, keeps the float decision): cap the text buttons to what the float reserves, for example
`.seg__action--text { max-inline-size: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`,
and give the Original button a `title`. Alternatively, derive `--seg-actions-text` from the real label widths.
Either way, add an e2e step that clicks Original and re-checks for overlap, under the vi UI.

### S2. Inside table cells the reserved float reflows the whole table
`style.css:186-196` and the float rule.

A translated cell's toolbar is about 126px with Original and Copy, and up to about 210px with Retranslate,
Explain and Edit. At 320-420px, a 2-3 column table has cells of about 100-150px. The float is wider than the cell,
and a float counts toward the cell's min-content width. So hovering or J/K-focusing a cell widens its column and
reflows the whole table. When the minimum widths add up to more than 100%, the table overflows sideways. The
e2e skips table cells, both in `textGaps` and in the overlap test.

Fix: in cells, put the toolbar in the flow at the end of the cell, the way the touch layout does. For example
`.seg--table-cell > .seg__actions { position: static; flex-wrap: wrap }` with no float. Or anchor it outside the
cell. Code figures have a milder version of this: the `<pre>` is a block formatting context, so it narrows by the
float's width while hovered. Accept that or skip the float for `.seg--code`.

### S3. `holdAnchor` scrolls the panel when it is at the top, including on a theme-only change
`follow.ts:193-201` and `App.tsx:127-130`.

At `scrollY = 0`, `panelAnchor` returns the first block with `offset` clamped to 0, even though the block's top
sits below the covered area. The space between them is the region's `padding-block-start` plus any notices or
About section above the list. `scrollToAnchor` then puts that block's top right under the header, so the panel
jumps down by that gap and hides the About section and notices.

This fires on every change to the reading item: `JSON.stringify` compares the whole `Reading`, including `theme`.
It also fires on panel open when the localStorage copy is stale. The page does not move, because `sent` is
updated, but the panel does.

Fix: record the pixel position (`rect.top - covered`) along with the offset. Restore by
`scrollBy(newTop - oldTop)` when the block's top was below the covered area, or skip the restore when
`scrollY === 0` and the offset is 0. Also skip `holdAnchor` when only `theme` changed, since a theme change does
not reflow. Add a unit test: panel at the top with content above the list, change the size, and assert no
`scrollTo` call.

### S4. A block-level target `lang` gives the target script font to the English original under it
`SegmentList.tsx:381-385` (`langAttrs`) and the `:lang()` rules in `style.css:300-345`.

Now that every translated block carries `lang={target}`, not only RTL ones (the spec asked for block `lang` only
for RTL targets), the rule `.segments[data-typeface] :lang(ja)` (and zh, ko, th, ar, he, hi) sets the script font on
the block. `.seg__original` (lang=en) sets no `font-family`, so it inherits that font. In serif mode, an English
original under a Japanese translation renders in Hiragino or Yu Gothic's Latin glyphs instead of the serif stack.
It also inherits the `line-height: 1.8` set for th, ar and hi.

Fix: add a reset ahead of the per-script rules, with equal specificity so the script rules still win:
`.segments[data-typeface='sans'] [lang] { font-family: var(--font-sans) }` and the same for serif. Or set the
target `lang` on the block only when the target is RTL.

### S5. The list "Waiting" label is outdented by the wrong unit and likely overlaps the bullet
`style.css:497-499`.

The label uses `margin-inline-start: -1.25em`, and `em` there is the label's own font-size (`--text-xs`, 11px),
so the shift is about -13.75px. The list's padding is 1.25em of the reading size (20px at 16px). Also, a
block-level `::before` inside a `display: list-item` element becomes the first line box, so the outside disc marker
lines up with the label line. The label then starts inside the marker's area, so "W" and the bullet collide.

I could not render this without Playwright, so it needs a visual check. Fix: do not outdent, which keeps the
bullet beside the label. Or outdent by `calc(var(--reading-size) * -1.25)` and set `list-style: none` on that one
item while it waits.

### S6. The "Waiting" label and muting go beyond what the spec asked for
`style.css:481-499`.

1. **Blocks keeping old text get the label.** The selector does not separate "pending with no text" from "pending
   with old text", so a retranslate puts a "WAITING" line above old translations. A single-block retranslate
   inserts a whole label line and then removes it, so the text below jumps twice. The blocks already differ in
   their attributes: a pending block keeping old text has `lang={target}` on the block, and one with no text has
   no `lang`. So `.seg--pending:not([lang])` scopes the label with no new props.
2. **Pending tables get a label on every row.** Every row's first cell has no previous sibling, so a pending table
   shows "WAITING" in each row. Exclude `.seg--table-cell` except in the first `.seg-row`.
3. **The whole page is muted before a job.** `.seg--original` is newly muted. Status `original` covers every block
   when there is no job, so the extracted page shown before Translate is now all in `--muted`. The spec does not
   ask for this, and it lowers contrast on the main pre-translation view. Confirm the intent or drop it.

### S7. Several tests pass without proving their behavior
- **J/K overlap check.** `e2e/reading.spec.ts:181-195` returns `toolbar` but never asserts it. If the toolbar
  never shows, which B1's fix or a selector slip could cause, `overlaps` is always false and the test passes. Fix:
  assert `m.toolbar === true` for translated blocks.
- **"No block re-render" claim.** `App.test.tsx:290` checks that the block element is the same object. Preact
  reuses DOM nodes on re-render, so this cannot catch a re-render. Either drop the claim or spy on a render, for
  example by counting `Block.prototype.render` calls.
- **Fixed sleeps in the settings e2e.** `reading.spec.ts:113, 128, 134` use `waitForTimeout(600/800)`. These are
  timing-based and can flake. Prefer `expect.poll` on the page's `scrollY` staying put across two frames after the
  font-size assertion.

---

## Nit

- **N1.** `langAttrs` (`SegmentList.tsx:383-384`): when the target is RTL and the source is unknown (detection
  failed), the original waiting in the list is forced to `dir="ltr"`. For a Persian or Urdu page with
  `sourceLang` undefined, that renders the text wrong. Use `dir="auto"` when the source is unknown. The first
  branch's `langs.rtl ? 'ltr'` can never be reached, because `rtl` implies an RTL target.
- **N2.** `Notice` renders a `<div>` inside the `<p>` block (`SegmentList.tsx:438`). The DOM tolerates it because
  the markup is built by script, but the HTML content model is invalid. Inside `div[role=heading]`, the failure text
  and "Retry" also become part of the heading's accessible name. That second part was already true before.
- **N3.** Rewritten CSS comments still carry plan ids: `style.css` "(M3-E5)", "(hover link, M5-E1)", "(plan
  M2-E1)", "(M3-E10)". These lines were rewritten in this phase, and the rule bans plan ids on new lines. Drop
  them while the comments are being edited anyway.
- **N4.** `.seg__caret` and the float use `width`/`height`. These are fine in horizontal writing, but the CSS
  claims "logical properties only". Use `inline-size`/`block-size` for consistency.
- **N5.** On touch screens, `.seg:is(:hover, :focus-within) > .seg__actions { display: flex }` outranks the
  `(hover: none)` rule `display: inline-flex`. Tapping or focusing a block turns the in-flow toolbar block-level,
  so it jumps to its own line. Repeat `display: inline-flex` with the hover selector inside the media query.
  B1's fix removes this naturally.
- **N6.** `useReadingView`: if an `onChanged` lands before the initial `readReading` resolves, the late
  `readReading` result can overwrite the newer value. This is unlikely. A version counter, or ignoring the read
  once a change has been applied, closes it.
- **N7.** The gap e2e only checks upper bounds. A collapsed gap of 0 would pass. Add a lower bound, for example
  p→p ≥ 0.9 × size - 2px.
- **N8.** Markers are not all muted: `.seg__badge--basic` and `--edited` are in `--accent`, while the spec says
  "small muted text labels". That is still one accent color, but a deviation.
- **N9.** Spec step 5 named `blocks.test.tsx` and `snippet.test.tsx` for the block-state tests. They went into a
  new `reading-view.test.tsx` instead, which is fine, but the phase report should say so.

---

## Anti-pattern check

No gradients, glass effects, emoji, shimmer, pills, left-border accent cards or animation. `a11y.test` asserts the
stylesheet has no `animation`/`@keyframes`. The linked fill stays `--pressed`, as decided. The privacy card has
a border and radius but no shadow. This passes.

## Plan follow-ups

- **Acceptance: e2e green.** Fails until B1 is fixed.
- **Acceptance: the toolbar never overlaps text.** Not met in all cases (S1, S2). The e2e that would show it is
  vacuous (S7).
- **Acceptance: hooks and a11y.** Met for hooks. The a11y tree regresses (B1).
- **Step 8 visual review.** Pending. Include S5 (list label and bullet), S2 (table at 320px), S4 (ja target in
  serif with the original shown) and an Arabic page.

Status: DONE_WITH_CONCERNS
Summary: One blocker: the toolbar's `display: none` breaks the existing flows.spec.ts toolbar clicks, confirmed by a
live failure in test-results, and hides the buttons from screen readers. Six should-fix issues cover toolbar
overlap and reflow (labels wider than reserved, table cells), `holdAnchor` scrolling the panel at the top, the target
font leaking into the original, and the scope of the Waiting label.
Concerns/Blockers: B1 must be fixed before the e2e can go green. S5 needs a visual check I could not do read-only.
