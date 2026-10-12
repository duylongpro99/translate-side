# Phase 1 report: eval regression gate and Haiku cost

Status: the eval regression gate is done and recorded green. The Haiku cost measurement (step 8) was skipped by the user's decision (2026-10-12): OpenRouter has no credit.

Branch `m6-p1`, from e749530, not pushed. The merge into `m6` waits for acceptance.

## Summary

- `pnpm run eval:gate` translates the 23 eval passages with the shipped default and scores them with the pinned judge. It fails when any dimension's mean is below the baseline mean minus that dimension's margin. The default is `DEFAULT_PROFILE` over `DEFAULT_CONNECTION` with `PANEL_STRATEGY`'s translate prompt, at chunk 400.
- The gate is local only, as decided in Validation Session 2. CI has no eval job and holds no secret.
- The baseline is 5 runs at the shipped default. Each margin is max(2 × the sample SD of the run means, 0.20). The 0.20 minimum is the user's decision from Validation Session 3.
- The gate ran green on the shipped default at c7ed294, on its first pass, for $0.1438.
- A deliberately worse translate prompt turns the gate red on three dimensions (demo 2).
- `pnpm check` is green: 1729 tests, 53 of them in `scripts/eval`.

## Commits

| commit | change |
|---|---|
| 75b8df0 | feat(eval): local regression gate over the shipped default against a stored judge baseline |
| 1e64625 | test(fixtures): capture the Rust book ownership chapter as a third long article |
| 2d540b9 | fix(eval): gate takes the translate prompt from the engine and pins the judge's thinking |
| 15c6f71 | docs(eval): what the regression gate checks, when to run it and how to re-baseline |
| d20a6a8 | fix(eval): refuse an unknown gate option with exit 2 instead of throwing |
| dcc05b0 | fix(eval): gate survives reading judge.json while the judge rewrites it |
| 4846c8e | test(eval): regression gate baseline of five runs of the shipped default |
| 936b33b | docs(eval): the regression gate turns red on a deliberately worse translate prompt |
| c7ed294 | fix(eval): raise the gate's minimum margin to 0.20 |
| f1a9849 | docs(eval): record the 0.20 margin floor decision and correct the noise wording |
| a8c71fa | docs(eval): record a green gate run on the shipped default |
| 8df9299 | docs(eval): report on the regression gate and the blocked cost measurement |
| 7ede48f | docs(eval): add the tester's green pass to the gate run history and flag tone's spread |
| (this commit) | docs: record that the Haiku cost measurement is skipped |

## Changed files

- New: `scripts/eval/gate.ts`, `scripts/eval/gate.test.ts`, `scripts/eval/providers.ts` (the provider table, moved out of `run.ts`), `scripts/eval-gate.mjs`, `eval/gate.json`, `eval/runs/gate-baseline-1..5/` and `fixtures/docs/mdbook-rust-book-ownership.json` (4,558 words, captured for step 8 before it was skipped).
- Changed: `scripts/eval/run.ts` (it imports the providers and their quirks), `scripts/eval/report-core.ts` (`dimensionMeans`), `package.json` (`eval:gate`) and `eval/README.md` (the "Regression gate" section).
- Plan: phase 1 step 3 now says 0.20 and step 8 is marked skipped, and `plan.md` has Validation Session 3 (the margin floor and the skipped Haiku cost).
- Reports: `plans/reports/eval-gate-261012-0742-worse-prompt-demo.md` and `plans/reports/eval-gate-261012-0910-green-run-at-head.md`.

## Baseline (eval/gate.json)

Five runs of the gate configuration. The engine (`src/`) was identical to e749530 for all five. Runs 1–3 were made by the process started at 75b8df0/1e64625, and runs 4–5 after the dcc05b0 fix, when the baseline resumed. Each run briefed 10 or 11 chunks and revised 50, 50, 48, 50 and 50 segments.

| dimension | runs | baseline | SD | margin | floor | M2 c400 | M2 c400 − margin |
|---|---|---|---|---|---|---|---|
| fidelity | 4.17 4.22 4.30 4.39 4.04 | 4.23 | 0.132 | 0.26 | 3.96 | 4.04 | 3.78 |
| naturalness | 3.83 3.87 3.96 4.04 3.83 | 3.90 | 0.094 | 0.20 | 3.70 | 3.91 | 3.71 |
| tone | 4.48 4.48 4.74 4.74 4.57 | 4.60 | 0.132 | 0.26 | 4.34 | 4.65 | 4.39 |
| terminology | 4.48 4.43 4.52 4.57 4.39 | 4.48 | 0.069 | 0.20 | 4.28 | 4.43 | 4.23 |

The step 4 check passes: every baseline mean is at or above the M2 c400 judge mean minus its margin.

## Margin decision

The baseline was first written with a 0.10 minimum. Naturalness's margin was then 0.19 and terminology's 0.137. Two valid passes of the unchanged shipped default went red on terminology alone, at 4.30 against a floor of 4.34. The reviewer judged this to be judge noise, not drift: a different set of passages lost a point each time, and the pooled SD over 8 passes is 0.10. The user raised the minimum to 0.20 (Validation Session 3), and `gate.json` was recomputed from the same five runs with no new calls (c7ed294). The runs' `judge.json` files and `createdAt` are unchanged.

## Green run (§3 #3)

Before this run, the shipped default had 4 scored passes: 2 green, one of them the tester's run (4.26, 3.78, 4.61, 4.52), and 2 red at the old 0.10 terminology floor that are green at 0.20. The table is in `plans/reports/eval-gate-261012-0910-green-run-at-head.md`. The tester's runs are not in the spend below.

`pnpm run eval:gate` at c7ed294, 2026-10-12 08:53, the only eval run against APIBOX at the time:

```
pass 1: GREEN (972 s)
| dimension | baseline | margin | floor | score | vs baseline | |
|---|---|---|---|---|---|---|
| fidelity | 4.23 | 0.26 | 3.96 | 4.17 | −0.05 | ok |
| naturalness | 3.90 | 0.20 | 3.70 | 3.74 | −0.17 | ok |
| tone | 4.60 | 0.26 | 4.34 | 4.35 | −0.25 | ok |
| terminology | 4.48 | 0.20 | 4.28 | 4.43 | −0.04 | ok |
passages scored 23/23, briefed chunks 11, revised segments 50, lost 0/149
spend: translate $0.0058 + judge $0.1379 = $0.1438
eval gate GREEN: 1 pass(es), spend $0.1438 at nominal prices
```

## Demo 2 (§7)

On a throwaway branch in its own worktree, both deleted afterwards, translate@2's goal and its first two rules were replaced with word-for-word, literal-idiom, flat-register instructions. The gate's first pass was valid and red. Under the 0.20 floors it is still red on fidelity (3.87 < 3.96), naturalness (3.52 < 3.70) and terminology (3.83 < 4.28). Tone was 4.35 against a floor of 4.34. The full diff and table are in `plans/reports/eval-gate-261012-0742-worse-prompt-demo.md`.

## Live spend

All amounts are at the nominal prices in `scripts/eval/pricing.ts`; the APIBOX prices there are unverified.

| run | result | spend |
|---|---|---|
| Baseline runs 1–5 | used | $0.7866 ($0.1652, $0.1724, $0.1502, $0.1455, $0.1533) |
| First baseline run 4 | outage: no response for 60 s, 2 segments lost, judge timed out at 19/23; discarded | $0.1197 |
| Gate on the default, 2026-10-11, pass 1 | valid, red on terminology 4.30 (0.10 minimum) | $0.1618 |
| same gate, pass 2 | outage: two calls hung, translation timed out | $0.0048 |
| Demo 2, pass 1 | valid, red | $0.1532 |
| Demo 2, pass 2 | outage: two calls hung, translation timed out | $0.0027 |
| Solo gate, 2026-10-12, 04:53, both passes | outage: no call answered, nothing translated | $0.0000 |
| Solo gate, 2026-10-12, 08:28, pass 1 | valid, red on terminology 4.30 (0.10 minimum) | $0.1611 |
| same gate, pass 2 | stopped when the margin decision arrived (19 passages translated, not judged) | $0.0055 |
| Recorded green run, c7ed294 | GREEN | $0.1438 |
| **Total** | | **$1.5392** |

The fixture capture made no LLM calls. Step 8 made no calls.

## Outage passes

Five passes ended without a verdict because APIBOX stopped answering chat requests. In each one a call hung until the pass's 25-minute timeout. The gate reported each as a failed pass with no scores, which is the intended behaviour: a pass without a full judge is never green. During the outage on 2026-10-12, `/v1/models` answered with HTTP 200 in 0.9 s, while a 5-token chat request got no answer for 978 s.

## Step 8: cost per long article on Haiku 4.5 (§3 #4)

**Skipped by user decision (2026-10-12): no OpenRouter credit; not measured, not estimated.** `docs/provider-matrix.md` ("Cost per long article") and the README "Measured" table are not written. The third long article is captured and committed (1e64625), and success criterion #4 is marked skipped in `plan.md` (Validation Session 3).

For a later run, once there is credit: `pnpm run eval -- --provider openrouter --strategy contextual --chunk-tokens 1200 --docs goblog-pipelines,docusaurus-code-blocks,mdbook-rust-book-ownership --price 1,0.1,5`. The target is ≈ $0.04 per long article (DESIGN §6).

## When to run the gate

From `eval/README.md`. CI does not run the gate. Run `pnpm run eval:gate` locally, and record its tables and spend in the PR or phase report:

- before merging any change to `src/engine/**`, `src/llm/**`, `src/shared/settings.ts`, `src/shared/presets.ts`, `src/entrypoints/sidepanel/jobs.ts`, `scripts/eval/**` or `eval/**`;
- in every test pass over a diff that touches those paths;
- in the release-candidate check.

One pass takes about 15 minutes and costs about $0.15. A gate run stops at $0.50.

## Open items

1. **No per-call timeout in the harness.** One hung call uses up the whole 25-minute pass, and the pass ends without a verdict. The gate handles this correctly (never green), but an outage costs a pass. By the supervisor's ruling, this is out of scope for this phase.
2. **The harness writes no commit.** `summary.json` has no `gitCommit` field, and never had one. The baseline runs' provenance is recorded in this report and in `gate.json`'s `createdAt`.
3. **Tone cleared its floor by 0.01 on the green run** (4.35 against 4.34), and its scores spread widely across the scored passes of the shipped default: 4.70, 4.61, 4.48 and 4.35. That is within the measured judge noise (pooled SD 0.10), but tone is the dimension to watch in the next gate runs.
4. **Step 8 is skipped** by the user's decision; nothing was measured or estimated (above).
