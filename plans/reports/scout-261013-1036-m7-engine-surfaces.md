# Scout — M7 engine surfaces

Date: 2026-10-13 · Source: Explore scout, saved by the controller session.

## Relevant files

- `src/engine/types.ts`: `StrategyId` (:48, already lists `refine`), `JobOptions` (:74), `TranslationJob` (:99), `EngineEvent` (:147; `segment.final` has `revision` and `attempt` at :156-165), `Stage` (:205), `StageContext` (:228), `Strategy` (:249), `WorkingMemory` (:272), `ContextSnippet` (:285), `ContextQuery` (:296), `ContextProvider` (:311), `PromptTemplate` (:323), `BudgetLimits` (:340), `Budget` (:348).
- `src/engine/runner.ts`: `defineStage` (:42), `StrategyDefinition` (:50), `defineStrategy` (:57).
- `src/engine/engine.ts`: `createEngine` (:75); it throws on an unknown strategy (:79-80), records usage into the budget (:87), keeps the highest revision per segment (:88-92), and defaults the context providers (:310).
- `src/engine/strategies/single-pass.ts`: `SINGLE_PASS_VERSION` (:34), `singlePass` (:417), `SINGLE_PASS_CACHE_KEY` (:420), budget skip (:358).
- `src/engine/strategies/contextual.ts`: `CONTEXTUAL_VERSION` (:45), `REVISED_REVISION = 2` (:56), `regresses` (:71-74), `revise` (:82-101), `contextualStages` (:117), `createContextual` (:225), `CONTEXTUAL_CACHE_KEY` (:262).
- `src/engine/stages/check.ts`: `createCheckStage(strategyId, prepare)`; it re-requests failing segments once with `attempt = max + 1`. `fail()` emits `segment.failed` with the condemned revision and deletes that memory entry.
- `src/engine/check/checks.ts`: `checkLength` (:263), `checkSegment` (:327), `checkDuplicates` (:353), `fixesFor` (:383).
- `src/engine/stages/analyze.ts:57`: analyze is skipped when the budget is exhausted.
- `src/engine/budget.ts`: `createBudget` (:8), `record` (:15), `exhausted` (:22), `maxOutputTokens` (:31).
- `src/engine/prompts/registry.ts`: `definePrompt` (:8, id = `name@version`), `createPromptRegistry` (:23). `src/engine/prompts/index.ts:6` holds `PROMPTS`. The current ids are `translate@1`, `translate@2`, `analyze@1` and `explain@1`; there is no `review@1`.
- `src/engine/context/budget.ts`: `CONTEXT_BUDGET_TOKENS` (1500), `DEFAULT_CONTEXT_PROVIDERS`, `gatherContext`. The v1 providers are `brief`, `glossary` and `context-tail` (`src/engine/context/*.ts`).
- `src/engine/testing.ts:15`: `fakeClient`.
- `src/llm/types.ts:15`: `ModelRole = 'translate' | 'analyze' | 'review'`.
- `src/shared/providers.ts`: `Routing` with `review?` (:119-126), `cleanRouting` (:235-247), `ROUTING_FIELDS` (:490), `routingWithout` (:580-589), and a role fallback to translate (:769).
- `src/entrypoints/sidepanel/route.ts`: `analyzeClient` (:96), `translateClient` (:112), lazy analyze resolver (:126).
- `src/entrypoints/sidepanel/jobs.ts`: `SegState` (:39), `PANEL_STRATEGY = contextual.id` (:83), `applySegmentEvent` (:196-214), analyze gate (:852), strategy selection (:916), budget (:921), `engine.translate` (:931), lazy rounds (:444-467), `explainSegment` (:1087), `redoSegment` (:1147), `defaultEngine` throws for `review` (:1316), engine strategy list `[singlePass, contextual, explain, basic]` (:1324), cache hit (:1440), `remember` (:1461), `keyFor` (:1481), `flushCache` (:1495), replace on retranslate (:1503).
- `src/entrypoints/sidepanel/translator.ts`: `Jobs` construction (:112), snippet jobs forced to `single-pass` (:115), action wiring (:508-511).
- `src/entrypoints/sidepanel/SegmentList.tsx`: `SegmentActions` (:11), `Text` (:55), `copyText` (:76), `BlockActions` (:97), `Original` (:154), `statusAttrs` (:164), `Block` (:254; `shouldComponentUpdate` :255). `App.tsx:363` passes the actions in.
- `src/entrypoints/options/Providers.tsx`: `routedIds` (:75, ignores `review`), role label (:304), `RoutingView` (:344), the `route-translate` and `route-analyze` rows (~:380-392), `SiteModelRules` (~:400).
- `src/locales/en.yml`: `roleTranslate` (:244), `roleAnalyze` (:245), `roleReview` (:246).
- `src/shared/cache.ts`: `CACHE_DB` (:12), `CACHE_MAX_BYTES` (:13), `strategyKeyInfo` (:66-72; hard-codes contextual and single-pass), `scopeHash` (:87-89), `segmentKey` (:93-97), `openTranslationCache` (:141), `open(name, 1)` (:149), `onupgradeneeded` (:150-154; stores `segments`, `briefs`, `meta`), `getMany` (:181), `putMany` (:199; keeps the higher revision/attempt).
- `src/shared/settings.ts`: `Preferences` (:245-262; no strategy or quality field), `budgetTokens` (:258), `DEFAULT_BUDGET_TOKENS = 400000` (:271), `cleanBudget` (:276), `readPreferences` (:292), `savePreferences` (:307).
- `src/shared/portable.ts`: `EXPORT_VERSION = 1` (:55), `MAX_IMPORT_BYTES = 1,000,000` (:57), `MAX_GLOSSARY` (:62), `buildExport` (:159), `importPrefs` (:313), `parseImport` (:379), `previewImport` (:628), `applyImport` (:642).
- `src/shared/sync-quota.ts:20-25`: 8 KB per item, 100 KB total, 512 items, overflow to storage.local.
- `scripts/eval/run.ts`: `--strategy` (:50), whitelist `single-pass|contextual` (:181-184). `scripts/eval/gate.ts`: uses `PANEL_STRATEGY` (:14), strategy lookup `[singlePass, contextual]` (:103), `translate@2` (:111). `eval/gate.json` pins contextual v2, translate@2, chunkTokens 400, and a judge; the baselines are fidelity 4.226, naturalness 3.904, tone 4.6 and terminology 4.478, with a margin of `max(2 × SD, 0.2)`.
- `vitest.config.ts`: the `engine` project (node) and the `shell` project (WxtVitest). Coverage thresholds are `src/engine/**` 95/90/95/95 and `src/llm/**` 90/85/85/90.
- `scripts/check-engine-boundary.mjs`: the engine may import only `src/engine/` and `src/llm/types.ts`.
- `e2e/servers.ts`: fixture server (4173) and mock OpenAI-compatible server (4174). The mock answers only translate (`<seg>`, `vi:` prefix) and analyze (`<document>`) shapes.
- `pnpm check` runs lint, typecheck (two tsc runs), check:engine, test:coverage, build, check:bundle and check:manifest. E2E is not part of it.

## What exists for M7 already

- The `review` role exists in `ModelRole`, `Routing.review`, cleaning, the fallback and `ROUTING_FIELDS`, but `defaultEngine` throws for it (jobs.ts:1316) and there is no review routing row in the options page.
- `refine` exists only as a `StrategyId` literal and in comments.
- Revisions are already in the contract: events, engine memory, the panel fold, the highest-revision cache, the revision-aware check, and contextual's chunk-0 revise (revision 2).
- Not started: the `review` stage, the `refine` strategy, the `review@1` prompt, quality modes, the "refined" marker, inline edit, translation memory storage and provider, and a Best eval baseline.

## Risks

1. **A failed review revision blanks the draft.** check.ts `fail()` emits `segment.failed` at revision 2, and the panel fold (jobs.ts:210-212) then drops revision 1's text. The review stage must accept or drop its candidate itself and emit nothing on rejection, as `regresses()` does (contextual.ts:71-74).
2. **Revision collision.** Contextual's chunk-0 revise already uses revision 2. Either review becomes revision 3, or `refine` turns the chunk-0 revise off.
3. **Cache version gap.** `strategyKeyInfo` gives unknown strategies version 0 and no prompt ids, so editing `review@N` would not invalidate Best entries. `refine` needs its own branch.
4. **Budget scope.** The budget is per engine job, and lazy rounds may each get the full `budgetTokens`. It is checked before a call and not reserved, so one call can overshoot.
5. **IndexedDB has no upgrade path.** The DB opens at version 1. A translation-memory store needs DB version 2 with an upgrade branch, or a separate DB name.
6. **Engine boundary.** The TM provider gets its data from the shell (a closure or `JobOptions`); the engine cannot import `src/shared/cache.ts`.
7. **Gate binding.** gate.ts follows `PANEL_STRATEGY`. Best needs its own gate config and baseline, and run.ts/gate.ts must accept `refine`.
8. **Coverage.** The 95% engine threshold applies to the new stage and provider.
9. **Mocks.** The e2e and eval mocks need to answer review calls.
10. **Export size.** `MAX_IMPORT_BYTES` is 1 MB, so a TM export needs a cap or a separate file.
11. **Edits and cache.** A reload reapplies cache hits, so an inline edit must update the cache, and a retranslate must not silently overwrite an edit.
12. **Live cost.** The eval gate and the ≤ 2× cost criterion need live provider keys. Never read `.env`.
