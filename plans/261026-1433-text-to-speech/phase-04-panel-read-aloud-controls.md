---
phase: 4
title: "Read-aloud controls in the panel"
status: pending
priority: P1
effort: "1.5d"
dependencies: [3]
---

# Phase 4: Read-aloud controls in the panel

## Goal

Each block's floating toolbar gets a "Read aloud" control that reads the original or the translation. The panel shows
a stop control and highlights the block being read.

## Files to create / modify

- Modify:
  - `src/entrypoints/sidepanel/SegmentList.tsx`: a toolbar button (icon plus tooltip, following the existing pattern at
    `SegmentList.tsx:123`) and a "reading" state class on the active block.
  - `src/entrypoints/sidepanel/App.tsx`: own the controller and render a stop or "now reading" strip.
  - `src/entrypoints/sidepanel/style.css`: the reading-state styles, using tokens only (`pnpm run check:tokens`).
  - `src/ui/icons.tsx`: speaker and stop icons.
  - `src/locales/en.yml` and `src/locales/vi.yml`: labels, tooltips, the `no-voice` hint, and errors.
  - `scripts/bundle-budget.json`: re-measure `chunks/sidepanel.js` and `assets/sidepanel.css`, then add a note.
- Create: `src/entrypoints/sidepanel/read-aloud.test.tsx`

## Tasks and steps

1. Choose which text is read. By default, read the side the reader is looking at: the translation in translated view,
   the original otherwise. A menu item on the button reads the other side.
2. Add keyboard and accessibility support: the button is reachable in the toolbar's tab order, `aria-pressed` while
   reading, and the stop control has a shortcut (Esc while reading). An `aria-live` polite region announces start and
   stop.
3. Scroll the reading block into view only when the "follow" setting is on, reusing `follow.ts`.
4. The selection popup is out of scope for this plan (validation answer): it waits for `feat/selection-popup` to merge.

## Verification

- `pnpm vitest run src/entrypoints/sidepanel/read-aloud.test.tsx src/entrypoints/sidepanel/a11y.test.tsx`
- `pnpm run check:tokens && pnpm run build && pnpm run check:bundle`
- Manual: play, stop with Esc, play the other side, and watch the highlight move to the next block when "read on" is
  on.
