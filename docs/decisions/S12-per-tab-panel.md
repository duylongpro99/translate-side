# S12 — Per-tab side panel: does a hidden tab's panel keep running?

Status: **gate passed 2026-11-10**; the per-tab panel is implemented on `feat/per-tab-panel` · Date: 2026-11-10 ·
Chrome 157.0.8103.50 (macOS) · Spike code: `spikes/s12/` · Plan: `plans/261110-0222-per-tab-side-panel/`

## Question

The user asked (2026-11-10) that the side panel open only on the tab that opened it, stay open when they come back to
that tab, and keep translating while that tab is in the background. The engine runs in the panel page (S1), and S1
forbade per-tab panels because a hidden one might unload and cancel its tab's translation. Nobody had measured that.

1. Does a per-tab panel stay loaded and keep running (timers, a streaming `fetch`) while another tab is in front?
2. Do two tabs get two separate panels, each running while hidden?
3. Can the open path call `setOptions({ tabId, path, enabled: true })` and `sidePanel.open({ tabId })` in one gesture?
   Must `setOptions` be awaited first?
4. Does the panel survive a navigation of its tab, a move to another window, and what do `close` and
   `setOptions({ enabled: false })` do? Do a closed tab's options outlive it?

## Method

- `spikes/s12/ext/` is an MV3 extension. Its worker turns the window-wide panel off at start
  (`setOptions({ enabled: false })`). `action.onClicked` calls `setOptions({ tabId, path: 'panel.html?tab=<id>',
  enabled: true })` and `sidePanel.open({ tabId })` in the same tick (`unawaited`), or awaits `setOptions` first
  (`awaited`).
- The panel logs `panel-LOADED`, `panel-UNLOAD` (`pagehide`), `visibilitychange`, a 1 s tick with the animation frames
  drawn in that second, and the progress of a 60 s streaming `fetch` from `server.mjs`.
- `spikes/s12/drive.mjs` runs an isolated **headful** Chrome stable and clicks the toolbar action with CDP
  `Extensions.triggerAction`, which is a user gesture (S5). It switches tabs with `chrome.tabs.update` through the
  worker. After each step the worker reads the active page's `innerWidth`: **1100 px with no panel beside it, 714 px with
  one.** That is the evidence for which tab shows a panel; it needs no screenshot.
- Each scenario ran twice, in a fresh browser each time. `summarize.mjs` prints a log per step.
- Re-run: `sh spikes/s12/run-all.sh 8912` (about 8 minutes; keep the spike window in front), then
  `node spikes/s12/summarize.mjs spikes/s12/results/<run>.jsonl`.

## Evidence

Logs: `spikes/s12/results/<scenario>-<order>-<run>.jsonl`.

| # | Scenario | Result (both runs) |
|---|---|---|
| 1 | Open on A, 30 s on B (no panel), back to A | One `panel-LOADED`, no `panel-UNLOAD`. On B: page 1100 px (no panel), A's panel `hidden`, 0 frames drawn, **ticks and fetch progress kept arriving** (fetch 200 → 3200 bytes over the 30 s). Back on A: page 714 px, panel `visible`, no click. `getOptions(B)`: `enabled: false`. |
| 2 | Open on A and on C; A → C → A → B | Two documents, `panel.html?tab=A` and `?tab=C`. Each shows on its own tab only (714 px), B shows none (1100 px). Both keep ticking and fetching while hidden. |
| 3 | Navigate A same-origin, then cross-origin | Same document throughout (one `panel-LOADED`); still shown on A. |
| 4 | `sidePanel.close({ tabId: A })` from the worker, no gesture | Closes and unloads A's panel (`onClosed`, `panel-UNLOAD`). Not shown when coming back to A. Options stay `enabled: true`. |
| 4 | `setOptions({ tabId: A, enabled: false })` | Also closes and unloads A's panel; not shown on return; the next toolbar click opens it again. |
| 5 | Move A to a new window (`windows.create({ tabId })`) | **The panel moves with its tab**: same document, still shown beside A (714 px) in the new window. |
| 6 | `awaited` order: `await setOptions`, then `open` | **`open` fails**: "`sidePanel.open()` may only be called in response to a user gesture." (2/2). The `unawaited` order opened in every run. |
| 7 | Close tab A | Chrome closes and unloads its panel. `tabs.get(A)` fails, but `getOptions({ tabId: A })` still returns the options: **they outlive the tab**. |
| 8 | Open A's panel, then open it again (same path, same tab: `Alt+T` pressed again, the selection button) | **No reload**: one `panel-LOADED`, no `panel-UNLOAD`, the fetch keeps going. |

Background throttling: after about 20 s hidden, the 1 s timer fired every 2–3 s and the fetch callbacks arrived in
batches (scenario 1). No chunk was lost and the stream finished. A translation job, which is driven by its streams, keeps
advancing; it may advance a little slower than in front.

Note on visibility: in runs where the spike window was not the focused app, `visibilityState` stayed `visible` and
frames kept being drawn while the panel was off screen. The page width is reliable either way, so the table rests on it.
The spike window was raised once at the start of each run for this reason.

## Decision

The gate passes. The per-tab panel is implemented with the engine still in the panel page (S1 stands):

1. **The window-wide panel is off.** The worker calls `setOptions({ enabled: false })` at every start.
2. **One open path.** `openTabPanel` (`src/shared/tab-panel.ts`) calls `setOptions({ tabId, path:
   'sidepanel.html?tab=<id>', enabled: true })` and `sidePanel.open({ tabId })` in the same tick, never awaiting
   `setOptions` first (scenario 6). The toolbar icon, `Alt+T`, the context menu, the selection button and the popup's
   Open in side panel all go through it.
3. **A panel is bound to its tab** by its `?tab=` query. It never follows the active tab, keeps its tab across a move
   to another window (scenario 5), and its job is never paused for being in the background. This supersedes S5 R1 /
   M0 D14 ("pause on tab switch"): a panel now serves one tab, so its job runs whether or not that tab is in front.
4. **The toggle closes the tab's panel only.** The close question carries the tab id; the bound panel answers and
   disables its tab's options, which closes it and keeps it closed on return (scenario 4).
5. **Nothing to do when a tab closes** (scenario 7). Chrome closes that tab's panel. Its options outlive it, but there
   is no API to delete them and tab ids are not reused in a session, so switching them off would free nothing.
6. **A second open of an open panel is safe** (scenario 8): the toggle's close question still reaches the same
   document, and a selection handed over to a translating panel does not restart it.

## Consequences

- S1's "do not give the panel a per-tab path" consequence is replaced by this record.
- An allowlisted site is auto-read only in a tab whose panel is open (M5-E3 change accepted by the user on 2026-11-10).
- Each open panel has its own engine, as each window's panel did before. `maxConcurrency` applies per job, as before.
- Not automatable: `Alt+T` and the context menu on a real panel, and the real side panel's visibility from Playwright.
  The owner's manual check covers them (plan Phase 4).
