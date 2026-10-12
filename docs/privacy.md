# Privacy policy

Translate Side is a Chrome extension that translates the page you are reading, in the side panel. This page says
what it reads, where that text goes, what it keeps on your device, and how to delete it.

**In short**

- The text of a page is read and sent to the AI provider **you** chose, over your own connection to that provider,
  when you start a translation, and on sites you have put on your allowlist, each time you open one of their pages
  while the panel is open.
- There is no Translate Side server. The extension has no analytics, no telemetry and no account. Nothing is sent to
  the developer.
- Your API keys stay on your device. They are sent only to the provider they belong to.
- Mail and sign-in pages, browser pages and the Chrome Web Store are never read. Password and other form fields are
  never read.
- A local model (Ollama or LM Studio, see [local-models.md](local-models.md)) keeps the text on your computer.

Effective for version 1.0.0. If a later version changes what is described here, this page changes with it, and the
panel asks you to read its notice again.

## What the extension reads

- **A page, when you ask.** Pressing <kbd>Alt</kbd>+<kbd>T</kbd> (or the shortcut you set), clicking the toolbar
  icon, choosing "Translate in side panel" in the context menu, or pressing "Translate this page" in the panel reads
  the visible text of that tab. Chrome gives the extension access to that one tab only for that action.
- **Sites you allow.** If you add a site to the allowlist (Settings › Site rules), Chrome asks you to grant access to
  that site. From then on, while the panel is open, each page you open on that site is translated automatically, so
  its text goes to your provider without a click. Remove the site from the list to stop; the access is given back to
  Chrome. Sites on your never-translate list are not read.
- **A selection.** "Translate in side panel" on selected text sends that text, up to 20,000 characters.
- **Never read:** webmail and sign-in sites on a built-in list (for example Gmail, Outlook, Yahoo Mail, Proton Mail
  iCloud, and the Google and Microsoft sign-in pages), the sites on your never-translate list, browser pages
  (`chrome://` and similar), the Chrome Web Store, and any page while a password field has keyboard focus. Text
  fields, password fields and other form controls are skipped when a page is read, so what you type into a page is
  never part of what is read.

Reading a page happens inside your browser. Nothing leaves your device until a translation starts, and a translation
starts only from your action or on a site you allowlisted.

## What is sent, and to whom

Text goes to the **provider you chose** in Settings › Providers (for example Anthropic, OpenAI, Google Gemini,
OpenRouter, Ollama, LM Studio, or an endpoint of your own). The browser connects to it directly, with the key you
saved. The panel names the provider in its first-run notice and in the job bar.

A translation sends:

- the text of the page's blocks (headings, paragraphs, list items, quotes, table cells and code), a few of the
  blocks just before the ones being translated, and the target language and style;
- for the "About this document" brief: the page title, its headings and the opening of its text;
- your glossary entries that apply (the term, how you want it rendered, your note);
- the model name, and your API key as the credential, to that provider only.

It does **not** send the page's address, cookies, your other tabs, your history, your other settings, or the keys of
other providers. The provider sees what any API call shows: your key, your network address and the extension's
`chrome-extension://` origin.

Your routing decides which provider gets a page: the model you picked, a rule for that site, or a fallback you
listed if the first one is busy or down. A rule marked local-only never falls back to a cloud provider. The
provider's own terms and privacy policy govern what it does with the text. Use a local model for sensitive pages.

**Plain HTTP.** Provider addresses must use HTTPS, with one exception: `http://` is accepted only for this computer
(`localhost`, `127.0.0.0/8`, `[::1]`) and for your local network (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
and `*.local` names), and the Providers screen then says "Unencrypted: only use this on a network you trust." Any
other `http://` address is refused, so page text never crosses the internet unencrypted.

## What is stored on your device

| Where | What | Leaves the device? |
|---|---|---|
| Extension local storage (`storage.local`) | Your API keys, one per connection. The first-run notice acknowledgement and the setup guide's state. The diagnostics log. The usage and cost totals (token counts and estimated cost by month, day and model profile). Settings too large to sync. | No. Keys are never synced. |
| Extension sync storage (`storage.sync`) | Connections (name, address, protocol), models, routing and site rules, preferences (languages, style, per-page token budget), your glossary, and your allowlist and never-translate lists. No keys and no page text. | Only through Chrome Sync, if you have it turned on: it goes to your Google account, with your other Chrome devices. |
| Browser database (IndexedDB `translate-side-cache`) | Translations already made (the translated text, found again by a hash of the source text and settings), and the short document briefs, each found by the page address it was made for. At most 50 MB of translations and 200 briefs, oldest unused first. | No. |
| Per-session storage (`storage.session`) | Per tab: whether the page could be read, the selected text and its page address for a context-menu translation, and a per-tab provider choice. | No. Chrome clears it when the browser closes. |
| The panel's own `localStorage` | One on/off setting (whether the panel follows the page's scroll). | No. |

Keys are saved as Chrome stores any extension data: in your browser profile on disk, not encrypted by the extension.
Anyone who can read your computer account can read them. Settings › Export and import settings writes the settings to a file you
choose; API keys are left out unless you tick "include keys" and confirm.

## Diagnostics

The extension keeps a log of its recent translation runs on your device (the last 50). Each entry holds versions,
the strategy, the preset and model name, counts of blocks and requests, token counts, timings, the outcome and, for a
failure, the error kind and HTTP status with a fixed message of ours. It never holds page text, page addresses,
provider addresses, keys, or the provider's own error message. The site's name (for example `example.com`) is added
only if you turn on "Include site names" in Settings › Diagnostics. The log stays on your device; the only way it
leaves is that you save it as a file in Settings › Diagnostics and send that file yourself, for example with a bug
report. Nothing is sent automatically. "Clear log" there deletes it.

## No tracking, no sale, no other use

- There is no Translate Side server, and the developer receives nothing: no usage data, no crash reports, no page
  text, no keys. The extension makes network requests only to the provider addresses you configured. It loads no
  remote code, fonts or scripts.
- Page text is used only to produce your translation. The extension does not sell it, does not use it for advertising
  or credit decisions, and does not pass it to anyone but the provider you chose. Use of information received from Google APIs
  adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Deleting your data

- **Provider keys and a connection:** Settings › Providers › Remove (it removes the key, the connection's models
  and the access Chrome granted for its address).
- **Translations and briefs:** Settings › Translation cache › Clear cache.
- **Diagnostics log:** Settings › Diagnostics › Clear log.
- **Usage and cost totals:** Settings › Usage and cost › Reset total.
- **Site access:** remove a site from Settings › Site rules; Chrome also lists granted sites at
  `chrome://extensions` › Translate Side › Details › Site access.
- **Everything on this device:** uninstall the extension in `chrome://extensions`. Chrome then deletes its local
  storage, cache and session data. Settings in sync storage are kept by Chrome Sync for your other devices: remove
  your connections, glossary and site lists in Settings first if you want them gone there too, or manage Chrome's
  synced data in your Google account.

## Contact

Questions and reports: <https://github.com/duylongpro99/translate-side/issues>. The source code, which this page
describes, is in the same repository.

<!--
Reviewer-only: where each claim is implemented (checked against the source, not against a progress log). Paths are
relative to the repository root.

Read only on an action, or on an allowlisted site
- Toolbar, Alt+T, context menu inject on a gesture: src/shared/panel.ts:82 (action.onClicked), :89-102 (context menu),
  src/shared/inject.ts:25 (injectInto, trigger gesture or navigation), wxt.config.ts:18 (activeTab, scripting).
- Automatic read only for an allowlisted site with its permission held, while the panel is open:
  src/shared/sites.ts:119 (autoTranslates), src/entrypoints/sidepanel/main.tsx:23 (autoInject).
- Site access is requested on a click and given back on removal: src/shared/sites.ts:167 (requestSitePermission),
  :187 (permissions.remove); src/shared/sites.ts:65 (the two origins per site).
- Selection: 20,000 characters, never stored for a denylisted site: src/shared/snippet.ts:12, :6-8.

Never read
- Built-in denylist and browser pages: src/shared/denylist.ts:12 (hosts), :31 (classifyUrl: non-http(s), Web Store).
- Password field in focus skips the page: src/extract/index.ts:81.
- Form controls skipped when copying the page: src/extract/compose.ts:32-37 (SKIP set).
- Never-translate list: src/shared/sites.ts:22 (SITE_NEVER_KEY), src/shared/access.ts reason 'never'.

What is sent
- Brief: title, headings, opening of the text: src/engine/prompts/analyze.ts:58 (analyzeInput). The page address is
  not in any prompt; it is only part of the brief's cache key: src/engine/stages/analyze.ts:46.
- Direct connection to the configured base URL, no other host: src/llm/sdk.ts:54 (preflight), src/llm/openai.ts,
  src/llm/anthropic.ts; the e2e harness fails the run if the panel or worker requests any host but the mock
  provider: e2e/fixtures.ts (context.route).
- Fallbacks and local-only: src/shared/providers.ts:814 (isLocalConnection), :842 (a local-only route skips cloud).
- Plain HTTP rule: src/llm/endpoint.ts:31 (isPlainHttpRefused), src/llm/errors.ts:18 (HTTPS_REQUIRED, used by
  checkBaseUrl), src/shared/settings.ts:225 (resolveConnection refuses it for a stored connection).

Stored on the device
- Keys in storage.local, never synced: src/shared/settings.ts:182-198 (secret:<id>).
- Acknowledgement, onboarding: src/entrypoints/sidepanel/privacy.ts:10, src/shared/onboarding.ts:9 (storage.local).
- Usage and cost totals: src/shared/spend.ts:15-52 (storage.local, token counts and cost only), :142 (reset).
- Sync items: src/shared/providers.ts:48-62 (connections, profiles, routing, site rules, allowlist),
  src/shared/settings.ts:280 (prefs), :332 (glossary), src/shared/sites.ts:22 (never list).
- A list too large for sync stays in storage.local: src/shared/sync-quota.ts:24.
- Cache: src/shared/cache.ts:12-15 (database, 50 MB, 200 briefs), :17-21 (a cached segment holds the translation),
  :100-107 (a brief row keyed by the brief key, which contains the page address).
- storage.session: src/shared/access.ts:52, src/shared/snippet.ts:12-54, src/shared/providers.ts:692-705 (tab route).
- localStorage: src/entrypoints/sidepanel/follow.ts:16.
- Export leaves keys out by default: src/shared/portable.ts:1-10.

Diagnostics
- Contents and limits: src/shared/diagnostics.ts:1-12 (what is kept and never kept), :19 (50 entries), :20
  (site names off by default), :205 (clear). The UI: src/entrypoints/options/Diagnostics.tsx.

Deletion
- Cache and usage controls: src/entrypoints/options/Options.tsx:552 (cache), :610 (usage and cost).
- Removing a connection removes its key and access: src/shared/providers.ts:673 (permissions.remove).
- Uninstall clears extension storage, and sync storage follows Chrome Sync: Chrome platform behaviour, not code.
- Not stored by the extension, so nothing to delete: telemetry (there is none), page text (only translations are
  cached).
-->
