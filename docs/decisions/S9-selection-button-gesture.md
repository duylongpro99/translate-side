# S9 — Selection button: page-click gesture and broad-permission revoke

Status: **measured 2026-10-25 (Q1, Q3); Q2 not measurable by script, safe branch chosen** · Chrome 155.0.8059.85
(macOS) · Spike code: `spikes/s9/` · Plan: `plans/261025-0548-popover-toolbar-and-selection-button/`

## Question

The selection button (a button the content script draws next to a page selection) needs three Chrome behaviors that
S5 never measured:

- **Q1. Gesture.** The content script handles a trusted `click` on its button and calls `runtime.sendMessage`. Can the
  worker's `onMessage` handler then call `sidePanel.open({ tabId })` while the panel is closed?
- **Q2. Revoke.** With `https://*/*` and `http://*/*` granted next to a provider origin and an allowlisted site, does
  `permissions.remove({ origins: ['https://*/*', 'http://*/*'] })` remove the narrower grants too?
- **Q3. S5 side effects.** With a host grant, is `tab.url` visible after every navigation, so that
  `listenForTabLifecycle` re-injects `content.js` into every page of a tab it once injected into?

## Method

- `spikes/s9/ext/` is an MV3 extension with `sidePanel`, `storage`, `activeTab`, `scripting`, `optional_host_permissions`
  for both broad patterns, and a global side panel. `cs.js` draws two page buttons: "open now" messages the worker on
  click, and "open after 1.5 s" messages it 1.5 s after the click. The worker calls `sidePanel.open({ tabId })` as the
  first call in `onMessage`, with no await before it, and logs the result. It also probes `executeScript` and
  `tab.url` on every `tabs.onUpdated` `complete`.
- `spikes/s9/drive.mjs` runs an isolated **headful** Chrome stable over CDP, as in S5. Clicks are real
  `Input.dispatchMouseEvent` events (trusted, with user activation). The control click is
  `element.click()` evaluated in the page (untrusted, no activation), run first after a load, before any real input.
- Variants: `activetab` (toolbar click via `Extensions.triggerAction` grants `activeTab` and injects the button),
  `granted` (`http://127.0.0.1/*` as an install-time host permission, the button drawn by a script registered with
  `scripting.registerContentScripts`, the way tier B registers it), `broad` (optional grants through
  `chrome://extensions`), and `manual` (`perm.html`, for a person to answer the permission prompts).
- Re-run: `cd spikes/s9 && node server.mjs 8909 results/x.jsonl & node drive.mjs granted 8909`.

## Evidence

Logs: `spikes/s9/results/{activetab,granted,broad-developerprivate}.jsonl`.

### Q1: a click on the page button opens the closed panel

| Run | Click | `isTrusted` | page activation | `sidePanel.open` |
|---|---|---|---|---|
| `granted` (registered script, host permission) | synthetic `element.click()`, no prior input | false | false | **FAIL**: "`sidePanel.open()` may only be called in response to a user gesture." |
| `granted` | real click, "open now" | true | true | **OK**, the panel target appears |
| `granted` | real click, message sent 1.5 s later | true | true | **OK** |
| `activetab` (button injected by a toolbar click) | real click, "open now" | true | true | **OK** |
| `activetab` | real click, message sent 1.5 s later | true | true | **OK** |

The `activetab` control row is not usable: `Extensions.triggerAction` had just given the page user activation, so the
untrusted click still opened the panel (`pageActivation: true`). The `granted` control isolates the effect: the
gesture that counts is the page's user activation, which Chrome carries with the content script's message.

### Q2: not measured by script

`permissions.request` shows a prompt that only a person can answer, and no Chrome switch accepts it. The other route,
`chrome.developerPrivate.addHostPermission` from `chrome://extensions`, resolves without error but grants nothing for
**optional** host permissions: `permissions.getAll().origins` stayed `[]` after granting the provider origin, the
allowlisted site and both broad patterns (`broad-developerprivate.jsonl`, steps 3, 5 and 22). Every probe in that run
failed for lack of access, so it measures neither Q2 nor Q3.

`node drive.mjs manual <port>` opens `perm.html`, where a person grants the narrow origins, then the broad patterns,
then removes the broad patterns, and the page logs `permissions.getAll()` after each step.

### Q3: a host grant re-injects on every navigation

In the `granted` run, `tabs.onUpdated` `complete` showed `tab.url` and `executeScript` succeeded on the first load and
on the reload, with no gesture (`granted.jsonl`, 2.3 s and 5.3 s). That is the S5 "host permission" column again: with a
host grant the URL is always visible and injection always works. Under the broad patterns every http(s) page has a host
grant, so `listenForTabLifecycle` would re-inject `content.js` into every page a tab visits once it holds an access
record. Under `activeTab` alone the record turns `lost` on a cross-origin navigation (S5).

## Decision

1. **Q1 passes: the button opens the panel.** The worker calls `sidePanel.open({ tabId: sender.tab.id })` first in its
   `onMessage` handler, with no await before it, as the context-menu handler does, then hands the selection over. Only
   `isTrusted` clicks send the message (the synthetic click has no gesture anyway, but the check keeps page scripts from
   triggering a handover). The "Press Alt+T to open the panel" fallback tip is not needed.
2. **Q2 is unknown, so turning tier B off does not revoke.** It unregisters the selection script and clears the setting.
   The broad patterns stay granted, and the option's hint says how to remove them in `chrome://extensions`. This branch
   can never cost a provider or allowlisted site its grant (plan acceptance criterion 6). If a manual run shows that
   `permissions.remove` of the broad patterns keeps the narrower grants, revoking on turn-off can be added later.
3. **Q3: the navigation path must not follow the broad grant.** Phase 4 keeps S5's behavior: on a navigation, the full
   content script is re-injected only into a page of the same origin as the one the gesture granted, or into a site
   with its own grant (the allowlist). Anything else is recorded as `lost`, as under `activeTab` alone.

## Consequences

Shipped as decided (2026-10-25): `src/shared/panel.ts` (`listenForSelectionButton`: open first, then inject and hand
over), `src/shared/selection-button.ts` (the option, registration and reconcile, no revoke on turn-off),
`src/shared/inject.ts` (`mayFollow`: the navigation follows only the granted origin or an allowlisted site; the access
record keeps the origin). The manual Q2 run is still open; its result can turn decision 2 into a revoke on turn-off.

- No manifest change: both broad patterns are already optional (decision S5, deviation (a)).
- The selection button can open a closed panel on any page where the script runs: tier A (the full content script) and
  tier B (the registered selection script) share one click path.
