---
title: "Phase 1: Gemini-native adapter"
status: todo
priority: P3
effort: "1.5d"
dependencies: []
tier: free
---

# Phase 1: Gemini-native adapter

## Goal

Gemini features that the OpenAI-compatible endpoint does not expose (thinking budgets, cached-token and thinking-token
usage, JSON schema output), through a new `ProtocolAdapter` behind `LLMClient` and a new preset (M9 §2.5). Free.

## Context links

- Spec: `docs/plans/M9-beyond-v1.md` §2.5; DESIGN §4.2 (protocols, not vendors).
- Scout: `plans/reports/scout-261013-1036-m8-track-surfaces.md` §5.
- Contract: `src/llm/types.ts:1-12` (additive only, adapters never retry, one `error` event), `:17` (`Protocol`),
  `:208-213` (`ProtocolAdapter`).

## Requirements

- A new protocol id `gemini-generate` (name decided here; the union is `src/llm/types.ts:17`).
- Streaming via `streamGenerateContent?alt=sse` on `https://generativelanguage.googleapis.com/v1beta`, with the key in
  `x-goog-api-key` (auth style `custom-header`). [UNVERIFIED: endpoint shape, checked in step 1.]
- Maps `system` → `systemInstruction`, `messages` → `contents` (`assistant` → `model`), `maxOutputTokens`,
  `temperature`, `jsonMode` → `responseMimeType: application/json`, `Quirks.reasoning` → `thinkingConfig`.
- Usage: `promptTokenCount` → `input`, `candidatesTokenCount + thoughtsTokenCount` → `output`,
  `cachedContentTokenCount` → `cachedInput`, `thoughtsTokenCount` → `reasoningOutput` (the contract at
  `src/llm/types.ts:114-125`). Thinking is never emitted as text.
- `listModels` and `probe` work, so "Test connection" works.
- No SDK: plain `fetch` with the existing guard (`watchedFetch`, `idleGuard`, `src/llm/sdk.ts:120, 158`) and error
  mapping (`classifyHttpError`, `classifyFetchError`, `classifyStreamError`, `src/llm/errors.ts:92, 193, 169`).
- The existing `gemini` preset (OpenAI endpoint, `src/shared/presets.ts:80-91`) and every stored Gemini connection
  stay as they are. No migration.

## Architecture

```
route.ts → resolveConnection (protocol gemini-generate) → createAdapter (client.ts:62)
         → lazy loader 'gemini-generate' → src/llm/gemini.ts (fetch + SSE parse) → NormalizedEvent stream
```

Data in: `ResolvedConnection` and `NormalizedRequest`. Transform: one JSON body per request, SSE frames parsed into
`text` deltas, a final `usage`, then `done` or `error`. Data out: `NormalizedEvent`s, same order rules as the other
adapters. The adapter loads lazily like the other two (`src/llm/client.ts:14-17`), so it is its own chunk.

## Related files

- **Create:** `src/llm/gemini.ts`, `src/llm/gemini.test.ts`.
- **Modify:** `src/llm/types.ts` (`Protocol`), `src/llm/client.ts` (loader map), `src/llm/presets.ts` (native base
  URL constant), `src/shared/presets.ts` (`PresetId`, a `gemini-native` preset, `protocolLabel` at `:272`),
  `src/shared/providers.ts` (`PROTOCOLS` at `:149`), `src/shared/connect.ts` (only if step 1 shows auto-detect must
  know the protocol), `scripts/eval/providers.ts` (a `gemini-native` harness provider), `src/locales/en.yml`,
  `src/locales/vi.yml`, `scripts/bundle-budget.json`, `docs/provider-matrix.md`, `.github/workflows/ci.yml` (add `m9`
  to the push branches at `:5`).

## Steps

1. Write the one-page track plan `docs/plans/M9-gemini-native.md` (M9 §3) from this file. Confirm the native REST
   shape (stream path, SSE framing, usage field names, error body, `models` listing, thinking config) against
   current Gemini API docs and record the field mapping in it.
2. Add `'gemini-generate'` to `Protocol` and to `PROTOCOLS` (`src/shared/providers.ts:149`). Check every
   `Record<Protocol…>` and `switch` over `Protocol` with `pnpm run typecheck`, and list each site the compiler flags.
3. Write `src/llm/gemini.ts` exporting `createGeminiAdapter(options)`: request builder, SSE reader, usage mapping,
   error mapping through `src/llm/errors.ts`, `preflight` (`sdk.ts:54`), the idle guard, and the existing quirk flip
   for `temperature` (`FLIP_TEMPERATURE`, `sdk.ts:47`). No retries.
4. Register the lazy loader in `src/llm/client.ts:14-17`.
5. Add the `gemini-native` preset: base URL, `custom-header` `x-goog-api-key`, default model the same as the existing
   Gemini preset, `modelIdPrefix: 'models/'`. Host pattern is `GEMINI_ORIGIN` (`src/shared/settings.ts:84`), so no new
   permission. Add its picker entry and en/vi strings.
6. Decide auto-detect: the native protocol is reachable only through its preset (auto-detect keeps probing the two
   existing protocols), unless step 1 shows otherwise. Record the decision.
7. Add `gemini-native` to `scripts/eval/providers.ts`, reading `GEMINI_API_KEY` from `.env` like the `gemini`
   provider.
8. Unit tests with a fake `fetch`: text deltas across frame splits, usage mapping, thinking tokens not shown as text,
   JSON mode, a 400 naming `temperature` flips once, 401/429/5xx/network/idle-timeout kinds, abort mid-stream, the
   model-id prefix.
9. Run the paired provider-matrix runs ("Verification") and add a `gemini-native` row to `docs/provider-matrix.md`.
<!-- Red Team: budget update rewrites every entry -->
10. Bundle budget: `--update` rewrites every entry and the total, so do not use it. Run `pnpm run build &&
    pnpm run check:bundle`, take the measured gzip size of the new `chunks/gemini.js` from its "not in the budget"
    message, and hand-edit `scripts/bundle-budget.json`: add that one line at the measured size plus 10%, raise
    `total` by the same amount, and append the reason and date to `note`. No other line changes.

## Todo

- [ ] One-page track plan with the confirmed field mapping
- [ ] `gemini-generate` in `Protocol` and `PROTOCOLS`, all compiler-flagged sites handled
- [ ] `src/llm/gemini.ts` with stream, listModels, probe
- [ ] Lazy loader registered
- [ ] `gemini-native` preset and en/vi strings
- [ ] Auto-detect decision recorded
- [ ] Harness provider `gemini-native`
- [ ] Unit tests at the `src/llm/**` coverage thresholds
- [ ] Provider-matrix run recorded in `docs/provider-matrix.md`
- [ ] Bundle budget: one hand-added line, total raised by the same amount, note appended
- [ ] `m9` added to CI push branches

## Success criteria

<!-- Red Team: eval bar compares unlike settings -->
- M9 §2.5 done when: passes the provider-matrix run (M4) and the regression gate. Read as: the native adapter and the
  existing OpenAI-endpoint `gemini` provider are run back to back with identical flags, the matrix row's settings
  (`--set eval --chunk-tokens 1500 --concurrency 2 --pause 4000`, same model, same strategy as the row records in
  `docs/provider-matrix.md:21` [UNVERIFIED: confirm the strategy from the row's run folder]). Both are judged. The
  native run has no segment loss, and its judge overall is not lower than the paired OpenAI-endpoint run by more than
  0.20. The historical 4.24 is reported for context only, because rows in that table are not like-for-like
  (`docs/provider-matrix.md:15`). `pnpm run eval:gate` (the shipped default) stays green.
- "Test connection" on a `gemini-native` connection succeeds with a real key (recorded by the tester).

## Guarantee to keep

No change to the engine interface; the adapter honours `src/llm/types.ts:1-12` (no retries, failures as one `error`
event). Existing Gemini connections keep the OpenAI endpoint.

## Verification

```
pnpm run test -- src/llm/gemini.test.ts
pnpm check
pnpm run e2e
pnpm run eval -- --provider gemini --set eval --chunk-tokens 1500 --concurrency 2 --pause 4000 [--strategy <row's>]
pnpm run eval -- --provider gemini-native --set eval --chunk-tokens 1500 --concurrency 2 --pause 4000 [--strategy <row's>]
pnpm run eval:judge && pnpm run eval:report
pnpm run eval:gate
```

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| A device on v1.0 syncs a `gemini-generate` connection it cannot parse | Medium × Low | `cleanConnection` returns null for an unknown protocol (`providers.ts:169`) and `parseStored` skips it per key (`:276-279`) without deleting it. Add a test that a v1.0-shaped parse ignores it and that routing to its profile falls back to the default |
| SSE framing differs from the docs | Low × Medium | Step 1 confirms against a live call; tests split frames at every byte boundary |
| Thinking-token accounting double-counts | Medium × Low | Usage tests pin the mapping; the cost readout is checked on one live call |

## Security

The key goes only in the `x-goog-api-key` header, never in the URL query (the native API also accepts `?key=`; do
not use it, URLs end up in logs). Error text from the server is classified like the other adapters and never stored
in diagnostics (M6 phase 4 rule).

## Rollback

Remove the preset entry; stored connections of that protocol are then ignored by `cleanConnection`. The adapter
file and the union member can stay or go without affecting other protocols.
