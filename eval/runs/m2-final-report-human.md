# Eval comparison

Scores are 1–5 means over the passages scored (n). Columns after the first show the change from the first run (single-pass / translate@1 / qwen3.8-flash). Human scores are the source of truth; judge scores are shown for regression checks until calibrated.

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 |
|---|---|---|---|
| human fidelity | 4.50 n=23 | 4.57 (+0.07) n=23 | 4.50 (+0.00) n=23 |
| human naturalness | 4.39 n=23 | 4.11 (-0.28) n=23 | 3.61 (-0.78) n=23 |
| human tone | 4.41 n=23 | 4.24 (-0.17) n=23 | 3.96 (-0.46) n=23 |
| human terminology | 4.20 n=23 | 4.07 (-0.13) n=23 | 3.72 (-0.48) n=23 |
| **human overall** | 4.38 | 4.24 (-0.13) | 3.95 (-0.43) |
| judge fidelity | 4.43 n=23 | 4.22 (-0.22) n=23 | 4.04 (-0.39) n=23 |
| judge naturalness | 4.04 n=23 | 4.00 (-0.04) n=23 | 3.91 (-0.13) n=23 |
| judge tone | 4.65 n=23 | 4.70 (+0.04) n=23 | 4.65 (+0.00) n=23 |
| judge terminology | 4.70 n=23 | 4.74 (+0.04) n=23 | 4.43 (-0.26) n=23 |
| **judge overall** | 4.46 | 4.41 (-0.04) | 4.26 (-0.20) |
| judge vs human (mean abs. diff · bias · within 1 · pairs) | 0.59 · +0.08 · 93% · 92 | 0.58 · +0.17 · 96% · 92 | 0.71 · +0.32 · 87% · 92 |
| judge model | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) |
| passages translated | 23 | 23 | 23 |
| segments lost after repair | 0/149 | 0/149 | 0/149 |
| segments repaired | 0 | 1 | 0 |
| LLM calls | 23 | 25 | 56 |
| input / output tokens | 17980 / 9699 | 25493 / 9805 | 66516 / 35426 |
| translation cost | $0.0015 | $0.0017 (×1.17) | $0.0053 (×3.59) |
| wall time (s) | 185 | 185 | 453 |
| judge cost | $0.1336 | $0.1324 | $0.1515 |

## human overall by category

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 |
|---|---|---|---|
| docs (8) | 4.42 | 4.28 (-0.14) | 3.95 (-0.47) |
| humor (6) | 4.27 | 4.15 (-0.13) | 3.85 (-0.42) |
| opinion (4) | 4.50 | 4.41 (-0.09) | 4.13 (-0.38) |
| tech-blog (5) | 4.33 | 4.17 (-0.15) | 3.90 (-0.43) |

## judge overall by category

| | single-pass / translate@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash | contextual / translate@2+analyze@1 / qwen3.8-flash / chunk 400 |
|---|---|---|---|
| docs (8) | 4.66 | 4.63 (-0.03) | 4.16 (-0.50) |
| humor (6) | 4.08 | 4.13 (+0.04) | 4.21 (+0.13) |
| opinion (4) | 4.31 | 4.25 (-0.06) | 4.69 (+0.38) |
| tech-blog (5) | 4.70 | 4.55 (-0.15) | 4.15 (-0.55) |
