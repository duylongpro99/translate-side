---
title: Planned a per-tab side panel
date: 2026-11-10
summary: "Plan for a panel that opens only on the tab that triggered it, gated on spike S12"
---

# Planned a per-tab side panel

## What happened
The user asked for the side panel to open only on the tab that triggered it. Today the panel is global to the window
and follows the active tab (`src/entrypoints/sidepanel/controller.ts:159`). An advisory interview confirmed three
requirements: the panel stays open when the user returns to its tab, the page keeps translating while its tab is
hidden, and each tab gets its own panel. The plan is in `plans/261110-0222-per-tab-side-panel/`.

## Decision
- Chrome's per-tab panel options do this. The worker disables the global panel and calls
  `sidePanel.setOptions({ tabId, path: 'sidepanel.html?tab=<id>', enabled: true })` before `sidePanel.open`.
  The panel then binds to that tab and stops following the active tab. The toolbar and Alt+T toggle works per tab.
- Spike S12 gates the plan. S1 forbade per-tab panels because a hidden one might unload, which would cancel the
  engine running in the panel. Nobody measured that. If S12 fails, the work stops and the user decides.
- The user accepted that an allowlisted site is no longer auto-read in other tabs.

## Next steps
Run Phase 1 (spike S12), then `/ak-cook plans/261110-0222-per-tab-side-panel/plan.md` if it passes.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
