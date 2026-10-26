---
title: "Cook: popover block toolbar and selection translate button"
date: 2026-10-25
summary: Shipped the popover toolbar (PR #3) and the selection button with its opt-in for every site (PR #4); two review rounds caught a navigation-guard hole and two toolbar regressions.
---

# Cook: popover block toolbar and selection translate button

## What happened
- Spike S9 on Chrome 155: a trusted page click carries the gesture to `sidePanel.open` (Q1 yes). Q2 could not be scripted: no switch accepts the permission prompt, and `developerPrivate.addHostPermission` silently grants nothing optional. Q3: a host grant re-injects on every navigation.
- Toolbar: CSS anchor positioning with `@position-try` fallbacks. Three Chrome behaviors shaped it: a plain `max()` clamp goes stale on scroll (scroll compensation translates, it does not re-lay out); Chrome keeps the last successful fallback while the anchor stays, so the anchor is attached only while shown; anchors and fixed boxes on every block cost ~40 ms on the 100-screen perf page.
- The panel e2e runs as a background tab with no frames: hover tests move the panel tab into its own window (`chrome.windows.create({ tabId })`).

## Review catches
- Records without an origin (a gesture on an unreadable page, an unfinished injection) let the navigation guard follow anything under the broad access. Every record now carries its grant's origin.
- The toolbar drew over the job bar, and a click-focused block's toolbar could float over another block after an instant scroll. Fixed with z-index, a job-bar-aware clearance, `:focus-visible`, and a fallback bounded by the block.

## Mistake
- A `git checkout <file>` meant to drop one tweak discarded all uncommitted toolbar CSS; rebuilt from the session and re-verified. Commit before experimenting with file swaps.

## Open
- Manual check on Chrome stable; S9 Q2 by hand (`spikes/s9`, `manual` mode).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
