---
title: Implemented the per-tab side panel
date: 2026-11-10
summary: "S12 passed; the panel opens per tab, is bound by ?tab=, and keeps translating in the background"
---

# Implemented the per-tab side panel

## What happened
Spike S12 ran in headful Chrome 157 (`spikes/s12/`, `docs/decisions/S12-per-tab-panel.md`). A hidden per-tab panel stays
loaded and keeps its timers and streaming fetch going. The gate passed, so Phases 2 to 4 went ahead on
`feat/per-tab-panel` with the engine still in the panel page.

## Surprises
- `await setOptions` before `sidePanel.open` loses the gesture. Both calls go out in one tick (`openTabPanel`).
- `visibilityState` is unreliable when the spike window is not the focused app. The active page's `innerWidth`
  (1100 px alone, 714 px beside a panel) became the evidence instead. An early screenshot attempt caught an unrelated
  window on the owner's screen; it was deleted and screen capture was removed from the driver.
- The jobs' active-tab gate (D14) would have paused a background tab's job. A bound panel reports its tab once, so the
  gate stays open. No gate code changed.
- e2e: `translate(page)` picked the first tab with a matching URL while `panel(page)` picked the active one. The old
  window-wide panel hid the mismatch.

## Review
A code review found that an unbound panel closed by the wrong tab, and that a failed `sidePanel.close` skipped
`window.close()`. Both are fixed. Disabling a closed tab's options was dropped as useless. A spike scenario added during
the review showed a second open of an open panel does not reload it.

## Open
- The owner's manual check in Chrome stable: open on A, switch to B (no panel), back to A (still open, translated);
  Alt+T on A closes only A's panel; the context menu and the selection button open the clicked tab's panel only.
- The panel perf budget test fails on master too (158–176 ms against 100 ms).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
