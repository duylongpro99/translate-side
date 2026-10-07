# Eval comparison

Scores are 1–5 means over the passages scored (n). Columns after the first show the change from the first run (single-pass / translate@1 / qwen3.8-flash). Human scores are the source of truth; judge scores are shown for regression checks until calibrated.

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 | contextual / translate@1+analyze@1 / qwen3.8-flash / chunk 400 (local, not committed) |
|---|---|---|---|---|
| human fidelity | – | – | – | – |
| human naturalness | – | – | – | – |
| human tone | – | – | – | – |
| human terminology | – | – | – | – |
| **human overall** | – | – | – | – |
| judge fidelity | 4.43 n=23 | 4.22 (-0.22) n=23 | 4.04 (-0.39) n=23 | 4.26 (-0.17) n=23 |
| judge naturalness | 4.04 n=23 | 4.00 (-0.04) n=23 | 3.91 (-0.13) n=23 | 4.04 (+0.00) n=23 |
| judge tone | 4.65 n=23 | 4.70 (+0.04) n=23 | 4.65 (+0.00) n=23 | 4.78 (+0.13) n=23 |
| judge terminology | 4.70 n=23 | 4.74 (+0.04) n=23 | 4.43 (-0.26) n=23 | 4.48 (-0.22) n=23 |
| **judge overall** | 4.46 | 4.41 (-0.04) | 4.26 (-0.20) | 4.39 (-0.07) |
| judge vs human (mean abs. diff · bias · within 1 · pairs) | – | – | – | – |
| judge model | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) |
| passages translated | 23 | 23 | 23 | 23 |
| segments lost after repair | 0/149 | 0/149 | 0/149 | 0/149 |
| segments repaired | 0 | 1 | 0 | 0 |
| LLM calls | 23 | 25 | 56 | 45 |
| input / output tokens | 17980 / 9699 | 25493 / 9805 | 66516 / 35426 | 31242 / 18437 |
| translation cost | $0.0015 | $0.0017 (×1.17) | $0.0053 (×3.59) | $0.0027 (×1.84) |
| wall time (s) | 185 | 185 | 453 | 300 |
| judge cost | $0.1336 | $0.1324 | $0.1515 | $0.1394 |

## human overall by category

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 | contextual / translate@1+analyze@1 / qwen3.8-flash / chunk 400 (local, not committed) |
|---|---|---|---|---|
| docs (8) | – | – | – | – |
| humor (6) | – | – | – | – |
| opinion (4) | – | – | – | – |
| tech-blog (5) | – | – | – | – |

## judge overall by category

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 | contextual / translate@1+analyze@1 / qwen3.8-flash / chunk 400 (local, not committed) |
|---|---|---|---|---|
| docs (8) | 4.66 | 4.63 (-0.03) | 4.16 (-0.50) | 4.56 (-0.09) |
| humor (6) | 4.08 | 4.13 (+0.04) | 4.21 (+0.13) | 3.96 (-0.12) |
| opinion (4) | 4.31 | 4.25 (-0.06) | 4.69 (+0.38) | 4.44 (+0.13) |
| tech-blog (5) | 4.70 | 4.55 (-0.15) | 4.15 (-0.55) | 4.60 (-0.10) |


## Notes (Phase F)

- Runs: m2 @ 8bc7484 (recorded as `gitCommit` in each committed run's summary.json), APIBOX qwen3.8-flash, 23 eval passages. Column 1 is the frozen single-pass baseline (judge at 3497cc0). The third contextual column (translate@1, chunk 400) is local, not committed: judge-only, no human sheet, not under `eval/runs/`.
- Judge noise: ds/deepseek-v4-pro re-run on the contextual@2 c1500 outputs, committed as `eval/runs/baseline-contextual-translate2-qwen3.8-flash/judge-rerun.json` (the report table uses `judge.json`). Re-judge: overall 4.36 (fidelity 4.30, naturalness 3.96, tone 4.57, terminology 4.61) against 4.41 the first time. On the re-judge, tone (4.57) and terminology (4.61) are below single-pass (4.65 and 4.70), as is fidelity (4.30 vs 4.43). Per-score mean absolute difference between the two judge runs is 0.27, identical in 73% of scores, within 1 point in 100%. Differences of about 0.1 between runs are inside this noise.
- Single-chunk consequence: at c1500 all 23 eval passages are one chunk, so analyze and the brief never run and no brief reaches translation. contextual@2 c1500 vs single-pass@1 differs only by the translate prompt version (plus the check stage). The M6 regression gate therefore cannot catch brief regressions from this baseline; the c400 run is kept as a reference run for the path where the brief is used (it has the `*.brief.json` files).
- Plan §3 #2 (cost ≤ 1.3x single-pass), per run: c1500 x1.17 met; c400 x3.59 not met; contextual@1 c400 x1.84 not met.
- Plan §3 #1 (judge only, contextual vs single-pass on fidelity / tone / terminology): c1500 first judge fidelity -0.22, tone +0.04, terminology +0.04; on the re-judge fidelity -0.13, tone -0.08, terminology -0.09. Not met on fidelity either time; tone and terminology are within judge noise of single-pass and flip sign between the two judge runs. The human scores decide.

## M2 baseline and status

- **M2 baseline (M2-D22): contextual@2 c1500**, `eval/runs/baseline-contextual-translate2-qwen3.8-flash`. This is the run M6's regression gate will defend. The c400 run (`eval/runs/baseline-contextual-translate2-qwen3.8-flash-c400`, see its README.md) is kept as a reference run, not as the baseline.
- **Plan §3 #1 is pending (M2-D21):** it waits for the human scores on the three sheets (frozen single-pass, contextual c1500, contextual c400).
