---
phase: 2
title: "Worker opens and closes panels per tab"
status: done
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Worker opens and closes panels per tab

## Goal

Every way of opening the panel enables it for the triggering tab only, and the toggle closes only that tab's panel.

## Files to Create / Modify

- Modify: `src/shared/panel.ts` (shared helper, `setupPanelBehavior`, `openPanelAndInject`, `togglePanelAndInject`, `ClosePanelRequest`)
- Modify: `src/entrypoints/selection-popup/Popup.tsx` (`openPanel` uses the helper)
- Modify: `src/shared/panel.test.ts`, `tests/background.test.ts`, `src/entrypoints/selection-popup/Popup.test.tsx`

## Tasks & Steps

1. In `src/shared/panel.ts`, add `PANEL_PATH = 'sidepanel.html'` and `openTabPanel(api, tabId): Promise<void>`. It
   calls `api.sidePanel.setOptions({ tabId, path: \`${PANEL_PATH}?tab=${tabId}\`, enabled: true })` without
   awaiting it, then `api.sidePanel.open({ tabId })` in the same tick. Both errors are logged. The comment states the
   gesture invariant. Use the order S12 proved (un-awaited or awaited).
2. `openPanelAndInject` and `togglePanelAndInject` call `openTabPanel` instead of `sidePanel.open`.
3. `setupPanelBehavior` also calls `setOptions({ enabled: false })` (the global panel off), guarded by
   `typeof api.sidePanel.setOptions === 'function'`.
4. `ClosePanelRequest` replaces `windowId` with `tabId: number`. `togglePanelAndInject` sends `tab.id`.
5. In `Popup.tsx`, `openPanel` calls `openTabPanel(api, record.tabId)` and keeps its existing then/else handling.
6. If S12 scenario 7 shows that options outlive a closed tab, add `setOptions({ tabId, enabled: false })` to
   `listenForTabLifecycle`'s `onRemoved`. Otherwise add nothing.
7. Tests:
   - `panel.test.ts`: `setOptions` with the tab's path, then `open`, with no await between them and both before any
     injection. The toggle request carries `tabId`.
   - `background.test.ts`: the global disable runs at startup, and a failure of it is logged, not left unhandled.
   - `Popup.test.tsx`: setOptions and open are the first calls in the click.

## Verification

- `pnpm vitest run src/shared/panel.test.ts tests/background.test.ts src/entrypoints/selection-popup/Popup.test.tsx`
- `grep -rn "sidePanel.open(" src --include=*.ts --include=*.tsx | grep -v test` shows only `openTabPanel`.
- `pnpm typecheck`
