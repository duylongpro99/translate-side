# M6 phase 1 review — eval regression gate (round 1)

Commits reviewed: 75b8df0 (gate), 1e64625 (third long fixture), on `m6-p1` over e749530.
Verdict: **one blocking finding** (B1). The rest are non-blocking.

Checked and fine:
- The harness is unchanged after `providers.ts` moved out of `run.ts`. A mock run (`node scripts/eval.mjs --mock --docs goblog-pipelines`) lost 0/73 segments, and its `summary.json` holds no absolute path.
- `vitest run scripts/eval` passes 45/45. `pnpm run typecheck` and `eslint scripts/eval` are clean.
- The gate gets its model, quirks and strategy from `DEFAULT_PROFILE`, `DEFAULT_CONNECTION` and `PANEL_STRATEGY`, and it refuses when the quirks drift.
- It runs at chunk 400 and asserts `briefedChunks > 0` and `revised > 0`.
- The margin is max(2 × sample SD, 0.10). A failed pass gets one re-run, and the gate is red only when both passes fail.
- Timeouts and the spend cap end a pass with a verdict and the table. The remaining budget is passed to the second pass.
- The gate refuses on a judge model or prompt-id mismatch, a missing key or a missing `gate.json`. The cap is $0.50, and the means are reused from `report-core.ts`.
- A pass without real spend can't be green. The test list covers every case the phase file names.
- The fixture is 121 segments and about 4.5k words, and it holds no paths or usernames. The commits have no plan IDs and no AI references.

## Blocking

**B1 — the gate hard-codes the translate prompt instead of taking the shipped one.**
- Where: `scripts/eval/gate.ts:90` (`strategy.id === contextual.id ? 'translate@2' : 'translate@1'`). The tests pin the literal at `gate.test.ts:40` and `:47`.
- Failure: someone changes the shipped prompt by bumping `CONTEXTUAL_TRANSLATE_PROMPT_ID` (`src/engine/strategies/contextual.ts:47`) to a new `translate@3`. The gate still passes `--prompt translate@2`, so it scores the old prompt and stays green. The shipped prompt goes untested, and the "default differs" note doesn't fire, because `cfg.translatePrompt` is computed the same way both times.
- Violates: phase step 1 ("uses their model, quirks and strategy" from the shipped constants), and plan §5 "run on changes to `engine/prompts`".
- Fix: use `CONTEXTUAL_TRANSLATE_PROMPT_ID` / `TRANSLATE_PROMPT_ID` from `@/engine/index`, and have the test assert against those constants rather than the literal.

## Non-blocking

**N1 — the code and README say every passage is multi-chunk at 400, but 13 of 23 are one chunk.**
- Where: `gate.ts:3-4`, `gate.ts:23` and the eval/README "What it checks" paragraph.
- Evidence: the M2 c400 `summary.json` has 34 chunks. Eleven docs have 2 chunks (1 of them briefed), and 12 have 1 chunk. The live baseline run shows the same thing: `go-share-memory.brief.json` is `null`.
- Effect: the brief and revise path runs on only 10–11 passages, so a regression confined to that path is diluted about 2×. The `briefed > 0` assertion still holds.
- Fix: correct the wording. A lower chunk size could make every passage multi-chunk, but that is a plan decision, not the reviewer's.

**N2 — the judge's thinking setting is not pinned.**
- `judge.json` records `reasoning` (effort medium, reserve 16000), and `judge.ts:59-60` already treats it as part of score identity (`sameThinking`).
- `gate.json` and `judgeMismatch` (`gate.ts:104`, `:173`) check only the model and the prompt id. A change to `APIBOX_JUDGE_QUIRKS` would therefore compare scores that aren't comparable, without a refusal.
- Suggestion: record the judge's `reasoning.effort` in `gate.json` and compare it too.

**N3 — no validation of `--baseline` or `--timeout-min`.**
- Where: `gate.ts:386` and `:400`.
- `--baseline 0` or `--baseline x` runs zero passes. `computeDimensions` then divides by zero, the means are NaN, `belowM2` is false, and a `gate.json` full of nulls is written with exit 0.
- `--timeout-min x` makes the deadline NaN, so `setTimeout` fires at once and every pass "times out".
- `--baseline 1` gives an SD of 0, so the margin silently falls to 0.10.
- Suggestion: require an integer n ≥ 2 (or exactly 5) and a positive timeout.

**N4 — plan IDs in a new file's comments.**
- `scripts/eval/providers.ts:2` has "(M2-D11, M2-D14)" and `:18` has "M4-F (G5)".
- The comments were moved verbatim from `run.ts`, but they are now in a new file, and the plan Constraints rule out plan IDs in code comments. This is a trivial fix: drop the IDs or reword.

**N5 — the per-pass timeout is reset for the second pass.**
- The worst case is 2 × 25 min plus the judge's tail. That is inside the red-team's 60 min, so this is fine. It's noted only because the README states the timeout per pass but not the total. No change is needed.

## Not yet delivered (outstanding phase work, not findings)

- `eval/gate.json` and `eval/runs/gate-baseline-{1..5}`: baseline run 1 was in progress at review time.
- The §3 #3 check of the baseline against M2 c400 (needs the baseline).
- Demo 2 (the red run), and a recorded green gate run with its spend.
- The Haiku cost run (step 8), with `docs/provider-matrix.md` "Cost per long article" and the README "Measured" row.
- `eval/README.md` is modified but uncommitted in the worktree. I reviewed that draft (N1 applies to it).

## Could not check

- Live gate behaviour (the timeout kill, the spend-cap kill, and the re-run against real calls). It needs paid calls, and the baseline is running in that worktree. Review it when the recorded outputs arrive.
- Whether the committed baseline runs are clean of absolute paths. The mock `summary.json` and the M2 c400 run are clean; re-check the `gate-baseline-*` runs when they are committed.
