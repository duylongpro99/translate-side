# Chrome built-in AI for zero-setup translation (as of 2026-10-20)

Scope: Prompt API (`LanguageModel`, Gemini Nano), Translator API, and LanguageDetector API, as used from a Chrome MV3 extension's side panel or service worker.

Evidence tiers: **[Doc]** means developer.chrome.com or the explainer. **[Src]** means Chromium `main` source, read 2026-10-20 (this is what ships next, so it can run slightly ahead of stable). **[Status]** means chromestatus.com API. **[3P]** means a third-party source. **UNVERIFIED** means no primary source was found.

## Bottom line

1. **Nano cannot output most target languages.** The Prompt API accepts only `en, es, ja, de, fr`, and `de`/`fr` only arrive in Chrome 149 (138 to 148 had `en, es, ja` only). If you pass any other output language (for example `vi`), `availability()` returns `unavailable` and `create()` throws `NotSupportedError`. For a general page translator, Nano is a narrow path. Use Translator plus LanguageDetector as the main zero-setup engine, and use Nano only when the target is one of those five languages. **High confidence. [Src][Doc]**
2. **Translator pivots through English.** A pair like `ja → vi` needs two language packs (`en↔ja` and `en↔vi`), and you get one combined progress stream for both. It supports 39 language codes, including `vi`. **High confidence. [Src][Explainer]**
3. **Extension service workers have all three APIs, and Chromium skips the user-activation check there.** Side panel pages (window context) need activation only when the state is `downloadable`. **High confidence on the code; medium on whether Chrome keeps it this way.**
4. **`responseConstraint` (JSON Schema or RegExp) is available on Nano.** It can replace a marker grammar. One approach is an array schema with `minItems = maxItems = N` segments. **High confidence it exists; output quality is UNVERIFIED.**

---

## 1. Prompt API availability in extensions

| Fact | Detail | Source | Confidence |
|---|---|---|---|
| Extensions stable | Chrome **138** (status badge on the extension docs). | [Doc] developer.chrome.com/docs/extensions/ai/prompt-api | High |
| Web stable | Origin trial ran 139–147; shipped on desktop in **148** (shipping stage `desktop_first: 148`). | [Status] chromestatus.com/feature/5134603979063296 | High |
| Manifest permission | None needed. The old `"aiLanguageModelOriginTrial"` permission has expired and should be **removed**. No flag needed. | [Doc] extensions/ai/prompt-api | High |
| Runtime gate | `AIPromptAPI` is `stable` on Win, Mac, Linux, and ChromeOS. | [Src] `third_party/blink/renderer/platform/runtime_enabled_features.json5` | High |
| Side panel / extension pages | These are window contexts in the extension process, so `LanguageModel` is exposed (`Exposed(Window AIPromptAPI, …)`). | [Src] `modules/ai/language_model.idl` | High |
| MV3 service worker | **Yes.** In the extension process Chromium calls `EnableAIPromptAPIForWorkers(true)`, along with `TranslationAPIForWorkers`, `LanguageDetectionAPIForWorkers`, the legacy identifiers, and the legacy params. The docs say "not available in Web Workers"; that refers to web pages. | [Src] `chrome/renderer/chrome_content_renderer_client.cc` (block starting `IsStandaloneContentExtensionProcess()`) | High (source); docs are silent |
| Content scripts | These run in the web page's renderer, not the extension process. They get **web** semantics: no `topK`/`temperature`, no `params()`, no legacy aliases. | Inferred from [Src] above | Medium |

## 2. Hardware and OS requirements

**Gemini Nano (Prompt API)**, per [Doc] docs/ai/get-started and docs/ai/prompt-api:
- **OS:** Windows 10/11, macOS 13+, Linux, or ChromeOS 16389.0.0+ on Chromebook Plus. Android, iOS, and non-Plus ChromeOS are not supported.
- **Disk:** at least **22 GB** free on the Chrome profile volume. If free space drops below 10 GB after download, the model is deleted, and it re-downloads once space is available again.
- **GPU:** more than 4 GB VRAM. **Or CPU:** 16 GB RAM or more and 4 or more cores. The CPU path rolled out in **Chrome 140** ([Doc] developer.chrome.com/blog/gemini-nano-cpu-support).
- **Network:** an unmetered connection is needed for the initial download only.
- **Model size:** the docs say it varies (check `chrome://on-device-internals`). Press reports say about **4 GB** ([3P] bitdefender.com; this figure is UNVERIFIED by Google).

**Translator and LanguageDetector:** desktop only, and they use expert models rather than Nano [Doc]. The docs give no disk, GPU, or RAM thresholds (**UNVERIFIED**; assume they are light). The LanguageDetector model is "very small" and may already be on the device [Doc language-detection]. Language-pack sizes are **UNVERIFIED**.

## 3. `availability()` states and options

- **States** ([Doc] get-started; [Explainer] webmachinelearning/prompt-api):
  - `unavailable`: the device or the options are not supported.
  - `downloadable`: a download is needed, and `create()` may need activation.
  - `downloading`: a download is in progress.
  - `available`: a session can be created immediately.
- **Options:** the same core options as `create()`: `expectedInputs: [{type:'text'|'image'|'audio', languages:[…]}]` and `expectedOutputs: [{type:'text', languages:[…]}]`. The explainer also mentions `thinkingEffort`, but its chromestatus entry is still "Proposed" [Status 5098001721851904].
- **Output languages:** the enabled set is `"en,es,ja,de,fr"` [Src `chrome/browser/ai/ai_language_model.cc` `GetEnabledLanguageBaseCodes`]. `de` and `fr` are documented as arriving in **Chrome 149** [Doc get-started].
- **Unsupported language:** returns `kUnavailableUnsupportedLanguage`, which surfaces in JS as `unavailable`, plus a one-time console error [Src `ai_manager.cc`].
- **Calling without languages:** not deprecated and does not throw. It logs a one-time console **warning**: "No output language was specified in a LanguageModel API request… Please specify a supported output language code: [en, es, ja, de, fr]" [Src `ai_manager.cc` `kEmptyOutputLanguageWarning`]. This warning is logged only for frames, so service workers do not see it.
- **Advice:** always pass `expectedInputs` and `expectedOutputs` languages, in both `availability()` and `create()`. **Confidence: High.**

## 4. Download flow and user activation

- **Which states require activation:**
  - **Prompt API:** only `downloadable`. **`downloading` does not require it** [Src `modules/ai/ai_utils.cc` `RequiresUserActivation`].
  - **Translator:** any state where a download is needed, *including* the privacy-masked state where the pack already exists but this origin has never created that pair [Src `on_device_translation/create_translator_client.cc`].
  - **LanguageDetector:** `after-download` only [Src `language_detector.cc`].
- **What counts as activation in a window:**
  - **Prompt API and LanguageDetector:** *sticky* activation is enough, so any click earlier in the document's lifetime qualifies. This is because feature `kAIRelaxUserActivationReqs` is `ENABLED_BY_DEFAULT` [Src `modules/ai/ai_features.cc`]. The milestone this landed in is **UNVERIFIED**.
  - **Translator:** *consumes transient* activation. Call `create()` synchronously within about 5 s of the click, and note that each call uses up the activation. This means **one click per new pair download**. Translator does not get the sticky relaxation [Src `create_translator_client.cc`].
- **Side panel:** a click inside the side panel document gives that frame activation, so it qualifies. **High confidence** (it is a normal extension frame). Extension pages get **no special relaxation**; the same `MeetsUserActivationRequirements(window)` check applies.
- **Service worker:** the activation check is skipped. The source comment says "User activation is not consumed by workers, as they lack the ability to do so", and Translator code does `if (!context->IsServiceWorkerGlobalScope() && RequiresUserActivation…)`. So `create()` from the SW can start a download with no click. **High confidence on current code. Medium risk** that Chrome tightens this; there is no doc that promises it.
- **`monitor`:** `create({monitor(m){ m.addEventListener('downloadprogress', e => e.loaded) }})`. The event is a `ProgressEvent` with `loaded` from **0 to 1** and `total === 1`. The 0 and 1 events always fire, even when nothing needs downloading. Multiple packs are combined into one stream. On failure, events stop and `create()` rejects with `NetworkError` [Explainer prompt-api and translation-api; Doc translator-api uses `e.loaded * 100`]. **High confidence.**
- **Download duration:** **UNVERIFIED.** It depends on bandwidth: about 4 GB for Nano means minutes. Translator packs are small but sizes are unpublished.

## 5. Context limits, sessions, and streaming

- **Renames** ([Explainer]; [Src] `language_model.idl` and `runtime_enabled_features.json5`):

  | Old name | New name |
  |---|---|
  | `inputQuota` | `contextWindow` |
  | `inputUsage` | `contextUsage` |
  | `measureInputUsage()` | `measureContextUsage()` |
  | `quotaoverflow` | `contextoverflow` |

  The old names are **removed on web** and **deprecated (still present) in extensions** via `AIPromptAPILegacyIdentifiers`. The source TODO says they will be removed "after extension context usage drops" (crbug 498228550). **Use the new names, and feature-detect.** The rename milestone is **UNVERIFIED** (after 138).
- **On overflow:** the oldest non-system turns are evicted and `contextoverflow` fires. If the input can't fit even then, the call rejects with `QuotaExceededError` (properties `requested` and `contextWindow`/quota) and removes nothing. Oversized `initialPrompts` also reject with `QuotaExceededError` [Doc][Explainer].
- **`measureContextUsage(input, {responseConstraint})`:** counts schema tokens too [Doc].
- **Window size:** it is `min(max_context_tokens, max_tokens − output_buffer)` from the model config [Src `ai_language_model.cc` `GetMaxTokens`]. Read it at runtime. Community figures range from about 6k to 9k tokens (**UNVERIFIED**).
- **Other session methods:** `session.clone({signal})` forks the context, `append()` adds context without prompting, and `destroy()` frees the session [Doc]. **High confidence.**
- **Streaming:** `promptStreaming()` returns a `ReadableStream` of **deltas**. Non-streaming concatenates chunks (`response_ = StrCat({response_, text})`) and streaming enqueues each piece [Src `modules/ai/model_execution_responder.cc`]. The change from cumulative to delta predates 138. **High confidence.**
- **Throughput:** **UNVERIFIED.** No official figure exists. Expect tens of tokens/s on GPU and slower on the CPU path [Doc CPU blog says GPU is "typically faster"].

## 6. Sampling parameters and system prompts

- **`topK` and `temperature`:** deprecated. On the **web** they are **ignored** with a console warning. In **extensions** they still work, and you must pass both or neither. If `samplingMode` is also given, it wins [Explainer; Doc extensions/ai/prompt-api].
- **`LanguageModel.params()`:** extension-only, marked `DeprecateAs` and gated by `AIPromptAPILegacyParams` [Src idl]. It returns `{defaultTopK, maxTopK, defaultTemperature, maxTemperature}`, or `null` when no model is available.
- **`samplingMode`:** an enum from `most-predictable` to `most-creative`, with default `balanced`. It is in origin trial **148→159**, and the chromestatus shipping stage lists 160 [Status 6325545693478912, updated 2026-10-15]. The source maps each preset to concrete topK/temperature values (for example `most-creative` = 1.2/100) [Src `ai_manager.cc`]. For translation, use `topK:1`-like determinism through the legacy params in extensions now, and migrate to `samplingMode:'most-predictable'` when it ships. **Medium confidence on the 160 timing.**
- **`initialPrompts`:** roles are `system`, `user`, and `assistant`. A `system` message must be the **first** message, otherwise the call fails with `TypeError`. Initial prompts are never evicted. A trailing `assistant` message with `prefix:true` prefills the reply [Doc][Explainer]. **High confidence.**

## 7. Translator API

- **Version and platform:** stable in **Chrome 138**, desktop only. Pass BCP 47 codes [Doc translator-api].
- **Languages:** **39 codes**: ar bg bn cs da de el en es fi fr hi hr hu id it iw(he) ja kn ko lt mr nl no pl pt ro ru sk sl sv ta te th tr uk vi zh zh-Hant [Src `components/on_device_translation/public/supported_languages.h`]. The docs also say 39 [Doc]. There is no API to list supported pairs yet (explainer issue #68).
- **English pivot:** "Currently we always translate via English" [Src `components/on_device_translation/public/language_pack.cc`]. A pair that doesn't involve English needs two packs, and quality is limited by both hops. **High confidence.**
- **Privacy masking:** a pair reports `downloadable` until this origin has created it, even if the pack is installed. Creating it then still needs activation in a window [Doc][Src].
- **`translateStreaming(text)`:** returns a `ReadableStream`. Input streaming is not supported. Calls **run sequentially** per translator, so chunk and parallelize across translators if needed [Doc][Explainer].
- **`inputQuota`:** hard-coded `Infinity`. **`measureInputUsage()`** always resolves `0` [Src `on_device_translation/translator.cc`]. The real limit is **UNVERIFIED**, so chunk by paragraph.
- **Policies:** `TranslatorAPIAllowed` (Chrome 132+) can disable it; see §9.

## 8. Structured output (`responseConstraint`)

- **Availability:** since **Chrome 137** [Doc docs/ai/structured-output-for-prompt-api]. Accepts a JSON Schema **or a `RegExp`** [Explainer; Chrome 148 blog: "regular expression and JSON schema formats"]. The result is a string, so `JSON.parse` it.
- **Errors:** unsupported schema features throw `NotSupportedError`. Non-compliant output throws `SyntaxError`. `omitResponseConstraintInput:true` drops the schema from the context (saving tokens), but you should then describe the format in the prompt [Explainer].
- **Can it replace a marker grammar?** Yes. One option is `{type:'array', items:{type:'string'}, minItems:N, maxItems:N}`, which makes segment count and order mechanically guaranteed. A RegExp can also enforce a literal marker format. The trade-offs:
  - The schema costs context tokens unless you omit it.
  - Streamed output arrives as partial JSON, so you need an incremental parser or must wait for completion.
  - The quality impact of constrained decoding on a small model is **UNVERIFIED**; test it.
  - **Confidence:** high that it is feasible; medium on quality.

## 9. Enterprise and user controls

All of these show up in JS as **`availability() === 'unavailable'`**, and `create()` rejects with `NotSupportedError` [Src `ai_manager.cc` `GetPrefBlockedResult`; `language_model_create_client.cc`]:

- **`GenAILocalFoundationalModelSettings`** (Chrome 124+; Android 142+; ChromeOS 149+). Values: `0` Allowed (default), `1` Disabled. When disabled, the model is not downloaded and any existing copy is deleted. Internally this returns `kUnavailableEnterprisePolicyDisabled`. The model download can also be blocked with `ComponentUpdatesEnabled=false` [Src `policy_definitions/GenerativeAI/GenAILocalFoundationalModelSettings.yaml`].
- **`BuiltInAIAPIsEnabled`** (Chrome 137+, per profile). Setting it to `false` disables the LanguageModel, Summarizer, Writer, and Rewriter APIs, also as `kUnavailableEnterprisePolicyDisabled` [Src `policy_definitions/Miscellaneous/BuiltInAIAPIsEnabled.yaml`].
- **`TranslatorAPIAllowed`** (Chrome 132+ desktop). Setting it to `false` disables Translator [Src `.../Miscellaneous/TranslatorAPIAllowed.yaml`].
- **New user toggle:** the "On-device AI" setting at **`chrome://settings/ai`**. When it is off, the API returns `kUnavailableFeatureNotEnabled` and logs a console warning ("On-device AI is disabled in Chrome settings…") [Src `ai_manager.cc`]. The milestone is **UNVERIFIED**. The UI should tell users that `unavailable` may mean "turned off" and not only "unsupported hardware".

## What changed between Chrome 138 and the current version

| Milestone | Change |
|---|---|
| 138 | Prompt API stable for extensions; Translator and LanguageDetector stable. |
| 140 | CPU inference path added (16 GB RAM, 4 or more cores). |
| 148 | Prompt API stable on the web. Multimodal input becomes stable. On the web, `topK`/`temperature` are ignored and `params()` is not exposed. `samplingMode` origin trial starts (148→159; shipping listed for 160). |
| 149 | Nano output languages add `de` and `fr`. ChromeOS support for the model-download policy. |
| UNVERIFIED (between 138 and now) | Rename from `inputQuota`/`inputUsage`/`measureInputUsage`/`quotaoverflow` to `contextWindow`/`contextUsage`/`measureContextUsage`/`contextoverflow`. Legacy names survive only in extensions and are marked for removal. |
| UNVERIFIED | Relaxed activation (sticky instead of transient) for the Prompt API and LanguageDetector, but not Translator. The `chrome://settings/ai` on-device AI toggle. `QuotaExceededError` becoming a `DOMException` subclass with `requested`/`contextWindow`. |

## Recommendation for the extension, ranked

1. **Translator + LanguageDetector as the default zero-setup engine.** It covers 39 languages including `vi`, has light hardware needs, and is stable since 138.
2. **Nano only when the target is in `{en, es, ja, de, fr}`** and `availability({expectedInputs, expectedOutputs:[{type:'text', languages:[target]}]})` is not `unavailable`. Use `responseConstraint` with an N-item array to replace the marker grammar.
3. **Call `create()` from a side-panel click handler**, synchronously for Translator because it consumes transient activation. Use creation in the service worker only as a deliberate, documented choice, because it relies on undocumented behaviour.

## Limitations

- These are source reads, not runtime tests. Chromium `main` may be ahead of stable (current stable is around 150–151; not checked).
- No primary data was found for the context-window size, tokens/s, translator pack sizes, or download times.
- Milestones for the rename, the relaxed activation, and the settings toggle were not pinned down; doing so would need a git-blame per file.

## Unresolved questions

1. Will Chrome keep the activation exemption for service workers? It is not documented anywhere.
2. Is there a Translator per-call input limit, given that `inputQuota` reports `Infinity`?
3. Does Nano quality hold up under a JSON-array `responseConstraint` for long segment lists? This needs an empirical test.
