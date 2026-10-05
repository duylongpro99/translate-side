# M4 — Providers

Size: L · Depends on: M1 `LLMClient` contract (M1-E6), M3 header (quick switcher) · Runs in
parallel with the end of M2 and with M3 · Unblocks: M5 (routing storage, fallback, permission
flow), M7 (routing roles)

## 1. Goal

**Let the user translate with any endpoint that speaks Anthropic Messages or OpenAI Chat,
including local models, and make switching models a dropdown away without ever sending content
somewhere the user didn't choose.**

The design principle (DESIGN §4.2) is "protocols, not vendors". M1 proved one protocol. M4 makes
the provider layer general: a second adapter, a data model for connections, profiles and
routing, a test-connection flow that turns cryptic failures into friendly fixes, and a fallback
chain that respects privacy. This is what makes the extension usable for people who can't or
won't use an Anthropic key: company gateways, OpenRouter, Gemini, Ollama, LM Studio.

## 2. Done looks like

- Settings ▸ Providers lists connections, models and routing (DESIGN §4.3.3 mock).
- Adding a connection: pick a preset → enter a key → **Test connection** (asks for host
  permission for that origin only) → pick a model from a discovered list → save. The first one
  becomes the translate route.
- A Custom connection on Auto-detect finds which protocols a gateway speaks and fixes common URL
  mistakes (double `/v1`, missing `/v1`, pasted `/chat/completions`).
- Ollama with CORS blocked shows a "CORS blocked" status and a **Fix…** guide with the exact
  command for each OS, not "Fix key". A missing model shows the `ollama pull` command.
- The panel header has a quick switcher for this tab, with "Make default".
- If the primary provider is rate-limited or down, blocks continue on the fallback with a small
  model badge. A bad key stops and never falls back.
- Settings shows usage per profile and estimated daily/monthly spend, with an optional soft limit.
- A 3-step onboarding with a sample-paragraph translation.

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | Harness and extension translate the eval set through: Anthropic direct, OpenRouter (both protocols via auto-detect), Gemini via OpenAI endpoint, Ollama (Qwen 7–8B), LM Studio | 5 of 5 |
| 2 | Provider matrix (quality and cost per provider) recorded from the harness | yes |
| 3 | Stop Ollama mid-page → blocks continue on fallback with a badge | yes |
| 4 | Bad Anthropic key → "Fix key", nothing sent to any other provider | yes |
| 5 | Test connection message correct for: bad key, CORS/origin blocked, model not found, wrong base URL | 4 of 4 |
| 6 | "Local only" site rule never falls back to a cloud profile | test passes |
| 7 | M1 single-key settings migrate to the new data model with no re-entry | yes |
| 8 | Removing a connection deletes its key and revokes its host permission | yes |

## 4. Out of scope

- `chrome-builtin` adapter and the `basic` strategy (M5-E7). Onboarding shows the Chrome
  built-in path only if S8 said it's viable, otherwise "coming soon".
- Site rules UI (storage only here; UI in M5-E6).
- Import/export (M5-E9).
- `gemini-native` adapter (M8). Passphrase lock (M8).
- `review` role in routing UI (M7).

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| Ollama 403 | S4, ROADMAP §8 item 5 | `403` + auth `none` + localhost → `cors`; show the guide. |
| Retry vs fallback ownership | §8 item 15 | SDK retries off; pipeline backoff → next fallback profile on `rate_limit`/`overloaded`/`network`; never on `auth`. |
| Fallback to Chrome Translator | §8 item 3 | Not here. In M5, the chain allows a terminal `basic` entry that switches strategy. |
| Dual-protocol gateway default | DESIGN §4.2.5, §8 item 4 | `claude-*` → `anthropic-messages`, else `openai-chat`; show the choice with a switch. Note: no caching benefit on Haiku. |
| Role naming | §8 item 9 | `analyze` / `translate` / `review`; UI label "Document brief". |
| Settings schema | M4-E2 | Versioned schema in `chrome.storage.sync` with a migration from M1 keys; secrets stay in `local`. |
| Local model chunking | ROADMAP §4 risks | Local presets: `maxConcurrency: 1`, smaller `chunkTokens`; consider `single-pass` for < 7B, decided from harness data. |

## 6. Work plan

Start the adapter as soon as M1-E6 is stable; the data model and UI can be built while M2 and
M3 continue.

**Sub-goal A — a second protocol**
- M4-E1 `openai-chat` adapter on the `openai` SDK: `baseURL`, auth styles,
  `stream_options.include_usage`, `max_tokens` vs `max_completion_tokens`, system-role folding,
  JSON mode flag; quirk learning (flip, retry once, persist).

**Sub-goal B — a model of connections, profiles and routing**
- M4-E2 `ProviderConnection`, `ModelProfile`, `Routing` in sync storage; schema version and
  migration.
- M4-E8 Routing resolution: site override → tab override → `routing.translate`; `analyze`
  defaults to `translate`.

**Sub-goal C — setup that explains its own failures**
- M4-E3 Presets (DESIGN §4.3.2) and the connection form (per-preset fields, advanced section).
- M4-E4 Optional host permission request/revoke.
- M4-E5 Probe / test connection with friendly error mapping (incl. the S4 rule).
- M4-E6 Auto-detect and URL-mistake fixer.
- M4-E7 Model discovery dropdown with manual entry.
- M4-E12 Ollama / LM Studio specifics: CORS guides, auto re-test, "model not pulled".

**Sub-goal D — resilient and private at runtime**
- M4-E9 Fallback chain, local-only privacy rule, per-block model badges, `context_length`
  shrink-and-retry.
- M4-E10 Usage meter (input/output/cached), pricing table, monthly soft limit.

**Sub-goal E — switching is easy**
- M4-E11 Quick switcher in the panel header (tab-scoped, "Make default").
- M4-E13 Onboarding: language → how to translate → test with a sample paragraph.

**Sub-goal F — know how each provider performs**
- Run the eval set through all five providers; publish the provider matrix (ROADMAP §7).

## 7. Demo script

1. Fresh profile: walk through onboarding with an Anthropic key; translate the sample.
2. Add OpenRouter as Custom → Auto-detect; show both protocols detected and the chosen one.
3. Paste `https://openrouter.ai/api/v1/chat/completions` as base URL; show the suggested fix.
4. Add Ollama without `OLLAMA_ORIGINS`: "CORS blocked" + Fix guide. Apply; test re-runs green.
5. Set Ollama as primary, Anthropic as fallback. Translate a page; stop Ollama midway; badges
   switch to Haiku.
6. Add a local-only site rule; repeat with Ollama stopped: no cloud fallback, clear error.
7. Use a bad Anthropic key: "Fix key", no other provider called.
8. Use the quick switcher to retranslate one page with a different model; "Make default".
9. Show the provider matrix and the usage meter.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Small local models break `<seg>` and ignore the glossary | Smaller chunks, `single-pass` for local presets, measured in the harness; documented in the provider matrix. |
| "Compatible" APIs differ in ways quirks don't cover | Quirk flags + learning; Advanced section exposes toggles; add presets as found. |
| Wildcard optional host permissions look alarming | Request only on user action, per origin; justification prepared for M6 store review (§8 item 19). |
| Sync quota with many profiles and rules | Keep items small; full plan in M6-E6. |

## 9. Handoff to M5 and M7

- Routing storage with site overrides (M5-E6 builds the UI).
- Fallback chain ready to accept a terminal `basic` entry (M5-E7).
- Permission request/revoke flow reused for per-site allowlisting (M5-E3).
- Routing roles that M7 extends with `review`.
