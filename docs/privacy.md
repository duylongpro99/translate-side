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
- With no provider set up, Chrome translates the page on your computer (its own Translator, or Gemini Nano). No text
  is sent anywhere, so the panel shows no notice for it.
- Reading a block aloud uses your computer's own voice by default, and sends nothing. A voice provider you add yourself
  (Settings › Voice) receives the text of each block it reads.

Effective for version 1.3.0. If a later version changes what is described here, this page changes with it, and the
panel asks you to read its notice again.

## What the extension reads

- **A page, when you ask.** Pressing <kbd>Alt</kbd>+<kbd>T</kbd> (or the shortcut you set), clicking the toolbar
  icon, choosing "Translate in side panel" in the context menu, or pressing "Translate this page" in the panel reads
  the visible text of that tab. Chrome gives the extension access to that one tab only for that action.
- **Sites you allow.** If you add a site to the allowlist (Settings › Site rules), Chrome asks you to grant access to
  that site (both its `https://` and `http://` addresses; an entry such as `*.example.com` covers the subdomains). From then on, while the panel is open, each page you open on that site is translated automatically, so
  its text goes to your provider without a click. Remove the site from the list to stop; the access is given back to
  Chrome, unless a provider connection still uses that host. Sites on your never-translate list are not read.
- **A selection.** "Translate in side panel" on selected text, or a click on the extension's button that shows at the
  end of a selection, sends that text, up to 20,000 characters. The button shows on a page where the panel is open. It
  never shows in text fields, password fields or other editable areas. The button's translation shows in a small popup
  next to the text (only on http and https pages; on a local file the click opens the side panel). The popup is a page
  of the extension, so the website can't read it. Closing the popup ends its translation and drops the text; a tab
  keeps at most one popup's text in the extension's memory, which is dropped when the tab closes or the browser
  quits. The first-run privacy notice and the spend limit's "Continue anyway" are only in the side panel, which a
  website can't cover with something else.
- **The selection button on every site (off unless you turn it on).** Settings › Site rules › "Show the translate
  button when I select text on any site" asks Chrome for access to all sites, so the button can show on any page,
  even with the panel closed. On each page, a small script then checks your selection only to decide whether to show
  the button. It reads nothing else on the page, and nothing leaves the page until you click the button; then only
  the selected text is translated, as above, in the popup. Nothing else on the page is read. If you choose "Open in
  side panel" in the popup, the panel reads the page so it can offer it, but the page is sent only if you then press
  "Translate this page" (or the site is on your allowlist). The setting applies to this
  device only, like Chrome's access. Mail and sign-in sites and your never-translate sites get no button (a
  page already open when you add its site to the never-translate list keeps it until it reloads, but its click then
  sends nothing).
  This access does not make the panel read more: after you follow a link, a page is read again only on the same site
  you started on, or on a site you allowlisted, as without it. Turning the option off removes the button, but Chrome
  keeps the access until you remove it at `chrome://extensions` › Translate Side › Details › Site access.
- **Never read:** webmail and sign-in sites on a built-in list (for example Gmail, Outlook, Yahoo Mail, Proton Mail,
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

- the text of the page's blocks (headings, paragraphs, list items, quotes, table cells, code and figure and table
  captions), and the descriptions of images (alt text) if you turn on "Translate image descriptions (alt text)" in Settings; a
  few of the blocks just before the ones being translated; and the target language and style;
- for the "About this document" brief: the page title, its headings and the opening of its text;
- your glossary entries that apply (the term, how you want it rendered, your note);
- your corrections that are similar to a passage being translated, as examples (the original text and your
  version, at most three per chunk), under the rules in "Your corrections" below;
- the model name, and your API key as the credential, to that provider only.

It does **not** send the page's address, cookies, your other tabs, your history, your other settings, or the keys of
other providers. The provider sees what any API call shows: your key, your network address and the extension's
`chrome-extension://` origin.

Your routing decides which provider gets a page: the model you picked, a rule for that site, or a fallback you
listed if the first one is busy or down. Chrome's own on-device translator ("Chrome basic translation") is the last
fallback by default; it runs on your computer, and you can remove it in Settings › Providers › Routing. A rule
marked local-only never falls back to a cloud provider.

**On this device, with no provider.** If no provider can run (you have not added a key), the page is translated by
Chrome on your computer: Chrome's Translator, or Gemini Nano for the languages it writes (Settings › Providers ›
Routing › On-device engine). Nothing is sent to any server. The first time a language pair is used, Chrome needs one
click on "Turn on" to download it; the download comes from Google, like any Chrome component, and carries no page
text. The first-run notice is asked only before text would leave your device: it is checked on the route each
translation actually takes, so adding a key later brings the notice before anything is sent. The
provider's own terms and privacy policy govern what it does with the text. Use a local model for sensitive pages.

**Reading aloud.** "Read aloud" on a block reads its translation or its original with the voice chosen in
Settings › Voice, only when you press it (and, with "keep reading" on, the blocks after it).

- **The system voice** (the default) is Chrome's speech on your computer and sends nothing. Chrome's own network voices
  (named "Google …", marked "online" in the list) send the text to Google; they are used only if you pick one.
- **A voice provider of your own** (Gemini, an OpenAI-compatible server, Azure Speech, ElevenLabs, Google Cloud
  Text-to-Speech, Vbee or FPT.AI) receives the text of each block it reads, with the voice and language, and your key
  for that provider. Gemini also receives a short note on how to read it (tone, stress), and an OpenAI model that
  takes instructions receives it as `instructions`. The browser connects to the provider directly; Chrome asks you
  for access to that provider's address when you save it. Settings › Voice says which provider receives the text.
  On a site on your never-translate list, and on a site whose rule is local-only, a provider's voice is not used:
  the system voice reads instead.
- **Preparing the text for a provider's voice.** Once a page is being translated, before a provider's voice reads a
  block, the extension asks the
  translation model of the page (the same route as the translation, so a local-only site stays on your computer) to
  write the block out as it should be spoken and to add that note. This sends the block and the blocks just before
  and after it. It is skipped, and the block is read as it is, while the first-run notice is unanswered, past your
  spend limit, or when only Chrome's Translator is set up. What it costs counts in Settings › Usage and cost as "Voice prep".
- A voice provider's key can be your translation key for the same service (Gemini, or OpenAI at its own address):
  the voice settings then only point to it; the key is not copied, and it is sent only to that same service.
- Voice requests are not priced, so they do not count toward your spend limit; the provider bills them to your key.

**Plain HTTP.** Provider addresses must use HTTPS, with one exception: `http://` is accepted only for this computer
(`localhost`, `127.0.0.0/8`, `[::1]`) and for your local network (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
and `*.local` names), and the Providers screen then says "Unencrypted: only use this on a network you trust." Any
other `http://` address is refused, so page text never crosses the internet unencrypted.

## What is stored on your device

| Where | What | Leaves the device? |
|---|---|---|
| Extension local storage (`storage.local`) | Your API keys, one per connection, and one per voice provider. The first-run notice acknowledgement and the setup guide's state. The diagnostics log. The usage and cost totals (token counts and estimated cost by month, day and model profile). The "Use corrections from other sites" setting. Whether the selection button shows on every site (per device, like the access it needs, and not in the settings export file). Settings too large to sync. | No. Keys are never synced. |
| Extension sync storage (`storage.sync`) | Connections (name, address, protocol), models, routing and site rules, preferences (languages, style, per-page token budget), the quality mode, the reading settings (theme, typeface, text size, line width), the voice settings (which voice, the voice for each language, keep reading, and the voice providers' addresses, regions and models), your glossary, and your allowlist and never-translate lists. No keys and no page text. | Only through Chrome Sync, if you have it turned on: it goes to your Google account, with your other Chrome devices. |
| Browser database (IndexedDB `translate-side-memory`) | Your corrections: the original text of the block, your version, the languages, when you made it, and the site (its address up to the host) you made it on. Whether it was made on a site that is local-only is also kept. At most 5,000 entries. | No, never synced. Only through the export file you save yourself (see "Your corrections"). |
| Browser database (IndexedDB `translate-side-cache`) | Translations already made (the translated text, found again by a hash of the source text and settings), and the short document briefs, each found by the page address it was made for. At most 50 MB of translations and 200 briefs, oldest unused first. | No. |
| Per-session storage (`storage.session`) | Per tab: whether the page could be read, the selected text and its page address for a context-menu translation, and a per-tab provider choice. | No. Chrome clears it when the browser closes. |
| The extension pages' own `localStorage` | Whether the panel follows the page's scroll, and a copy of the reading settings on each extension page (panel, settings, setup guide), read before the page draws so it opens in your theme. | No. |

Keys are saved as Chrome stores any extension data: in your browser profile on disk, not encrypted by the extension.
Anyone who can read your computer account can read them. Settings › Export and import settings writes the settings to a file you
choose; API keys are left out unless you tick "include keys" and confirm. Voice providers' keys are never in the file.

## Your corrections

When you correct a block with the panel's Edit button, the original text and your version are kept in a database on
this device (`translate-side-memory`), apart from the translation cache. They are shown again whenever that same text
is translated, and are never sent for that. The database is never synced, is not touched by "Clear cache", and is
deleted by "Clear translation memory" in Settings › Translation memory.

Corrections also work as examples. When you translate a similar passage, a few of them are sent to the provider that
translates that page, along with the passage (see "What is sent"). Three rules decide which:

- A correction made on a page under a local-only site rule is sent only when the page being translated is under one
  too, so it stays on local models. It is never sent to a cloud provider.
- By default only corrections you made on the same site are sent. Corrections from your other sites, and imported
  ones, are sent only if you turn on "Use corrections from other sites" in Settings › Translation memory. That setting
  applies on every route, local models included.
- Nothing is sent for a selection you translate on its own, or in Fast mode.

The file made by "Export translation memory" is a separate, explicit file you save and keep; the extension never
sends it anywhere. It holds the original text and your version of every correction and whether each was made on a
local-only site, but not the site's address. It is not part of the settings export file. An imported file is checked
before it is stored, and only guides later translations unless you tick "Also replace matching blocks". The
diagnostics log records how many corrections a run used and an identifier of each (a hash), never their text.

## Diagnostics

The extension keeps a log of its recent translation runs on your device (the last 50). Each entry holds versions,
the strategy, the preset and model name, counts of blocks and requests, token counts, timings, how many corrections were used as examples and a hash of each (never their text), the outcome and, for a
failure, the error kind and HTTP status with a fixed message of ours. It never holds page text, page addresses,
provider addresses, keys, or the provider's own error message. The site's name (for example `example.com`) is added
only if you turn on "Include site names" in Settings › Diagnostics. The log stays on your device; the only way it
leaves is that you save it as a file in Settings › Diagnostics and send that file yourself, for example with a bug
report. Nothing is sent automatically. "Clear log" there deletes it. If the panel itself crashes, the log also gets
an entry with the name of the part that failed and the kind of error (for example `TypeError`), never its message or
stack.

## No tracking, no sale, no other use

- There is no Translate Side server, and the developer receives nothing: no usage data, no crash reports, no page
  text, no keys. The extension makes network requests only to the provider addresses you configured. It loads no
  remote code, fonts or scripts.
- Page text is used only to produce your translation. The extension does not sell it, does not use it for advertising
  or credit decisions, and does not pass it to anyone but the provider you chose. Use of information received from Google APIs
  adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Deleting your data

- **Provider keys and a connection:** Settings › Providers › Remove (it removes the key, the connection's models
  and the access Chrome granted for its address, unless a site you allowlisted still uses that address).
- **Translations and briefs:** Settings › Translation cache › Clear cache.
- **Corrections:** Settings › Translation memory › Clear translation memory (export them first to keep a copy).
- **Diagnostics log:** Settings › Diagnostics › Clear log.
- **Usage and cost totals:** Settings › Usage and cost › Reset total.
- **Site access:** remove a site from Settings › Site rules; Chrome also lists granted sites at
  `chrome://extensions` › Translate Side › Details › Site access, where the access to all sites that the selection
  button on every site asked for is removed too.
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
- Selection: 20,000 characters, never stored for a denylisted site: src/shared/snippet.ts:12, :4-6.
- Selection button: shown only for a settled selection outside fields and editable regions, sends only on a trusted
  click: src/extract/selection-button.ts (eligibleSelection, the click handler); the worker checks the sender's
  address against the denylist and the never-translate list: src/shared/panel.ts (listenForSelectionButton,
  selectionRecord). The popup hears only its own frame, and the worker hears Open in side panel only from the popup page
  in the selection's tab: src/extract/selection-button.ts (createSelectionPopup), src/shared/panel.ts (popupToPanel). The click asks for the selection only: the page is offered, not translated (the `selection`
  trigger): src/shared/inject.ts (InjectTrigger), src/entrypoints/sidepanel/controller.ts (refresh).
- Selection button on every site: off by default, access requested on the click, script registered only while the
  option is on and the access held, excluding denylisted and never-translate hosts, access kept on turn-off, the
  option kept in `storage.local`: src/shared/selection-button.ts; the script draws only the button: src/entrypoints/selection.content.ts. A navigation
  follows only the granted origin or an allowlisted site: src/shared/inject.ts (mayFollow).

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
- localStorage: src/entrypoints/sidepanel/follow.ts:16 (scroll follow), src/ui/theme.ts (READING_MIRROR, the copy of the
  reading settings) and public/theme-boot.js (reads it before the first paint).
- Reading settings in storage.sync: src/shared/reading.ts (READING_KEY).
- Export leaves keys out by default: src/shared/portable.ts:1-10.

Reading aloud
- The system voice: chrome.tts on the device, a network ("remote") voice used only when picked by name:
  src/tts/system.ts (rankVoices, pickVoice). Permission `tts`: wxt.config.ts.
- A voice provider receives only the text it reads, the voice, the language and the key; the note only for providers
  that take one: src/tts/cloud/cloud-engine.ts (notePart), src/tts/cloud/*.ts (one request each), src/tts/presets.ts
  (`instructions`, the origin asked for). The permission is asked in the Save click, for that origin:
  src/entrypoints/options/Voice.tsx (AddProvider onSubmit).
- Keys: storage.local `ttsSecret:tts-<provider>` (apart from translation keys), or a reference to a translation
  connection of the same service (`keyFrom`), only at the provider's own address: src/tts/settings.ts
  (cleanTtsConnection, sameService, readTtsKey).
- No cloud voice on a never-translate or local-only page (the system voice reads): src/entrypoints/sidepanel/App.tsx
  (cloudAllowed), src/entrypoints/sidepanel/jobs.ts (localOnly), src/entrypoints/sidepanel/read-aloud.ts (effective). Settings export carries no
  voice key, and an import that moves a voice provider drops its saved key: src/shared/portable.ts (buildExport,
  importVoice, resolveImport).
- Text preparation: only for a page with a translation job, on its translate route, skipped without the privacy acknowledgement, past the spend limit or
  with only Chrome's Translator; the block and its neighbours; spend as `voice-prep`:
  src/entrypoints/sidepanel/jobs.ts (speechClient), src/entrypoints/sidepanel/read-aloud.ts (voicePrepVia),
  src/tts/prepare.ts, src/engine/prompts/tts-prepare.ts, src/shared/spend.ts (VOICE_PREP_SPEND_ID).
- Read only on a press: src/entrypoints/sidepanel/SegmentList.tsx (ReadButtons), src/tts/controller.ts.

Corrections and examples
- The memory database, its fields and its export file (no origin; the local-only mark kept): src/shared/memory.ts
  (MEMORY_DB, MemoryEntry, exportFile). It is not part of the settings export: src/shared/portable.ts.
- Which entries may be sent: src/shared/memory.ts (examplesFor: local-only entries only to a local-only route;
  other sites' and imported entries only with the across-sites setting, on every route), used in
  src/entrypoints/sidepanel/jobs.ts (examples built from the route's local-only state). The setting is in
  storage.local: src/shared/memory.ts (MEMORY_ACROSS_SITES_KEY).
- A selection uses no memory: src/entrypoints/sidepanel/translator.ts (the snippet jobs).

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
