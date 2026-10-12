# Permission justifications

The text for the Chrome Web Store Privacy tab: one paragraph per permission and per optional host pattern. Each says
what the extension needs it for and the user action that triggers it. The manifest is built from `wxt.config.ts`
(`permissions`, `optional_host_permissions`, `commands`); `scripts/check-manifest.mjs` asserts the list on every
build, so a permission cannot be added without this file being revisited.

**The extension declares no `host_permissions` and no content scripts.** It has no access to any site until the
user grants it. The content script is injected into one tab, on a user action.

## Single purpose

Translate the page you are reading, in Chrome's side panel next to the original, with an AI provider you choose.

## Permissions

### `sidePanel`

Shows the translation in Chrome's side panel beside the page. The panel opens when the user presses the toolbar icon
or the keyboard shortcut (`Alt+T` by default, rebindable at `chrome://extensions/shortcuts`) and closes when they
press it again. Without it, the translation would have to replace or overlay the page, which the extension
deliberately does not do.

### `storage`

Saves the user's settings and what makes them quicker to use again: provider connections, model choices, routing and
site rules, preferences, glossary (`storage.sync`); the user's API keys, the first-run notice acknowledgement, usage
totals and the local diagnostics log (`storage.local`); and per-tab state that Chrome clears when the browser closes
(`storage.session`). Keys never go to sync storage. The translation cache uses the browser's own IndexedDB, which
needs no permission. What is stored, and how to delete it, is on the [privacy page](../privacy.md).

### `activeTab`

Lets the extension read the tab the user is looking at after, and only after, a user action: pressing the toolbar
icon or the shortcut, choosing "Translate in side panel" in the context menu, or pressing "Translate this page" in the
panel. Chrome grants access to that one tab for that gesture, so the extension needs no standing access to every page.

### `scripting`

Injects the extension's own content script (bundled in the package, not downloaded) into the tab the user chose, to
read the page's text and to mark the matching block when the user points at the translation. It runs only in a tab
where the user acted (through `activeTab`) or on a site the user allowlisted (through the optional host permission
below). It is never injected into browser pages or the Chrome Web Store.

### `contextMenus`

Adds one item, "Translate in side panel", to the right-click menu. On selected text it translates just that
selection, so a user can translate a passage without translating the whole page; on the page it opens the panel.
Choosing the item is the user action. The selected text is sent to the user's chosen provider, and nothing else is
added to the menu.

### Keyboard shortcut (`commands`)

`_execute_action` with the suggested key `Alt+T` toggles the panel, as the toolbar icon does. It needs no permission
entry. `Alt+T` stays the default on macOS too (there it is <kbd>Option</kbd>+<kbd>T</kbd>); the shortcut can be
rebound at `chrome://extensions/shortcuts`, and the setup guide and the README say how.

## Optional host permissions

These are declared as `optional_host_permissions`: Chrome does not grant any of them at install. The extension asks
for **one origin at a time**, with a Chrome prompt, in response to a click, and gives it back when the setting that
needed it is removed. There are two reasons to ask, and the patterns below are the only ones the extension can ask
for.

1. **A provider endpoint.** The extension calls the AI provider the user configured, from the browser, with the
   user's key. When the user presses Test connection on a connection in Settings › Providers, or "Grant access" in
   the panel, it asks for that connection's origin only. The user can pick any provider (a hosted API, a gateway of
   their own, a local model), so the origin cannot be known when the package is built.
2. **A site the user allowlists.** When the user adds a site in Settings › Site rules (or chooses "Always translate
   <site>" in the panel), it asks for that site so that the panel can translate its pages on each visit
   without a click. Removing the site gives the access back.

### `https://*/*`

Provider endpoints and allowlisted sites served over HTTPS. Required because providers and gateways are chosen by the
user: a hosted API, a corporate gateway, a regional endpoint. Requested only for the one origin in question, on a
click. Nothing is read from a site that is not allowlisted, and a page is not sent anywhere until a translation
starts.

### `http://localhost/*` and `http://127.0.0.1/*`

A model running on the user's own computer, such as Ollama (`http://localhost:11434`) or LM Studio
(`http://localhost:1234`), which serve plain HTTP on the loopback interface. Requested for that host only, when the
user adds and tests the local connection. The text never leaves the computer. These two patterns are the narrow
grants the Providers screen asks for in the local-model case.

### `http://*/*`

Two uses, both on a click and for one origin: a gateway on the user's local network that serves plain HTTP (for
example a model server at `http://192.168.1.20:8000`, or a `*.local` name), and a site the user allowlists that is
itself served over plain HTTP.

**How this is held to the store's HTTPS requirement for user data.** The code accepts a plain-HTTP *provider
endpoint* only when its host is this computer (`localhost`, `127.0.0.0/8`, `[::1]`) or the local network
(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `*.local`). Any other `http://` provider address is refused with a
message asking for HTTPS, when it is saved or tested and again when a stored or imported connection is used, so page
text is sent over plain HTTP only to the user's own machine or local network, never across the internet. A
local-network address shows "Unencrypted: only use this on a network you trust." For a plain-HTTP *site*, the
extension only reads the page, and its text goes to the provider over the provider's own (HTTPS or local)
connection.

## Remote code

No. All code is in the package. The extension loads no remote scripts, no remote modules and no remote fonts.

## Data

Page text and the user's glossary go only to the provider the user chose (see the [privacy policy](../privacy.md)).
There is no developer server, no telemetry and no account.

<!--
Reviewer-only: where each statement is implemented (paths relative to the repository root; checked against the
source, not a progress log).

- Declared permissions and optional hosts, shortcut: wxt.config.ts:18 (permissions), :21 (optional_host_permissions),
  :25-32 (commands, _execute_action, Alt+T). No host_permissions and no declared content scripts: the same file has
  neither key; scripts/check-manifest.mjs asserts the built manifest.
- sidePanel use: src/shared/panel.ts:25 (setPanelBehavior), :82 (action.onClicked opens and toggles),
  src/entrypoints/sidepanel/toggle.ts (close request).
- activeTab / scripting on a gesture: src/shared/inject.ts:25 (injectInto, files: the bundled content script),
  src/shared/panel.ts:82-102. Never injected into restricted pages: src/shared/denylist.ts:31 (classifyUrl).
- contextMenus: src/shared/panel.ts:89-97 (one item, contexts page and selection), :100+ (onClicked).
- storage: src/shared/settings.ts:182-198 (keys, storage.local), src/shared/providers.ts:48-62 (sync records),
  src/shared/access.ts:52 and src/shared/snippet.ts:50 (storage.session), src/shared/diagnostics.ts:133 and
  src/shared/spend.ts:255 (storage.local).
- Per-origin requests on a click, given back on removal: src/entrypoints/options/Providers.tsx:813 (Test connection),
  src/entrypoints/sidepanel/translator.ts:529 and :555 (Grant access), src/shared/sites.ts:167 (allowlist),
  :187 and src/shared/providers.ts:673 (permissions.remove), src/shared/settings.ts:206 (originPattern: one origin).
- Plain-HTTP rule: src/llm/endpoint.ts:31 (isPlainHttpRefused, with isLoopbackHost and isPrivateNetworkHost),
  src/llm/errors.ts:18 and :31 (checkBaseUrl, used by testConnection and by every request through preflight in
  src/llm/sdk.ts:54), src/shared/settings.ts:225 (resolveConnection, for stored, imported or synced connections),
  src/entrypoints/options/Providers.tsx (save and Test refuse it; the unencrypted note is shown for a private-network
  address). Tests: src/llm/endpoint.test.ts, src/shared/settings.test.ts, src/shared/connect.test.ts,
  src/entrypoints/options/Providers.test.tsx.
- A plain-HTTP site is only read: the page text is sent through the provider connection (src/llm/sdk.ts), never to
  the site's own host.
- Remote code "No": no fetch of scripts in src; MV3's default content security policy forbids remote code and the
  manifest sets none (wxt.config.ts).
-->
