---
title: "Phase 7: Tool calls in the LLM contract"
status: todo
priority: P3
effort: "2d"
dependencies: []
tier: foundation
---

# Phase 7: Tool calls in the LLM contract

## Goal

Add optional, additive tool-call support to the normalized LLM contract and its adapters, so the `agentic` strategy
(phase 8) can run a read-only tool loop. This is the one shared-foundation phase; nothing user-visible ships in it and
no existing request changes.

## Context links

- Contract rule: `src/llm/types.ts:1-12` (additive and optional only; adapters do not retry).
- Today: `NormalizedRequest` has no `tools` and `messages[].content` is a `string` (`src/llm/types.ts:79-100`, `:84`);
  `NormalizedEvent` is `text | usage | done | error` (`:121-125`); `StopReason` has no tool reason (`:105`).
- Param builders: `toOpenAIParams` (`src/llm/openai.ts:87-106`, messages mapped at `:88`), `toAnthropicParams`
  (`src/llm/anthropic.ts:60-…`, messages mapped at `:64`); `chrome-builtin` sends `req.messages` straight to
  `promptStreaming` (`src/llm/chrome-builtin.ts:84`).
- Engine wrappers that inspect events: retry (`src/engine/retry.ts:110-126`: `usage` is held, an early `error`
  breaks for a retry, `text` continues, and every other event is treated as terminal at `:122-126`), fallback
  (`src/engine/fallback.ts:76-83`, `sawText` only on text), budget accounting (`src/engine/engine.ts:87`).
- Test double: `fakeClient` (`src/engine/testing.ts:15-…`), `src/llm/testing.ts`.
- If phase 1 has shipped: `src/llm/gemini.ts` gets the same support (`functionDeclarations`, `functionCall`,
  `functionResponse`).

## Requirements

- `NormalizedRequest.tools?: ToolSpec[]` with `ToolSpec = { name; description; parameters: JSONSchema }`, and
  `toolChoice?: 'auto' | 'none'`. Absent `tools` → the request on the wire is byte-identical to today (tests on both
  param builders).
- Messages widen additively: `{ role: 'user' | 'assistant'; content: string; toolCalls?: ToolCall[] }` and a new
  member `{ role: 'tool'; toolCallId: string; name: string; content: string }`. Every member keeps `content: string`,
  so existing readers compile unchanged.
- `NormalizedEvent` gains `{ type: 'tool_call'; id: string; name: string; arguments: string }`, emitted complete
  (never partial), before the terminal event. `StopReason` gains `'tool_use'`. Order rules in the `NormalizedEvent`
  doc comment are updated.
- OpenAI-compatible: `tools: [{ type: 'function', function }]`, `tool_choice`; accumulate streamed
  `delta.tool_calls[index]` fragments; `finish_reason: 'tool_calls'` → `tool_use`; assistant `tool_calls` and `tool`
  role messages mapped back.
- Anthropic: `tools: [{ name, description, input_schema }]`; `content_block_start` `tool_use` plus
  `input_json_delta` accumulated; `stop_reason: 'tool_use'`; assistant `tool_use` blocks and user `tool_result` blocks
  mapped back.
- `chrome-builtin`: a request with `tools` yields one `error` event (`bad_request`, "this model can't use tools");
  `tool` messages are never sent.
- Capability: a 400 that names `tools` on an OpenAI-compatible gateway is classified as `bad_request` and not
  quirk-flipped (the caller, phase 8, falls back to its non-tool strategy). A new optional `Quirks.supportsTools?:
  boolean` is learned through the existing `saveLearnedQuirk` path so the next job skips the attempt.
<!-- Red Team: retry wrapper ends the stream at the first tool_call -->
- Engine wrappers: in `retry.ts`, a `tool_call` sets `sawText`, is yielded, and the loop continues; only `done` and
  `error` are terminal (today the fall-through at `:122-126` would flush usage, yield the first tool call and return,
  dropping a second parallel call and `done(tool_use)`). In `fallback.ts:80-83`, a `tool_call` also sets `sawText`.
  So a stream that already yielded a tool call is never silently replayed, and every call plus the stop reason
  reaches the strategy in order.
- `fakeClient` can script `tool_call` events and records tool messages.

## Architecture

```
strategy (phase 8) ── NormalizedRequest{ tools, messages incl. tool results } ──► LLMClient.stream
   adapters: openai.ts / anthropic.ts / gemini.ts map tools ⇄ wire, stream → text | tool_call | usage | done(tool_use)
   chrome-builtin: tools → error(bad_request)
engine retry/fallback: tool_call marks the stream as having produced output
```

Data in: tool specs and tool-result messages from the strategy. Transform: per-protocol wire mapping; streamed
argument fragments joined into one JSON string per call. Data out: complete `tool_call` events. Arguments are passed
through as strings; parsing and validation belong to the strategy (phase 8), which treats them as untrusted.

## Related files

- **Create:** none (tests go into the existing `src/llm/adapters.test.ts` and engine tests).
- **Modify:** `src/llm/types.ts`, `src/llm/openai.ts`, `src/llm/anthropic.ts`, `src/llm/chrome-builtin.ts`,
  `src/llm/gemini.ts` (if phase 1 shipped), `src/llm/errors.ts` (only if the tools-400 classification needs it),
  `src/llm/testing.ts`, `src/engine/testing.ts`, `src/engine/retry.ts`, `src/engine/fallback.ts`,
  `src/shared/providers.ts` (`supportsTools` in learned quirks), `src/llm/adapters.test.ts`, `src/engine/retry.test.ts`,
  `src/engine/fallback.test.ts`, `e2e/servers.ts` (the mock answers a scripted tool round, for phase 8's e2e),
  `DESIGN.md` §4.2 (one paragraph on the optional tool contract).

## Steps

1. Write `docs/plans/M9-tool-calls.md` (M9 §3, as the foundation for `agentic`).
2. Types in `src/llm/types.ts`, with doc comments; `pnpm run typecheck` lists every switch over `NormalizedEvent` and
   every `messages` mapper; handle each.
3. Param builders and stream readers for OpenAI-compatible and Anthropic, plus `chrome-builtin`'s refusal.
4. Tests per adapter: no-tools requests byte-identical (snapshot of params); one and two parallel tool calls;
   fragments split across chunks; malformed argument JSON passed through as a string; `tool_use` stop reason; tool
   results mapped back; a 400 naming `tools`; abort mid-call.
<!-- Red Team: retry wrapper ends the stream at the first tool_call -->
5. Retry and fallback: in `retry.ts`, add a `tool_call` branch that sets `sawText`, yields and continues, and make
   only `done` and `error` terminal; in `fallback.ts`, set `sawText` on `tool_call`. Wrapper-level tests (not only
   adapter tests, which bypass the wrappers): two tool calls then `done(tool_use)` pass through `withRetry` and the
   fallback chain with both calls, the usage and the stop reason in order; an error after a tool call is not
   replayed.
6. `supportsTools` learned quirk; test that a learned `false` keeps `tools` off the wire.
7. Mock server: one scripted tool round on a marker in the system prompt.
8. Coverage stays at the `src/llm/**` and `src/engine/**` thresholds (`vitest.config.ts`).
9. `pnpm run eval:gate` (LLM code changed) and record it.

## Todo

- [ ] One-page foundation plan
- [ ] Additive types with doc comments
- [ ] OpenAI-compatible and Anthropic mapping; chrome-builtin refusal; gemini if present
- [ ] Adapter tests incl. byte-identical no-tools params
- [ ] Retry yields tool calls and continues (only `done`/`error` terminal); fallback treats them as output; wrapper-level tests
- [ ] `supportsTools` learned quirk
- [ ] Mock server tool round
- [ ] Coverage thresholds held; eval gate recorded

## Success criteria

- Requests without `tools` are byte-identical on the wire to v1 for both protocols (param snapshot tests), and
  `pnpm run eval:gate` is green.
- A scripted two-round tool exchange passes through each adapter and the fake client end to end in unit tests, and
  a turn with two parallel tool calls passes through `withRetry` and the fallback chain intact (Red Team).

## Guarantee to keep

The contract stays additive and optional (`src/llm/types.ts:1-3`); adapters still never retry; the engine interface
is unchanged. DESIGN §8's "the model has no tools" stays true until phase 8 ships a strategy that sends tools.

## Verification

```
pnpm run test -- src/llm src/engine/retry.test.ts src/engine/fallback.test.ts
pnpm check
pnpm run e2e
pnpm run eval:gate
```

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| Widening `messages` breaks a consumer that assumed two roles | Medium × Medium | Typecheck lists every mapper; `content: string` kept on every member |
| A replayed stream re-yields a tool call | Medium × High | `sawText` on tool calls; tests |
| The retry wrapper truncates a stream at the first tool call | High (certain today) × High | Explicit `tool_call` branch in `retry.ts`; wrapper-level test with two parallel calls |
| Gateways differ in tool-call streaming | High × Low | Pass-through of argument strings; learned `supportsTools`; phase 8 falls back without tools |

## Security

No tool is defined or executed in this phase. Tool-call arguments are model output and are marked untrusted in the
type docs; parsing and allow-listing live in phase 8.

## Rollback

All fields are optional; reverting the phase's commits leaves every existing request unchanged.
