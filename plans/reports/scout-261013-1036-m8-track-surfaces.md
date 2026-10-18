# Scout: M8 "Beyond v1" track surfaces

Scope: read-only scouting for the seven M8 tracks in `docs/plans/M8-beyond-v1.md` §2, plus settings versioning and feature gating. Line numbers were checked against the working tree on 2026-10-13. `node_modules` was not searched (blocked by a local hook), so WXT and Playwright behavior is marked unverified where it matters.

## Relevant Files

- `docs/plans/M8-beyond-v1.md` - the seven tracks and their guarantees (§2.1–2.7).
- `DESIGN.md:816` - the "The model has no tools" claim that `agentic` must rescope.
- `DESIGN.md:25` - PDFs listed as a v1 non-goal.
- `ROADMAP.md:452` - §8 item 14 (`define_term` constraints); `ROADMAP.md:462` item 19 (store review of optional host permissions); `ROADMAP.md:365` M8 summary.
- `docs/plans/M7-stronger-translation.md:41, 92` - `agentic` is named as a M7 follow-on; the `review` stage and revision UI are shared with it. No `docs/progress/progress-m7.md` exists, so M7 looks unfinished.
- `src/llm/types.ts:17, 79-100, 121-125, 208-213` - `Protocol` union, `NormalizedRequest`, `NormalizedEvent`, `ProtocolAdapter`.
- `src/llm/client.ts:14-17, 57, 62-68` - adapter loaders, `CHROME_NANO` flag, `createAdapter`.
- `src/llm/openai.ts:87-106`, `src/llm/anthropic.ts:60` - `toOpenAIParams`, `toAnthropicParams`.
- `src/engine/types.ts:48, 228-254, 297-320` - `StrategyId`, `StageContext`, `Strategy`, `ContextQuery`, `ContextProvider`.
- `src/engine/engine.ts:76-80, 105, 309-310` - strategy lookup, translate-flag gate, context wiring.
- `src/entrypoints/sidepanel/jobs.ts:1316, 1324` - `review` role throws; the strategy list.
- `src/engine/context/budget.ts:13, 19, 33-35` - context budget, `DEFAULT_CONTEXT_PROVIDERS`, `gatherContext`.
- `src/engine/context/glossary.ts:30-40, 226-241` - `mergeGlossary` (personal first) and `glossaryProvider`.
- `src/engine/context/assemble.ts:16-28, 51, 64` - system prompt vars, context block rendering, tag neutralizing.
- `src/shared/providers.ts:49, 55-60, 110-128, 362-372, 727` - schema version, `migratedRoute`, `SITE_ALLOWLIST_KEY`, `SiteRule`, migrations, `siteRuleFor`.
- `src/shared/sites.ts:22, 77-81` - `SITE_NEVER_KEY`, `readSiteLists`.
- `src/shared/settings.ts:72-95, 182-198, 221-240, 292-305` - Gemini connection and profile, secret key read/write, `resolveConnection`, preferences read.
- `src/shared/portable.ts:55, 159-199, 415-419` - export version, `buildExport` with `includeKeys`, key import parsing.
- `src/shared/migrate.ts:18, 62-91` - `migrateSync` and the migration lock.
- `src/entrypoints/sidepanel/route.ts:63` - the one hot-path call of `resolveConnection`, which reads the key before each request.
- `src/shared/access.ts:48-57`, `src/shared/snippet.ts:45-54`, `src/shared/providers.ts:692-705` - existing `storage.session` users.
- `src/shared/presets.ts:80-91` - the Gemini preset (OpenAI-compatible endpoint).
- `src/llm/presets.ts:5-6` - `GEMINI_OPENAI_BASE_URL`.
- `src/shared/settings.ts:84` - `GEMINI_ORIGIN` host pattern.
- `scripts/eval/judge.ts:47` - judge client also uses the Gemini OpenAI endpoint.
- `scripts/eval/README.md:10` and `docs/provider-matrix.md` - the provider matrix is an eval-harness procedure, not a script.
- `wxt.config.ts:17-21` - `minimum_chrome_version`, `permissions`, `optional_host_permissions`.
- `src/entrypoints/background.ts:8-12` - background setup (MV3 comments).
- `src/shared/panel.ts:25-29, 40, 68, 82` - `sidePanel.setPanelBehavior`, `sidePanel.open`, `action.onClicked`.
- `src/entrypoints/sidepanel/toggle.ts:19` - `sidePanel.close`, guarded by `typeof`.
- `src/llm/chrome-builtin.ts:25` and `src/llm/chrome-translator.ts:49` - `LanguageModel` and `Translator` globals, both guarded.
- `scripts/check-manifest.mjs:5, 14-22` - built-manifest assertions, hard-coded to `.output/chrome-mv3` and `background.service_worker`.
- `scripts/check-bundle.mjs:9` and `scripts/bundle-budget.json` - bundle budget.
- `e2e/playwright.config.ts` (`CHROMIUM_ARGS`) and `e2e/fixtures.ts:138-168, 189, 196` - Chromium-only harness.
- `.github/workflows/ci.yml:5, 17-25, 27-52` - CI triggers, check job, Chromium-only e2e job.
- `src/segment/segmenter.ts:32, 42, 61, 68-76, 227-233, 304-333` - code and opt-out handling in the segmenter.
- `src/segment/code-block.ts:6` - `CODE_BLOCK` selector.
- `src/engine/check/checks.ts:228-233, 327-336` - `checkCode` and `checkSegment`.
- `src/extract/index.ts:77-86` - `extractPage`, the DOM extraction entry point.
- `src/entrypoints/content.ts:23-25, 43` - content script registration (`matches: []`, runtime) and the `extractPage` call.
- `src/shared/inject.ts:33-53` - `injectInto` and `attempt`, which run `executeScript` on frame 0.
- `src/shared/denylist.ts:7, 31-47` - the readable schemes (`http:`, `https:`, `file:`) and `classifyUrl`.
- `src/shared/language.ts:34-35` - `MIXED_LANGUAGE_DETECTION` flag.
- `docs/decisions/S1-engine-host.md`, `S5-activetab-navigation.md` - decisions the Firefox and PDF tracks depend on.

## Patterns

### 1. agentic strategy
- A strategy is `{ id, version, run(job, ctx): AsyncIterable<EngineEvent> }` (`src/engine/types.ts:249-254`). `defineStrategy` in `src/engine/runner.ts` builds one from stages. The shell registers strategies in one array at `src/entrypoints/sidepanel/jobs.ts:1324`, and `engine.ts:76-80` looks them up by `job.strategy` and throws on an unknown id. A new `agentic` entry plugs in here.
- `StrategyId` already admits any string (`types.ts:48`, `(string & {})`). The literal `'refine'` appears in the union, but no `refine` strategy file exists.
- `StageContext` (`types.ts:228-247`) gives `llm(role)`, `memory`, `context`, `prompts`, `budget`, `signal`, and `mt`. Roles are `translate | analyze | review` (`types.ts:15`). `jobs.ts:1316` throws for `review` ("no model profile is routed for the review role yet"), so the M7 `review` path is not wired.
- Tool use does not exist in the LLM layer. `NormalizedRequest` (`src/llm/types.ts:79-100`) has no `tools` field, and `messages[].content` is a plain `string` (`types.ts:84`). `NormalizedEvent` (`types.ts:121-125`) has only `text`, `usage`, `done`, and `error`, so there is no tool-call event. `toOpenAIParams` (`src/llm/openai.ts:87-106`) and `toAnthropicParams` (`src/llm/anthropic.ts:60`) build request bodies without tools. `src/llm/types.ts:3` says the contract changes must be additive and optional.
- The "no tools" claim is `DESIGN.md:816`. The `agentic` row in the DESIGN strategy table is `DESIGN.md:593`.
- Memory tools have partial backing. `lookup_glossary` can read `memory.glossary` and `memory.brief` (`src/engine/memory.ts`, `glossary.ts:226-241`). `get_surrounding_text` can use `segmentsBefore` and `runningTextBefore` (`glossary.ts:169-180`). No translation-memory store exists in `src/`; M7-E4/E5 plans it.
- `define_term` has no existing code. Any web call goes through `fetch` from the worker or panel, and it needs a host permission. The current `optional_host_permissions` (`wxt.config.ts:21`) is per origin and set at runtime, so a fixed dictionary origin would need its own grant.

### 2. Firefox build
- `wxt.config.ts` has no `browser`/`targets` setting. It produces Chrome MV3 only. The manifest fields that are Chrome-shaped are `minimum_chrome_version: '138'` (`:17`), `permissions` including `sidePanel` (`:18`), and `_execute_action` (`:24-29`, Alt+T).
- Chrome-only calls are all guarded by `typeof` checks, which helps:
  - `sidePanel.setPanelBehavior` (`src/shared/panel.ts:25-29`) is guarded.
  - `sidePanel.open` (`panel.ts:40, 68`) is called without a guard, but through `api.sidePanel?.open`.
  - `sidePanel.close` (`src/entrypoints/sidepanel/toggle.ts:19`) is guarded.
  - `action.onClicked` (`panel.ts:82`) and `contextMenus` (`panel.ts:90-102`) are plain calls.
- Built-in AI: `LanguageModel` (`src/llm/chrome-builtin.ts:25`) is behind `CHROME_NANO = false` (`src/llm/client.ts:57`). `Translator` (`src/llm/chrome-translator.ts:49`) returns `undefined` when absent, and the UI shows the "missing" message (`chrome-translator.ts:41`). So a Firefox build degrades to "no basic translation" without code changes.
- Worker assumptions: `src/entrypoints/background.ts:8-12` says "MV3 workers restart often". The M8 plan's S1 re-check (Firefox event pages) applies here. The S1 decision (`docs/decisions/S1-engine-host.md`) puts the engine in the side panel, which reduces exposure.
- Build checks assume Chrome: `scripts/check-manifest.mjs:5` defaults to `.output/chrome-mv3/manifest.json`, and `:22` asserts `side_panel.default_path`. Line 21 asserts `background.service_worker`. `scripts/check-bundle.mjs:9` hard-codes `BUILD = '.output/chrome-mv3'`.
- E2E is Chromium-only: `e2e/playwright.config.ts` (`CHROMIUM_ARGS`) and `e2e/fixtures.ts:139` (`channel: 'chromium'`), `:141` (`--load-extension`), `:154` and `:161, 168` (`request.serviceWorker()`, `context.serviceWorkers()`), and `:189, 196` (`chrome-extension://${id}/...`). Firefox needs a different extension loader and different URL schemes (`moz-extension://`). I believe Playwright's Firefox driver cannot load unpacked extensions, but this is unverified in this session.
- CI (`.github/workflows/ci.yml`): the `check` job runs on `ubuntu-latest` and calls `pnpm run build`, `check:bundle`, and `check:manifest` (`:17-25`). The `e2e` job installs only Chromium (`:37-45`). Triggers are `master`, `main`, `m6` (`:5`).

### 3. Passphrase lock for keys
- Keys live in `storage.local` under `secret:<connectionId>` (`src/shared/settings.ts:182-183`). `saveApiKey` (`:186-188`) trims and writes; `readApiKey` (`:190-195`) reads; `removeApiKey` (`:197-199`) deletes. Settings are in `storage.sync`, so keys are kept out of sync on purpose (`settings.ts:1-5`).
- Before every request, `resolveConnection` (`settings.ts:221-240`) calls `readApiKey` (`:226`) and returns the key inside `ResolvedConnection` (`src/llm/types.ts:60-77`). The only hot-path caller is `src/entrypoints/sidepanel/route.ts:63`. Other callers only check whether a key exists (`providers.ts:326, 547, 671`) or display it (`src/entrypoints/options/Providers.tsx:70, 592, 737`).
- A lock would intercept these read paths: `route.ts:63` (translation) and `Providers.tsx:592` (test connection). A "prompt for unlock" state is needed at `route.ts` where the error is built (`route.ts:64-66` returns `noKeyError`).
- Export: `buildExport` (`src/shared/portable.ts:159-199`) reads `secret:<id>` for every connection only when `includeKeys` is true (`:171-176`). Import parses `keys` (`:415-419`) and writes only when the user asked for it. Without `includeKeys`, values whose names look like secrets are removed (`:155-156`, `SENSITIVE_NAME` at `:69`).
- `storage.session` is already used for per-session state (`src/shared/access.ts:48-57`, `src/shared/snippet.ts:45-54`, `src/shared/providers.ts:692-705`). The unlocked key could follow that pattern. The access level of `storage.session` matters: by default, content scripts cannot read it. The side panel can, so the design should keep decryption in the panel.
- The `secret:` keys are not in any version or schema. A lock needs a marker per connection or a global marker in `storage.local`, and it must not be confused with `migratedRoute` (`providers.ts:55`).

### 4. SiteStyleProvider and DomainProvider
- Context providers implement `ContextProvider` (`src/engine/types.ts:311-320`): `id`, optional `maxTokens`, and `provide(q): Promise<ContextSnippet[]>`. The `ContextQuery` (`types.ts:297-308`) carries `doc`, `chunk`, `targetLang`, `maxTokens`, `segments`, `memory`, and `options`.
- The contract at `types.ts:316-317` says document-scoped snippets must not depend on the chunk, so the system block stays byte-identical across chunks. A `SiteStyleProvider` (tone rules) and `DomainProvider` (term lists) should be document-scoped on that rule.
- Wiring: `engine.ts:310` uses `deps.context ?? DEFAULT_CONTEXT_PROVIDERS`. Those defaults are `[documentBriefProvider, glossaryProvider, contextTailProvider]` (`src/engine/context/budget.ts:33`). `jobs.ts` does not pass `context`, so the defaults apply. A new provider has to be added to the array or passed in `EngineDeps`.
- Budget: `CONTEXT_BUDGET_TOKENS = 1500` (`budget.ts:13`), the personal glossary gets `1500 - 400 = 1100` (`budget.ts:19`), and `gatherContext` (`budget.ts:35-…`) splits the budget among providers.
- Glossary priority is enforced in `mergeGlossary` (`src/engine/context/glossary.ts:30-40`), which puts personal entries before brief entries and keeps the first occurrence of each term. The "user glossary wins" guarantee in M8 §2.4 maps to this function. `JobOptions.glossary` (`src/engine/types.ts:76-77`) is documented as having priority.
- Rendering: `renderSystemPromptV2` (`src/engine/context/assemble.ts:28`) and `renderContextBlock` (`assemble.ts:51`). `neutralizeContextTags` (`assemble.ts:64`) guards the context tag. A tone rule would go through `SystemPromptV2Vars` (`assemble.ts:16-27`), which is a prompt-version change (`translate@2` in `src/engine/prompts/translate.ts`).
- Site rules: `SiteRule` (`src/shared/providers.ts:110`) and `routing.siteOverrides` (`providers.ts:128`). `siteRuleFor(routing, url)` (`providers.ts:727`) picks one. Routing is in `storage.sync` (`ROUTING_KEY`). A per-site tone field would extend `SiteRule` and `cleanSiteRules` (`providers.ts:224`).
- Allowlist and never-list: `SITE_ALLOWLIST_KEY = 'siteAllowlist'` (`providers.ts:60`) and `SITE_NEVER_KEY = 'siteNever'` (`src/shared/sites.ts:22`), both read through `readList` (`sites.ts:77-81`).
- Term lists can reuse `cleanGlossary` (`src/shared/settings.ts:340`), `saveGlossary` (`settings.ts:365`), and the glossary export in `portable.ts`. The glossary has a size warning (`settings.ts:334`, ratio 0.8). The storage quota risk is ROADMAP §8 item 17 (`ROADMAP.md:458`).

### 5. gemini-native adapter
- `ProtocolAdapter` (`src/llm/types.ts:208-213`): `protocol`, `stream(conn, req)`, optional `listModels(conn)`, and `probe(conn)`. Probe results use `ProbeResult` (`types.ts:203-206` area).
- Existing adapters: `createOpenAIAdapter` (`src/llm/openai.ts:132`) and `createAnthropicAdapter` (`src/llm/anthropic.ts:133`). Both use their vendor SDK with `maxRetries: 0` (`openai.ts:55-70`, `anthropic.ts:31`). Shared machinery is in `src/llm/sdk.ts`: `streamAttempts` (`:204`), `classifySdkError` (`:71`), `watchedFetch` (`:158`), the idle guard (`:108-146`), and `headerOverrides` (`:282`). A native Gemini adapter would not use either SDK, so it would need its own `fetch` streaming and error mapping. The error mapping lives in `src/llm/errors.ts`.
- Protocol plumbing that a new protocol must extend:
  - The `Protocol` union (`src/llm/types.ts:17`).
  - The lazy loader map `Record<Exclude<Protocol, 'chrome-builtin'>, ...>` (`src/llm/client.ts:14-17`), and `createAdapter` (`client.ts:62-68`).
  - `ProviderConnection.protocol` and `protocolOf` (`src/shared/settings.ts:26, 67-70`).
  - `PresetId` and the preset list (`src/shared/presets.ts:9-20`, presets at `:58-150`).
  - The auto-detect path in `src/shared/connect.ts` (not inspected in this scout).
- The Gemini preset today: `src/shared/presets.ts:80-91` sets `protocol: 'openai-chat'`, `baseUrl: GEMINI_OPENAI_BASE_URL` (`src/llm/presets.ts:6`), `auth: 'bearer'`, `quirks: { modelIdPrefix: 'models/' }` (`types.ts:37` documents the prefix), and `defaultModel: 'gemini-3.5-flash-lite'`. The built-in connection is `GEMINI_CONNECTION` (`src/shared/settings.ts:72-81`) and the profile is `GEMINI_PROFILE` (`settings.ts:86-95`).
- Host permission: `GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*'` (`settings.ts:84`). The native endpoint is on the same host, so the existing optional host grant covers it.
- Provider matrix: there is no script with that name (`package.json` has none). The M4 matrix is an eval-harness procedure: `pnpm run eval` (`package.json:28`, `scripts/eval.mjs`) with `--provider apibox|gemini|anthropic` (`scripts/eval/README.md:10`). Results are in `docs/provider-matrix.md`, whose Gemini row records `gemini-3.5-flash-lite` on the OpenAI endpoint with judge overall 4.24. The judge uses the same endpoint (`scripts/eval/judge.ts:47`). The migration harness expects the Gemini connection (`scripts/eval/migration.ts:54-57`).

### 6. Code-comment translation
- Code blocks are segmented as kind `code` with `translate: false` (`src/segment/segmenter.ts:61` computes `translate = kind !== 'code' && …`; `:68-71` `emitCode`). The text comes from `codeText` (`segmenter.ts:304-320`), which keeps whitespace and `<br>` newlines. `codeLang` comes from `data-language`, `data-lang`, or `language-*` classes (`segmenter.ts:322-333`), and is stored as segment meta (`src/engine/types.ts:33`).
- Selector: `CODE_BLOCK = 'pre, .cm-content, .CodeMirror-code'` (`src/segment/code-block.ts:6`). Visit order: `segmenter.ts:76`. Inline code tags are `code, kbd, samp, tt` (`segmenter.ts:32`).
- Do-not-translate exclusion is enforced in the engine. The engine, chunker, and strategies all filter on `segment.translate`: `engine.ts:105`, `src/engine/chunker.ts:55`, `src/engine/strategies/single-pass.ts:162`, `src/engine/strategies/basic.ts:60`. Code segments never reach the model.
- Author opt-out: `optedOut` (`segmenter.ts:227-233`) honors `translate="no"` and `.notranslate` on ancestors below the root. Editable surfaces are excluded earlier (`src/extract/compose.ts:97-102`).
- Byte identity: no check verifies code-block bytes. Code segments are never sent, so they are copied from `codeText`. The per-segment checks (`src/engine/check/checks.ts:327-336`) run only on model output. `checkCode` (`checks.ts:228-233`) checks only backtick spans, and `checkUrls` (`checks.ts:235-239`) checks URLs. The code fixtures in `fixtures/snapshots/docusaurus-code-blocks.segments.txt` and `fixtures/docs/docusaurus-code-blocks.json` are the obvious base for an identity test.
- DESIGN §4.1 (around `DESIGN.md:812`) says editor surfaces stay excluded from any "translate code comments" option, because they may hold typed text. That constraint limits the comment track to `pre` and read-only code.

### 7. PDF
- No PDF code exists. A search of `src`, `tests`, `e2e`, and `scripts` found no PDF reference. `DESIGN.md:25` lists PDFs as a v1 non-goal, and `ROADMAP.md:365` lists "PDF" under M8.
- `pdf.js` is not a dependency. `package.json` lists `@anthropic-ai/sdk`, `@mozilla/readability`, and `openai` under `dependencies` (`package.json:69-73`).
- Current behavior on a PDF tab (inferred from code, not run):
  1. `classifyUrl` (`src/shared/denylist.ts:31-47`) accepts `https:` and `http:` URLs, so a PDF URL passes.
  2. `injectInto` (`src/shared/inject.ts:33-52`) calls `executeScript` on `frameIds: [0]`. Chrome's built-in PDF viewer is an extension-hosted frame, so injection is expected to fail. At a gesture, `attempt` returns `blocked / inject-failed` (`inject.ts:52`). This has not been verified in a browser.
  3. If injection did succeed, `extractPage` (`src/extract/index.ts:77-86`) would find no `main` element and return `no-content`.
  Neither path has a PDF-specific message, and there is no PDF e2e fixture.
- Extraction entry point for a new source: `extractPage(doc, targets)` (`src/extract/index.ts:77`), called from `src/entrypoints/content.ts:43`. The output is `Segment[]`. The segments carry DOM-bound fields: `pathOf` (`segmenter.ts:16`) and a `targets` map from ids to `Element | Range` (`content.ts:41-51`). A PDF source would need a separate target type for highlight and scroll, which the panel and `src/extract/link.ts` currently assume is a DOM node.
- Bundle budget: `scripts/bundle-budget.json` lists 16 files and a `total` of 307,482 bytes gzip (`"total"` near the end). The `note` says it was measured on 2026-10-12 plus 10% (the budget `note`). The measured total is about 279.5 KB gzip. A PDF renderer such as pdf.js would be a new chunk. `check-bundle.mjs` fails any file that is not in the budget (`:40-43`), so the budget must be reset on purpose with `--update <note>` (`check-bundle.mjs:27-33`). Headroom is about 28 KB in total.

### Settings storage versioning and migrations
- `storage.sync` carries one schema version: `SCHEMA_VERSION = 1` (`src/shared/providers.ts:49`), stored under `SCHEMA_KEY`. `MIGRATIONS` has one step, version 1 (`providers.ts:362-370`). `migrateSync` (`src/shared/migrate.ts:62-91`) runs steps in order under `withMigrationLock` (`migrate.ts:18-32`). A version newer than the build leaves storage alone (`migrate.ts:10-12`).
- A new sync key needs a new migration step only when a stored shape changes. Preferences have no version: `readPreferences` (`src/shared/settings.ts:292-305`) merges stored partial fields over defaults.
- Export format: `EXPORT_FORMAT = 'translate-side-settings'` and `EXPORT_VERSION = 1` (`src/shared/portable.ts:54-55`). Import is bounded to 1 MB (`portable.ts:57`).
- Device-only state is in `storage.local` with no version: `migratedRoute` (`providers.ts:55`), the `secret:` keys (`settings.ts:183`), and the spend log, which `portable.ts:4-6` says is never exported.

### Feature gating
- No runtime feature-flag store or entitlement check exists. Gating is compile-time constants: `CHROME_NANO = false` (`src/llm/client.ts:57`, enforced at `client.ts:62-64` and `route.ts:61-62`) and `MIXED_LANGUAGE_DETECTION = false` (`src/shared/language.ts:35`).
- Availability checks gate built-in AI (`chrome-builtin.ts:25`, `chrome-translator.ts:49`). Manifest and version gating is noted at `wxt.config.ts:16`.
- A per-track toggle (for example a `agentic` or `codeComments` switch) would be a new preference in `Preferences` (`settings.ts:245`) or a per-profile field, and it would need a default and a migration decision.

## Risks

- **Tool use is a contract change.** `NormalizedRequest`, `NormalizedEvent`, and both adapter param builders have no tool fields (`src/llm/types.ts:79-125`, `openai.ts:87`, `anthropic.ts:60`). `types.ts:3` requires additive, optional changes. `chrome-builtin` and `chrome-translator` need explicit "no tools" behavior. The `agentic` track must rescope DESIGN §8 (`DESIGN.md:816`) as ROADMAP §8 item 14 requires.
- **M7 is a dependency in practice.** The `review` role throws (`jobs.ts:1316`), `refine` exists only as a type literal (`types.ts:48`), and the M7 revision UI is what `agentic` reuses (`M7-stronger-translation.md:92`). The planner should confirm M7 status before scheduling `agentic`.
- **Firefox has three hard-coded Chrome checks.** `check-manifest.mjs` expects `background.service_worker` (`:21`) and `.output/chrome-mv3` (`:5`). `check-bundle.mjs:9` expects `.output/chrome-mv3`. The e2e harness and CI build only Chromium (`fixtures.ts:139, 141, 154`; `ci.yml:37-45`).
- **WXT sidebar support is unverified.** `wxt.config.ts` has no Firefox target, and the WXT source under `node_modules` was not read (blocked by a local hook). Whether the `sidepanel` entrypoint emits `sidebar_action` for Firefox must be checked before planning the manifest work.
- **Passphrase lock sits on the translation hot path.** `resolveConnection` (`settings.ts:221-240`) and `route.ts:63` are the only read path. The lock must not break test connection (`Providers.tsx:592`) or export with keys (`portable.ts:171-176`) unless those are deliberately gated too.
- **Byte identity of code is by construction, not by check.** Adding comment translation changes `codeText` output and the DOM write-back. Editor surfaces stay excluded (DESIGN §4.1). A new identity test should use the code fixtures listed above.
- **PDF injection behavior is unverified.** The analysis in §7 is from code reading. A manual check on a PDF URL (gesture injection, and what `extractPage` reports) is the cheapest way to confirm it before writing a plan.
- **The bundle budget is tight.** About 28 KB gzip of total headroom remains (`scripts/bundle-budget.json`, `check-bundle.mjs`). Any track that adds a chunk, such as PDF rendering or a Firefox-specific shim, needs a budget decision.
- **Provider matrix is a procedure, not a command.** "Passes the provider matrix run" in M8 §2.5 needs a defined harness invocation (`scripts/eval/README.md:10`) and a baseline from `docs/provider-matrix.md`.
- **Storage quota.** New sync items (site tone rules, term lists) share the 100 KB sync quota (ROADMAP §8 item 17, `ROADMAP.md:458`). Only `storage.local` or chunked items avoid it.

## Unresolved Questions

- Does `wxt` 0.21.4 emit `sidebar_action` for the `sidepanel` entrypoint when built for Firefox, and does it generate `background.scripts` for an event page? (Not verified: `node_modules` was blocked.)
- Does Chrome's PDF viewer reject `executeScript` on frame 0 for an `https://…pdf` tab? Does the side panel open there at all? (Needs a manual check.)
- Is M7 complete? No `docs/progress/progress-m7.md` exists and `jobs.ts:1316` still throws for `review`.
- Does `Playwright` 1.64 drive Firefox with an unpacked extension? (Believed no; not verified.)
- Which profile field would carry a per-track setting (agentic, code comments) when it is per document rather than per connection? This is a product decision, not a code question.
- Does `src/shared/connect.ts` auto-detect need a new protocol for `gemini-native`? (Not inspected.)

Status: DONE_WITH_CONCERNS
Summary: The scout maps every M8 track to its current code surface, with file:line citations, and finds the main blockers: no tool support in the LLM contract, M7's `review` path not wired, Chrome-only checks and e2e in the build, and no PDF code or PDF handling today. Firefox manifest behavior, Chrome PDF-viewer injection, and Playwright's Firefox support were not verified because `node_modules` reads were blocked and no browser was run.
