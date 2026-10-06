# Translate Side — Roadmap

Source of truth: `DESIGN.md` (draft v0.1, 2026-10-05). This roadmap turns it into ordered
milestones, ticket-sized tasks, a critical path, an MVP cut and a v1.0 cut. Where this document
and `DESIGN.md` disagree, the disagreement is listed in §8 (gaps and contradictions) with a
recommended resolution; nothing here silently overrides the design.

Status: v0.1 (2026-10-05)

## 0. Working assumptions

The open questions in `DESIGN.md` §12 are unresolved. This roadmap assumes:

| Question | Assumption | What depends on it |
|---|---|---|
| Browsers | **Chrome only for v1.** WXT is still used so a Firefox build stays possible. | "Firefox build" moves from M5 to M8. No `sidebar_action` work, no Firefox CI. Chrome built-in AI can be relied on as an *optional* path. |
| Default provider | **Anthropic, Claude Haiku 4.5** (`claude-haiku-4-5`, $1 / $5 per MTok, 200K context). | Onboarding pre-selects the Anthropic preset. Eval baseline and cost estimates are measured on Haiku 4.5. Prompt caching will **not** engage on Haiku 4.5 with the designed system block (see §8, item 4). Thinking is left off (omit the `thinking` param). |
| Target language | **One target language, switchable globally** (settings + header switch). Not per tab, not several at once. | Cache key already includes `targetLang`. The brief cache key must add it (§8, item 10). Onboarding step 1 picks it. |
| Term gloss (§12 Q4) | Adopt the behavior already in the draft prompt: keep established English terms, add a short gloss **on first occurrence only**, for glossary terms and for terms the model judges to have no common equivalent. Exposed as a setting in M2. | `translate@1` prompt text, eval rubric for "terminology". |

Sizes assume one developer working with AI assistance: **S** ≈ up to 1 week, **M** ≈ 2–3 weeks,
**L** ≈ 4–6 weeks. They are rough and meant for ordering, not for commitments.

## 1. Milestone overview

```
 M0 Skeleton + spikes ──► M1 Translate E2E ──► M2 Contextual quality ──► M3 Reading UX core ═══ MVP
                                   │                                             │
                                   └──► M4 Providers (parallel from mid-M2) ─────┤
                                                                                 ▼
                                   M5 UX complete + robustness ─────────► M6 Hardening ═══ v1.0
                                                                                 │
                                                                                 ▼
                                                        M7 Stronger translation ──► M8 Beyond v1
```

| # | Milestone | Goal in one line | Size | Cut |
|---|---|---|---|---|
| M0 | Skeleton and spikes | Panel opens, page is extracted and segmented, five unknowns are answered with written decisions | M | |
| M1 | Translate end to end | `engine/` + `single-pass` + `<seg>` parser + Anthropic adapter + minimal settings + Node harness | L | |
| M2 | Contextual quality | `contextual` strategy, brief, glossary, context tail, check stage, style modes, eval set | M | |
| M3 | Reading UX core | Viewport priority, cache, resume, selection mode, error UX, header controls | M | **MVP** |
| M4 | Providers | `openai-chat` adapter, connections/profiles/routing, test connection, fallback, usage meter, onboarding | L | |
| M5 | Reading UX complete and robustness | Hover, bidirectional scroll sync, SPA handling, site rules, long docs, tables, Chrome built-in, import/export | M | |
| M6 | Release hardening | Store listing, permissions review, e2e tests, regression gate, docs, beta | M | **v1.0** |
| M7 | Stronger translation | `refine` strategy with revisions, quality modes, translation memory from edits | L | v1.1 |
| M8 | Beyond v1 | `agentic`, Firefox, passphrase lock, domain providers, `gemini-native` | L | later |

## 2. Spikes (time-boxed, inside M0)

Each spike ends with a short decision record in `docs/decisions/` (what was tested, result,
decision). Spikes S1–S5 gate M1; S6–S8 are small and can slip into M1.

| ID | Unknown | How to test (1–2 days each) | Decision it unblocks |
|---|---|---|---|
| **S1** | **MV3 worker suspension during streaming.** Chrome kills a worker after 30 s idle and after a single request exceeds 5 min. Reading a fetch body is not an "event". Does an open Port keep it alive? Do Port messages reset the idle timer? What happens to an in-flight stream on suspension? | Prototype: worker streams a 60–90 s response (Ollama with a slow model, or a throttled mock), with and without Port traffic, with and without a periodic `chrome.runtime.getPlatformInfo()` ping. Observe kill and resume from `chrome.storage.session`. | **Where the engine runs.** Option A: engine in the worker, keepalive via Port messages plus a heartbeat, resumable job state. Option B: engine runs **in the side panel page** (it lives exactly as long as a translation is needed; no suspension; same host-permission rules), the worker only coordinates tabs, injection and the context menu. B removes the resume machinery entirely and is the recommended default unless A proves trivially reliable. Note: with B the cache (IndexedDB) and `engine/` are unchanged; only the shell wiring differs. |
| **S2** | **`<seg>` parse robustness.** Missing, merged, reordered or unclosed segments; literal `<` in source text; attribute quoting drift; stream cut by `max_tokens` mid-segment. | Run 50 chunks from 10 pages through Haiku 4.5 and one small local model (Qwen 7–8B). Count segment-loss, merges, marker corruption. Try escaping `<`/`>` in source, strict `<seg id="N">` grammar with lenient fallback. | Parser grammar and repair policy (retry only missing segments; treat `stopReason: max_tokens` as "re-request open segment"). Also sets `maxOutputTokens` multiplier per target language. |
| **S3** | **Extraction quality on docs sites.** Readability is tuned for articles; docs sites (Docusaurus, MkDocs Material, mdBook (GitBook-style), MDN, docs.rs, GitHub README, a long-form blog essay, a newsletter issue, Wikipedia, one news site; all permissively licensed) may lose code blocks, tables, admonitions, or keep sidebars. | Run Readability vs the `main`/`article`/`[role=main]` walk on 10 fixture pages. Define the "poor result" heuristic (text ratio, lost `pre` count). Save fixtures for tests. | Extraction policy and fallback thresholds; segment kinds that need special handling (admonitions, tabs, details/summary). |
| **S4** | **Ollama from an extension.** Ollama rejects requests whose `Origin` is not allowed and returns **403**, which `DESIGN.md` §4.3.5 classifies as *auth*. Does a granted host permission change anything? Is `OLLAMA_ORIGINS` still required? | Call `http://localhost:11434/v1/models` and a chat completion from the worker and from the panel, with and without host permission, with and without `OLLAMA_ORIGINS`. | Error classifier rule: `403` + auth style `none` + localhost → `cors`, show the Fix guide, never show "Fix key". Confirms the §4.3.6 guide text. |
| **S5** | **`activeTab` and navigation.** `activeTab` is revoked when the tab navigates. The content script is gone after a full navigation. `chrome.sidePanel.open()` needs a user gesture, so "auto-open on allowlisted sites" may be impossible. Per-tab panel close needs Chrome 141. | Open panel on page A, click a link to page B (same site) and to another site. Check whether the panel stays, whether the script can be re-injected without a gesture, whether a click inside the panel counts as a gesture. | Allowlist design (§8 item 6): per-site **optional host permission** lets the extension re-inject on navigation; without it, the panel shows a "Translate this page" button that re-triggers via a gesture that grants `activeTab` if one exists, or asks for the site permission. Sets `minimum_chrome_version`. |
| S6 | **Prompt caching on Haiku 4.5.** Minimum cacheable prefix on Haiku 4.5 is **4096 tokens**; the designed system block is ~1k tokens, so `cache_control` will never hit. | Measure `cache_read_input_tokens` on three consecutive chunks. Compare with Sonnet-class model (minimum 512–1024). | Accept no caching on Haiku (the §6 estimate already assumes uncached prices). Keep `cache_control` for larger models and gateways. Do **not** pad the prefix; padding costs more than it saves at this size. |
| S7 | **Vendor SDKs in an extension.** Bundle size of `@anthropic-ai/sdk` and `openai` together, `dangerouslyAllowBrowser`, AbortSignal propagation during streaming, and double-retry (SDK `maxRetries` default 2 plus our own backoff). | Build a throwaway WXT entry with both SDKs; stream and abort; measure bundle. | Set SDK `maxRetries: 0` and own retries in the pipeline, or the reverse; bundle budget. |
| S8 | **Chrome built-in availability.** `LanguageDetector` and `Translator` availability states, model download time, Chrome version gating, behavior on unsupported hardware. | Call `availability()` and `create()` on two machines; time the first download. | Language-detection fallback chain (§8 item 7) and whether "Just try it" onboarding path is viable at v1. |

## 3. Milestones in detail

### M0 — Skeleton and spikes (size M)

**Goal.** A WXT + TypeScript MV3 project where opening the panel on a page shows that page's
segmented original text, with code blocks marked, on ten fixture sites. The five gating spikes
have decision records.

**Scope.** `DESIGN.md` §4.1 content script and side panel shell; §8 permissions; §11 M0.
Modules: `entrypoints/{background,content,sidepanel,options}`, `shared/messaging`,
`extract/`, `segment/`.

**Deliverables.**
- Repo with WXT, TypeScript strict, Preact (or Svelte; pick once, in M0-E1), Vitest, ESLint.
- An ESLint boundary rule: `engine/` may not import `chrome`, `wxt/*`, DOM types, or `llm/` implementations (interfaces only).
- Manifest: `sidePanel`, `storage`, `activeTab`, `scripting`, `contextMenus`; `optional_host_permissions` for provider endpoints; `commands` with `Alt+T`; `minimum_chrome_version` (from S5/S8).
- Typed message protocol (content ⇄ worker ⇄ panel) with versioned message names.
- Extraction and segmentation producing `Segment[]` per §4.1, with inline markup → light markers and `code`/`pre` marked do-not-translate.
- Panel renders original segments by kind; dev-only "segments" debug view.
- Ten HTML fixtures saved from S3 plus snapshot tests of segmentation output.
- Decision records for S1–S5 (S6–S8 may land in M1).

**Exit criteria.**
- Demo: open the panel on each fixture site; segments appear with correct kinds; no nav/footer noise on at least 8 of 10; code blocks intact on all.
- S1–S5 decision records merged; the "where the engine runs" decision is final.

**Dependencies.** None.

**Tasks.**
- M0-E1 Project setup: WXT, TS strict, UI framework choice, Vitest, ESLint + boundary rule, CI (lint, typecheck, unit).
- M0-E2 Manifest and entrypoints: action click and `Alt+T` open the panel for the tab (`action.onClicked` → `sidePanel.open`, with `openPanelOnActionClick: false`; decision S5), context menu entry stub, options page stub.
- M0-E3 Injection: on panel open, inject the content script with `chrome.scripting` under `activeTab`; handle "already injected" and "cannot inject here" (`chrome://`, Web Store).
- M0-E4 Messaging: typed Port protocol, request/response helpers, tab-scoped routing in the worker.
- M0-E5 Extraction: shadow-composed clone; `main`/`article`/`[role=main]` walk with in-content noise rules (generic + per-site cleanup selectors) and visibility filter; Readability fallback (decision S3); denylisted origins never extracted.
- M0-E6 Segmenter: block kinds, inline marker conversion, `domPath`, stable ids across re-extraction (hash of path + text), table-row grouping field (`groupId`).
- M0-E7 Panel: render originals by kind, loading/empty/error states, settings gear placeholder.
- M0-E8 Fixtures and snapshot tests from S3.
- M0-S1…S5 Spikes above.

### M1 — Translate end to end (size L)

**Goal.** A page is translated into the target language, streamed into the panel, by an engine
that also runs unchanged in Node.

**Scope.** `DESIGN.md` §5.1–5.3 (framework, `single-pass`), §5.7 steps 2–3 (chunking, `<seg>`
streaming), §4.2.1–4.2.2 (`anthropic-messages` adapter), §4.3.4 key storage (basic), §10 harness
skeleton. Modules: `engine/{core,strategies,stages,prompts,parsing}`, `llm/{client,anthropic}`,
`shell/jobs`, `eval/`.

**Deliverables.**
- `engine/`: `TranslationEngine`, `TranslationJob`, `EngineEvent`, `Strategy`, `Stage`, `StageContext`, `WorkingMemory`, `PromptRegistry`, `Budget` (interfaces + minimal implementations).
- Chunker: 800–1,500 source tokens, cut at headings, never split a paragraph, keeps table rows together; token estimate heuristic (chars/3.5 for Latin scripts, tuned later).
- `<seg>` streaming parser with repair policy from S2; emits `segment.partial` and `segment.final`.
- `single-pass` strategy = translate(chunk) + check(count only in M1).
- Prompts as versioned assets: `translate@1` from §5.7 (with `{BRIEF_JSON}` and `{GLOSSARY}` empty in M1).
- `llm/`: `LLMClient`, `NormalizedRequest/Event`, `LLMError` classifier; `anthropic-messages` adapter on `@anthropic-ai/sdk` with `baseURL`, `x-api-key`, streaming, usage, `cache_control` on the system block, abort.
- Shell: one job per tab, 2 chunks in flight, cancel on panel close or navigation; worker or panel hosting per S1.
- Options page v0: API key (masked, stored in `chrome.storage.local` under `secret:<connectionId>`), target language, source-language override.
- Panel: streaming render, per-segment status, cancel button, simple cost readout from `usage` events.
- Node eval harness v0: loads fixture documents (JSON of `Segment[]`), runs the engine with a real adapter, writes outputs + token usage + wall time to a results folder.
- Unit tests: parser (golden + fuzz), chunker, error classifier.

**Exit criteria.**
- Demo: a 3,000-word article translated end to end; first segment visible within ~2 s; whole page under ~30 s with 2 in flight.
- Harness runs the same engine on 5 fixture docs and reports cost per doc.
- Segment loss after repair is 0 on the fixtures; parser fuzz tests pass.

**Dependencies.** M0 (shell, segments, S1 decision, S2 grammar, S7 SDK settings).

**Tasks.**
- M1-E1 Engine core types and the stage/strategy runner (ordered stages, shared working memory, event multiplexing).
- M1-E2 Chunker + token estimator.
- M1-E3 `<seg>` streaming parser + repair (missing, merged, unclosed, `max_tokens` cut).
- M1-E4 Prompt registry + `translate@1` template + prompt-version in cache key plumbing (key used from M3).
- M1-E5 `single-pass` strategy and `check` stage v0.
- M1-E6 `LLMClient` contract, error classifier, retry/backoff policy (owning retries per S7).
- M1-E7 `anthropic-messages` adapter (stream, usage, abort, `probe`, `listModels`).
- M1-E8 Job orchestration in the shell (per S1), role → profile mapping stub (`translate` only).
- M1-E9 Options v0 (key, target language) and key storage with masking.
- M1-E10 Panel streaming render and status.
- M1-E11 Node harness v0 and fixture capture script (export `Segment[]` from the extension's debug view).
- M1-E12 Tests.

### M2 — Contextual quality (size M)

**Goal.** Translations keep tone, intent and terminology across the whole document, and there is
a measurable eval that proves it.

**Scope.** §5.4 context providers, §5.6 guardrails, §5.7 steps 0–1 and 4, §10 eval. Modules:
`engine/{stages/analyze,context,stages/check}`, `shell/langdetect`, `eval/`.

**Deliverables.**
- `analyze` stage: brief call (title + first ~1,500 tokens + outline), lenient JSON parsing (fenced or bare), `analyze@1` prompt; brief emitted as an `artifact` event and shown in the panel ("About this document" collapsible).
- `ContextProvider` interface; `DocumentBriefProvider`, `GlossaryProvider` (personal + auto), `ContextTailProvider` (last 1–2 source paragraphs + translations, marked do-not-translate).
- System prompt assembly that is byte-stable across chunks of a document.
- Style modes Natural / Faithful / Simplified; term-gloss setting (per §0 assumption).
- `check` stage v1: segment count, marker balance, backtick spans byte-identical, URL/number/code preservation, length-ratio sanity, re-request failing segments once, then mark `segment.failed`.
- Language detection as a **shell port** (not in `engine/`): Chrome `LanguageDetector` → `<html lang>` → ask the model in the brief; skip page if already in target language; per-segment detection for mixed pages (behind a flag).
- Personal glossary v0: list editor in options (term → rendering, keep-as-is toggle).
- Budget guardrail v0: per-job token ceiling from settings; stages check it.
- Eval set: 20–30 passages (tech blogs, docs, opinion, idiom/humor/sarcasm), rubric 1–5 on fidelity, naturalness, tone, terminology; human scoring sheet; LLM-as-judge script for regression (a stronger Claude model as judge); harness compares `single-pass` vs `contextual`, `translate@N` vs `translate@N+1`.

**Exit criteria.**
- Eval: `contextual` ≥ `single-pass` on fidelity, tone and terminology (human + judge), at ≤ 1.3× cost.
- Segment loss after repair: 0 on the eval set; marker/code preservation check passes on 100% of code-bearing segments.
- Demo: a sarcastic opinion piece and a Rust blog post read naturally with consistent terms; the brief is visible in the panel.

**Dependencies.** M1. Eval passage collection can start in M0 (no code needed).

**Tasks.**
- M2-E1 `analyze` stage + `analyze@1` + lenient JSON parsing + artifact event.
- M2-E2 Context provider interface and the three v1 providers; token budgeting across providers.
- M2-E3 Stable system prompt assembly + `translate@2` (brief, glossary, style mode, gloss rule).
- M2-E4 `check` stage v1 + per-segment re-request.
- M2-E5 Language detection port and fallback chain; skip-if-same-language; mixed-language flag.
- M2-E6 Personal glossary storage (sync, with quota guard) and editor.
- M2-E7 Budget v0.
- M2-E8 Eval set, rubric, judge script, harness comparison report (markdown table output).

### M3 — Reading UX core → **MVP** (size M)

**Goal.** Good enough to use every day: open, read the visible part within seconds, revisit for
free, recover from errors without losing the page.

**Scope.** §3 (viewport first, selection mode, per-block actions, style control), §4.1 (IO
observer, resume), §7 caching, §8 privacy notice and denylist, §4.3.5 error classification (for
the single Anthropic connection). Modules: `shell/{cache,priority,selection}`, panel UI.

**Deliverables.**
- Viewport priority: IntersectionObserver → `priority` ids; the engine orders chunks by priority and re-prioritizes on scroll (pending chunks only).
- Translation cache (IndexedDB) keyed per §7 (`segmentText + targetLang + model + styleMode + strategy@version + promptVersions + glossaryHash`), highest revision only, LRU ~50 MB. Brief cache by `url + contentHash + targetLang`.
- Job persistence/resume per S1 decision (or none if the engine runs in the panel).
- Selection mode: context menu "Translate in side panel" → `translateSnippet`; also used when extraction fails ("Couldn't read this page. Select text to translate it.").
- Per-block actions: show original inline, retranslate (bypasses cache), copy.
- Panel header: language pair with target-language switch, model name, style mode, settings gear, cancel/retranslate page.
- One-way scroll follow (page → panel), toggle in header.
- Error UX: auth error → "Fix key" inline (no fallback); rate limit → backoff indicator per chunk; `segment.failed` → inline retry; network down → whole-page retry.
- Per-page cost readout and a settings-page running total (Anthropic pricing table built in).
- First-run privacy notice ("page text is sent to the provider you chose"); built-in denylist (banking, mail, `chrome://`, Web Store, pages with focused password fields) never extracted.
- Dogfood for one week; bug list triaged into M3 or later.

**Exit criteria (the MVP bar).**
- On any article or docs page: visible segments translated within ~2 s of opening; whole 3,000-word page within ~30 s.
- Reopening a translated page renders from cache with no API calls.
- Killing the network mid-translation leaves the translated part intact and offers retry.
- Selection mode works on a page where extraction fails.
- The developer uses it daily for a week without reaching for another translator.

**Dependencies.** M2 (quality worth using), M1 (engine, adapter).

**Tasks.**
- M3-E1 IntersectionObserver reporting + priority ordering in the engine + re-prioritization.
- M3-E2 IndexedDB translation cache (key, LRU, revision rule) + brief cache + cache stats in settings.
- M3-E3 Job persistence/resume (per S1) or panel-hosted engine wiring.
- M3-E4 Selection mode + extraction-failure hint.
- M3-E5 Per-block actions.
- M3-E6 Header controls incl. target-language switch; style mode switch.
- M3-E7 One-way scroll follow.
- M3-E8 Error UX for auth / rate limit / network / segment failure.
- M3-E9 Cost readout and running total.
- M3-E10 Privacy notice and denylist.
- M3-E11 Dogfood week and triage.

### M4 — Providers (size L)

**Goal.** Any endpoint speaking Anthropic Messages or OpenAI Chat works, local models work, and
switching models is a dropdown away.

**Scope.** §4.2.2–4.2.6, §4.3 in full (except import/export → M5). Modules: `llm/openai`,
`llm/probe`, `shell/providers`, options UI, onboarding.

**Deliverables.**
- `openai-chat` adapter on the `openai` SDK: `baseURL`, auth styles, `stream_options.include_usage`, `max_tokens` vs `max_completion_tokens` quirk, system-role folding, JSON mode flag.
- Quirk learning: on `bad_request` naming a parameter, flip the flag, retry once, persist on the connection.
- Data model + storage: `ProviderConnection`, `ModelProfile`, `Routing` in `chrome.storage.sync` with a schema version and migration from the M1 single-key settings; keys stay in `local`.
- Presets table from §4.3.2 (Anthropic, OpenAI, Gemini, OpenRouter, Ollama, LM Studio, Custom ×3, Chrome built-in placeholder).
- Add/edit connection flow: preset → fields → key → **Test connection** (requests optional host permission for the origin, probe, 1-token call, friendly result) → model discovery → save creates a profile and sets routing if first.
- Auto-detect for Custom (§4.2.5) and URL-mistake suggestions (double `/v1`, missing `/v1`, pasted `/chat/completions`).
- Routing resolution: site override → tab override → `routing.translate`; `analyze` defaults to `translate`.
- Fallback chain on `rate_limit`/`overloaded`/`network` after backoff; never on `auth`; "local only" site rules never fall back to cloud; per-block model badge.
- `context_length` → shrink `chunkTokens` and retry.
- Usage meter per profile (input/output/cached), daily and monthly estimated spend with `pricing`, optional monthly soft limit warning.
- Quick switcher in the panel header (tab-scoped, "Make default").
- Ollama / LM Studio: CORS guide with exact commands per OS, auto re-test, "model not pulled" detection with the `ollama pull` command, `maxConcurrency: 1` and smaller chunks in the preset.
- Onboarding (3 steps) with a sample-paragraph translation; Chrome built-in path shown only if S8 says it is viable, otherwise "coming soon".
- Removing a connection deletes its key and revokes its host permission.

**Exit criteria.**
- Harness and extension both translate the eval set through: Anthropic direct, OpenRouter (both protocols via auto-detect), Gemini via the OpenAI endpoint, Ollama (Qwen 7–8B), LM Studio.
- Demo: stop Ollama mid-page → blocks continue on the fallback with a badge; a bad Anthropic key stops with "Fix key" and sends nothing elsewhere.
- Test connection gives the right friendly message for: bad key, CORS/origin blocked, model not found, wrong base URL.

**Dependencies.** M1 `LLMClient` contract (adapter work can start as soon as M1-E6 lands); M3 header for the quick switcher. Runs in parallel with the end of M2 and with M3.

**Tasks.**
- M4-E1 `openai-chat` adapter + quirks + learning.
- M4-E2 Provider data model, sync storage, schema versioning, migration from M1 settings.
- M4-E3 Presets and the connection form (per-preset fields, advanced section).
- M4-E4 Optional host permission request/revoke flow.
- M4-E5 Probe/test connection + friendly error mapping (incl. S4 rule for Ollama 403).
- M4-E6 Auto-detect and URL-mistake fixer.
- M4-E7 Model discovery dropdown (Anthropic `/v1/models`, OpenAI `/models`), manual entry.
- M4-E8 Routing resolution, tab override, site overrides (storage only; UI in M5).
- M4-E9 Fallback chain, privacy rule, model badges, `context_length` shrink.
- M4-E10 Usage meter, pricing table, soft limit.
- M4-E11 Quick switcher.
- M4-E12 Ollama / LM Studio specifics and guides.
- M4-E13 Onboarding.

### M5 — Reading UX complete and robustness (size M)

**Goal.** The side-by-side experience is complete and the extension survives real sites: SPAs,
huge docs, tables, navigation within a site.

**Scope.** §3 (hover, bidirectional scroll sync, explain this), §4.1 MutationObserver/URL change,
§4.2.6 Chrome built-in, §4.3.7 import/export, §7 site rules, §9 edge cases.

**Deliverables.**
- Hover link both ways; bidirectional scroll sync with loop guard.
- SPA handling: MutationObserver + URL-change detection → re-extract; unchanged segments from cache; stable segment ids across re-extraction.
- Navigation within a site keeps translating when the site is allowlisted (optional host permission per S5). Otherwise, after a same-origin navigation, the panel shows the original text with a one-click "Translate this page" (the `activeTab` grant survives same-origin navigation). After a cross-origin navigation, it asks for `Alt+T`/the toolbar or "Always translate on this site", because a panel click cannot grant `activeTab`.
- Long documents: lazy mode above a segment-count threshold (viewport + ~2 screens ahead), with "Translate the rest" button.
- Tables: cell segments, rows kept in one chunk; captions and alt text behind a setting; code comments translation deferred to M8.
- Site rules UI: auto-translate allowlist, never-translate list, local-only, per-site model (storage from M4-E8).
- Chrome built-in: `chrome-builtin` adapter for Nano via `LanguageModel` (experimental, behind a flag) and a separate **MT port** for `Translator` used by the `basic` strategy (see §8 item 3); "basic translation" label; used as last fallback or by choice.
- "Explain this" per-block action (`explain@1` prompt via `translateSnippet`, output shown as a note).
- Import/export settings JSON (keys excluded unless confirmed).
- Keyboard: `Alt+T` opens the panel; toggles it closed on Chrome 141+ via `sidePanel.close` (decision S5, deviation (c)), panel-local shortcuts; basic a11y (focus order, ARIA on segments).

**Exit criteria.**
- Demo: browse three pages of a Docusaurus site with the panel open; each page translates without re-clicking (allowlisted); cached sidebar text costs nothing (visible in usage meter).
- A 100-screen page stays responsive; lazy mode translates ahead of the reader.
- Provider down → `basic` Chrome Translator fallback labeled as such.

**Dependencies.** M3 (observer infra), M4 (routing storage, fallback chain, permission flow).

**Tasks.**
- M5-E1 Hover link, bidirectional scroll sync.
- M5-E2 SPA re-extraction and id stability.
- M5-E3 Per-site host permission + re-injection on navigation; "Translate this page" fallback.
- M5-E4 Lazy mode for long docs.
- M5-E5 Tables, captions, alt text.
- M5-E6 Site rules UI.
- M5-E7 `chrome-builtin` adapter (Nano) + MT port (Translator) + `basic` strategy.
- M5-E8 Explain this.
- M5-E9 Import/export.
- M5-E10 Shortcuts and a11y.

### M6 — Release hardening → **v1.0** (size M)

**Goal.** Shippable on the Chrome Web Store, with a regression gate so prompt and strategy
changes cannot silently degrade quality.

**Deliverables.**
- Store listing, screenshots, privacy policy, permission justifications (`optional_host_permissions` wildcard needs a clear explanation), `minimum_chrome_version`.
- E2E tests (Playwright with the extension loaded) over the fixture pages against a mock provider; unit coverage targets for `engine/` and `llm/`.
- Eval regression gate in CI: judge scores on the eval set must not drop more than a set margin vs the stored baseline for the default prompt and strategy.
- Performance: extraction of large DOMs in idle callbacks; bundle size budget (from S7); memory check on 100-screen pages.
- Diagnostics: local, exportable log of the last N jobs (no telemetry); error boundary in the panel.
- Settings and cache schema versioning with migrations; `chrome.storage.sync` quota guard (glossary and site rules move to `local` with a sync "pointer" if over quota).
- UI localization scaffold (English plus the target language of the assumed user).
- Docs: README, Ollama/LM Studio setup, provider matrix, privacy page.
- Closed beta with a handful of users; fix list.

**Exit criteria.**
- v1.0 published (unlisted first, then listed).
- 20 fixture pages pass e2e; no console errors.
- Eval scores within margin of the M2 baseline; cost per long article measured and documented (target ≈ $0.04 on Haiku 4.5 per §6).

**Dependencies.** M3–M5.

**Tasks.** M6-E1 Store assets and policy; M6-E2 Playwright e2e; M6-E3 Eval regression gate;
M6-E4 Performance and bundle budget; M6-E5 Diagnostics log; M6-E6 Schema versioning and sync
quota; M6-E7 Localization scaffold; M6-E8 Docs; M6-E9 Beta and fixes.

### M7 — Stronger translation (size L, v1.1)

**Goal.** A "Best" mode that measurably beats `contextual`, delivered as revision 2 so reading
never waits; the translator learns from the user's edits.

**Deliverables.**
- `review` stage and `review@1` prompt (source + draft → targeted fixes), `refine` strategy = `contextual` draft → `review` → `check`; `revision: 2` events; "refined" marker in the panel; budget-aware skip.
- Quality modes Fast / Balanced / Best mapped to `single-pass` / `contextual` / `refine`; advanced setting exposes strategies; `review` role in routing UI.
- Inline editing of a translated block; (source, corrected target) stored in a local translation memory; `TranslationMemoryProvider` with lexical similarity retrieval (embeddings later).
- Harness: `refine` vs `contextual` on the eval set with cost ratio.

**Exit criteria.** `refine` improves fidelity or naturalness by a clear margin on the eval set at
≤ 2× cost; drafts still appear as fast as in Balanced mode; edits are reused on similar passages.

**Dependencies.** M2 (stages, providers), M4 (routing roles), M6 (regression gate).

**Tasks.** M7-E1 `review` stage/prompt; M7-E2 `refine` strategy and revisions UI; M7-E3 quality
modes and routing UI; M7-E4 block editing and translation memory store; M7-E5 TM provider;
M7-E6 eval comparison.

### M8 — Beyond v1 (unsized)

`agentic` strategy with read-only tools (web `define_term` must be allow-listed and must never
receive page text verbatim, see §8 item 14); Firefox build (`sidebar_action`, no built-in AI);
passphrase lock for keys; `SiteStyleProvider`, `DomainProvider`; `gemini-native` adapter; code
comment translation; PDF.

## 4. Critical path, parallel tracks, early risks

**Critical path.** M0-E1…E6 → S1 decision → M1-E1/E3/E6/E7 (engine core, parser, client,
Anthropic adapter) → M1-E8 (orchestration) → M2-E1/E2/E4 (brief, providers, check) → M3-E1/E2
(priority, cache) → dogfood → M4-E1/E2/E5 (second adapter, data model, test connection) →
M5-E3 (navigation/allowlist) → M6-E3 (regression gate) → v1.0.

**What can run in parallel.**
- Eval passage collection and rubric (M2-E8) from day one; it needs no code.
- `openai-chat` adapter (M4-E1) as soon as the `LLMClient` contract (M1-E6) is stable.
- Provider UI and data model (M4-E2/E3) while M2 is in progress.
- Extraction tuning on fixtures (S3 follow-ups) independently of the engine.
- Hover/scroll sync (M5-E1) once the observer infra (M3-E1) exists.
- Store assets and docs (M6-E1/E8) during M5.

**Risks that need the spikes.** S1 (worker lifetime) can change the shell architecture, so it
must be settled before M1-E8. S2 (parser) sets the repair policy that the check stage and cost
estimates rely on. S5 (navigation) decides whether docs-site reading is one click per site or one
click per page, which is the difference between MVP and annoyance for the main use case.

**Other risks.**
- Quality on small local models: `<seg>` compliance and glossary adherence drop sharply below ~7B. Mitigation: `single-pass` with smaller chunks for local presets, measured in M4 with the harness.
- `chrome.storage.sync` quota (100 KB total, 8 KB per item) with a growing glossary and site rules. Mitigation in M6-E6.
- Chrome Web Store review of wildcard optional host permissions. Mitigation: clear justification and request only on user action (already the design).
- Cost surprises with target languages that expand 1.5–2×. Mitigation: `maxOutputTokens` multiplier per language from S2, soft limit in M4-E10.

## 5. MVP and v1.0 cuts

**MVP = end of M3.** Anthropic only, one target language, `contextual` strategy, viewport-first
streaming, cache, selection mode, basic error handling, per-page cost. No provider UI, no hover,
no SPA handling, no Chrome built-in. This is the first point where daily reading is faster with
the extension than without it.

**v1.0 = M0–M6.** Everything in `DESIGN.md` except: `refine`/quality modes and translation memory
(M7), `agentic` (M8), Firefox (M8), passphrase lock (M8), code-comment translation (M8),
`gemini-native` (M8). Chrome built-in ships in v1.0 as a fallback and experimental option only
if S8 shows it is reliable; otherwise it moves to v1.1 and onboarding offers two paths.

## 6. Dependencies on the §0 assumptions

- If **Firefox** joins v1: add a Firefox CI target in M0, replace `chrome.sidePanel` with WXT's abstraction in M0-E2, drop the Chrome built-in path on Firefox, re-test S1 (Firefox event pages behave differently), and add ~M to M5.
- If the default becomes **local-first (Ollama)**: M4-E1 and M4-E12 move into M1, onboarding changes, and the eval baseline is measured on Qwen; expect the parser repair policy (S2) to matter much more.
- If **several target languages at once** are wanted: the panel needs a language tab strip, jobs become per (tab, language), and the cache already handles it; add ~S to M3.
- If **term gloss** defaults to "glossary terms only": only `translate@N` text and one setting change; no roadmap impact.

## 7. Suggested milestone-by-milestone eval checkpoints

| Milestone | What the harness must show |
|---|---|
| M1 | Segment loss 0 after repair on fixtures; cost per 3,000-word article recorded. |
| M2 | `contextual` ≥ `single-pass` on fidelity, tone, terminology; prompt A/B (`translate@1` vs `@2`). |
| M4 | Same eval through 5 providers; a provider matrix of quality and cost. |
| M6 | Regression gate green vs the M2 baseline. |
| M7 | `refine` vs `contextual` with cost ratio. |

## 8. Gaps and contradictions found in DESIGN.md

Ordered by how early they bite.

1. **Who chunks and who builds prompts.** §4 and §4.1 put the chunker, prompt builder and the viewport-priority queue in the service worker; §5.1 says the shell never builds prompts and §5.3 makes `chunk` a stage inside the strategy. **Resolution:** the engine owns chunking, prompt building and chunk ordering (it already receives `priority: string[]`); the shell owns per-tab job lifecycle and passes `maxConcurrency` and `chunkTokens` into the job (`TranslationJob.options` or `Budget`). Update the §4 diagram.

2. **MV3 suspension vs. an engine in the worker.** §4.1 relies on a Port keeping the worker alive during streams. An idle open Port does not reliably prevent termination, and reading a fetch body is not an extension event. Spike S1; the likely outcome is running the engine in the side panel page. The design should name the host of the engine explicitly either way.

3. **`chrome-builtin` cannot implement `ProtocolAdapter.stream(NormalizedRequest)`.** The Translator API takes no prompt, so §4.2.2's `chrome-builtin` column mixes two different things: Nano (`LanguageModel`, fits the contract) and Translator (does not). Also `Routing.fallback: [ollama, chrome-builtin]` is a list of *profiles*, but falling back to Translator requires switching *strategy* to `basic`. **Resolution:** a separate `MTClient` port (`translate(text, from, to)`) used only by the `basic` strategy; the fallback chain allows a terminal `basic` entry that switches strategy, not just model.

4. **Prompt caching will not engage on the default model.** Haiku 4.5's minimum cacheable prefix is 4096 tokens; the system block is ~1k tokens. §5.7 calls this "harmless", which is true for cost (the §6 estimate uses uncached prices), but §4.2.5's rule "prefer `anthropic-messages` for `claude-*` so prompt caching works fully" buys nothing on Haiku. Keep the rule for larger models; do not pad.

5. **Ollama's 403 is misclassified.** Ollama rejects disallowed `Origin` with 403; §4.3.5 maps 401/403 to *auth* → "Fix key", which is wrong for a connection with auth `none`. Add the classifier rule from S4 and show the CORS guide instead.

6. **`activeTab` does not survive navigation, and `sidePanel.open()` needs a user gesture.** §4.1 injects only under `activeTab`; §3 and §8 describe following links on docs sites and auto-open on allowlisted sites. After navigation the content script is gone and the grant is revoked; auto-open without a gesture is not possible. **Resolution:** allowlisting a site requests an optional host permission for it (re-injection then works on every navigation); "auto-open" becomes "auto-translate when the panel is already open". Spike S5.

7. **Step 0 (language detection) uses a `chrome.*` API inside the engine pipeline.** §5.7 lists `LanguageDetector` as the first step of the `contextual` strategy, but §5.1 forbids `chrome.*` in `engine/`. **Resolution:** detection is a shell port; the job carries `sourceLang` (and optional per-segment langs). A fallback chain is also missing for Chrome < 138 or unsupported hardware: `<html lang>` → model-side detection in the brief.

8. **Default behavior for long pages is contradictory.** §3 says "then the rest of the page in reading order"; §9 says very long docs are translated lazily (viewport + ~2 screens). Needs a threshold (segments or tokens) and a "Translate the rest" control. Planned in M5-E4.

9. **Role naming drift.** §4.3 intro says tasks are "brief, translate, fallback"; §4.3.1 and §5.1 use `analyze`, `translate`, `review`. Pick `analyze/translate/review`; the UI label can say "Document brief". The §4.3.3 mock also lacks a `review` row; add it when `refine` ships (M7).

10. **Brief cache key lacks the target language.** §7 keys the brief by `url + contentHash`, but the brief's glossary renderings are target-language specific. Add `targetLang` (and the `analyze` prompt version).

11. **Translation cache key omits the brief deliberately, which should be stated.** A segment cached from one document is reused in another even though the second document's brief differs. This is the right trade-off for boilerplate, but the design should say so, and "retranslate" must bypass the cache.

12. **Tables need a grouping field.** §9 wants rows kept in one chunk; `Segment` in §4.1 has no `groupId`/parent, so the chunker cannot honor it. Add `groupId`.

13. **`EngineEvent.usage` drops `cachedInput`.** `NormalizedEvent.usage` has it; the engine event does not, so the usage meter cannot show cache savings. Add it.

14. **Security claim vs. future tools.** §8 says "the model has no tools, so the worst a hostile page can do is cause a bad translation"; §5.3's `agentic` adds a web `define_term` tool, which a hostile page could steer into exfiltrating text via URLs. Constrain it (fixed dictionary endpoints, query = a single term, never raw page text) and keep the §8 claim scoped to non-agentic strategies.

15. **Double retries.** Both SDKs retry by default (2 attempts on 429/5xx) and §4.3.5 adds its own backoff and fallback. Decide one owner (spike S7); otherwise a rate limit costs 6–9 attempts before fallback.

16. **`jsonMode` is best-effort.** The brief relies on JSON; not every endpoint supports a JSON mode, and the Anthropic path has no `response_format`. The brief parser must accept fenced or prose-wrapped JSON and fall back to "no brief" rather than failing the job.

17. **Sync storage quota.** §4.3.1 and §7 put connections, profiles, routing, glossary and site rules in `chrome.storage.sync` (100 KB total, 8 KB per item). A few hundred glossary entries can exceed it. Plan: `local` with an optional sync mirror, or chunked items (M6-E6).

18. **Minimum Chrome version is unspecified.** Side panel needs 114, per-tab close 141, built-in AI 138. Pick one (138 suggested) and gate features by availability checks rather than version.

19. **Store review of `optional_host_permissions`.** Arbitrary custom endpoints need `https://*/*` plus `http://localhost/*` and `http://127.0.0.1/*` (and `http://*/*` for LAN gateways). This is reviewable but needs a justification; the design should mention it under §8.

20. **`Alt+T` on macOS** types a dagger in some layouts and may collide with other extensions. Keep as default but make it clearly rebindable (Chrome's shortcuts page) and mention it in onboarding.
