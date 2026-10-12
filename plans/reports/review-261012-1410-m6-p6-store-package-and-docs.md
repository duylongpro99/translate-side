# Review: store package and docs (M6-E1, M6-E8)

Range reviewed: `9f127f9..a871d4e` on branch `m6` (worktree `../translate-side-m6`), read-only.
Reviewer: m6-p6-review, 2026-10-12.

## Verdict

**There are no blocking findings.** The done criteria in §2, the two §5 rows and the contract reading of §3 #1 are met.
The zip, the listing text, five 1280×800 screenshots, the 440×280 tile, the privacy policy and a justification for
every permission and optional host pattern are all in the repo. The plain-HTTP rule matches the Validation Session 1
decision and is enforced at Test, save, every request and `resolveConnection`. I found 12 non-blocking accuracy and
polish items. Items 1–4 are worth fixing before the user pastes the text into the dashboard, because they are
claims a store reviewer or user could check against the product.

## What was verified, and how

- **Zip.** A clean `git clone` of `m6` at `a871d4e` into a scratch directory, then
  `pnpm install --frozen-lockfile && pnpm run zip`, gave `translate-side-1.0.0-chrome.zip`: 313 081 bytes, SHA-256
  `b95890f4…100ef8`. Both match `docs/store/submission.md:11-12`, so the "reproducible" claim holds. The 27 entries
  match the contents table. There are no `.map` files, no dotfiles and no `.env`. The manifest has version `1.0.0`,
  the five permissions, no `host_permissions`, no `content_scripts` and exactly the four optional hosts. The only
  difference from phase 5 is the version.
- **Remote code "No".** There is no `eval(` or `new Function(` in any built JS file, and no script is loaded from a
  remote URL. The only hard-coded hosts are provider presets and "get a key" links.
- **Assets.** `sips` reports exactly 1280×800 for all five screenshots, 440×280 for the tile and 128×128 for the icon.
  There are no home paths, user names or text chunks in the PNGs, and the screenshots contain no real key or account.
- **`pnpm check`.** The first run in the clone showed 1820/1820 tests passing. Its one failed suite was a temporary
  probe file of mine that the run collected by accident. The clean re-run result is in the "Checks run" section at
  the end.
- **Hygiene.** No changed file contains a home path, the macOS user name or a work email. All seven commit subjects
  are conventional and have no plan IDs, phase numbers or AI references. The new test names and code comments have
  no finding codes either.

### Plain-HTTP rule (`src/llm/endpoint.ts`, `src/llm/errors.ts:31`, `src/shared/settings.ts:225`)

I ran the real `endpoint.ts` with Node on the parsed WHATWG hostname, which is the host `fetch` will actually contact:

| Input | Hostname | Result |
|---|---|---|
| `http://10.0.0.1@evil.com/v1` | `evil.com` | refused ✔ |
| `http://10.0.0.1#@evil.com/`, `http://10.0.0.1\evil.com/` | `10.0.0.1` | allowed, with the note ✔ (fetch goes to 10.0.0.1) |
| `http://localhost:11434\@evil.com/` | `localhost` | allowed ✔ (fetch goes to localhost) |
| `http://127.1`, `0x7f.0.0.1`, `2130706433`, `0177.0.0.1` | `127.0.0.1` | allowed, loopback ✔ |
| `http://10.0.0.1./v1` | `10.0.0.1` | allowed ✔ |
| `172.15.255.255` / `172.32.0.1` (unit test) | – | refused ✔. `172.16.0.1` and `172.31.255.255` are allowed ✔ |
| `http://EVIL.LOCAL/v1` | `evil.local` | allowed, with the note ✔ |
| `evil.local.com`, `a..local`, `local`, `172.16.0.1.nip.io` | – | refused ✔ |
| `[::1]` | `[::1]` | allowed ✔ |
| `[::ffff:127.0.0.1]`, `[::ffff:192.168.1.2]`, `0.0.0.0`, `localhost.` | – | refused (the strict side, acceptable) |

Where it is enforced:
- `testConnection` checks it through `checkBaseUrl` before any request (connect.ts:255).
- The Providers Test click returns before the permission prompt (Providers.tsx:807), so no grant is asked for a
  public `http://` origin.
- Save refuses it (Providers.tsx:833).
- Every stream and probe checks it through `preflight` (sdk.ts:55, 212).
- `resolveConnection` throws for a stored, imported or synced connection (settings.ts:225). The panel's `clientFor`
  catches that and shows the message, so import or sync cannot bypass the rule.
- Onboarding reuses `ConnectionForm`, so it gets the same checks.

## Findings

All findings are **non-blocking**.

1. **The privacy policy under-claims what is sent: captions and image alt text.** In `docs/privacy.md:48-49` the list
   of sent text is "headings, paragraphs, list items, quotes, table cells and code". The segmenter also sends figure
   and table captions, which are on by default (`src/segment/segmenter.ts:103-105`, `captions: true` at
   `settings.ts:287`). It also sends image alt text when "Translate image descriptions (alt text)" is turned on
   (`segmenter.ts:111-120`). Failure scenario: a user or a store reviewer turns on alt text and sees text sent that the
   policy does not list. Violates: phase §2 "what is read"; the review brief's "flag any under-claim". Fix: add
   "captions, and image descriptions (alt text) if you turn that on".

2. **"One origin at a time" is not exact for allowlisted sites.**
   - Affected text: `docs/store/permission-justifications.md:61` and `:69-71`, `docs/store/listing.md:40`, and README
     line 76.
   - What the code does: allowlisting a site requests both `https://<pattern>/*` and `http://<pattern>/*`
     (`src/shared/sites.ts:65`). A user can also enter `*.example.com`, which grants every subdomain
     (`sitePattern`, sites.ts:37-50).
   - Failure scenario: the reviewer adds a site, sees Chrome ask for http and https access to it (or to all its
     subdomains), and the text said one origin.
   - Violates: §5 "requested only on user action per origin"; the brief's "flag any over-claim".
   - Fix: say "one site at a time (both http and https; a `*.` entry covers its subdomains)" for sites, and keep "one
     origin" for providers.

3. **`docs/local-models.md:19-20` tells users to "lower the model's concurrency in Providers", but no such control
   exists.** `maxConcurrency` is set only from the preset (`src/entrypoints/options/form.ts:203`). There is no
   concurrency field in Providers or the locales, and the local presets are already at 1. Failure scenario: a user
   looks for the setting and cannot find it. Violates: phase goal "Nothing claims behavior the code doesn't have".
   Fix: drop that clause.

4. **The privacy policy does not mention two things the code does.**
   (a) The default routing adds Chrome's built-in on-device translator ("Chrome basic translation") as the last
   fallback (`providers.ts:305`, `:259`). `docs/privacy.md:58-59` says "a fallback you listed", but this one is there
   by default. It is privacy-neutral because it runs on the device, so one sentence is enough: "Chrome basic
   translation, on this device, is the last fallback by default; remove it in Providers › Routing."
   (b) The diagnostics log also records panel crashes, with the component and the error class
   (`diagnostics.ts:183-186`). `privacy.md:83` describes only translation runs.
   Violates: the review brief's "diagnostics contents" and "where it goes".

5. **`permission-justifications.md:8-9` says "The content script is injected into one tab, on a user action."** On an
   allowlisted site it is also injected on navigation with no click (`src/entrypoints/sidepanel/main.tsx:23-27`). The
   `scripting` paragraph (line 42) says so, but the summary line contradicts it. Fix: add "…or on a site the user
   allowlisted."

6. **The unencrypted note shows only inside the connection form** (`Providers.tsx:950-952`). The saved connection's
   row in the list does not show it. The decision says "shows a standing note". I read "standing" as "always shown
   while that address is in use", and the form satisfies the letter of that. A badge on the list row would match it
   better. This is a judgement call for the supervisor; I did not count it as a violation.

7. **The Vietnamese `options.connect.httpsOnly` is ambiguous** (`src/locales/vi.yml`): "http:// thường chỉ được dùng…"
   can read as "http:// is *usually* only allowed…". Suggest "http:// (không mã hóa) chỉ được dùng cho…".

8. **Screenshots, polish only.**
   (a) In 03 and 04 the settings page fills only the left ~650 px, and the right half of the 1280×800 frame is empty.
   Narrowing the viewport, or composing beside the panel as 05 does, would read better in the store carousel.
   (b) In 02 the page block is highlighted, but nothing in the panel shows which block is being pointed at, so the
   caption "Point at a block…" is only half shown.
   (c) The job bar shows "0.1 s" next to a connection labelled "Local model". That speed is the mock's, and the label
   invites a reading that a local model is that fast. Consider a neutral label such as "My provider", or not featuring
   the timing.

9. **Icon padding.** `public/icon/128.png` fills almost the whole 128 px canvas. The Chrome Web Store image
   guidelines ask for about 96×96 artwork with ~16 px transparent padding. It is not a rejection cause, but it is
   worth a pass before going public.

10. **Typo** in `docs/privacy.md:31`: "Proton Mail iCloud" is missing a comma.

11. **README numbers that predate this phase.** README lines 62 ("under 2 seconds") and 173-183 (23 passages, 1.17×,
    0 lost, 100%) restate figures from eval and provider files. They were already there before `9f127f9`, so this
    phase did not add them, but the phase's risk note says to link instead of restating. Optional.

12. **Minor wording.** `privacy.md:27-28` and `:102-103` say the access "is given back" on removal. That is true
    unless a provider connection or another entry shares the host (`sites.ts:177-188`, `providers.ts:653-674`). Adding
    "unless a connection still uses it" would be exact.

## Claims checked as true (spot list)

- **Auto-translate on allowlisted sites only while the panel is open.** The panel's `autoInject` checks
  `autoTranslates`, which needs the allow mode and a held permission. The worker's navigation re-inject only reads
  locally, and the translator starts a job only when the user asked or the site is allowlisted
  (`translator.ts:371-383`). The privacy policy, the notice sentence (`panel.privacy.auto`, with a test) and the
  listing all say this.
- **Never read.** The denylist hosts (denylist.ts:12-27), the Web Store and non-http(s) schemes (:31-45), a focused
  password field (extract/index.ts:81) and the form-control SKIP set (compose.ts:32-37) all match the policy.
- **The page address is never in a prompt.** It is only part of the brief cache key (stages/analyze.ts:48).
  `analyzeInput` sends the title, outline and excerpt.
- **Storage.** Keys use `secret:<id>` in storage.local. The sync items, the cache (`translate-side-cache`, 50 MB,
  200 briefs), the storage.session records and the one localStorage toggle (follow.ts) all match the table. The
  diagnostics log keeps 50 entries, has site names off by default and has a "Clear log" button.
- **Labels the docs quote.** "Clear cache", "Reset total", "Clear log", "Include site names", "Ollama (local)",
  "LM Studio (local)", "Grant access", "Local only", "Enable CORS", "Nothing answers…" and "…refused requests from
  the extension" all exist in `en.yml` or `presets.ts`. `OLLAMA_ORIGINS="chrome-extension://*"` matches
  connect.ts:405, and the base URLs `:11434/v1` and `:1234/v1` and the model `qwen3:8b` match presets.ts.
- **No Haiku cost claim.** README:185-187 and the provider matrix rows 26 and 29 say "not run".
- **README.** Alt+T rebinding is at lines 132-134 and in the shortcut table, the install placeholder is there, and
  every relative link points at a file that exists.

## Implementer deviations

1. **The screenshot generator is an e2e spec run by `scripts/store-screenshots.mjs`. Accepted.** It reuses the
   harness as step 7 asks, it is skipped unless `STORE_SCREENSHOTS` is set, and it uses no real key.
2. **Additive harness edits** (`answerWith`, which `reset()` clears; `options()`). **Accepted.** They are opt-in,
   existing specs are unaffected, and the tests stay green.
3. **Page and panel composed side by side from two real screenshots. Accepted.** Every pixel is the real UI, and
   submission.md:56-57 discloses it. See finding 8 for polish.
4. **The rule lives in `checkBaseUrl` plus `resolveConnection`. Accepted, and better than the plan.** It covers Test,
   save, every request and stored, imported or synced connections from one predicate.
5. **Privacy notice version not bumped. Accepted.** `master` is at version 1 and `m6` at 2, so every existing
   unpacked user sees the notice again, with the new sentence, when M6 lands. Nothing has been published under
   version 2.

## Open items for the user, with my view

- **"Authentication information" tick: keep it.** The API key is a credential that is transmitted off the device, to
  the provider, on every request. Under-disclosing a data type is a common rejection cause, and over-disclosing costs
  nothing.
- **URLs use the public GitHub repo path.** They are correct. The privacy URL resolves only after `m6` is merged and
  pushed to `master`, and submission.md's checklist says so.
- **Reviewer test key placeholder.** Correctly left for the user and never committed.
- **"Synced settings stay in Chrome Sync after uninstall".** This is accurate platform behaviour, and the policy
  marks it as such in its reviewer-only comment.
- **The Vietnamese UI shows English language names** (the LANGUAGES list, visible in screenshot 05). Cosmetic, and
  not a store issue. It could be a carry-over.
- **Local-model memory sizes.** They are labelled as general guidance and fine as written.

## Checks run

- A clean clone, `pnpm install --frozen-lockfile`, `pnpm run zip`: the hash and size match submission.md.
- The `endpoint.ts` edge-case probe with Node: see the table above.
- `pnpm check` in the clone: tests 1820/1820 on the first run. The clean re-run result is appended below.

## Unresolved questions

- Should "standing note" (finding 6) also mean a badge on the saved connection's row? That is for the supervisor or
  the user to decide.

## Clean re-run of `pnpm check` (appended)

`pnpm check` in the clean clone at `a871d4e` passed (exit 0). Lint, typecheck and `check:engine` passed. Tests: 100
files and 1820 tests passed. The build succeeded. `check:bundle` reported 276 962 B gzip, within the 307 482 B budget.
`check:manifest` reported OK.

## Re-review: fix commits a871d4e..f62a742 (2026-10-12 15:10)

**Verdict: clear. There are no blocking findings.** All 12 earlier findings are resolved. The two items the user
requested (localized language names, and the listing's instruction for the host section) are correct. Two new
non-blocking findings are below.

### Verified

- **Zip.** A clean checkout of `f62a742`, then `pnpm install --frozen-lockfile && pnpm run zip`, gives 313 295 bytes
  and SHA-256 `a79ad1e1…f6ad9ee1e`. Both match `docs/store/submission.md`.
- **`pnpm check`.** It passes (exit 0). Tests: 101 files and 1825 tests passed. The bundle is 277 159 B gzip, within
  the 307 482 B budget, and the manifest check reports OK.
- **Assets.** The five screenshots are exactly 1280×800, the tile is 440×280 and `store-icon-128.png` is 128×128,
  with 96 px artwork inside a 16 px transparent margin.

### How each earlier finding was resolved

1. **Captions and alt text.** `privacy.md` now lists captions, and alt text when that option is on. True.
2. **Origins and sites.** The justifications, the listing, the README and the privacy policy now say both schemes are
   requested and that a `*.` entry covers subdomains, and that access is kept while another setting still uses the
   host. True (`sites.ts:65`, `:177-188`, `providers.ts:653-674`).
3. **Concurrency.** The clause about lowering concurrency is removed from `docs/local-models.md`.
4. **Fallback and crashes.** The privacy policy now mentions the default on-device "Chrome basic translation"
   fallback, and the crash entries that record the component and error class but never the message or stack. Both
   true (`providers.ts:305`, `diagnostics.ts:183-186`).
5. **Justification summary.** It now says "…or on a site the user allowlisted while the panel is open." True.
6. **Standing note.** The saved connection's row now shows the unencrypted note (`Providers.tsx:218-222`). A test
   covers a private-network address (note shown), loopback (no note) and https (no note).
7. **Vietnamese wording.** The `httpsOnly` text now reads "Địa chỉ http:// (không mã hóa) chỉ được dùng…".
   Unambiguous.
8. **Screenshots.**
   - Settings are now composed beside the panel in 03 and 04.
   - 02 now shows the link on both sides. The two halves are shot in turn for the same block, and submission.md
     discloses this.
   - The connection is labelled "My provider" and the model "translate-1", with about 2 s from a delay the mock adds.
     submission.md discloses the delay.
9. **Icon.** A separate store icon with padding was added. The package icon is unchanged.
10. **Typo.** The missing comma is fixed.
11. **README numbers.** The README now links to `eval/gate.json` and `eval/runs/` (both exist), and the "under
    2 seconds" claim is gone.
12. **Wording on removal.** It is now qualified everywhere, in the privacy policy, the justifications and the
    listing.

**User-requested items.**
- **Localized language names.** `languageName` is used only for text shown on screen: the panel header, the job bar,
  "About this document", the options page and onboarding. The engine's `languageLabel`, the language codes and
  `LANGUAGES` are untouched. The test renders the real `renderSystemPromptV2` and asserts "English>Vietnamese".
  Screenshot 05 shows "Tiếng Việt".
- **Listing host-section instruction.** It now names the three host sections exactly, in both `listing.md` and
  `submission.md`, and they match the three headings in the justifications.

### New findings (both non-blocking)

N1. **Language names can appear in a language the interface doesn't have.**
- In `src/shared/language-name.ts:9-15`, `uiLocale()` uses `browser.i18n.getUILanguage()`, which is Chrome's own UI
  language.
- The extension ships only `en` and `vi` messages. In a French, German or other Chrome, the interface falls back to
  English, but `languageName` returns names from `Intl.DisplayNames` in that language. Checked with Node:
  `new Intl.DisplayNames(['fr'], {type:'language'}).of('vi')` gives `vietnamien`.
- Failure scenario: in a French Chrome, the English panel and settings show "vietnamien", "anglais" and so on, mixed
  into English text.
- Fix: use the localized name only when the UI locale's base language is one the extension ships (today only `vi`),
  for example by checking it against a short list beside `languageName`, or by reading
  `i18n.getMessage('@@ui_locale')` with the same check. Otherwise return the English name.
- Violates the user's request ("language names follow the interface language"): here they follow Chrome's language
  instead.

N2. **Small drift.**
- The reviewer-only comments in `docs/local-models.md:97` and `docs/store/permission-justifications.md:128` cite
  `Providers.tsx:813` for the Test permission request. After the row-note edit it is at `:818`.
- In screenshots 01–04 the panel starts at the subtitle, while 05 also shows the translated title at the top. This is
  cosmetic and was already there before these commits.
