---
phase: 1
title: "Eval regression gate and Haiku cost"
status: pending
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 1: Eval regression gate and Haiku cost

<!-- Updated: Red Team 2026-10-11. The gate runs the shipped default at chunk 400 (multi-chunk, briefed), with
     5 baseline runs, a 60 min timeout, a failing run when the secret is missing, a step-level secret, and wider
     paths. The rubric hash is dropped.
     Updated: Validation Session 2. The gate is local only; no CI job and no Actions secret. -->

## Goal

A prompt, strategy, engine, LLM-layer or default-model change that makes translations worse fails
`pnpm run eval:gate`, run locally before merge. The cost
of a long article on Haiku 4.5 is measured and documented.

## Plan tasks owned

- M6-E3: eval regression gate against the stored M2 baseline. Per Validation Session 2 it runs locally, not in CI.
- §3 #4: cost per long article on Haiku 4.5, measured and documented. This was assigned here because it uses the
  same harness.

## Done criteria (copied from docs/plans/M6-release-hardening.md)

- §2: "CI runs … an eval regression job that fails if judge scores drop below the M2 baseline by more than the set margin."
- §3 #3: "Eval scores vs M2 baseline (default prompt + strategy) | within margin; gate green in CI"
- §3 #4: "Cost per long article on Haiku 4.5, measured and documented | ≈ $0.04 (DESIGN §6)"
- §5: "Regression margin | Set from judge variance measured over repeated runs of the baseline (e.g. 2× the observed
  standard deviation per dimension)." and "Gate cost in CI | Run on changes to `engine/prompts`, `engine/strategies`
  or default model; not on every commit."
- §7 demo 2: "Make a deliberately worse prompt change on a branch; show the eval gate failing."

A gate run counts as green only if it made real calls and reported their spend.

**User override (Validation Session 2):** the user removed the judge from CI to keep CI simple. "Gate green in CI"
and "an eval regression job" in §2 and §3 #3 are read as "a local `pnpm run eval:gate` run, green and recorded".
CI keeps lint, typecheck, unit, coverage, build, the manifest and bundle checks, and e2e, none of which needs a
key.

Spec: DESIGN.md §6 (cost); `eval/README.md` (eval workflow).

## Starting point

- **Shipped default.**
  - The model, quirks and `chunkTokens: 1200` come from `DEFAULT_PROFILE` (`src/shared/settings.ts:132-140,167-168`).
  - The quirks are `APIBOX_QWEN_QUIRKS` (`src/llm/presets.ts:41`).
  - The strategy is `PANEL_STRATEGY` = contextual (`src/entrypoints/sidepanel/jobs.ts:80`), which uses translate@2
    (`src/engine/strategies/contextual.ts:47`).
  - The harness instead hard-codes its model (`scripts/eval/run.ts:147`) and defaults to chunk 1500 (`run.ts:53`).
- **The 1500 baseline never exercises the contextual strategy.** All 23 passages are one chunk with no brief.
  `contextual.ts:15-16` skips analyze for one-chunk documents.
- **M2 c400 baseline.** `eval/runs/baseline-contextual-translate2-qwen3.8-flash-c400` is multi-chunk. It has:
  - 34 chunks, 11 of them briefed;
  - 48 revised segments and 56 calls;
  - 453 s of wall time;
  - a `judge.json` and human scores.
- **Judge.** `ds/deepseek-v4-pro` with `judge@1` at temperature 0 (`scripts/eval/judge-core.ts:15-16,65`). Its
  version is the prompt id, and the rule at `:10-14` is to change it only together with a re-score. One judge run
  takes about 7 minutes.
- **Report.** `scripts/eval/report-core.ts` already computes per-dimension means (:24-29) and the delta against the
  first run (:18-21).
- **Haiku pricing.** `scripts/eval/run.ts:151-152` has the providers `openrouter` and `openrouter-anthropic`. The id
  `anthropic/claude-haiku-4.5` has no entry in `PRICES` (`scripts/eval/pricing.ts:22-27`), so the run must pass
  `--price 1,0.1,5`.

## Steps

1. **Gate configuration from the shipped constants.** `scripts/eval/gate.ts` imports `DEFAULT_PROFILE` and
   `PANEL_STRATEGY` and uses their model, quirks and strategy.
   - **Chunking:** the chunk size is fixed at 400, so the 23 passages are multi-chunk and the analyze, brief and
     revise path runs. The gate asserts that briefed chunks > 0 and that revised segments > 0.
   - **Test:** a unit test asserts that the gate's model and strategy equal the shipped constants.
2. **Re-baseline at HEAD.** Run the gate configuration 5 times with the judge, and store the runs as
   `eval/runs/gate-baseline-<n>/`.
3. **Margin.** For each dimension, take the SD of the 23-passage judge mean across the 5 runs. The margin is the
   larger of 2 × SD and 0.20 (Validation Session 3). Write `eval/gate.json` with:
   - the margins, the SDs and the per-dimension baseline means;
   - the judge model and the prompt id;
   - the model, strategy and chunk size;
   - the M2 c400 reference.
4. **§3 #3 check.** Each dimension's mean over the 5 HEAD runs must be at least the M2 c400 judge mean minus the
   margin. If not, stop and report to the supervisor with the diff of the engine commits since 8bc7484. Never
   re-baseline silently.
5. **`pnpm run eval:gate`** (`scripts/eval-gate.mjs` → `gate.ts`). One translate and judge pass.
   - **On a failure:** it re-runs once (plan §8), and exits non-zero only when both runs fail.
   - **Output:** it always prints a per-dimension table and the spend, including on timeout. An internal phase
     timeout ends the run with a verdict rather than a cancelled job.
   - **Refusals:** it refuses when `gate.json`'s judge model or prompt id differs from `judge-core.ts`.
   - **Spend cap:** it aborts above $0.50 at nominal prices, which are marked unverified in `pricing.ts`.
   - **Reuse:** the means come from `report-core.ts`; do not duplicate them.
6. **No CI job** (Validation Session 2). The gate needs paid live calls (APIBOX translate plus judge), so it stays out
   of CI. CI holds no secret. The gate runs locally from `.env`:
   - before merging any change to `src/engine/**`, `src/llm/**`, `src/shared/settings.ts`, `src/shared/presets.ts`,
     `src/entrypoints/sidepanel/jobs.ts`, `scripts/eval/**` or `eval/**`;
   - by the M6 tester in every phase whose diff touches those paths;
   - in the phase 7 release-candidate check.
7. **Demo 2.** On a throwaway branch, make a deliberately worse `translate@2` variant, run `pnpm run eval:gate`, and
   record the red output, which shows the failing dimension and the drop. Then delete the branch, and record the
   output in the phase report.
8. **Haiku cost.**
   - **Articles:** three articles of at least 2,500 words, the "long article" of DESIGN §6. `fixtures/docs` has two
     (`goblog-pipelines` 3,331 words, `docusaurus-code-blocks` 2,566); capture a third prose-heavy page with
     `eval:capture`.
   - **Run:** `pnpm run eval -- --provider openrouter --strategy contextual --chunk-tokens 1200 --docs <ids>
     --price 1,0.1,5`.
   - **Record:** tokens, calls, wall time, list-price cost and OpenRouter's billed cost.
   - **Document:** in `docs/provider-matrix.md` (new section "Cost per long article") and in the README "Measured"
     table, against ≈ $0.04.
9. **`eval/README.md`.** Document what the gate checks, when it runs, how to re-baseline (a deliberate commit of
   `gate.json` plus the runs), and the rule from step 6 on when to run it, since CI doesn't.

## Files

- Create: `scripts/eval/gate.ts`, `scripts/eval/gate.test.ts`, `scripts/eval-gate.mjs`, `eval/gate.json`,
  `eval/runs/gate-baseline-{1..5}/`, and the third long fixture document.
- Modify: `package.json` (script), `scripts/eval/report-core.ts` (export the helpers if needed), `eval/README.md`,
  `docs/provider-matrix.md`, `README.md` (the "Measured" table only).

## Verification

- `pnpm run eval:gate` passes at HEAD, and `gate.test.ts` covers pass, fail, re-run pass, judge mismatch, the
  shipped-constant match and briefed > 0.
- A local gate run at the `m6` head is green with its spend shown, and the demo-branch run is red. Both outputs are
  in the phase report.
- `pnpm check` is green. The phase report states the spend of every live run: expected under $1 on APIBOX, and
  cents on OpenRouter.

## Risks

- **The judge model changes behind APIBOX.** The gate turns red without any quality change. The model id in
  `gate.json` makes the cause visible, and re-baselining is a deliberate commit.
- **OpenRouter has no credit.** Step 8 fails. Report it and ask the user; do not estimate.
- **Someone forgets to run the gate.** CI won't catch it. This is accepted for CI simplicity (Validation Session 2).
  The rule in `eval/README.md` and the tester's per-phase run are the mitigation.
