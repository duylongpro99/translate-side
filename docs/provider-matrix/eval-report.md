# Eval comparison

Scores are 1–5 means over the passages scored (n). Columns after the first show the change from the first run (single-pass / translate@1 / gemini-3.5-flash-lite). Human scores are the source of truth; judge scores are shown for regression checks until calibrated.

| | single-pass / translate@1 / gemini-3.5-flash-lite | single-pass / translate@1 / qwen3.8-flash | single-pass / translate@1 / gemma4:31b / chunk 1200 | single-pass / translate@1 / gpt-oss:20b / chunk 1200 |
|---|---|---|---|---|
| human fidelity | – | – | – | – |
| human naturalness | – | – | – | – |
| human tone | – | – | – | – |
| human terminology | – | – | – | – |
| **human overall** | – | – | – | – |
| judge fidelity | 4.17 n=23 | 4.39 (+0.22) n=23 | 4.04 (-0.13) n=23 | 3.43 (-0.74) n=23 |
| judge naturalness | 3.78 n=23 | 3.96 (+0.17) n=23 | 4.39 (+0.61) n=23 | 3.17 (-0.61) n=23 |
| judge tone | 4.57 n=23 | 4.78 (+0.22) n=23 | 4.65 (+0.09) n=23 | 3.78 (-0.78) n=23 |
| judge terminology | 4.43 n=23 | 4.83 (+0.39) n=23 | 4.74 (+0.30) n=23 | 3.52 (-0.91) n=23 |
| **judge overall** | 4.24 | 4.49 (+0.25) | 4.46 (+0.22) | 3.48 (-0.76) |
| judge vs human (mean abs. diff · bias · within 1 · pairs) | – | – | – | – |
| judge model | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) | ds/deepseek-v4-pro (judge@1) |
| passages translated | 23 | 23 | 23 | 23 |
| segments lost after repair | 0/149 | 0/149 | 0/149 | 0/149 |
| segments repaired | 1 | 0 | 0 | 0 |
| LLM calls | 24 | 23 | 23 | 23 |
| input / output tokens | 18521 / 10517 | 17980 / 9638 | 18018 / 10187 | 18605 / 10407 |
| translation cost | $0.0318 | $0.0015 (×0.05) | n/a | n/a |
| wall time (s) | 107 | 173 | 320 | 136 |
| judge cost | $0.1335 | $0.1301 | $0.1216 | $0.1390 |

## judge overall by category

| | single-pass / translate@1 / gemini-3.5-flash-lite | single-pass / translate@1 / qwen3.8-flash | single-pass / translate@1 / gemma4:31b / chunk 1200 | single-pass / translate@1 / gpt-oss:20b / chunk 1200 |
|---|---|---|---|---|
| docs (8) | 4.41 | 4.53 (+0.13) | 4.66 (+0.25) | 3.78 (-0.63) |
| humor (6) | 3.88 | 4.29 (+0.42) | 4.17 (+0.29) | 2.67 (-1.21) |
| opinion (4) | 4.31 | 4.44 (+0.13) | 4.38 (+0.06) | 3.81 (-0.50) |
| tech-blog (5) | 4.35 | 4.70 (+0.35) | 4.55 (+0.20) | 3.70 (-0.65) |

- single-pass / translate@1 / gemini-3.5-flash-lite: no human scores yet (no human sheet)
- single-pass / translate@1 / qwen3.8-flash: no human scores yet (no human sheet)
- single-pass / translate@1 / gemma4:31b / chunk 1200: no human scores yet (no human sheet)
- single-pass / translate@1 / gpt-oss:20b / chunk 1200: no human scores yet (no human sheet)
