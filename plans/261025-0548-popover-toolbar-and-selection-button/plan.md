---
title: "Popover block toolbar and a translate button on text selection"
description: "The side panel's block toolbar floats over the text instead of rewrapping it, and selecting text on a page shows the extension's button, which translates the selection in the panel."
status: in-progress
priority: P1
effort: 4.5d
branch: feat/popover-toolbar-selection-button
tags: [feature, frontend, privacy]
blockedBy: []
blocks: []
created: 2026-10-25
---

# Popover block toolbar and a translate button on text selection

## Overview

Contract: the brainstorm in this session (2026-10-25). User decisions: the toolbar becomes a popover, and the
selection button runs in two tiers, "A + B opt-in". Tier A is on by default: the button shows on tabs where the
panel is open, and it needs no new permission. Tier B is a settings option, "Show the translate button on every
site", which requests the optional host permissions only when it is turned on.

**Current code.**
- The toolbar `.seg__actions` is already `position: absolute`. The line jump comes from a float that reserves
  its width on hover (`src/entrypoints/sidepanel/style.css:593`), plus the code caption padding (`:590`).
- Selection translation runs only from the context menu (`src/shared/panel.ts:89-145`, `handOverSelection`).
  The handover writes a `storage.session` snippet record, and the open panel picks it up
  (`src/entrypoints/sidepanel/App.tsx:102`).
- The content script is injected only at gesture time or on allowlisted sites (decision S5,
  `src/shared/inject.ts`). DESIGN §8 promises minimal permissions.

## Phases

| # | Phase | Depends on | Effort | Status |
|---|---|---|---|---|
| 1 | [Spike: page-click gesture and broad-permission revoke](./phase-01-spike-gesture-and-permissions.md) | — | 0.5d | Done (Q2 manual run open) |
| 2 | [Popover block toolbar](./phase-02-popover-toolbar.md) | — | 1d | Done (branch `fix/popover-block-toolbar`) |
| 3 | [Selection button while the panel is open](./phase-03-selection-button-in-open-panel.md) | 1 | 1.5d | Done |
| 4 | [Selection button on every site (opt-in)](./phase-04-selection-button-everywhere-opt-in.md) | 1, 3 | 1d | Done |
| 5 | [Verification and docs](./phase-05-verify-and-docs.md) | 2, 3, 4 | 0.5d | In progress: PRs #3 and #4 open; manual Chrome check and S9 Q2 are the owner's |

Phase 2 ships first as its own PR, from branch `fix/popover-block-toolbar`, with its own gates and no wait on
the spike. Phases 1 and 3–5 follow on branch `feat/popover-toolbar-selection-button` (phase 5 covers that PR's
docs). Phases 3 and 4 share `content.ts`, `panel.ts`, `background.ts` and the locale files, so they run in order.

Validated decisions (2026-10-25):
- In tier A the button lives only while the panel is connected.
- Tier B is off by default and is offered only in Settings, not in onboarding.
- Phase 2 ships as a separate PR first.

## Acceptance criteria

1. Hovering or focusing a translated block shows the toolbar without moving any text. Each line's
   `getBoundingClientRect` is the same before and after hover, for paragraphs, headings, list items and code
   blocks. The toolbar of the first block under the sticky header is fully visible and clickable.
2. Touch layouts and table cells keep their in-flow toolbar. Tooltips, keyboard focus and shortcuts still work.
3. With the panel open on a tab, selecting page text shows the extension button near the selection. Clicking it
   translates the selection in the panel, exactly as the context-menu item does. (Changed in PR review by the
   owner: the click sends only the selection; the page is offered, not translated. See phase 4.)
4. With tier B on, the button shows on any eligible page, even when the panel is closed. The click opens the
   panel if the gesture allows it (phase 1 decides). If it doesn't, the selection is still handed over and the
   button says how to open the panel.
5. The button never appears in inputs, textareas, contenteditable regions or password fields, nor on built-in
   denylisted or never-translate sites. No page text leaves the page before the click.
6. Turning tier B off unregisters the script. A provider's host permission is never lost as a side effect.
7. The install-time permissions stay unchanged. DESIGN §8 and `docs/privacy.md` describe the opt-in.
8. `pnpm test`, lint, typecheck, build and the touched e2e specs pass.

## Non-goals

- No inline translation bubble on the page: results stay in the side panel.
- The context menu stays.
- No `<all_urls>` at install time, and no selection button inside iframes in this round.
