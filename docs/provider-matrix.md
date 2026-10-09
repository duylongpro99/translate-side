# Provider matrix (M4-F)

Quality, cost and speed of each provider on the same 23-passage eval set (149 translatable segments, English → Vietnamese, `single-pass` / `translate@1`, natural style), run with the Node harness (`pnpm run eval -- --set eval --provider …`) and scored by the pinned judge (`ds/deepseek-v4-pro`, judge@1). ROADMAP §7 lists "provider matrix" under M5 docs and the M4 row asks for "a provider matrix of quality and cost"; this page is where it lives (docs/provider-matrix.md), and M5's docs page can link or copy it.

Run on 2026-10-09. Harness runs are kept in `eval/runs/m4f-*` (summary, judge scores, outputs); the full comparison table is `docs/provider-matrix/eval-report.md`; extension runs and screenshots are in `docs/provider-matrix/`.

## Scope: what changed from plan §3 #1 (decision G5)

Plan §3 #1 names five providers: Anthropic direct, OpenRouter (both protocols), Gemini, Ollama (Qwen 7–8B) and LM Studio. By the user's decision G5 (2026-10-09) local Ollama and LM Studio are replaced by **Ollama cloud**, because no local model is available. Anthropic and OpenRouter need `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`, which were not in `.env`: those rows are **not run — no key** and are to be run when keys exist (commands below). APIBOX (`AIBOX_API_KEY`), the app's default provider, is an extra row.

Ollama cloud hosts no Qwen model. Its list on 2026-10-09: `kimi-k2.7-code`, `minimax-m3`, `kimi-k3`, `mistral-large-4`, `nemotron-3-super`, `nemotron-3-ultra`, `glm-5.3-flash`, `kimi-k2.6`, `nemotron-3-nano:30b`, `gpt-oss:20b`, `glm-5.3`, `gemma4:31b`, `gpt-oss:120b`, `mistral-large-3:675b`, `deepseek-v4-pro:0813`, `deepseek-v4.1-flash`, `minimax-m2.7`, `glm-5.2`. Run: **`gemma4:31b`** (a multilingual model, the closest to "Qwen-class, small") and **`gpt-oss:20b`** (the smallest model offered; the only data on small-model behaviour).

## The matrix

Judge scores are 1–5 means over 23 passages (fidelity / naturalness / tone / terminology, "overall" is their mean). No human scores exist for these runs, so the judge-versus-human check is not available here; the judge is the same one used for every earlier baseline, so the rows are comparable with each other and with `eval/runs/baseline-*`.

| Provider · model (protocol) | Harness result | Judge overall | Fidelity · natural. · tone · term. | Cost, eval set | Median call · whole set | Extension: goblog-pipelines (73 blocks) |
|---|---|---|---|---|---|---|
| Gemini · `gemini-3.5-flash-lite` (OpenAI endpoint) | lost 0/149, 1 repaired, 0 failing finals, code 25/25 | **4.24** | 4.17 · 3.78 · 4.57 · 4.43 | **$0.0318** (verified price $0.30 / $2.50 per M) | 3.5 s · 107 s¹ | 73/73, 21.6 s, $0.0179 |
| APIBOX · `qwen3.8-flash` (OpenAI chat; the app default) | lost 0/149, 0 repaired, code 25/25 | **4.49** | 4.39 · 3.96 · 4.78 · 4.83 | **$0.0015** (nominal USD, price unverified) | 7.5 s · 173 s | 73/73, 73.6 s, $0.0013 |
| Ollama cloud · `gemma4:31b` (OpenAI chat) | lost 0/149, 0 repaired, code 25/25 | **4.46** | 4.04 · 4.39 · 4.65 · 4.74 | n/a: Ollama cloud bills a plan, not tokens | 13.5 s · 320 s | 73/73, 23.3 s, no cost shown |
| Ollama cloud · `gpt-oss:20b`, default quirks | **lost 127/149** (every call stopped at `max_tokens`) | not scored | – | n/a | 11.1 s · – | **10/73, 63 failed** |
| Ollama cloud · `gpt-oss:20b`, `reasoning: effort low, reserve 6000` | lost 0/149, 0 repaired, code 25/25 | **3.48** | 3.43 · 3.17 · 3.78 · 3.52 | n/a | 5.8 s · 136 s | 72/73, 1 failed |
| Anthropic · direct (`anthropic-messages`) | **not run — no key** | – | – | – | – | **not run — no key** |
| OpenRouter · OpenAI protocol (auto-detect) | **not run — no key** | – | – | – | – | **not run — no key** |
| OpenRouter · Anthropic protocol (auto-detect) | **not run — no key** | – | – | – | – | **not run — no key** |

¹ The Gemini run used `--pause 4000` between passages for the free tier's rate limit, so its wall time includes 22 × 4 s of waiting; calls, not the pause, set the median.

By category (judge overall): docs · humor · opinion · tech-blog — Gemini 4.41 · 3.88 · 4.31 · 4.35; APIBOX 4.53 · 4.29 · 4.44 · 4.70; gemma4:31b 4.66 · 4.17 · 4.38 · 4.55; gpt-oss:20b (low) 3.78 · 2.67 · 3.81 · 3.70.

Tokens for the eval set (the same ≈18 k in / ≈10 k out for every model; the tokenizers differ slightly): Gemini 18,521 / 10,517; APIBOX 17,980 / 9,638; gemma4:31b 18,018 / 10,187; gpt-oss:20b 18,605 / 10,407. Ollama cloud's prompt cache works (about 55 % of gemma's and gpt-oss's input tokens came back as cached); APIBOX reported none on the harness run and 4,096 on the extension page; Gemini reported none.

### Extension side (§3 #1: "harness and extension")

`scripts/eval/ext-run.mjs` loads the built extension (`.output/chrome-mv3`) in Chrome for Testing 1243 with Playwright, serves `fixtures/sites/goblog-pipelines.html` from 127.0.0.1, seeds one provider (connection, profile, routing, key; the privacy notice acknowledged), opens the panel, and waits for the job to end. Each run ends in a screenshot of the panel; the job bar's text, cost and count of failed blocks are in the `.json` beside it.

| Run | Result | Screenshot | Data |
|---|---|---|---|
| Gemini | 73 of 73 · 21.6 s · $0.0179 | `docs/provider-matrix/gemini.png` | `gemini.json` |
| APIBOX | 73 of 73 · 73.6 s · $0.0013 | `apibox.png` | `apibox.json` |
| Ollama cloud `gemma4:31b` | 73 of 73 · 23.3 s | `ollama-cloud-gemma4-31b.png` | `ollama-cloud-gemma4-31b.json` |
| Ollama cloud `gpt-oss:20b`, default | **10 of 73 · 63 failed** · 215 s | `ollama-cloud-gpt-oss-default.png` | `…-default.json` |
| Ollama cloud `gpt-oss:20b`, reasoning low | 72 of 73 · 1 failed · 79.9 s | `ollama-cloud-gpt-oss-reasoning-low.png` | `…-reasoning-low.json` |

Method limits, stated plainly: a headless run cannot press the toolbar icon or answer Chrome's permission prompt, so the driver (a) adds `host_permissions` for 127.0.0.1 and the provider's origin to a temporary copy of the manifest, and (b) does what the worker's action handler does (inject `content-scripts/content.js`, write the tab's `access:<id>` record) instead of clicking. The panel, the job engine, the provider client and the storage reads are the real built code. The permission prompt itself and the real Alt+T gesture remain covered by unit tests and by a human check.

## What each provider showed

- **Gemini via its OpenAI endpoint.** Works with no quirks. Fastest median call (3.5 s). Judge 4.24, the lowest of the three working models, mostly naturalness (3.78) and humor (3.88). One segment needed the re-request (a `script` check) and was repaired. By far the most expensive of the three that report a cost (≈ 21× APIBOX on the same set).
- **APIBOX `qwen3.8-flash`.** Highest judge score (4.49), cheapest (nominal $0.0015 per set; the gateway's USD prices are unverified), slowest cloud call after Ollama's 31 B model (7.5 s median) because the app's thinking policy (chunk 1 off, later chunks `minimal`) is applied. The extension run took 73.6 s for the page against Gemini's 21.6 s; the page is the same, so this is the gateway's latency, not the page.
- **Ollama cloud `gemma4:31b`.** No quirks needed, 0 lost, 0 repaired, judge 4.46 (best naturalness, 4.39; best docs, 4.66). Slowest per call (13.5 s median, 25 s max) but the preset's `maxConcurrency: 4` makes the page itself as fast as Gemini (23.3 s). No cost figure: the plan is a subscription, so the panel shows no cost (the Usage and cost section would count tokens only).
- **Ollama cloud `gpt-oss:20b` — the small-model finding (plan §8 risk).** With the preset's default quirks (`{}`, no reasoning policy) the model is unusable: it thinks before it answers, the thinking is not reported in `usage` (reasoning tokens 0) and counts against the output cap the engine sets (≈ 660 tokens for a chunk), so every one of the 46 calls ended with `stop: max_tokens`; many answers were empty or cut mid-segment, 127 of 149 segments were lost in the harness and 63 of 73 blocks failed in the panel. With a profile quirk `reasoning: { control: 'effort', lowest: 'low', reserveTokens: 6000 }` (the same mechanism as APIBOX's Qwen policy, S2) the run recovers to 0 lost (harness) and 72 of 73 (panel; one block failed and is retryable). Even then quality is well below the others (judge 3.48; humor 2.67; the model translates literally and misses idiom), so a 20 B reasoning model is a poor default for translation. No model in the 7–8 B class could be tested, so the plan's "consider single-pass for < 7B" question (below) stays open.

## Decisions and open items

1. **G5 applied.** Ollama cloud stands in for local Ollama and LM Studio; the two local presets are unchanged and untested against a real server in this phase.
2. **Local chunking (plan §5, "decided from harness data").** *Open.* There is no local model to measure, so the local presets keep `maxConcurrency: 1` and their smaller `chunkTokens`, and `single-pass` stays the strategy at every size. The only small-model data is `gpt-oss:20b` above; it says a small reasoning model needs a reasoning policy before chunk size matters. Decide when a 7–8 B local model can be run (Ollama or LM Studio on a machine that has one).
3. **No product code changed.** The one genuine provider failure (`gpt-oss:20b` with default quirks) is a missing per-model reasoning policy on an unlisted model, not a wrong preset: `ollama-cloud` has no default model, and the working default (`gemma4:31b`) needs none. Not fixed here because a general fix (detecting a reasoning model that fills the output cap and retrying with a reasoning reserve) is a new feature. Reported to the supervisor as an open question: either leave it (the user picks a model in Settings; a failing model shows 'Retry failed' blocks), or give the `ollama-cloud` preset a `defaultModel` of `gemma4:31b`, or add a learned quirk for a `max_tokens` stop with empty text.
4. **Harness change.** `scripts/eval/run.ts` gained the `ollama-cloud` (default model `gemma4:31b`) and `openrouter` (default model `anthropic/claude-haiku-4.5`, OpenAI protocol) provider entries. `scripts/eval/ext-run.mjs` is new.
5. **Rows waiting on keys.** With the key in `.env` (names only): `ANTHROPIC_API_KEY` → `pnpm run eval -- --set eval --provider anthropic` and `node scripts/eval/ext-run.mjs anthropic`; `OPENROUTER_API_KEY` → `… --provider openrouter` for the OpenAI protocol and the same with `--model anthropic/claude-haiku-4.5` through the Anthropic protocol of OpenRouter (the harness has no Anthropic-protocol OpenRouter entry; add one with `protocol: 'anthropic-messages'`, base URL `https://openrouter.ai/api`, when the key exists, and let the extension's auto-detect pick it). Then `pnpm run eval:judge -- <run>` and `pnpm run eval:report`. Update this table; the auto-detect part of §3 #1 is unproven until then.
6. **Judge calibration.** None of these runs has a human sheet, so the "judge vs human" check is absent; differences under about 0.25 between the top rows (APIBOX 4.49, gemma 4.46) are inside the judge's own noise and should not be read as a ranking.
