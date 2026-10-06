# M1 — Translate end to end

Size: L · Depends on: M0 · Unblocks: M2, M4 (adapter work can start once M1-E6 lands)

## 1. Goal

**Prove a page can be translated and streamed into the panel by an engine that runs unchanged
in Node.**

This is the first time real translations appear, but quality is not the point yet. The point is
the shape: the `engine/` boundary, the `LLMClient` contract, the `<seg>` streaming parser and
the Node harness. Every later milestone adds to these pieces. If the engine can't run in Node,
there's no way to measure quality in M2. If the parser loses segments, nothing built on top can
be trusted.

## 2. Done looks like

- With an Anthropic key in settings, opening the panel on a 3,000-word article streams a
  translation in: the first segment appears within about 2 seconds, and each segment fills in
  live and then settles.
- A cancel button stops the job. Closing the panel or navigating also cancels it.
- A cost readout shows what the page cost.
- `npm run eval` (or similar) runs the same engine in Node over 5 fixture documents and writes
  outputs, token usage, wall time and cost per document to a results folder.

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | Time to first visible segment, 3,000-word article | ~2 s |
| 2 | Whole page, 2 chunks in flight | < ~30 s |
| 3 | Segment loss after repair on the fixtures | 0 |
| 4 | Parser golden and fuzz tests (missing, merged, reordered, unclosed, literal `<`, `max_tokens` cut) | pass |
| 5 | Harness runs the engine on 5 fixture docs and reports cost per doc | yes |
| 6 | `engine/` builds and runs with no `chrome`, DOM or vendor SDK imports | lint + Node run |
| 7 | Rate limit is retried by exactly one owner (no SDK + pipeline double retry) | verified in a test |

## 4. Out of scope

- Document brief, glossary, context tail, style modes (M2).
- Cache, viewport priority, selection mode, error UX beyond basic status (M3).
- Any provider besides `anthropic-messages`; provider UI (M4).

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| Who chunks and builds prompts | ROADMAP §8 item 1 | The **engine** owns chunking, prompt building and chunk ordering. The shell owns job lifecycle and passes `maxConcurrency` and `chunkTokens` in the job options. |
| Retry owner | S7, §8 item 15 | SDK `maxRetries: 0`; the pipeline owns backoff, retry and (later) fallback. |
| Token estimate | M1-E2 | chars / 3.5 for Latin scripts; tune with harness data. |
| `maxOutputTokens` | S2 | 2.0 × est. source tokens + 12 × segments + `reasoning.reserveTokens`, no per-language multiplier (DESIGN §5.7). |
| Prompt caching on Haiku | S6, §8 item 4 | Keep `cache_control` on the system block (it helps larger models). Don't pad the prefix. Accept no caching on Haiku. |
| `EngineEvent.usage` shape | §8 item 13 | Include `cachedInput` from the start. |

## 6. Work plan

Build from the contracts outward, and get the Node harness working **before** the panel UI, so
the engine is validated without the browser.

**Sub-goal A — stable contracts**
- M1-E1 Engine core types: `TranslationEngine`, `TranslationJob`, `EngineEvent`, `Strategy`,
  `Stage`, `StageContext`, `WorkingMemory`, `PromptRegistry`, `Budget`; ordered-stage runner
  with event multiplexing.
- M1-E6 `LLMClient`, `NormalizedRequest/Event`, `LLMError` classifier, retry/backoff policy.
  Freeze this early: M4 builds the second adapter against it.

**Sub-goal B — correct output, even when the model misbehaves**
- M1-E3 `<seg>` streaming parser and repair (missing, merged, unclosed, `max_tokens` cut);
  emits `segment.partial` and `segment.final`.
- M1-E2 Chunker: 800–1,500 source tokens, cut at headings, never split a paragraph, keep a
  `groupId` together.
- M1-E12 Parser golden + fuzz tests, chunker and classifier tests, written alongside.

**Sub-goal C — a real model call**
- M1-E7 `anthropic-messages` adapter on `@anthropic-ai/sdk`: `baseURL`, `x-api-key`,
  streaming, usage, `cache_control`, abort, `probe`, `listModels`.
- M1-E4 Prompt registry and `translate@1` (brief and glossary slots empty); prompt version
  plumbed for the M3 cache key.
- M1-E5 `single-pass` strategy = translate(chunk) + check (count only).

**Sub-goal D — measurable outside the browser**
- M1-E11 Node harness v0 and a fixture capture script (export `Segment[]` from the debug view).

**Sub-goal E — in the browser**
- M1-E8 Job orchestration per the M0 engine-host decision: one job per tab, 2 chunks in flight,
  cancel on close/navigation; role → profile stub (`translate` only).
- M1-E9 Options v0: masked API key in `chrome.storage.local` under `secret:<connectionId>`,
  target language, source-language override.
- M1-E10 Panel streaming render, per-segment status, cancel, cost readout.

## 7. Demo script

1. Enter an Anthropic key and target language in options.
2. Open a 3,000-word article, press `Alt+T`. Time the first segment; watch segments stream.
3. Press cancel halfway; confirm requests stop (network panel) and translated segments stay.
4. Re-run to completion; read the cost readout.
5. In a terminal, run the harness on 5 fixtures; show the results folder and per-doc cost.
6. Run the parser fuzz suite.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Model breaks the `<seg>` format more than S2 predicted | Repair policy plus single-segment re-request; fuzz corpus grows from real failures. |
| SDK bundle size or browser quirks | S7 measured it; keep adapters behind `LLMClient` so the SDK can be swapped for `fetch` if needed. |
| Engine host wiring gets complicated (if worker-hosted) | Prefer the panel host from S1; worker coordinates only. |

## 9. Handoff to M2

- A working `single-pass` baseline and harness numbers, which are M2's comparison point.
- Stable `Stage`/`Strategy` interfaces for adding `analyze` and the context providers.
- `translate@1` as the prompt to improve on.
- The frozen `LLMClient` contract, so M4 can start in parallel.
