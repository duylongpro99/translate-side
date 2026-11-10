---
phase: 1
title: "Spike S12: per-tab panel lifecycle"
status: done
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Spike S12, per-tab panel lifecycle

## Goal

Measure whether Chrome keeps a hidden per-tab side panel loaded and running. Decide whether the plan proceeds.

## Files to Create / Modify

- Create: `spikes/s12/` (copy of `spikes/s5/drive.mjs`, `server.mjs`, `site/`, and a new `ext/`)
- Create: `docs/decisions/S12-per-tab-panel.md`
- Create: `spikes/s12/results/*.jsonl`

## Tasks & Steps

1. Build `spikes/s12/ext/`: an MV3 extension with `sidePanel`, `tabs`, `activeTab` and `side_panel.default_path`.
   The worker calls `setOptions({ enabled: false })` at startup. `action.onClicked` calls
   `setOptions({ tabId, path: 'panel.html?tab=<id>', enabled: true })` without awaiting it, then `open({ tabId })`.
   The panel posts `panel-LOADED` and `panel-UNLOAD` (on `pagehide`), a 1 s timer tick, and the progress of a
   slow-streaming `fetch` from `server.mjs` (about 60 s) to the log server.
2. Adapt `drive.mjs` to run these scenarios in headful Chrome stable, and record the Chrome version:
   1. Open on A. Switch to B (no panel) for 30 s. Return to A.
   2. Open on A and on C. Switch A → C → A.
   3. Navigate A same-origin and cross-origin while its panel is open.
   4. Close A's panel with `sidePanel.close({ tabId })`, then switch away and back.
   5. Move tab A to a new window (`tabs.move` / detach).
   6. Await `setOptions` before `open`, to check whether the gesture is lost. Compare with the un-awaited order.
   7. Close tab A, then call `tabs.get` and `getOptions({ tabId })`.
3. Run each scenario twice. Write the JSONL logs.
4. Write `docs/decisions/S12-per-tab-panel.md` in the shape of S5: questions, setup, results table, decision.

## Pass condition (the gate)

- Scenario 1: one `panel-LOADED`, no `panel-UNLOAD`, and the timer ticks and fetch progress keep arriving during
  the 30 s on B. Returning to A shows the panel without a click.
- Scenario 2: A's panel and C's panel are separate documents. Each keeps running while hidden.
- The un-awaited `setOptions` + `open` order opens the panel in both runs.

**If scenario 1 fails:** stop. Report to the user. Do not start Phases 2 to 4.

## Verification

- `node spikes/s12/drive.mjs` produces both JSONL runs. The decision record cites them.
- Record what scenarios 3, 5 and 7 show. Phase 3 depends on scenario 5, and Phase 2 depends on scenario 7.
