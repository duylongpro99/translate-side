---
title: "Phase 2: Eval: refine vs contextual, Best baseline"
status: todo
priority: P2
effort: "1.5d + owner"
dependencies: [1]
---

# Phase 2: Eval: refine vs contextual, Best baseline

## Goal

The harness runs `refine`, reports it against `contextual` with scores, review accept/reject counts and the cost
ratio, and the gate has a separate Best baseline. `review@N` is iterated until refine clears the margin, or the
owner is told that it did not.

## Context links

- Source: `docs/plans/M7-stronger-translation.md` §3 #1, #2, #6, §6 M7-E6, §7 demo 1.
- Pricing: `plans/reports/brainstorm-261013-1036-free-pro-pricing.md` (Pro waits for the margin).
- Gate design: `plans/261011-1206-m6-release-hardening/phase-01-eval-regression-gate.md`, `eval/README.md`.
- Scout: risks 7, 9 (eval mock), 12.

## Requirements

1. `pnpm run eval -- --strategy refine` works with real providers and with `--mock`; the mock answers review calls.
2. `pnpm run eval:report` shows refine against contextual: the judge dimensions, the cost ratio, the token ratio, and
   the review accepted, rejected and skipped counts.
3. `pnpm run eval:gate` keeps gating Balanced unchanged; `pnpm run eval:gate -- --mode best` gates refine against
   `eval/gate-best.json`.
4. The margin rule for §3 #1 is fixed before the live runs (below).

## Decisions

- **Risk 7 (gate binding).** `shippedConfig()` in `scripts/eval/gate.ts` is resolved from `PANEL_STRATEGY` (`:14`, `:103`)
  and stays that way for the default mode. A `--mode best` flag builds the same config with `strategy: 'refine'`, its
  version and `reviewPrompt`, and reads and writes `eval/gate-best.json`. The two files never share a baseline. The
  strategy lookup at `:103` becomes `[singlePass, contextual, refine]`.
<!-- Red Team: paired same-session margin -->
<!-- Updated: Validation Session 1 - paired design adopted for the margin -->
- **The §3 #1 margin (paired, same session).** One session runs 10 passes at chunk 400 on the eval set, interleaved
  C, R, C, R, … (5 `contextual`, 5 `refine`), with the same translate model, the same pinned judge and the same
  day. Δd = mean(refine runs) − mean(contextual runs of that session) for dimension d. Refine passes when
  Δfidelity ≥ margin(fidelity) **or** Δnaturalness ≥ margin(naturalness), and every dimension has Δd ≥ −margin(d).
  The margins are those in `eval/gate.json` (0.26 for fidelity and tone, 0.20 for naturalness and terminology,
  M6 Validation Session 3). The M6 baseline in `eval/gate.json` is used only as a drift check: if this session's
  contextual mean differs from it by more than its margin on any dimension, the report says so and the owner
  decides whether to proceed. "Human" is the owner's blind sheet (`pnpm run eval:sheet`) on at least 10 of the 23
  passages: refine must be preferred on a **strict majority of the non-tied passages**.
- **Cost (§3 #2).** The ratio of `costUsd` over the same passages at chunk 400, and the ratio of input plus output
  tokens as a check, because the APIBOX prices in `scripts/eval/pricing.ts` are nominal. Both must be ≤ 2.
<!-- Updated: Validation Session 1 - Best is held back if the margin is missed -->
- **Time box.** At most three prompt versions (`review@1..3`). If `review@3` still misses the margin, stop and report
  to the owner with the numbers. Best is then **held back from store releases** (neither shipped free nor sold)
  until a later prompt passes; phase 7 sets the release switch accordingly (`BEST_MODE_RELEASED`, phase 4).
- **Risk 12 (live cost).** Every live run is marked **owner** below. Agents never read `.env`. Each live step states
  its expected spend from `SPEND_CAP_USD` (`scripts/eval/gate.ts`, $0.50 per pass).

## Architecture and data flow

```
run.ts --strategy refine [--review-prompt review@N] ─► engine (createRefine) ─► events
  finals: highest revision wins (run.ts:321-326, already); chunk events with `review` → summary.review counts
  summary.json { strategy: refine, version, prompts: { translate, analyze, review } }
report.ts ─► table: scores, cost ×ratio (report-core.ts:120), review counts
gate.ts --mode best ─► shippedConfig('best') ─► eval/gate-best.json (baseline, sd, margin per dimension)
```

## Related files

- **Modify:**
  - `scripts/eval/run.ts`: the strategy whitelist at `:181-184`, `PROMPTS` at `:186`, a `--review-prompt` flag, the
    mock client at `:104-128` (a user message that starts with `<review>` gets `<none/>` for odd ids and the draft
    plus a fixed suffix for even ids, so both paths run), and review counts in the summary;
  - `scripts/eval/runs.ts` (the summary type), `scripts/eval/report-core.ts` and `scripts/eval/report.test.ts`;
  - `scripts/eval/gate.ts` and `scripts/eval/gate.test.ts` (`--mode best`);
  - `eval/README.md` (how and when to run the Best gate);
  - `src/engine/prompts/review.ts` (the iterations, after phase 1 is accepted);
  - `scripts/eval/latency.ts`: a `--strategy` flag passed to `Jobs` through its `strategy` test seam
    (`src/entrypoints/sidepanel/jobs.ts:416`); the live latency run is in phase 7.
- **Create:** `eval/gate-best.json` (written by the gate's `--baseline` mode, never by hand), and
  `eval/runs/<refine runs>/` (by the harness).

## Implementation steps

1. Accept `refine` in `run.ts` and `--review-prompt` (default `REVIEW_PROMPT_ID`). Use `createRefine` with the
   chosen translate and review prompts. Refine requires translate@2.
2. Teach the mock client the review shape, and add review counts (accepted, unchanged, rejected, skipped) to `DocResult` and
   the summary.
3. Add the refine columns to the report: the existing cost ratio, a token ratio, and the review counts.
4. Add `--mode best` to `gate.ts`. Check that some segments were reviewed in a pass, as it already checks that some
   chunks were briefed. Add tests in `gate.test.ts` for the config, the file choice and the reviewed-segments check.
5. Mock dry run (agent): `pnpm run eval -- --mock --set eval --strategy refine --chunk-tokens 400` and
   `pnpm run eval:report` on it, with the output pasted into the phase report.
6. **Owner.** Screening: run contextual and refine (`review@1`) once each, interleaved, at chunk 400 on the eval
   set; judge both; report the paired Δd, the cost ratio and the rejected rate. Expected spend: about 2 × the gate's
   per-pass cost. <!-- Red Team: paired same-session margin -->
7. If the margin is missed, the implementer writes `review@2` (then `review@3`) from the judge's notes and the
   rejected candidates, never by loosening `checkSegment`; the owner repeats step 6.
8. **Owner.** With the chosen `review@N`, run the paired session (5 contextual + 5 refine, interleaved, same
   judge) for the margin decision, with the drift check, and fill the blind sheet. Expected spend: about 10 × the
   per-pass cost. <!-- Red Team: paired same-session margin -->
9. **Owner.** When the margin is met: `pnpm run eval:gate -- --mode best --baseline 5` writes `eval/gate-best.json`
   (it runs its own 5 passes; reusing the paired session's 5 refine run folders instead saves that spend, if the
   gate can read existing folders `[UNVERIFIED]`);
   then `pnpm run eval:gate` (Balanced) and `pnpm run eval:gate -- --mode best` are both recorded green.

## Todo

- [ ] `run.ts` accepts `refine` and `--review-prompt`; the mock answers review calls
- [ ] Review counts in the summary and the report; cost and token ratios
- [ ] `gate.ts --mode best` with its own file and the reviewed-segments check, tested
- [ ] `latency.ts --strategy`
- [ ] Mock dry run recorded
- [ ] Owner: review@1 live runs and Δd table
- [ ] Iterations up to review@3 if needed, each with its numbers
- [ ] Owner: paired 5 + 5 session, drift check, margin decision and the blind sheet (strict majority of non-tied)
- [ ] Owner: `eval/gate-best.json` written; both gates green

## Success criteria

- §3 #1: the paired margin rule above holds, and the blind sheet gives refine a strict majority of the non-tied
  passages; or the owner has the report that it does not, and Best is held back (Validation Session 1).
- §3 #2: the cost ratio and the token ratio are both ≤ 2.
- §3 #6: `eval/gate.json` is unchanged by this phase, and `eval/gate-best.json` exists with 5 runs.

## Verification

- `pnpm vitest run scripts/eval/gate.test.ts scripts/eval/report.test.ts`
- `pnpm run eval -- --mock --set eval --strategy refine --chunk-tokens 400`
- **Owner:** `pnpm run eval -- --set eval --strategy refine --chunk-tokens 400`, `pnpm run eval:judge`,
  `pnpm run eval:report`, `pnpm run eval:gate -- --mode best`
- `pnpm check`

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| Refine misses the margin | M × H | Time box of three versions; Best is then held back from releases (Validation Session 1). |
| Judge or model drift fakes a gain | M × H | Paired same-session runs; the M6 baseline only as a drift check; strict-majority sheet. <!-- Red Team: paired same-session margin --> |
| The review's rejected rate is high, so refine ≈ contextual at about 1.7× cost | M × M | Report the rejected candidates by check kind; fix the prompt, not the checks. |
| A prompt change during iteration breaks phase 3's tests | L × L | Phase 3 tests use `REVIEW_PROMPT_ID`, never a literal. |

**Rollback.** Revert the scripts; `eval/gate.json` was never touched. A bad `review@N` is rolled back by setting the
default back to the earlier version; the cache key changes with it.

## Security

The harness reads keys only through the owner's environment (`eval/README.md`). Run folders contain page text from
the public eval set and no keys. `eval/gate-best.json` contains only scores, ids and config.
