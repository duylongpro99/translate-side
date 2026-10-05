# S5 — `activeTab` and navigation → permission and allowlist design

Status: proposed (awaiting review; amended after review round 1) · Date: 2026-10-05 · Chrome 154.0.8037.93 (macOS) · Spike code: `spikes/s5/`

## Question

ROADMAP §2 S5 asks: after the panel opens on page A, what happens on a same-site and a cross-site navigation? Does the
panel stay? Can the content script be re-injected without a gesture? Does a click inside the panel count as a gesture?
Is "auto-open on allowlisted sites" possible? Which `minimum_chrome_version`?

Added by the supervisor from the Phase A review:
1. Does opening the panel through the toolbar action / `_execute_action` (`Alt+T`) with
   `setPanelBehavior({ openPanelOnActionClick: true })` grant `activeTab` for later injection? Do the `Alt+T` command
   and the context-menu → `sidePanel.open()` path grant it?
2. Should `optional_host_permissions` include `http://*/*` (LAN gateways, ROADMAP §8 item 19)?

## Method

- `spikes/s5/site/` holds three local pages on two origins: `http://127.0.0.1:<port>/a.html` and `/b.html`, and
  `http://localhost:<port>/c.html` (a different origin and site). `server.mjs` serves them and collects logs.
- `spikes/s5/ext/` is an MV3 extension with `sidePanel`, `storage`, `activeTab`, `scripting`,
  `optional_host_permissions` for both origins, a `side_panel.default_path`, and `_execute_action` = `Alt+T`. The worker
  logs every `action.onClicked` and `tabs.onUpdated`. It tries `scripting.executeScript` at each step ("probe") and
  tries `sidePanel.open()` with no gesture. The panel has buttons that inject, call `sidePanel.open()` and call
  `permissions.request()`.
- `spikes/s5/drive.mjs` runs an isolated **headful** Chrome (temporary profile). It clicks the toolbar action with CDP
  `Extensions.triggerAction`. It clicks links and panel buttons with real `Input.dispatchMouseEvent` events, which give
  the page user activation. It navigates "omnibox-style" with `Page.navigate`. Worker probes with no gesture run
  through `Runtime.evaluate` on the worker.
- Variants: `mode` = `behavior` (`openPanelOnActionClick: true`) or `onclicked` (`false`; `action.onClicked` calls
  `sidePanel.open({tabId})` and injects). `variant` = `optional` (site origins only optional), or `granted` (site origins
  as install-time host permissions, standing in for "the user granted the optional permission when allowlisting").
- Re-run: `cd spikes/s5 && node server.mjs 8901 results/x.jsonl & node drive.mjs onclicked 8901 optional`.

## Evidence

Logs: `spikes/s5/results/{behavior-optional,onclicked-optional,onclicked-granted,permtest,permtest-undeclared}.jsonl`.

Tester round, re-runs with the committed `drive.mjs` and `NOPERM=1` (the permission-prompt step skipped, so no run
depends on a person): `results/onclicked-optional-rerun.jsonl` and `results/behavior-optional-rerun.jsonl`. The
original `behavior-optional.jsonl` came from an older `drive.mjs`. The re-run reproduces every row of its column:
inject FAIL at every step, `onClicked` never fired, panel-click inject FAIL, and the second toolbar click closed the
panel.

### Who can inject, and when (worker `executeScript` probe, no gesture)

| Step | `behavior` + optional | `onclicked` + optional | `onclicked` + host permission |
|---|---|---|---|
| A loaded, nothing clicked | FAIL | FAIL | OK |
| Toolbar action clicked on A | panel opens; **inject FAIL**; `onClicked` not fired | panel opens; inject OK | OK |
| Hash link on A (`#sec`) | FAIL | OK | OK |
| `history.pushState` on A | FAIL | OK | OK |
| Link click A → B (same origin, full navigation) | FAIL | **OK** | OK |
| Reload B | – | OK | OK |
| Omnibox-style navigation B → A (same origin) | – | OK | OK |
| Second tab opened (B) | – | FAIL (no grant for that tab) | OK |
| Back on the first tab | – | OK | OK |
| Link click → C (cross origin) | FAIL | **FAIL** (grant revoked) | OK |
| Panel click "inject" on C after the grant loss | – | **FAIL** (`onclicked-optional-rerun.jsonl`, step 24) | – |
| `history.back()` C → A | – | FAIL | OK |

In the `onclicked` + optional run, `tabs.onUpdated` exposed `tab.url` exactly while the grant was alive (`urlVisible`
is null once it is revoked). That gives the worker a cheap "do I still have access?" signal.

### Gestures

| Call | Result |
|---|---|
| `sidePanel.open()` from the worker with no gesture | FAIL: "`sidePanel.open()` may only be called in response to a user gesture." |
| `sidePanel.open({tabId})` inside `action.onClicked` | OK |
| `sidePanel.open()` from a click inside the panel | OK (panel click = user activation) |
| `scripting.executeScript` from a click inside the panel, no `activeTab` grant | FAIL (`navigator.userActivation.isActive` was `true`): **a panel click is a gesture but not an `activeTab` grant** |
| `permissions.request({origins:["http://localhost/*"]})` from a panel click | the prompt appears (still pending after 3 s and 12 s), then resolved `true`; `permissions.getAll()` shows the new origin |
| `permissions.request` for an origin not in the manifest (`http://192.168.1.50/*`) | FAIL: "Only permissions specified in the manifest may be requested." |

Note: the permission prompt resolved `true` 8–18 s after it appeared, in 3 of 3 runs. The driver never clicks it. **The
user clicked "Allow" by hand** (user, 2026-10-05: "i clicked allow before"). So the "resolved `true`" evidence and the
`permissions.getAll()` grant check come from that manual click. The tester's re-run with nobody clicking left the
prompt pending, as expected. What is automated: the prompt appears from a panel click.

### Panel lifetime

With the global panel (`side_panel.default_path`), the panel loaded once and stayed loaded through every step:
same-origin and cross-origin navigation, reload, omnibox navigation, and opening, switching to and closing a second
tab. That's one `panel-LOADED` and no `panel-UNLOAD` across the 68 s scenario. In `behavior` mode a second toolbar
click **toggles the panel closed** (`panel-UNLOAD` 0.4 s after the click).

### API availability on 154

`chrome.sidePanel.close` and `chrome.sidePanel.getLayout` are both `function`.

### Manual check still open: `Alt+T` and the context menu

CDP can neither press browser-level shortcuts nor click context-menu items, so these two paths weren't automated.
`spikes/s5/manual-ext/README.md` is a 2-minute checklist with a logging extension. It covers `Alt+T` with
`openPanelOnActionClick` off and on, the context menu → `sidePanel.open` + inject, and a named command.

Expected result: `_execute_action` is documented as equivalent to clicking the action, and `Extensions.triggerAction`
followed the normal action path here (it fired `onClicked` and granted `activeTab` in `onclicked` mode). So `Alt+T`
should behave exactly like the toolbar rows above, in both modes. Context-menu clicks and named commands are documented
`activeTab` grants. **Unverified until someone runs the checklist.**

## Decision

1. **Do not use `setPanelBehavior({ openPanelOnActionClick: true })`.** It opens the panel without granting
   `activeTab` and without firing `action.onClicked`, so the extension can never read the page it opened on. Use
   `openPanelOnActionClick: false`. In `action.onClicked` (toolbar or `Alt+T`), call `sidePanel.open({ tabId })` and
   then inject. **This deviates from plan M0-E2 ("action click and `Alt+T` open the panel for the tab
   (`setPanelBehavior`)")** and answers the reviewer's question: the answer is no. The toggle is lost; see
   deviation (c).
2. **Allowlist = optional host permission, as the plan default says.** Allowlisting a site calls
   `permissions.request({ origins: [<origin>/*] })` from a click in the panel (a valid gesture). With the permission,
   the worker re-injects on every `tabs.onUpdated` `complete` with no gesture, including cross-origin navigation within
   allowlisted origins, back/forward and other tabs.
3. **Without the site permission:**
   - `activeTab` lasts longer than ROADMAP §8 item 6 assumed. It survives same-document navigation, same-origin link
     navigation, reload and same-origin omnibox navigation. It is lost on cross-origin navigation and never covers
     other tabs.
   - So the worker re-injects on `tabs.onUpdated` while the grant lives. It treats `tab.url` being hidden, or an
     inject failure, as "grant lost".
   - When the grant is lost, the panel shows "Translate this page". A panel button can't re-grant `activeTab`, so that
     state tells the user to press `Alt+T` or the toolbar icon. It also offers "Always translate on this site", which
     requests the optional host permission.
4. **"Auto-open" becomes "auto-translate when the panel is already open"**, as in the plan default (§8 item 6).
   `sidePanel.open()` without a gesture fails. The panel itself persists across navigations, so the
   auto-translate-when-open flow needs no open call.
5. **`minimum_chrome_version`: 138, as in the plan default.** Nothing in S5 needs a newer version. Per-tab
   `sidePanel.close` (141) is gated by `typeof chrome.sidePanel.close === 'function'`. Only 154 was tested; 138 itself
   was not.
6. **`optional_host_permissions`: add `http://*/*`** (supervisor question 2). Chrome refuses
   `permissions.request` for any origin not covered by the manifest (evidence above). Without `http://*/*` the extension
   could never be granted:
   - a LAN gateway, e.g. `http://192.168.1.50:11434` (ROADMAP §8 item 19);
   - an allowlisted plain-HTTP site under decision 2.

   Optional host permissions show no install-time warning. At runtime we only ever request the exact origin the user
   picked. Proposed manifest:
   `["https://*/*", "http://*/*"]` (`http://*/*` already covers `http://localhost/*` and `http://127.0.0.1/*`; keeping
   them listed is harmless). Store-listing justification: "Optional, requested per origin at runtime, only for a
   provider endpoint or a site the user explicitly allowlists for automatic translation."

## Deviation from plan default

**Deviation (a): how the action opens the panel (affects M0-E2 and M0-E3).**

- Plan text: M0-E2 says "action click and `Alt+T` open the panel for the tab (`setPanelBehavior`)". M0-E3 says "inject
  the content script with `chrome.scripting` under `activeTab`". The two can't both hold.
- Evidence (`results/behavior-optional.jsonl`): with `openPanelOnActionClick: true`, the toolbar action opened the panel
  but:
  - `executeScript` failed with "Cannot access contents of the page…";
  - `action.onClicked` never fired;
  - a panel-button inject also failed;
  - a second click closed the panel.

  With `openPanelOnActionClick: false` and `action.onClicked` → `sidePanel.open({tabId})` + inject
  (`results/onclicked-optional.jsonl`), the panel opened and injection worked.
- Proposed change: `setPanelBehavior({ openPanelOnActionClick: false })`. The action handler opens the panel and injects
  (Decision 1). Phase A code is not changed by this spike.

**Deviation (c): the toolbar and `Alt+T` no longer toggle the panel closed.**

- Plan text: ROADMAP M5 says "Keyboard: `Alt+T` toggle". Chrome's built-in `openPanelOnActionClick` behavior is a
  toggle.
- Evidence: in `behavior` mode a second click closed the panel (`panel-UNLOAD` 0.4 s later). In `onclicked` mode a
  second click (`onclicked-optional.jsonl`, step 13) kept it open, because `sidePanel.open()` on an open panel does
  nothing.
- Options for the user:
  1. **Accept open-only** in M0. `Alt+T` and the toolbar always open the panel and inject; the panel has its own close
     button.
  2. **Emulate the toggle** (recommended for M5). The worker tracks whether the panel is open in this window (the
     panel's Port is connected). If it is open, `action.onClicked` calls `chrome.sidePanel.close({ windowId })` instead
     (Chrome 141+, gated by `typeof chrome.sidePanel.close === 'function'`). On 138–140 there is no toggle and the click
     re-injects. `sidePanel.close` exists on 154 but **was not exercised** in this spike.

**Not a deviation: same-origin navigation on a site that isn't allowlisted is extract-only.** DESIGN §8: "Never
auto-translate by default".
- While the `activeTab` grant lives (same-origin navigation, reload), the worker re-injects and the panel shows the new
  page's **original** segments. Nothing is sent to a provider.
- The panel offers "Translate this page". That button works, because the panel can inject and read the page while the
  grant lives (S5: `panel-click-inject-OK`).
- After a cross-origin navigation the grant is gone. The panel shows the "lost access" state (Decision 3); a panel
  button can't help there.
- Only an allowlisted site auto-translates on navigation, and only while the panel is open.

**Not a deviation, but a new recommendation for the Phase A manifest:** add `http://*/*` to
`optional_host_permissions` (Decision 6). The plan deferred this question to S5.

The other S5-related plan defaults hold: optional host permission for allowlisted sites; "auto-open" → "auto-translate
when the panel is already open"; `minimum_chrome_version` 138.

## Consequences

- **M0-E2**, master code this changes (if the user accepts deviation (a)):
  - `src/shared/panel.ts:14`: `setPanelBehavior({ openPanelOnActionClick: true })` → `false`, plus an
    `action.onClicked` handler. `src/shared/panel.test.ts:11` asserts the old value.
  - `src/shared/panel.ts:33`: the context-menu handler follows the same rule, open first, then inject.
  - In both handlers `sidePanel.open({tabId})` is the first call, with no `await` before it. Denylist and settings reads
    go after it. The spike calls it first.
  - `wxt.config.ts:17`: `optional_host_permissions` gains `http://*/*`. `scripts/check-manifest.mjs:16` pins the exact
    list and must change with it.
- **M0-E3:**
  - Injection triggers: action click, `Alt+T` and the context menu (each a grant), plus `tabs.onUpdated` `complete`
    (re-inject while the grant or host permission holds). "Cannot inject here" covers `chrome://`, the Web Store, a lost
    grant and a denied permission.
  - Injection must be idempotent. `tabs.onUpdated` `complete` fires on hash and `pushState` changes (S5 steps 5–8), and
    repeated action clicks inject again. The content script guards with a global flag and answers "already injected".
  - Who injects: the worker inside `action.onClicked` and the context-menu handler (gesture time), and on
    `tabs.onUpdated`. The panel may also inject on "Translate this page", since the grant belongs to the extension
    (S1 consequence).
  - **Access state is per tab.** The global panel spans every tab in the window. On `tabs.onActivated`, a tab without a
    grant or host permission shows the "lost access" state (S5: the second tab had no grant).
- **M0-E4:** injection starts while the panel is still loading (in the spike, `panel-LOADED` arrived after
  `inject-OK`). The protocol needs a panel-ready handshake. The content script waits for, or answers, the panel's
  connect; it never pushes into a panel that may not exist yet.
- **Jobs under the global panel (affects S1's per-tab jobs).** "Auto-translate when the panel is already open"
  applies to every allowlisted tab in the window. Switching to an allowlisted tab would start a job there. Proposed
  rule: only the active tab's job schedules new chunks; a tab that loses focus finishes its in-flight chunks and stops.
  Switching back resumes, served from the cache. This keeps the per-window concurrency limit meaningful. Not tested.
- The panel needs a "lost access" state with the two actions above. A panel button never triggers injection on its own
  without a grant.
- DESIGN §8 and ROADMAP §8 item 6 should be updated with the more accurate `activeTab` lifetime (finding table) and the
  `openPanelOnActionClick` pitfall.
- Phase A manifest: add `http://*/*` to `optional_host_permissions`.

## Limits of this spike

- **Runtime grant.** "Host permission granted" was emulated with install-time `host_permissions`, so re-injection after a
  **runtime** grant is not directly verified. The runtime-grant run (with the user's manual "Allow") showed the same
  `permissions.getAll()` result, but its post-grant probe ran on a different origin.
- `Extensions.triggerAction` stands in for a real toolbar click. A real click, `Alt+T` and the context menu are in the
  manual checklist, which hasn't been run yet.
- Global panel only. Tab-specific panels (`sidePanel.setOptions({ tabId, path })`) were not tested. They aren't needed
  under the S1 decision (one panel document per window hosts the per-tab jobs).

## Proposed spec changes

Not applied; the user decides.

1. **DESIGN.md §7, line 716.**
   - Old: "site rules (auto-open / never translate)"
   - New: "site rules (auto-translate when the panel is open / never translate)"
2. **DESIGN.md §8, line 727.**
   - Old: "Never auto-translate by default. A per-site allowlist turns on auto-open."
   - New: "Never auto-translate by default. Allowlisting a site grants an optional host permission for it, so the
     extension can re-inject on navigation; on allowlisted sites the open panel translates each new page automatically.
     The panel cannot be opened without a user gesture (decision S5)."
3. **DESIGN.md §8, line 731.**
   - Old: "plus host permissions only for the configured provider endpoints (requested optionally at runtime)."
   - New: "plus optional host permissions, requested per origin at runtime, only for the configured provider endpoints
     and for sites the user allowlists. The manifest declares `https://*/*` and `http://*/*` as optional (ROADMAP §8
     item 19)."
4. **ROADMAP.md M5, line 285.**
   - Old: "Navigation within a site keeps translating when the site is allowlisted (optional host permission per S5);
     otherwise a one-click "Translate this page" in the panel."
   - New: "Navigation within a site keeps translating when the site is allowlisted (optional host permission per S5).
     Otherwise, after a same-origin navigation, the panel shows the original text with a one-click "Translate this
     page" (the `activeTab` grant survives same-origin navigation). After a cross-origin navigation, it asks for
     `Alt+T`/the toolbar or "Always translate on this site", because a panel click cannot grant `activeTab`."
5. **ROADMAP.md M5, line 292.**
   - Old: "Keyboard: `Alt+T` toggle"
   - New: "Keyboard: `Alt+T` opens the panel; toggles it closed on Chrome 141+ via `sidePanel.close` (decision S5,
     deviation (c))"
6. **ROADMAP.md M0-E2.**
   - Old: "action click and `Alt+T` open the panel for the tab (`setPanelBehavior`)"
   - New: "action click and `Alt+T` open the panel for the tab (`action.onClicked` → `sidePanel.open`, with
     `openPanelOnActionClick: false`; decision S5)"
7. **ROADMAP.md §8 item 6.** Append: "S5 result: the `activeTab` grant survives same-origin navigation and reload, and
   is lost on cross-origin navigation. With `openPanelOnActionClick: true`, a toolbar click does not grant `activeTab`."
   - Add "`Alt+T` behaves the same" only if manual checklist rows 5/6 confirm it. If they show `Alt+T` granting
     `activeTab` under `openPanelOnActionClick: true`, narrow the sentence to the toolbar click and revisit
     deviation (a).
