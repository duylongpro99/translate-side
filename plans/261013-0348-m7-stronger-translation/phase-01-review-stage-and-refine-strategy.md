---
title: "Phase 1: Review stage and refine strategy"
status: todo
priority: P2
effort: "2d"
dependencies: []
---

# Phase 1: Review stage and refine strategy

## Goal

The engine has a `review` stage, a `review@1` prompt and a `refine` strategy: the `contextual` draft first, exactly
as Balanced produces it, then a review pass whose accepted candidates arrive as a higher revision. A rejected
candidate, a failed review call or an exhausted budget leaves the draft standing and emits no `segment.failed`.

## Context links

- Source: `docs/plans/M7-stronger-translation.md` §2, §5 rows 1–3, §6 M7-E1/E2, §8 row 1.
- Spec: `DESIGN.md` §5.2 (revisions, line ~545), §5.3 (`refine` row, line ~592), §5.5, §5.6 (line ~631: skip refine when the budget is exhausted).
- Scout: risks 1, 2, 3 (key data only; the shell branch is phase 3), 4, 8.

## Requirements

1. `review@1` asks for targeted fixes only (meaning errors, omissions or additions, unnatural phrasing, term
   consistency with the glossary and brief) and returns only the changed segments, or `<none/>`.
2. `refine` = `contextual` draft → `review` per chunk. The review revision replaces a draft only when the candidate
   passes every post-check (`checkSegment` in `src/engine/check/checks.ts:327` and the neighbour-duplicate check).
3. Never emit `segment.failed` from the review pass, whatever happens.
<!-- Red Team: review budget reserve -->
4. Review is skipped (drafts kept) when the budget is exhausted or cannot cover the chunk's estimated review cost,
   counting the cost already reserved by review calls in flight.
5. A job may bring drafts it already has (a cache hit below the review revision); refine reviews them without
   drafting them again.
<!-- Red Team: reviewed is a cache fact -->
6. Each chunk's review outcome is reported (accepted, unchanged, rejected and skipped ids) for the shell's cache, the
   harness and diagnostics. "Unchanged" covers `<none/>`, an omitted id and a candidate equal to the draft.
<!-- Red Team: reviews hold up lazy rounds -->
7. The strategy announces when the drafts are done (a `stage` event `drafts`, status `done`), and stops starting
   review calls once the job's `reviewWanted()` returns false. Calls in flight finish (M3-D3).

## Decisions on scout risks

- **Risk 1 (a failed review blanks the draft).** The review stage does its own acceptance and never goes through
  `createCheckStage` (`src/engine/stages/check.ts`), whose `fail()` emits `segment.failed` with `revision` and deletes
  working memory. A rejected candidate is simply not emitted, the pattern of `revise`/`regresses` in
  `src/engine/strategies/contextual.ts:71-101`. There is no re-request for a rejected candidate (it keeps cost ≤ 2×).
- **Risk 2 (revision collision).** Keep contextual's chunk-0 revise (revision 2, `contextual.ts:56`) inside the
  draft, so every Best draft equals the Balanced output and Best can never be worse than Balanced when review is
  skipped. The review revision is `REVIEWED_REVISION = 3`. Review starts only after the whole contextual run has
  ended, so revision 3 never races revision 2. The panel marks "refined" by `producedBy.stage === 'review'`, and a
  cache hit by `revision >= REVIEWED_REVISION` (phase 3).
- **Risk 3 (cache version gap).** Export `REFINE_CACHE_KEY = { strategy: 'refine', version: REFINE_VERSION,
  promptIds: [ANALYZE_PROMPT_ID, CONTEXTUAL_TRANSLATE_PROMPT_ID, REVIEW_PROMPT_ID] }`. Phase 3 adds the branch in
  `strategyKeyInfo` (`src/shared/cache.ts:66-72`). A `review@N` bump changes `REVIEW_PROMPT_ID` and so the key.
<!-- Red Team: review budget reserve -->
- **Risk 4 (budget overshoot).** The budget is per engine job (`src/engine/engine.ts:310` → `createBudget`). The
  review's estimate is the prompt's estimated input tokens plus `maxOutputTokens({ sourceTokens, segments,
  reasoningReserveTokens })` (`src/engine/budget.ts:33-35`), where the reserve comes from the **review** role's client
  (`llm('review').reasoningReserveTokens`), so review calls use the review route's own reasoning quirks. The refine
  run keeps one `reserved` counter shared by its review works: a call starts only when `remainingTokens() - reserved
  >= estimate`; it adds its estimate on start and removes it when its `usage` event has been recorded (or the call
  ended without one). Usage itself is still recorded by the engine (`engine.ts:87`). Drafts keep today's check, so
  Balanced behaviour is unchanged. Validation Session 1 accepted the per-run scope.

## Architecture and data flow

```
TranslationJob (+ drafts?) ─► refine.run
  1. seed: ctx.memory.translated ← drafts (as given revision); draft job = job with drafted segments translate:false
  2. yield* createContextual(translatePrompt).run(draftJob, ctx)     // analyze ∥ chunks, chunk-0 revise, check
  3. yield { type: 'stage', stage: 'drafts', status: 'done' }                    <!-- Red Team: reviews hold up lazy rounds -->
     if budget.exhausted(): yield chunk events with review.skipped = 'budget'; return
  4. works = chunkJob(job, priority) → per chunk, the segments with a draft in memory
  5. runStages([reviewStage], works)  // pick: chunks after the screen first, the screen last; recut drops pending
                                       // chunks outside ctx.within() when focus changes
reviewStage(chunk):
  job.reviewWanted?.() === false → report skipped 'dropped'
  estimate > remaining − reserved → report skipped 'budget'; else reserved += estimate (released after usage)
  llm('review').stream({ system: review@1(languages, style, brief+glossary document snippets), user: <review> items })
  hold text; pass usage events through
  parse <seg id="n">…</seg> (or <none/>) → candidates
  missing id, <none/> or candidate == draft → unchanged; checkSegment(source, candidate) empty && !copiesNeighbour → accept; else reject
  yield segment.final { revision: 3, producedBy: { strategy: 'refine', stage: 'review', model } } for accepted
  yield { type: 'chunk', index, briefed, review: { accepted, unchanged, rejected, skipped? } }
  call error → no segment events, review.error kind in the chunk event
```

The system block is built only from document-scoped snippets (`gatherContext` filtered to `scope: 'document'`, as
`renderSystemPromptV2` does in `src/engine/context/assemble.ts:28-49`), so it is byte-identical across chunks and is
a caching prefix. Page text and drafts in the user message go through `neutralizeContextTags`
(`assemble.ts:61-66`), extended to the new `review` and `item` tags.

## Related files

- **Create:**
  - `src/engine/prompts/review.ts` (`reviewV1`, `REVIEW_PROMPT_ID = 'review@1'`) and `src/engine/prompts/review.test.ts`;
  - `src/engine/stages/review.ts` (`createReviewStage`, the user-message builder, the answer parser, the acceptance rule) and `src/engine/stages/review.test.ts`;
  - `src/engine/strategies/refine.ts` (`createRefine`, `refine`, `REFINE_ID`, `REFINE_VERSION = 1`, `REVIEWED_REVISION = 3`, `REFINE_CACHE_KEY`) and `src/engine/strategies/refine.test.ts`.
- **Modify:**
  - `src/engine/prompts/index.ts:9` (`PROMPTS` gains `reviewV1`);
  - `src/engine/types.ts` (`TranslationJob.drafts?`, the `chunk` event's `review?` field at :183, the revision comment at :156-165);
  - `src/engine/context/assemble.ts:61` (`CONTEXT_TAG` gains `review|item`);
  - `src/engine/index.ts` (exports).

## Implementation steps

1. Write `review@1` in `src/engine/prompts/review.ts` with `definePrompt` (`src/engine/prompts/registry.ts:8`).
   Slots: `TARGET_LANG`, `SOURCE_LANG`, `STYLE`, `STYLE_RULE`, `BRIEF`, `GLOSSARY` (reuse `STYLE_LABELS`,
   `STYLE_RULES` and `languageLabel` from `src/engine/prompts/translate.ts`). Rules: fix only the four kinds; never
   restyle a correct sentence; keep every marker, code span, link, URL and number; answer with the full revised text
   of each changed segment as `<seg id="n">…</seg>`, or exactly `<none/>`.
2. Add `TranslationJob.drafts?: ReadonlyMap<string, { text: string; revision: number }>`,
   `TranslationJob.reviewWanted?: () => boolean`, and the `chunk` event's `review?: { accepted: string[];
   unchanged: string[]; rejected: string[]; skipped?: 'budget' | 'error' | 'dropped'; error?: LLMErrorKind }`.
   <!-- Red Team: reviewed is a cache fact --> `producedBy.model` of a review final stays the review model (it is
   the truth); phase 3 keys and badges it by the job's translate model.
3. Implement `createReviewStage(reviewPrompt)`, scope `chunk`, role `review`. Parse the answer with `parseOutput`
   (`src/engine/parsing/seg-parser.ts:357`) over the sent ids, treating a missing id as unchanged. If the parser
   cannot accept a subset of ids `[UNVERIFIED]`, write a small `<seg id>` parser in `review.ts` that ignores unknown
   ids, keeps the first of duplicate ids and ignores text outside tags.
4. Apply the acceptance rule: `checkSegment(source, candidate, targetLang)` must return no failure, and
   `copiesNeighbour` (`src/engine/parsing/duplicate.ts:53`) must be false against the page-order neighbours' current
   texts. Otherwise reject. Emit nothing for rejected or unchanged ids.
5. Implement `createRefine({ translatePrompt?, reviewPrompt? })` and `refine` as in the data flow: seed drafts, run
   contextual over the draft job, then review. `pick` orders chunks after the screen first (`ctx.priority`), then
   the screen, then chunks before it. `recut` returns only the pending works with a segment inside `ctx.within()`.
6. Export `refine`, `createRefine`, `REFINE_CACHE_KEY`, `REVIEWED_REVISION`, `REVIEW_PROMPT_ID` and `reviewV1` from
   `src/engine/index.ts`.
7. Write the tests listed in Todo with `fakeClient` (`src/engine/testing.ts:20`), keeping `src/engine/**` coverage
   at the 95/90/95/95 thresholds.

## Todo

- [ ] `review@1` prompt and a render test (no empty slot, byte-stable system block for two chunks)
- [ ] `drafts` and the `chunk.review` field in `types.ts`
- [ ] Review stage: accepted candidate → `segment.final` revision 3, `producedBy.stage = 'review'`
- [ ] Rejected candidate (lost code span, changed number, duplicate of a neighbour) → no event, id in `rejected`, draft still in memory
- [ ] `<none/>`, unknown ids, garbage answer, truncated answer → no segment events, no throw
- [ ] Review call fails (non-retryable and retries exhausted) → drafts kept, no `segment.failed`, usage recorded
- [ ] Budget exhausted after drafts → no review call, `skipped: 'budget'` (§3 #4)
- [ ] Budget below one chunk's estimate → that chunk skipped, a cheaper chunk still reviewed
- [ ] <!-- Red Team: review budget reserve --> Two concurrent reviews against a budget that fits one: only one call starts; the estimate includes the review client's reasoning reserve
- [ ] <!-- Red Team: reviewed is a cache fact --> `<none/>`, omitted ids, unchanged and rejected ids all appear in the chunk report
- [ ] <!-- Red Team: reviews hold up lazy rounds --> `drafts` stage event after the contextual run; `reviewWanted()` false → pending reviews skipped as `dropped`, in-flight ones finish
- [ ] Seeded drafts → contextual drafts only the rest; review covers all
- [ ] Chunk-0 revise (revision 2) lands before any revision 3; review starts after the contextual run ends
- [ ] Order: chunks after the screen first, the screen last; recut drops pending reviews outside `within`
- [ ] Abort mid-review rethrows the abort reason like the other strategies
- [ ] Page text containing `</item>` or `<review>` is neutralised in the user message
- [ ] Engine exports and the engine boundary check

## Success criteria

- Every Todo test passes in the `engine` vitest project.
- No code path in `src/engine/stages/review.ts` or `src/engine/strategies/refine.ts` yields `segment.failed` (grep and test).
- `src/engine/**` coverage stays at or above 95/90/95/95.
- With review disabled by budget, a `refine` run emits exactly the events a `contextual` run emits for the same job, apart from the `chunk` review reports.

## Verification

- `pnpm vitest run --project engine src/engine/stages/review.test.ts src/engine/strategies/refine.test.ts`
- `pnpm run check:engine` and `pnpm run typecheck`
- `pnpm run test:coverage`, then `pnpm check`

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| The parser rejects a subset of ids | M × M | Step 3 fallback parser; test both shapes. |
| The acceptance rule is too strict (a correct fix trips the length check) | M × M | Phase 2 reports the rejected rate per run; tune only `review@N`, never loosen `checkSegment` for Balanced. |
| The basic-fallback switch interacts with review calls | L × M | Review never emits `segment.failed`, so the switch has nothing to take over; a test runs refine with `basicFallback` and a provider that dies during review. |

**Rollback.** The phase only adds files and optional fields; reverting the commits removes `refine`, and nothing in
the shell refers to it before phase 3.

## Security

Page text is untrusted: it is neutralised before it goes into the review message, and the panel keeps rendering
output as text (`DESIGN.md` §8). An injected instruction in page text can steer the reviewer as it can the
translator. The post-checks bound the damage to the text itself; nothing else in the extension reads model output.
