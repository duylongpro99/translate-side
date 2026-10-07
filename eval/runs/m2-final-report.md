# Eval comparison

Scores are 1–5 means over the passages scored (n). Columns after the first show the change from the first run (single-pass / translate@1 / qwen3.8-flash). Human scores are the source of truth; judge scores are shown for regression checks until calibrated.

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 | contextual / translate@1+analyze@1 / qwen3.8-flash / chunk 400 |
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

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 | contextual / translate@1+analyze@1 / qwen3.8-flash / chunk 400 |
|---|---|---|---|---|
| docs (8) | – | – | – | – |
| humor (6) | – | – | – | – |
| opinion (4) | – | – | – | – |
| tech-blog (5) | – | – | – | – |

## judge overall by category

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 | contextual / translate@1+analyze@1 / qwen3.8-flash / chunk 400 |
|---|---|---|---|---|
| docs (8) | 4.66 | 4.63 (-0.03) | 4.16 (-0.50) | 4.56 (-0.09) |
| humor (6) | 4.08 | 4.13 (+0.04) | 4.21 (+0.13) | 3.96 (-0.12) |
| opinion (4) | 4.31 | 4.25 (-0.06) | 4.69 (+0.38) | 4.44 (+0.13) |
| tech-blog (5) | 4.70 | 4.55 (-0.15) | 4.15 (-0.55) | 4.60 (-0.10) |


## Notes (Phase F)

- Runs: m2 @ 8bc7484, APIBOX qwen3.8-flash, 23 eval passages. Column 1 is the frozen single-pass baseline (judge at 3497cc0). The third contextual column (translate@1, chunk 400) is judge-only; no human sheet is committed for it.
- Judge noise: ds/deepseek-v4-pro re-run on the contextual@2 c1500 outputs gave overall 4.36 (fid 4.30, nat 3.96, tone 4.57, term 4.61) against 4.41 the first time; per-score mean absolute difference 0.27, identical in 73% of scores, within 1 point in 100%. Differences of about 0.1 between runs are inside this noise.
- At chunk 1500 every eval passage is one chunk, so no brief reaches translation; contextual@2 vs single-pass@1 there differs by the translate prompt version only.
