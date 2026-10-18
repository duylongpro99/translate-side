---
title: "Phase 6: Translation memory provider"
status: todo
priority: P2
effort: "1.5d"
dependencies: [1, 2, 5]
---

# Phase 6: Translation memory provider

## Goal

A `TranslationMemoryProvider` puts the user's most similar corrections into the chunk's `<context>` block, ranked
by lexical similarity over the source text, within its token share. Each retrieval is logged. Retrieval is the Pro
`translation-memory` feature, read once per job start in `Jobs.start` and available by default.

## Context links

- Source: `docs/plans/M7-stronger-translation.md` §2 row 5, §3 #5, §4 (no embeddings), §5 row 5, §6 M7-E5, §8 row 3, §9.
- Spec: `DESIGN.md` §5.4 (context providers, line ~598).
- Scout: risks 6, 8.

## Requirements

1. The engine gets examples only through `JobOptions.memory?: readonly MemoryExample[]` (`{ id, source, target }`),
   never from `src/shared/` (the engine boundary).
2. The score is the Dice coefficient over word tokens (`/[\p{L}\p{N}]+/gu`, NFKC, lower case). For text in
   scripts written without spaces (Han, Hiragana, Katakana, Thai, Lao, Khmer), character bigrams are used instead.
3. A minimum similarity `TM_MIN_SIMILARITY = 0.5`, at most `TM_MAX_EXAMPLES = 3` per chunk, at most
   `TM_MAX_TOKENS = 400`, and the best example per chunk segment first.
4. The snippet is chunk-scoped (the user message), so the caching prefix is untouched. With no examples the prompt
   is byte-identical to today's.
5. The retrieval is logged: the entry ids and scores, per chunk, as an engine event; counts in diagnostics.
<!-- Updated: Validation Session 1 - feature access resolved once per job start -->
6. `featureAvailable('translation-memory')` is awaited once in `Jobs.start` and stored on the job; false → no
   `memory` in the job. Exact-source reuse of edits (phase 5) is free and unaffected.
<!-- Red Team: local-only corrections leak to cloud -->
7. Sending rules, applied in the shell before the engine sees anything: a run whose route is **not** local-only
   never receives an entry with `localOnly: true`; an entry from another origin (including imported entries) is
   sent only when the device setting "Use corrections from other sites" is on (`storage.local`, default **off**).
   A local-only run may receive all entries of its target language.
<!-- Red Team: memory load delays first draft -->
8. Loading never delays the first request: one snapshot per panel session per target language, refreshed only when
   the store's write counter changes, read in parallel with route resolution and raced against the cache timeout
   (`cacheTimeoutMs ?? 1500`, `jobs.ts:1427-1431`). A timeout means no examples for that run.

## Decisions on scout risks

- **Risk 6 (engine boundary).** Data enters through `JobOptions`, like the personal glossary (`types.ts:76`).
  The provider is registered in `DEFAULT_CONTEXT_PROVIDERS` (`src/engine/context/budget.ts:33`) after the context
  tail: `[brief, glossary, context-tail, translation-memory]`. The tail keeps its share, and the memory gets what
  is left, up to 400 tokens of the 1,500 (`budget.ts:13`). Without examples it returns `[]`, so Balanced and the
  M6 gate prompts do not change.
- **Logging.** `ContextSnippet` gains an optional `refs?: readonly { id: string; score: number }[]`. The translate
  run yields `{ type: 'stage', stage: 'context', status: 'done', info: { chunk, memory: refs } }` after
  `gatherContext` (`src/engine/strategies/single-pass.ts:315`) when a memory snippet was used. The panel adds the
  count and the ids to the diagnostics record; the ids are memory keys (hashes), not text. The harness writes the
  event to its run folder.
- **Review.** The review prompt uses document-scoped snippets only (phase 1), so it gets no memory examples.
  This is deliberate: the draft already followed them.
- **Index.** Built once per `memory` array (a `WeakMap` keyed by the array), as an inverted index from token to
  entries. Candidates are entries sharing at least one token; only those are scored. Loading is capped at 5,000
  entries by phase 5. <!-- Red Team: memory load delays first draft --> The shell passes a **stable** array: the
  filtered view is memoised per (target language, origin, local-only, across-sites setting, store version), so
  lazy rounds, resumes and refreshes reuse the same array and the same index.
<!-- Red Team: local-only corrections leak to cloud -->
- **Where the filter lives.** In the shell (`src/shared/memory.ts` `examplesFor(snapshot, { origin, localOnly,
  acrossSites })`), because origin and route are shell facts; the engine only ranks what it is given.
- **Risk 8 (coverage).** The provider and the similarity are pure functions with table tests; the 95% threshold
  applies.

## Architecture and data flow

```
translator.ts: Jobs({ featureAvailable, memory: snapshotStore })   snapshotStore.load(targetLang) cached per session,
                                                                    reloaded when store.version() changed
Jobs.start: in parallel ─ translateClient(...) │ featureAvailable('translation-memory') │ snapshot (raced, 1500 ms)
  job.memoryOn stored                         ◄ the one async gate read
  after the route: examples = memoryOn ? examplesFor(snapshot, { origin, localOnly: route.localOnly, acrossSites })
                              (memoised, stable array) : undefined
  ─► engineJob.options.memory
single-pass translate run ─► gatherContext(ctx.context, q) ─► translationMemoryProvider.provide(q)
   q.chunk segments × index → candidates → Dice score ≥ 0.5 → top 3 → snippet (chunk scope):
     "Corrections the user made to earlier translations; follow their wording where the same phrasing appears:"
     <source>…</source><translation>…</translation>   (neutralizeContextTags, the pair format of tail.ts)
   ─► renderContextBlock (assemble.ts:51) ─► user message
   ─► yield stage 'context' { chunk, memory: refs }  ─► jobs.onEvent → job.log.memory
```

The `<source>`/`<translation>` pair format is shared with `src/engine/context/tail.ts:22-25`: move `pair()` into
`assemble.ts` and import it in both, rather than copying it.

## Related files

- **Create:** `src/engine/context/memory.ts` (`translationMemoryProvider`, `similarity`, `tokens`, constants) and
  `src/engine/context/memory.test.ts`.
- **Modify:**
  - `src/engine/types.ts` (`MemoryExample`, `JobOptions.memory?`, `ContextSnippet.refs?`);
  - `src/engine/context/budget.ts:33`, `src/engine/context/tail.ts` and `src/engine/context/assemble.ts` (`pair`);
  - `src/engine/strategies/single-pass.ts:315` (the event); `src/engine/index.ts` (exports);
  - `src/entrypoints/sidepanel/jobs.ts` (`deps.memory` snapshot, the gate read and the parallel race in `start()`,
    `options.memory`, the event into the log);
  - `src/entrypoints/sidepanel/translator.ts` (the session snapshot store and its wiring);
  - `src/shared/memory.ts` (`examplesFor`, the snapshot loader) and `src/entrypoints/options/Memory.tsx` (the
    "Use corrections from other sites" checkbox);
  - `src/shared/diagnostics.ts` (`JobRecord.memory?: { hits: number; ids: string[] }`, capped at 20 ids);
  - `scripts/eval/run.ts`: `--memory <file>` loads a memory export as `options.memory` (after phase 2 is accepted);
  - `e2e/flows.spec.ts` (reuse across pages).
- **Fixtures:** `src/engine/context/memory.fixtures.ts`: labelled pairs, similar and unrelated, in en→vi and one
  CJK sample.

## Implementation steps

1. Add the types. Write `tokens()` and `similarity()` with the script rule, and table tests: identical text = 1;
   reordering keeps a high score; unrelated text is below 0.2; CJK bigrams; empty text = 0.
2. Write the provider: the index, candidates, scoring against each chunk segment (an entry's score is its best over
   the chunk's segments), the threshold, top-k, the token cut via `estimateTokens`, and `refs`. A test: no
   `memory` → `[]` and the prompt byte-identical to a baseline render.
3. Move `pair()` to `assemble.ts` and register the provider after the tail.
4. Emit the `context` stage event in the translate run, and test it on single-pass and contextual.
5. Shell: the snapshot store in `translator.ts`; in `Jobs.start` the single `featureAvailable('translation-memory')`
   read, in parallel with route resolution and the raced snapshot; `examplesFor` after the route; `options.memory`;
   `onEvent` records the refs; diagnostics adds the counts. Tests: a local-only entry never reaches a non-local
   run; a cross-origin entry only with the setting on; an imported entry only with the setting on; the same array
   instance across two lazy rounds; a snapshot that never resolves does not delay the first request beyond the
   timeout; time to first request with a 5,000-entry store stays within 50 ms of an empty store (fake-indexeddb).
6. Harness `--memory`, and a retrieval precision check (no live call): over the labelled fixtures, every similar
   pair is retrieved and no unrelated pair is, at the chosen threshold.
7. **Owner (optional live check, source plan §8 row 3):** an eval run with `--memory` built from 10 corrected
   eval segments; the judge's dimensions stay within the Balanced margins.
8. e2e: edit a block on fixture A; open fixture B (same origin), which has a similar sentence; the mock's captured
   prompt for B's chunk contains the correction inside `<context>`, and the diagnostics record shows
   `memory.hits ≥ 1`. <!-- Red Team: local-only corrections leak to cloud --> Second flow: a local-only site rule
   for fixture A (the mock reached as a local connection), an edit there; fixture B on a cloud route with the
   across-sites setting on: no captured cloud request contains A's correction.

## Todo

- [ ] Types: `MemoryExample`, `JobOptions.memory`, `ContextSnippet.refs`
- [ ] `tokens` and `similarity` with the script rule, tested
- [ ] Provider: index, threshold, top-k, token cut, refs
- [ ] `pair()` shared; provider registered after the tail; byte-identical prompt without memory
- [ ] `context` stage event; panel log and diagnostics
- [ ] One `translation-memory` read in `Jobs.start`, stored on the job; false → no memory
- [ ] Sending rules: local-only, cross-origin opt-in, imported entries; tests and the local-only e2e flow
- [ ] Session snapshot, stable memoised array, parallel and raced load; timing test with 5,000 entries
- [ ] Harness `--memory` and the fixture precision check
- [ ] e2e reuse across pages
- [ ] Owner: optional live check

## Success criteria

- §3 #5: in e2e, page B's request carries page A's correction, and the retrieval is logged (event and diagnostics).
  The live demo in phase 7 shows the correction in the output.
- `grep -rn "featureAvailable('translation-memory')" src` returns one line, in `jobs.ts` `start()`.
- No e2e or unit path sends a local-only entry to a non-local route, or a cross-origin entry without the opt-in.
- The 5,000-entry timing test passes in every mode, so Balanced's first request is not delayed by the memory.
- With no memory, the captured Balanced prompts on the e2e fixtures are byte-identical to phase 5's.
- Engine coverage stays at or above the thresholds.

## Verification

- `pnpm vitest run --project engine src/engine/context`
- `pnpm run check:engine`, `pnpm check`
- `pnpm run e2e`
- `pnpm run eval -- --mock --set eval --strategy contextual --memory <file>`

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| Irrelevant examples mislead the model | M × M | The threshold, 3 per chunk, the fixture precision check, and the optional live check. |
| A memory snippet starves the context tail | — | Avoided: the provider is registered after the tail. |
| Scoring 5,000 entries per chunk is slow | L × M | The inverted index scores only candidates; a test bounds 5,000 entries × 40 segments under 50 ms in node. |
| Loading the memory delays the first draft | — | Avoided: session snapshot, parallel and raced load, stable array (Requirement 8). |
| A Pro-off user expects retrieval because edits still apply | M × L | The exact-match override is described as "your edits" and retrieval as "learns from your edits" (licensing UI). |

**Rollback.** Remove the provider from `DEFAULT_CONTEXT_PROVIDERS`: prompts are as in phase 5, and the memory store
is unaffected.

## Security

<!-- Red Team: local-only corrections leak to cloud -->
Examples come from other pages, so they are filtered before sending: an entry made under a local-only site rule
never goes to a non-local route, and an entry from another origin (or an imported one) goes out only when the user
turned on "Use corrections from other sites". Examples travel in the chunk's `<context>` block, marked "do not
translate", with tags neutralised; an instruction hidden in an example has the same exposure as page text.
Diagnostics get hashed keys and counts, never text.
