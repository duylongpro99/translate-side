# Code review: per-tab side panel (feat/per-tab-panel, uncommitted)

Date: 2026-11-10 · Reviewer: code-reviewer · Mode: read-only

## Scope
- Files: src/shared/{tab-panel.ts,panel.ts}, src/entrypoints/sidepanel/{controller.ts,toggle.ts,main.tsx,App.tsx,jobs.ts}, src/entrypoints/selection-popup/Popup.tsx, e2e/{fixtures.ts,per-tab-panel.spec.ts} + call-site updates, tests (tab-panel, panel, toggle, controller, background, Popup), docs (DESIGN, README, privacy, S1, S12), spikes/s12 (skimmed).
- Not re-run: typecheck, eslint, unit tests (reported green by the lead); e2e running separately.
- Note: during the review the working tree was briefly stashed and restored by another process; findings were read from the same content.

## Verified OK (the six focus questions)
1. Gesture: every `sidePanel.open` goes through `openTabPanel` (src/shared/tab-panel.ts:19-24), which fires `setOptions` unawaited, then `open`, in the same tick. Call sites: action/Alt+T (panel.ts:73), context menu (panel.ts:44 via openPanelAndInject, called synchronously at :111), selection button (panel.ts:141, after only synchronous checks; the popup branch returns before), popup "Open in side panel" (Popup.tsx:53). No await precedes `open` anywhere. `minimum_chrome_version` is 138, so `sidePanel` always exists, and dropping the old `?.` does not matter.
2. Close contract: worker sends `{tabId, pressedAt}` (panel.ts:74). The panel answers only when `message.tabId === controller.tabId` and `pressedAt >= bornAt + 100` (toggle.ts:37-40). The bound id is set synchronously at the start of `start()` (controller.ts:166-168), and `start()` runs in the same module tick as the listener registration, so a bound panel answers from its first message. The worker's `setOptions(enabled:true)` is sent before the question, and the panel's `setOptions(enabled:false)` comes after the answer, so they arrive in that order.
3. Controller: bound mode registers no onActivated listener. onDetached skips the bound tab (controller.ts:180-182). storage.session.onChanged is filtered to `activeTabId` (the bound tab). `pageComplete` and autoInject run only for sessions, and a bound panel only has a session for its own tab. `drop()` of the bound tab clears `activeTabId` and reports `active(undefined)`.
4. Active-tab assumptions: the only remaining `windows.getCurrent`/`tabs.query({active})` calls are the unbound fallback in controller.ts:169/192. No other src code follows the active tab.
5. Selection popup: Popup.tsx:37-39 still calls `translator.watch(() => record.tabId)` and `snippets.jobs.setActive(record.tabId)`, unchanged. The popup does not use the controller.
6. D14 gate (jobs.ts:945-951, :1022): `setActive(bound)` runs once, before any `refresh`, so a job is created with `gate.set(tabId === activeTabId) === true`. No later call changes it except `drop` → `undefined`, after the job is already dropped. A bound panel's job is never paused.

## Findings

### Medium

**M1. The unbound fallback treats "the tab I happened to start on" as "my bound tab" for closing.** App.tsx:348, main.tsx:38, toggle.ts:20-28.
`closePanel` and `listenForCloseRequests` get `controller.tabId`. For an unbound page (no `?tab=`), that is the window's active tab at start (controller.ts:192-193). So an unbound panel:
- answers the toolbar/Alt+T close question for that tab, and
- on Close (header button or toggle) calls `setOptions({tabId: X, enabled:false})`, which writes a per-tab override on a tab it is not bound to. On Chrome 141+ it then calls `sidePanel.close({tabId: X})`, swallows any rejection and **returns without `window.close()`**.

Failure scenarios:
- (a) A window-wide panel shown before the worker's first `setOptions({enabled:false})` (e.g. after a browser restart, if Chrome does not persist global options; not verified). Pressing Close hides it on X only through the override. `close({tabId})` targets a tab-specific panel that does not exist, so nothing closes, and the global panel stays on every other tab, still showing X.
- (b) The e2e harness, where the panel is a normal tab. Close does nothing (sidePanel.close rejects, so `window.close` is skipped), and it disables the real page tab's panel options as a side effect.

Also, on a bound panel, if both `setOptions` and `close` fail, the failure is silent and the panel stays open.

Fix: key closing on the bound id only. Pass `boundTabId(location.search)` (not `controller.tabId`) to `closePanel` and to `listenForCloseRequests`. In `closePanel`, fall back to `window.close()` when `close({tabId})` rejects, i.e. `.then(() => undefined, () => window.close())`. For an unbound page, keep the old window-scoped close (`sidePanel.close({windowId})`) or `window.close()`.

### Low

**L1. The onRemoved housekeeping is a no-op that adds a per-tab option entry for every closed tab.** panel.ts:235-236.
S12 scenario 7 shows Chrome keeps a closed tab's options. There is no API to delete them, and tab ids are not reused in a session. So `setOptions({tabId, enabled:false})` frees nothing and protects nothing. It writes a new override for every closed tab, including the many that never had a panel. That is unbounded growth in the browser's side-panel options map over a long session. The unit test (panel.test.ts, tab lifecycle) and S12 decision 5 lock this in.
Fix: drop the call (and decision 5's wording). If it must stay, limit it to tabs this extension opened a panel for, e.g. tabs with an access record.

**L2. Test quality gaps.**
- Most `PanelController` tests still call `started(w)` with no `tabId`, so they exercise the unbound fallback that production no longer uses. Only 3 tests pass `tabId`. The onDetached branch, which now behaves differently, is covered bound only for the bound tab itself. Suggest defaulting `started()` to bound, or running the routing and lifecycle tests in both modes.
- controller.test.ts:235: "ignores access changes of background tabs until they are activated". The panel is never activated onto another tab any more, so the name describes removed behaviour.
- toggle.test.ts:96/107: `vi.unstubAllGlobals()` is called at the end of the test body, so a failed assertion leaks the `window` stub into later tests. Move it to `afterEach`.
- No unit test covers `closePanel` when `setOptions` or `close` rejects (the M1 path).
- e2e/per-tab-panel.spec.ts test 2 asserts `{closed: true}` but not that the page closed, and it cannot: in-tab panel, see M1(b). That is acceptable for the contract, but the test's real effect is `setOptions(A, false)` plus a swallowed `close`. Worth a comment, or an assert on `chrome.sidePanel.getOptions({tabId: A})` being `enabled:false`, which verifies the S12 close path end to end.
- panel.test.ts `openPanelAndInject` records `setOptions` in a separate array, so it does not prove the order relative to `open`. tab-panel.test.ts does prove it, so this is acceptable.

## Unverified risks (not findings; need the owner's manual check)
- **Toggle or selection button on a tab whose panel is already open** re-issues `setOptions({tabId, path: same, enabled:true})` and `open` on the open panel (panel.ts:73, :44, :141). S12 never ran this: scenario 4 clicks again only after a close or disable, and there is no second-click-while-open scenario in spikes/s12/drive.mjs. If Chrome re-navigated the panel on a same-path `setOptions`:
  - the selection button would reload the panel and cancel its running job;
  - Alt+T would reload instead of close, because the new document ignores the question by `pressedAt < bornAt`.

  Chrome is expected to navigate only on a path change, but this is unmeasured. Add "press Alt+T twice → closes" and "selection button on a translating tab → job keeps running" to the manual check, or add an s8 scenario to the spike.
- Whether Chrome persists the global `setOptions({enabled:false})` across a browser restart. This decides whether M1(a) is reachable in practice.

## Positive observations (risk calibration only)
- The `openTabPanel` ordering invariant is centralized and unit-tested with a never-settling `setOptions`. That is the right shape of test for the gesture constraint.
- The new e2e test 1 would fail on the old code (onActivated would rebind the in-tab panel to B and pause A's job), so it is a real regression guard.

## Recommended actions
1. M1: use the bound id for the close path, with a `window.close()` fallback on rejection.
2. L1: remove the onRemoved `setOptions`, or limit it.
3. Add the two manual-check items above before merge.
4. L2: test cleanups (bound-mode controller coverage, the stale test name, `afterEach` unstub).

## Unresolved questions
- Same-path `setOptions` on an open per-tab panel: reload or no-op? (Chrome 157)
- Global side-panel options persistence across a browser restart.

Status: DONE_WITH_CONCERNS
Summary: The gesture ordering, the tab-keyed close contract, the controller's bound behaviour, the D14 gate and the popup jobs are correct. One medium issue: the unbound fallback closes by the start-time active tab and skips `window.close`. Two low issues: no-op option writes on every tab close, and test gaps. Plus one unmeasured Chrome behaviour (same-path `setOptions` on an open panel) that needs a manual check.
