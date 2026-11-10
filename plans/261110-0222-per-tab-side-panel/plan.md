---
title: "Side panel per tab: open only on the tab that opened it"
description: "The panel shows only on the tab that triggered it, stays open when the user returns, and keeps translating while that tab is in the background."
status: in-review
priority: P1
effort: 2d
branch: feat/per-tab-panel
tags: [feature, panel, architecture]
blockedBy: []
blocks: []
created: 2026-11-10
---

# Side panel per tab

## Outcome

The user's request (2026-11-10): today, opening the panel on one tab keeps it open on every tab of the window, and it
reads whichever tab is active. The panel should open only on the tab that triggered it. Tabs that did not trigger it
have no panel. Confirmed in an advisory interview the same day.

**Acceptance criteria**
1. Opening the panel on tab A (toolbar icon, Alt+T, context menu, selection button, or the selection popup's
   Open in side panel) shows it on tab A only.
2. Switching to tab B, which never opened the panel, shows no panel.
3. Returning to tab A shows its panel still open, with no click.
4. A long page translating on A keeps translating while the user is on another tab. On return it is done, or has
   advanced for the time spent away.
5. Opening the panel on tab C gives C its own panel. A is unaffected.
6. The toolbar icon and Alt+T close only the current tab's panel. A closed tab panel does not reappear on that tab
   until it is opened again.
7. The panel never switches to showing another tab: it is bound to the tab that opened it.

**Non-goals**: syncing panels across windows; the Firefox `sidebar_action` build (M9); moving the engine out of the
panel (only if Phase 1 fails, and only with the user's approval).

**Constraints**: `sidePanel.open` stays the first call in the user gesture, with no `await` before it (S5).
`openPanelOnActionClick` stays off (S5). The engine stays in an extension page, not the worker (S1).

## Design

- **Per-tab panels.** The worker disables the global panel at startup (`sidePanel.setOptions({ enabled: false })`).
  Every open path calls one shared helper, which calls
  `setOptions({ tabId, path: 'sidepanel.html?tab=<id>', enabled: true })` without awaiting it, then
  `sidePanel.open({ tabId })` in the same tick. Chrome then shows the panel only on that tab and keeps its open state
  per tab.
- **The panel is bound to its tab.** `sidepanel.html?tab=<id>` tells the panel which tab it serves. The controller
  drops the `tabs.onActivated` follow (`src/entrypoints/sidepanel/controller.ts:159`). The e2e harness opens
  `sidepanel.html?tab=<id>` in a tab the same way. This removes its "never bring the panel to the front" rule.
- **Toggle per tab.** The worker's close question carries `tabId`, not `windowId`. The panel bound to that tab closes
  itself (`sidePanel.close({ tabId })`, else `window.close()`) and disables its tab's options, so the tab has no panel
  until it is opened again.
- **Concurrency.** This does not change. `maxConcurrency` already applies per job (`src/engine/runner.ts:62`), and
  today's single panel already runs one job per tab. Separate panels keep the same per-job count.

## Behaviour change to accept

An open panel no longer reads other tabs. The M5-E3 auto-read of an allowlisted site (`autoInject` in
`src/entrypoints/sidepanel/main.tsx`) then only happens inside the panel's own tab, for example after a navigation
there. A newly activated allowlisted tab is no longer read until its own panel is opened. This follows from criterion 2.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|------------|
| 1 | [Spike S12: per-tab panel lifecycle](./phase-01-spike-per-tab-panel-lifecycle.md) | Done (gate passed) | none |
| 2 | [Worker opens and closes panels per tab](./phase-02-worker-opens-panels-per-tab.md) | Done | 1 (pass) |
| 3 | [Panel bound to its tab](./phase-03-panel-bound-to-its-tab.md) | Done | 1 (pass) |
| 4 | [E2E and docs](./phase-04-e2e-and-docs.md) | Done; owner's manual check open | 2, 3 |

Phase 1 is a gate. If a hidden per-tab panel unloads or stops running, criterion 4 cannot be met with the engine in
the panel. Stop and ask the user whether to move the engine to an offscreen document (a milestone, not this plan) or
to accept "resume from cache".

## Success Criteria

- [x] S12 is recorded in `docs/decisions/S12-per-tab-panel.md`: a hidden per-tab panel keeps running, has one
      `panel-LOADED` and no `panel-UNLOAD` across A → B → A, and its timer and fetch keep advancing while hidden.
- [x] Every open path goes through the shared per-tab helper. `grep -rn "sidePanel.open(" src` shows only that helper.
- [x] The controller has no `tabs.onActivated` listener.
- [ ] `pnpm typecheck`, eslint on `src`, `pnpm test`, the build, `check:bundle`, `check:manifest` and the e2e suite pass.
- [x] S1's "do not use per-tab panels" consequence and DESIGN §4 are updated to cite S12.

## Risks

- **Gesture ordering:** an un-awaited `setOptions` followed by `open` in the same tick may race. S12 checks this.
  Fallback: set the tab's options earlier, on the content script's ready message, and keep `open` alone in the gesture.
- **Tab moved to another window (`tabs.onDetached`):** it is not known whether a per-tab panel follows its tab. S12
  checks this. The controller must not drop its own tab's session on detach if the panel follows.
- **Global disable at startup:** a click that arrives before the worker disables the global panel would open a global
  panel once. This is harmless and idempotent, because the next start disables it again.

## Validation Log

### Session 1 (2026-11-10)

- **Auto-read of allowed sites in other tabs:** the user accepts the change. Only the panel's own tab is auto-read.
  README line 75 and DESIGN are updated in Phase 4.
- **If S12 fails:** the user chose to stop and ask, with the evidence in hand. This is the plan's gate, unchanged.

### Verification Results

- Claims checked: 10 (panel.ts open and toggle paths, `Popup.tsx:52`, `controller.ts:159` `onActivated`,
  `ControllerOptions`, `main.tsx` `autoInject`, `toggle.ts` window-keyed close, `runner.ts:62` per-job concurrency,
  `e2e/fixtures.ts` panel page, the `spikes/s5` driver, `README.md:75`)
- Verified: 10 | Failed: 0 | Unverified: 0
- Tier: Standard
- Still unknown by design, settled by Phase 1: per-tab panel lifetime when hidden, gesture ordering, detach behaviour,
  and whether options outlive a closed tab.

### Whole-Plan Consistency Sweep

The plan, phases and validation decisions agree. The README line is named in Phase 4. No contradictions remain.

## Implementation Notes (2026-11-10)

- S12 passed in Chrome 157: `docs/decisions/S12-per-tab-panel.md`. The awaited `setOptions` order loses the gesture,
  so the shared helper (`src/shared/tab-panel.ts` `openTabPanel`) sends both calls in one tick. It lives in its own
  module so the selection popup does not import the worker's `panel.ts`.
- Not in the plan, found on the way: the jobs' active-tab gate (D14) is what would have paused a background tab's job.
  A bound panel reports its tab as active once and never changes it, so the job keeps running. Documented in DESIGN
  §4.1 and the `jobs.ts` header; no gate code changed.
- Phase 3 step 3 (the panel closes itself when its tab closes) needs no code: Chrome closes and unloads a tab's panel
  with the tab (S12 scenario 7).
- Scenario 5: a panel moves with its tab, so a bound panel keeps its tab's session on `onDetached`.
- Phase 2 step 6 was implemented, then removed after review: disabling a closed tab's options frees nothing (S12
  decision 5). A scenario 8 (a second open does not reload the panel) was added from the review.
- Review (`plans/reports/code-reviewer-261110-0955-per-tab-panel-review.md`): closing now uses the panel's bound tab
  only, an unbound panel closes for its window, and a panel page that `sidePanel.close` cannot close closes itself.
- e2e: `translate(page)` and `panel(page)` now resolve the page's own tab, as two tabs can share an address.
- Known, not from this change: `e2e/perf.spec.ts` "keeps the panel within its long-task budget" fails on master too
  (158–176 ms against 100 ms on this machine).
