# Code review: feat/popover-toolbar-selection-button (selection button, tiers A and B)

Worktree: /Users/onedayin20902/personal/agent/translate-side-selection-button, `git diff master...HEAD` (463cc5b..4ca1de3).
Read-only review. Date: 2026-10-25.

## Scope
- Commits: 4 after master (6103096, 29d1e02, 1885372, 4ca1de3), not 6 as stated in the brief.
- Files: 44 changed, +1882/-49 (about 700 lines of source; the rest is tests, e2e and spike files).
- Focus: navigation guard (`mayFollow`), worker message path, registration reconcile, page-side button, options switch, import/export, docs claims.
- Probe: a scratch vitest file run against the worktree source (no worktree edits) confirmed finding H1.

## Overall assessment
The click path is sound: `sidePanel.open` is called synchronously in `onMessage`, sender checks are right (`sender.id`, `sender.tab`, `frameId === 0`), the denylist and never-translate checks use the sender's address, `isTrusted` is enforced, and turning the option off never revokes. The weak point is the navigation guard that DESIGN, privacy.md and the store justification all lean on ("the broad access does not make the panel read more"). The guard trusts any access record that has no `origin`, and the branch itself writes such records. The docs changes are also not committed on the branch.

## Critical issues
None.

## High priority

### H1. With the broad grant, the navigation guard is bypassed for every record without `origin`. Confidence: high (probe-verified)
`src/shared/inject.ts`:
```ts
const origin = result.status === 'ready' ? originOf(tab.url) : from?.origin;   // injectInto
...
if (from?.origin === undefined) return true;                                    // mayFollow
...
await writeAccess(api, tabId, { status: 'injecting', trigger });                // attempt: no origin
```
Records the branch writes without `origin`:
1. **Any gesture that does not end `ready`.** Examples: the action or Alt+T on a `chrome://newtab` page (restricted), a denylisted mail page, a never-translate site, or the Web Store (inject-failed). `from` is undefined for a gesture, so `origin` is undefined.
2. **The transient `injecting` record** that `attempt` writes before every `executeScript`. It is left behind if the worker dies mid-injection, and a second `tabs.onUpdated complete` can read it while the first injection is still in flight (a fast JS redirect, for example).

Probe result:
- Gesture on `https://mail.google.com/mail/` gives `{"status":"blocked","reason":"denylisted","trigger":"gesture"}` with no origin.
- A navigation to `https://news.example/` then gives `{"status":"ready","trigger":"navigation","origin":"https://news.example"}`, with `executeScript` called.
- An `injecting` record with no origin followed by a cross-origin navigation also gives `ready`.

After the leak, the new record carries the new origin, so the tab keeps being followed on that site.

The most common real path: the user opens the panel with the toolbar on the New Tab page (blocked, restricted), then types an address. Under `activeTab` alone, `tab.url` is hidden and the record turns `lost`. With the tier B grant, the full content script is injected and the page is extracted into the panel with no gesture on that origin. That contradicts S9 decision 3, DESIGN §8 ("re-injected only on the origin a gesture granted"), privacy.md ("This access does not make the panel read more") and permission-justifications reason 3. Nothing is sent without a Translate click unless the site is allowlisted, so this is a local read, not an exfiltration. That is why it is rated High, not Critical.

The "legacy records" justification for `origin === undefined → true` does not hold either: access records live in `storage.session`, which Chrome clears when the extension reloads or updates. So in practice every origin-less record is one this branch wrote.

Fix:
- In `injectInto`, use `const origin = trigger === 'gesture' ? originOf(tab.url) : result.status === 'ready' ? originOf(tab.url) : from?.origin;`. activeTab grants the tab's origin even when the extension declines to read it.
- Pass the origin into the `injecting` write as well: `writeAccess(api, tabId, { status: 'injecting', trigger, ...(origin ? { origin } : {}) })`, computed from `from?.origin` for a navigation or the tab URL for a gesture.
- In `mayFollow`, keep `from === undefined → true` (the panel's allowlist-gated `autoInject` relies on it), but treat `from` without `origin` as "allowlist only".
- Add unit tests for "blocked gesture, then cross-origin navigation → lost" and "injecting record, then cross-origin navigation → lost".

### H2. The docs changes are not on the branch. Confidence: high
DESIGN.md, docs/privacy.md, docs/store/permission-justifications.md, docs/store/listing.md, README.md and the "Consequences" paragraph of docs/decisions/S9-selection-button-gesture.md are modified only in the worktree (`git status`), not committed. Merging HEAD as it stands ships an opt-in that asks for all-sites access with no privacy or store-justification text. That fails plan acceptance criterion 7 and phase 5. Commit them after fixing H1, since the current text claims H1 cannot happen.

## Medium priority

### M1. `reconcile()` rewrites the registered script on every worker start. Confidence: medium-high
`listenForSelectionEverywhere` runs `reconcile()` at the top level. When the script is registered, that means an unconditional `scripting.updateContentScripts`. The worker wakes for every `tabs.onUpdated` on every tab (listener in `listenForTabLifecycle`), so after each idle period a page load triggers a script-set update, which Chrome broadcasts to renderers and persists (`persistAcrossSessions: true`).

Fix: compare the registered entry's `excludeMatches`, `matches` and `js` with the desired ones, and update only when they differ. This is the same `getRegisteredContentScripts` call already made, without the `ids` filter shortcut.

### M2. The tier B button does not follow changes to the never-translate list or the permission on open pages. Confidence: high
`selection.content.ts` leaves only when `selectionEverywhere` turns off. If a site is added to never-translate, or the broad grant is removed in chrome://extensions, the already-open pages keep the button until reload. A click is still handled by the worker: `handOverSelection` blocks never-translate sites, but without the grant it hands the text over and records `blocked/inject-failed`. Nothing leaks past the worker checks. But the docs claim "never-translate sites get no button", which is true only for page loads after the change.

Fix: in the script, also leave on a `siteNever` change that matches `location`. It could read via `onListChanged`, but that import adds weight, so a simple `storage.sync.onChanged` key check plus `matchesSite` would do. Or soften the docs.

### M3. Stale tier B copy after an extension update throws on click. Confidence: medium
After an update, an old tier B copy stays on open pages with a dead runtime. A new copy is acquired only if tier A or a fresh tier B runs on that page. A click then calls `browser.runtime.sendMessage`, which throws synchronously ("Extension context invalidated"), so the `.catch` never runs. The button hides and nothing happens.

Fix: check `isRuntimeAlive()` in `onClick` (or in the watch's click handler) and stop the watch when it is false, or wrap the call in try/catch.

## Low priority
- **L1.** The worker does not cap `message.text` before writing it to `storage.session`. The content script caps at 40k, but only a compromised renderer could exceed that. A `slice(0, 2 * MAX_SELECTION_CHARS)` in `listenForSelectionButton` costs nothing.
- **L2.** `deepActiveElement` is duplicated in `src/extract/selection-button.ts` and `src/extract/index.ts`. `editable.ts` was split out for exactly this kind of sharing, so it could hold this too.
- **L3.** `selectionEverywhere` is in `storage.sync`. Turning it on on device A re-enables it on device B wherever B still holds the broad grant, which turn-off deliberately keeps. This is consistent with the sync model, but worth a line in the hint or privacy.md.
- **L4.** Tier B shows the button for selections made by page script (`addRange`), so a page can place the button under a user's next click. The impact is only that page-chosen text from the same page gets translated with the user's provider. Accept, or require that a `mouseup` or `keyup` preceded the settle.
- **L5.** The Options switch does not refresh on `permissions.onRemoved` while the page is open, so the "no access" warning appears only after a reload or a toggle.

## Edge cases found by scouting
- Blocked or restricted gesture followed by a navigation (H1). This is the realistic path: a toolbar click on the New Tab page, then typing a URL.
- The `injecting` window and a worker killed mid-injection (H1).
- `excludeMatches`: never-list entries match `matchesSite` semantics (an exact host, or `*.` covering the base host), and `*.host` patterns for the denylist cover the bare host in Chrome match patterns. These are consistent. `HOST_RE` cannot produce an invalid match pattern, as far as I could verify.
- `removeAllowlisted` and provider removal call `permissions.remove` for narrow origins while the broad grant is held. That is expected to leave `https://*/*` in place (set difference). Not measured. `autoTranslates` still gates on the allowlist, so there is no behavior risk.
- Change watch: the host element adds one childList mutation (one re-read with an unchanged signature). Later show and hide only touch inline style, and `attributes` is not observed. OK.
- Closed shadow root: document-level capture listeners see the host in `composedPath()`, so `ours()` works. `deepActiveElement` stops at the host. OK.

## Verified correct (to calibrate risk)
- `listenForSelectionButton`: the type guard and sender checks are synchronous, and `sidePanel.open` is the first async call. The sender URL is used for the checks, not one in the message. Extension pages (no tab), other frames and other extensions are ignored. Registered at the top level.
- `listenForSelectionEverywhere`: listeners are registered at the top level, and reconcile is serialized through a promise queue. Errors are logged, not swallowed into the chain.
- Turn-off only unregisters. No `permissions.remove` of the broad patterns anywhere (`grep`), so acceptance criterion 6 holds.
- Tier A acquire and leave are balanced per port. The ref-count replaces a dead copy, and a dead copy's late `leave` does not clear the new global.
- Import and export: a boolean only, and the permission is not carried. An imported `true` without the grant shows the warning and does not register.
- The existing context menu, action toggle and allowlist auto-inject paths are unchanged, apart from the extra `from` argument.

## Recommended actions
1. Fix H1 in `inject.ts` (gesture origin even when not ready, origin on the `injecting` write, origin-less non-undefined `from` → allowlist only) and add the two regression tests.
2. Commit the docs (H2) after H1, so the privacy claim is true when it ships.
3. M1: make reconcile a no-op when the registration already matches.
4. M2 and M3: tier B leaves on a matching never-list change and on a dead runtime, or adjust the docs wording.
5. Low items at the author's discretion.

## Plan follow-ups (no plan files edited)
- Phases 3 and 4: code and tests appear complete. H1 undermines the Q3 branch of phase 4 ("navigation path must not follow the broad grant").
- Phase 5 (docs): written but uncommitted (H2).
- Phase 2 (popover toolbar, acceptance criteria 1 and 2): there are no commits for it on this branch, although the branch name includes it. Confirm whether it is a separate branch.

## Metrics
- Gates were reported green by the lead. Not rerun here (read-only; no build or e2e in a worktree under review).
- New unit tests: panel, selection-button (extract and shared), portable, options, background. None covers a non-ready gesture or the `injecting` record followed by a navigation.

## Unresolved questions
- Is phase 2 (popover toolbar) meant for this branch?
- Was the tier B `storage.sync` scope (rather than `storage.local`) deliberate, given that turn-off keeps the grant (L3)?
