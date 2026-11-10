---
phase: 3
title: "Panel bound to its tab"
status: done
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 3: Panel bound to its tab

## Goal

A panel serves only the tab in its `?tab=` query: it never switches to another tab, and it answers close requests for
its own tab only.

## Files to Create / Modify

- Modify: `src/entrypoints/sidepanel/controller.ts` (bound tab; no `onActivated`; detach handling per S12)
- Modify: `src/entrypoints/sidepanel/main.tsx` (read `?tab=`, pass it in)
- Modify: `src/entrypoints/sidepanel/toggle.ts` (`listenForCloseRequests` matches `tabId`; `closePanel` per tab)
- Modify: `src/entrypoints/sidepanel/controller.test.ts`, `toggle.test.ts`, `App.test.tsx` where they assume following

## Tasks & Steps

1. In `main.tsx`, parse `new URLSearchParams(location.search).get('tab')` into a positive integer, or `undefined`.
   Pass it to `new PanelController(browser, { tabId, ... })` and to `listenForCloseRequests`.
2. In `controller.ts`, add `tabId?: number` to `ControllerOptions`. In `start()`:
   - With a bound tab: call `setActive(boundTabId)` once, and register no `tabs.onActivated` listener.
   - Without one (an old panel opened by the global path before the worker disabled it, or a page opened directly):
     fall back to the window's active tab at start, still without following. Remove `onActivated` entirely.
   - `onUpdated`, `onRemoved` and `storage.session.onChanged` stay. They are already keyed by tab and only touch
     sessions this panel has.
   - `onDetached`: follow S12 scenario 5. If a per-tab panel moves with its tab, do not drop the bound tab's session
     when it leaves this window. If it does not move, keep today's drop.
3. When the bound tab is closed (`onRemoved` for the bound tab), the panel closes itself.
4. In `toggle.ts`:
   - `listenForCloseRequests(api, close, tabId, bornAt)` answers only when `message.tabId === tabId`. The
     `windowId` lookup goes away.
   - `closePanel(api, tabId)` calls `sidePanel.setOptions({ tabId, enabled: false })`, then
     `sidePanel.close({ tabId })` when it is available, else `window.close()`.
5. Remove the now-unused multi-tab paths, but only where nothing else uses them. `sessions` stays a Map, because
   snippets and offers key by `tabId`. Keep the change small.
6. Tests:
   - `controller.test.ts`: a bound controller ignores an `onActivated` for another tab and shows its own tab's view.
     An unbound controller binds to the active tab at start and does not follow.
   - `toggle.test.ts`: answers only its own `tabId`; `closePanel` disables then closes.

## Verification

- `pnpm vitest run src/entrypoints/sidepanel`
- `grep -n "onActivated" src/entrypoints/sidepanel/controller.ts` prints nothing.
- `pnpm typecheck` and `pnpm exec eslint src`
