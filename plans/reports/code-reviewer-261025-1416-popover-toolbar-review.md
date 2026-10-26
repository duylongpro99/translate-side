# Code Review: fix/popover-block-toolbar (ba29bc5, 35d4ae1 over master 463cc5b)

## Scope
- Files: src/entrypoints/sidepanel/style.css, src/entrypoints/sidepanel/blocks-nav.ts, e2e/reading.spec.ts, e2e/flows.spec.ts, DESIGN.md (+178 / -55)
- Focus: the branch diff, plus the code around it (SegmentList toolbar markup, App.tsx header variable and DOM order, JobBar, follow.ts scroll-follow, fixtures)
- Method: I read the source. I also ran headless Chromium probes (Playwright 1.64, Chromium 156) on a plain HTML copy of the new toolbar CSS, with a sticky header (z 3), a sticky job bar (z 2) and 40 blocks, some with dir=rtl. The probes are in the session scratchpad. Nothing in the worktree was edited, built or run.

## Overall assessment
On the main path the change works, and the plan's main claims hold in the probe:
- No line moves on hover or focus.
- The toolbar touches its block, so the pointer reaches it from the text and the block stays hovered.
- In an RTL block inside an LTR document, the toolbar goes to the left. Blink resolves `inset-inline-end` against the toolbar's own direction, and `anchor(inside)` follows it.
- `anchor-scope` keeps each toolbar on its own block.
- Specificity across hover, focus, table cells and touch is sound.

Two problems remain. Both are regressions that the new e2e cases do not cover.

## Critical issues
None.

## High priority

### H1. A focused block's toolbar can come loose and float under the header, over another block, where it can still be clicked
Confidence: high for the mechanism (probed). Medium for how often it happens in the real panel (not run in the extension).

**What triggers it.** The toolbar shows on `:focus-within`, and a block keeps focus in two common cases:
- the user clicks the block's text (blocks have a roving tabindex, so a click focuses them);
- the user clicks a toolbar button (the button keeps focus).

While the block has focus, its toolbar is `position: fixed` and anchored. If the panel then jumps instantly so the block is off screen, Chrome re-runs the fallbacks:
- `--seg-actions-header` (`top: 0` plus the header margin) is the only option that fits;
- `position-visibility` does not hide the toolbar, because the root scroller is not an "intervening" clipper.

**What the probe showed.** A focused block b10, then `scrollTo({ behavior: 'instant' })`:
- block at -300 to -228 (fully above the viewport): toolbar painted at y=43, and clickable over block b14;
- block at 900 to 972 (below a 600px viewport): toolbar painted at y=43, and clickable over block b0;
- adding `position-visibility: anchors-visible` or `no-overflow` changes nothing.

Gradual scrolling (mouse wheel up or down, PageDown) keeps the toolbar attached. So the trigger is an instant jump:
- scroll-follow (`follow.ts:80`, `win.scrollTo({ top, behavior: 'instant' })`) when the page jumps (End key, an in-page anchor, find-in-page);
- dragging the scrollbar;
- any programmatic jump.

**Impact.** A toolbar for an off-screen block covers another block's top end corner. Clicking it runs Original, Retranslate, Copy or Explain on the block the user cannot see. With Retranslate, that block's cached translation is replaced.

**Before this branch** the toolbar was `position: absolute` inside its block, so it could never leave it.

**Fix options** (pick one, then add an e2e case that focuses a block, jumps the panel, and asserts the toolbar is not over any other block):
1. Keep the popover for hover and keyboard focus only, for example `.seg:is(:hover, :focus-visible, :has(:focus-visible))`. Mouse focus would no longer pin the toolbar. J/K focus followed by a scroll-follow jump would still be exposed, so this is not complete on its own.
2. Bound the header option by the anchor, so it fits only while part of the block is visible below the header. For example, use `bottom: anchor(bottom)` instead of `auto`, so the box (start of the screen to the block's bottom) is empty when the block is above the viewport. The case where the block is below the viewport also needs a guard. Verify with the probe.
3. When the panel scrolls programmatically (follow.ts) and the focused block leaves the viewport, blur it or remove its anchor (for example a `data-` flag that the anchored rule requires).

### H2. The shown toolbar now paints over the sticky job bar and can block its buttons
Confidence: high (probed).

**Cause.** The toolbar's z-index went from 1 to 2. The job bar is also z 2 and comes earlier in the DOM (App.tsx:436 before :445), so the toolbar paints on top. The space the toolbar treats as "no room" (`--seg-actions-clear`) counts only the header, not the job bar. In the probe, a 40px job bar with a Stop button at the inline end, and a hovered block 10px below it: `elementFromPoint` at Stop's centre returned `.seg__actions`.

**When it matters.** The job bar holds "what needs attention", with buttons: cancelled, stopped, limit, on-device setup, fix. A user who moves the pointer up from the block to one of those buttons passes over the toolbar, which keeps the block hovered, and the button cannot be reached from below.

**Inconsistency.** `focusBlock` already counts the job bar (`coveredBy`), so keyboard and mouse use different "covered" heights.

**Fix.**
- Bring z-index back to 1. Nothing in the reading area needs 2: the tooltip sits inside the toolbar's own stacking context.
- And/or set a `--panel-covered-h` from App.tsx (header plus job bar, through the same ResizeObserver) and use it in `--seg-actions-clear`.

## Medium priority

### M1. With the pointer resting on a tall block, the toolbar scrolls under the header and cannot be reached
Confidence: high (probed). Not a regression.

Hover a 1050px block and scroll with the wheel. Chrome keeps the fallback it last chose while the anchor stays, and moves the toolbar with the scroll:
- from block top -40 on, the toolbar sits behind the header (`elementFromPoint` returns the header);
- the block stays `:hover` the whole time;
- the toolbar comes back only after the pointer leaves the block and comes back.

The old absolute toolbar behaved the same, so this is not a regression. It does fall short of phase 2's requirement "It must never be hidden or unclickable", and of acceptance criterion 1's "fully visible and clickable". The e2e first-block case passes only because it scrolls first and hovers afterwards. Either record this as an accepted limit in the phase notes, or re-show the toolbar on scroll.

### M2. The corner fallback hard-codes the toolbar height
`@position-try --seg-actions-corner { bottom: calc(anchor(top) - 30px) }` and the matching `bar.offsetHeight` are tied to `.seg__action { height: 24px }` + 2×2px padding + 2×1px border. If someone changes the button height later, the corner option goes out of line without any error. Put the height in one custom property, used by both `.seg__action` and the try rule.

## Low priority
- **L1.** The first-block e2e case only checks the vertical position. Nothing checks the inline side for `ar`, and the RTL mapping is what DESIGN.md and the phase require. The probe confirms it works (barL = blockL in a dir=rtl block). Add one cheap check: in RTL, `|bar.left - block.left| < 1`; in LTR, the same with `right`.
- **L2.** The e2e cases never move the pointer from the text to the toolbar in the main (above the block) position. Playwright's click teleports to the button. The probe confirms the path works today. A `mouse.move` in steps from the text up to the button would protect the "touches the block" invariant.
- **L3.** `margin: 0` in the table-cell and touch rules is redundant: the anchored rule, the only one that sets a margin, never matches there. It is harmless.

## Checked and fine
- **Specificity.**
  - The anchored rule (0,4,0) beats the base `.seg__actions` (0,1,0): `top: auto` wins over `inset-block-start: 0`.
  - The table-cell rule (0,2,0) is not overridden, because the anchored rule excludes `.seg--table-cell`.
  - The touch rule is the only one with `position: static` under `hover: none`, and the anchored rule sits inside `@media not (hover: none)`.
  - Table cells are not nested in a `.seg` (`.seg-table` has no `seg` class), so no outer block anchors itself when a cell is hovered.
- **Keyboard and screen reader.** The hidden toolbar uses `opacity: 0` and `pointer-events: none`, never `display` or `visibility`. Its buttons stay in the a11y tree, and the active block's buttons stay tabbable (`rove`). The letter shortcuts use `button.click()`, which `pointer-events` does not block. `aria-keyshortcuts` and the group label are unchanged.
- **blocks-nav.** It reads `position` after `focus()`, so the `:focus-within` style applies. Under touch the toolbar is static, so it adds 0. jsdom returns no position, so it adds 0 and the unit tests are unaffected.
- **Tooltips.** They are positioned against the fixed toolbar (it is the containing block) and open below it at the inline end. In a 320px panel they stay inside the panel in both LTR and RTL: max 260px, measured from the toolbar edge.
- **e2e.**
  - `clickAction` (focus the block, then click) is needed now that a hidden toolbar ignores the pointer. Without it Playwright reports "intercepts pointer events", reproduced in the probe. No assertion was dropped or loosened.
  - The J/K test keeps all its assertions. It only moves to its own window and waits a frame.
  - The new line comparison uses exact `toEqual` over every text line in `.segments`.
  - The env-gated store-screenshots spec sends its own pointer events, so it does not depend on the toolbar showing.
- **Rules.** The added lines have no plan IDs or phase labels.
- **DESIGN.md §3.** The wording matches the behaviour, except the "never hidden" spirit (see M1).

## Edge cases found while scouting
- Instant programmatic scroll with a focused block → H1
- A sticky job bar with buttons → H2
- A tall hovered block under wheel scroll → M1
- A focused block plus a hovered block shows two toolbars, as before (no change)
- An edited block returns no toolbar (`editing`), so no anchor case

## Recommended actions
1. Fix H1 (option 2 or 3, ideally together with option 1) and add an e2e case: focus a block, jump the panel, assert no stray toolbar.
2. Fix H2: z-index back to 1, and count the job bar in the cleared space.
3. Decide on M1: accept and record it in phase 2, or fix it.
4. M2 and L1-L2 are optional hardening.

## Plan follow-up (phase 2 todo)
| Todo | State |
|---|---|
| Anchored toolbar (custom try options instead of `flip-block`) | Done |
| Float, variables and caption padding removed | Done |
| Sticky-header and hover-gap cases | Partly done (H1, M1) |
| e2e no-reflow and first-block | Done |
| Visual check at 320px, LTR/RTL, light/dark | Not verifiable here |

Acceptance criterion 1 is met for hover after scrolling, but not for the "fully visible and clickable" case under scrolling (M1). Acceptance criterion 2 is met.

## Metrics
- Type, lint and tests: not re-run (read-only review). The lead reports them green, with the perf spec failing the same way as on master.
- Linting issues introduced: 0 seen

## Unresolved questions
- Probes ran on Chromium 156. The fallback memory and re-run behaviour on Chrome 138, the minimum version, was not checked.
- Is "mouse click on block text keeps the toolbar shown" intended? This decides whether option 1 in H1 is acceptable.

Status: DONE_WITH_CONCERNS
Summary: The CSS is correct for the main hover/focus path, RTL, table cells and touch, and the e2e changes do not weaken any assertion. A focused block's fixed toolbar can come loose and be clicked under the header after an instant scroll (H1), and the toolbar now covers the sticky job bar's buttons (H2).
Concerns/Blockers: H1 and H2 were confirmed in a Chromium probe of the same CSS, not in the built extension.
