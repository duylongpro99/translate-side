---
title: "Plan: popover block toolbar and selection translate button"
date: 2026-10-25
summary: Planned a no-reflow popover toolbar and a two-tier selection button; a gesture/permission spike gates the selection work.
---

# Plan: popover block toolbar and selection translate button

## What happened
Brainstormed and planned two UX fixes: `plans/261025-0548-popover-toolbar-and-selection-button/`.
- Toolbar line jump: the cause is the hover-only reserving float in `src/entrypoints/sidepanel/style.css:593` (plus the code caption padding at `:590`). The toolbar itself was already absolute.
- Selection button: today there is only the context menu (`src/shared/panel.ts`). The content script exists only under activeTab or an allowlisted grant (S5).

## Decision
- Toolbar: CSS anchor positioning with `anchor-scope` and `flip-block` (min Chrome 138), and the reserving float removed. It ships first as its own PR.
- Selection button, tier A: while the panel is connected, with no new permission. Tier B: an opt-in Settings switch, off by default, that requests the already-optional `https://*/*` and `http://*/*` and runs `registerContentScripts`.
- The click reuses `handOverSelection` through a worker message.

## Next steps
- Spike S9 measures three things: whether a content-script click allows `sidePanel.open`, whether removing the broad pattern also strips provider grants, and whether S5 re-injects on every navigation under the broad grant.
- Then `/ak:cook` the plan.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
