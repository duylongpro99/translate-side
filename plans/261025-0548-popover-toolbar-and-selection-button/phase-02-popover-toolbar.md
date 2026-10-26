---
title: "Phase 2: Popover block toolbar"
status: done
---

# Phase 2: Popover block toolbar

## Overview

Priority P1, independent. The per-block toolbar floats over the block like a popover. It never reserves space
in the text, so nothing rewraps on hover or focus.

## Key insights

- `.seg` is `position: relative` (`style.css:332`), and `.seg__actions` is already absolutely positioned at the
  top end corner (`style.css:533`). Overlap was avoided by reserving space instead, with the hover-only float
  `.seg:...:is(:hover, :focus-within):has(> .seg__actions)::before` (`style.css:593`) and the width variables
  `--seg-actions-w` and `--seg-actions-text` (`style.css:556-580`). That float is what moves the lines.
- A code block pads its caption on hover (`style.css:590`), which also moves text.
- The panel scrolls the document under a sticky header (`.panel__header`, `z-index: 3`, `style.css:9`).
  A toolbar placed above the first visible block could sit under the header.
- Min Chrome 138 supports CSS anchor positioning, `anchor-scope` and `position-try-fallbacks: flip-block`.
- Table-cell and touch toolbars are in the flow and always shown, so they never jump. They stay as they are.

## Requirements

- On hover or `:focus-within`, the toolbar shows above the block's top end edge, with a shadow
  (`--shadow-overlay`) and the existing raised background. No layout property of the block or its text
  changes.
- When there is no room above (the top of the panel or under the sticky header), it flips to below the
  block's top edge or overlaps the corner. It must never be hidden or unclickable.
- The pointer can move from the text to the toolbar without the toolbar disappearing: there is no gap between
  the block and the toolbar, or an invisible bridge covers it.
- Tooltips (`.seg__action[data-tip]::after`) stay inside the panel, and the CSS-mask icons and node budget are
  unchanged.
- RTL panels mirror correctly (logical properties only).

## Architecture

CSS only, in `src/entrypoints/sidepanel/style.css`:

```css
.seg { anchor-name: --seg; anchor-scope: --seg; }
.seg:not(.seg--table-cell) > .seg__actions {
  position: absolute;
  position-anchor: --seg;
  inset: auto;
  bottom: anchor(top);
  right: anchor(right);          /* written with logical anchor sides in the real code */
  position-try-fallbacks: flip-block;
  box-shadow: var(--shadow-overlay);
}
```

The plain-absolute fallback (no anchor support) is not needed at Chrome 138. With anchor positioning the
containing block is the viewport, so `flip-block` sees the panel's top edge. To keep the toolbar clear of the
sticky header, make the header area unavailable to the toolbar. One option is `position-try` with a
`@position-try` rule that sets `top: anchor(top)` (overlapping the block's first line end) when the header
covers the space above. The other is the `.panel` scroll-padding plus a check in e2e. Pick whichever passes the
first-block e2e case below. Then delete the float rule, the `--seg-actions-*` variables and the code-caption
padding.

## Related code files

- Modify `src/entrypoints/sidepanel/style.css` (the toolbar section, lines ~531-612).
- Modify `e2e/reading.spec.ts` or the spec that owns block actions now (`grep seg-copy e2e`): add the no-reflow
  and first-block cases.
- Do not modify `SegmentList.tsx` unless the bridge needs an element; prefer a pseudo-element.

## Implementation steps

1. Replace the toolbar positioning with anchor positioning as above, keeping table-cell and `hover: none` as they are.
2. Remove the reserving float, the width variables and the code-caption hover padding.
3. Handle the sticky header case and the hover gap.
4. Check tooltips, which anchor to the toolbar, on a 320px panel in LTR and RTL.
5. Add e2e: record each text line's rect (Range `getClientRects()`) for a multi-line paragraph, a heading and a
   code block, hover the block, and compare. Hover the first block under the header and click its copy button.

## Todo

- [x] Anchor-positioned toolbar, with `@position-try` fallbacks (corner, under the header) instead of `flip-block`; anchored only while shown (Chrome keeps the last fallback while the anchor stays, and anchors on every block cost ~40 ms on the 100-screen perf page)
- [x] Reserving float, variables and caption padding removed
- [x] Sticky-header and hover-gap cases handled; J/K leaves room for the toolbar (`blocks-nav.ts`)
- [x] E2E no-reflow and first-block tests (`e2e/reading.spec.ts`), flows focus a block before a toolbar click
- [x] Visual check at 320px, LTR and RTL, light and dark (Playwright screenshots; a real side panel check is the owner's)

## Review outcome (2026-10-25)

- Fixed: the toolbar sat over the sticky job bar (now under it, and its clearance counts the job bar), and a
  focused block's toolbar could float over another block after an instant scroll (now shown for keyboard focus
  only, and the under-the-header fallback is bounded by the block). Both have e2e cases.
- Accepted limit, as on master: with the pointer resting on a tall block while the wheel scrolls, the toolbar can
  slide under the header until the pointer leaves and comes back.
- Report: `plans/reports/code-reviewer-261025-1416-popover-toolbar-review.md` (in the main checkout).

## Success criteria

Acceptance criteria 1 and 2 of the plan pass. The e2e line-rect comparison is exact, and no existing e2e spec
or screenshot test needs a weakened assertion. Update the store screenshots only if a screenshot shows a hovered block.

## Risks

- The popover covers the end of the previous block's last line while it shows. This trade-off was accepted in
  the brainstorm.
- `anchor-scope` is needed so that every block anchors its own toolbar. Without it, all toolbars anchor to the
  last `.seg`. Verify this in e2e with two blocks.
