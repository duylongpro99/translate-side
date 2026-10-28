# Permission justifications

The text for the Chrome Web Store Privacy tab: one paragraph per permission and per optional host pattern. Each says
what the extension needs it for and the user action that triggers it. The manifest is built from `wxt.config.ts`
(`permissions`, `optional_host_permissions`, `commands`); `scripts/check-manifest.mjs` asserts the list on every
build, so a permission cannot be added without this file being revisited.

**The extension declares no `host_permissions` and no content scripts.** It has no access to any site until the
user grants it. The content script is injected into one tab, on a user action, or on a site the user allowlisted while the panel is open.
A second, smaller script, which only draws the selection button, is registered on every site only when the user turns
on that option and grants access to all sites (reason 3 below).

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
below). It is never injected into browser pages or the Chrome Web Store. With the opt-in selection button on every site
(reason 3 below), it also registers a small script that draws only that button.

### `contextMenus`

Adds one item, "Translate in side panel", to the right-click menu. On selected text it translates just that
selection, so a user can translate a passage without translating the whole page; on the page it opens the panel.
Choosing the item is the user action. The selected text is sent to the user's chosen provider, and nothing else is
added to the menu.

### `tts`

Reads a block of the page aloud, its translation or its original, when the user presses "Read aloud" on it in the
panel, with a voice of the user's computer (Chrome's text-to-speech). It is the zero-setup voice: nothing is
downloaded and no key is needed. Chrome's network voices are used only if the user picks one in Settings › Voice.
Chrome shows no install warning for this permission.

### Keyboard shortcut (`commands`)

`_execute_action` with the suggested key `Alt+T` toggles the panel, as the toolbar icon does. It needs no permission
entry. `Alt+T` stays the default on macOS too (there it is <kbd>Option</kbd>+<kbd>T</kbd>); the shortcut can be
rebound at `chrome://extensions/shortcuts`, and the setup guide and the README say how.

## Optional host permissions

These are declared as `optional_host_permissions`: Chrome does not grant any of them at install. The extension asks
for **one provider origin or one site at a time**, with a Chrome prompt, in response to a click, and gives the access
back when the setting that needed it is removed, unless another setting still uses the same host. The one exception is
reason 3, an option that is off by default and asks for both broad patterns. There are three reasons to ask, and the
patterns below are the only ones the extension can ask for.

A voice provider the user adds in Settings › Voice (reason 1's twin: a text-to-speech endpoint such as
`generativelanguage.googleapis.com`, `*.tts.speech.microsoft.com` or `api.elevenlabs.io`) is asked for the same way,
for that provider's origin only, in the Save click.

1. **A provider endpoint.** The extension calls the AI provider the user configured, from the browser, with the
   user's key. When the user presses Test connection on a connection in Settings › Providers, or "Grant access" in
   the panel, it asks for that connection's origin only. The user can pick any provider (a hosted API, a gateway of
   their own, a local model), so the origin cannot be known when the package is built.
2. **A site the user allowlists.** When the user adds a site in Settings › Site rules (or chooses "Always translate
   <site>" in the panel), it asks for that site so that the panel can translate its pages on each visit
   without a click. Chrome is asked for both the `https://` and `http://` addresses of that site, and for its
   subdomains when the entry is `*.example.com`. Removing the site gives the access back, unless a provider connection
   still uses that host.
3. **The selection button on every site (opt-in, off by default).** When the user turns on "Show the translate button
   when I select text on any site" in Settings › Site rules, the extension asks for `https://*/*` and `http://*/*` and
   registers a small script that only draws a button next to text the user selects, on every page except mail and
   sign-in sites and the user's never-translate sites. The script reads the selection only to decide whether to show
   the button; nothing is sent until the user clicks it, and then only the selected text goes to the user's provider
   (the page itself is only offered in the panel, and sent only if the user then asks for it).
   The access does not make the panel read more pages than without it. Turning the option off unregisters the script;
   the access stays granted until the user removes it in `chrome://extensions`, because removing the broad patterns
   could not be shown to leave the narrower grants of reasons 1 and 2 in place.

### `https://*/*`

Provider endpoints and allowlisted sites served over HTTPS. Required because providers and gateways are chosen by the
user: a hosted API, a corporate gateway, a regional endpoint. Requested only for the one origin or site in question, on a
click, except for the opt-in selection button on every site (reason 3), which asks for the whole pattern on the click
that turns it on. Nothing is read from a site that is not allowlisted, beyond the selection that decides whether that
button shows, and a page is not sent anywhere until a translation starts.

### `http://localhost/*` and `http://127.0.0.1/*`

A model running on the user's own computer, such as Ollama (`http://localhost:11434`) or LM Studio
(`http://localhost:1234`), which serve plain HTTP on the loopback interface. Requested for that host only, when the
user adds and tests the local connection. The text never leaves the computer. These two patterns are the narrow
grants the Providers screen asks for in the local-model case.

### `http://*/*`

Two uses, both on a click and for one origin or site: a gateway on the user's local network that serves plain HTTP (for
example a model server at `http://192.168.1.20:8000`, or a `*.local` name), and a site the user allowlists that is
itself served over plain HTTP. The opt-in selection button on every site (reason 3) asks for the whole pattern, so the
button also shows on plain-HTTP pages.

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
Chrome's on-device translation models (its Translator and Prompt APIs) are downloaded and run by Chrome itself, after
the user's click, as Chrome components; they are not code of the extension and need no permission.

## Data

Page text and the user's glossary go only to the provider the user chose (see the [privacy policy](../privacy.md)).
A block read aloud goes to the voice provider the user added, if any; the default voice is the computer's own.
With no provider set up, Chrome's on-device APIs translate the page and no page text leaves the device.
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
- Selection button on every site: src/shared/selection-button.ts (BROAD_ORIGINS requested on the click,
  reconcileSelectionScript registers only while the option is on and the access held, excludedMatches, no revoke on
  turn-off), src/entrypoints/selection.content.ts (draws only the button), src/entrypoints/options/Options.tsx
  (SelectionEverywhere); decision record: docs/decisions/S9-selection-button-gesture.md.
- storage: src/shared/settings.ts:205-223 (keys, storage.local), src/shared/providers.ts:49-63 (sync records),
  src/shared/access.ts:52 and src/shared/snippet.ts:50 (storage.session), src/shared/diagnostics.ts:133 and
  src/shared/spend.ts:255 (storage.local).
- Per-origin requests on a click, given back on removal: src/entrypoints/options/Providers.tsx:892 (Test connection),
  src/entrypoints/sidepanel/translator.ts:573 and :609 (Grant access), src/shared/sites.ts:167 (allowlist),
  :187 and src/shared/providers.ts:706 (permissions.remove), src/shared/settings.ts:231 (originPattern: one origin).
- Plain-HTTP rule: src/llm/endpoint.ts:31 (isPlainHttpRefused, with isLoopbackHost and isPrivateNetworkHost),
  src/llm/errors.ts:18 and :31 (checkBaseUrl, used by testConnection and by every request through preflight in
  src/llm/sdk.ts:54), src/shared/settings.ts:245 (resolveConnection, for stored, imported or synced connections),
  src/entrypoints/options/Providers.tsx (save and Test refuse it; the unencrypted note is shown for a private-network
  address). Tests: src/llm/endpoint.test.ts, src/shared/settings.test.ts, src/shared/connect.test.ts,
  src/entrypoints/options/Providers.test.tsx.
- A plain-HTTP site is only read: the page text is sent through the provider connection (src/llm/sdk.ts), never to
  the site's own host.
- Remote code "No": no fetch of scripts in src; MV3's default content security policy forbids remote code and the
  manifest sets none (wxt.config.ts).
-->
