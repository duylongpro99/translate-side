# Eval gate: recorded green run on the shipped default

The regression gate ran green on its first pass, against `eval/gate.json` with the 0.20 minimum margin.

- Commit: `m6-p1` at c7ed294. The engine (`src/`) is unchanged since e749530, the commit the baseline ran at. f1a9849, which followed during the run, changes documentation only.
- Command: `pnpm run eval:gate` (2026-10-12, 08:53 Asia/Saigon), the only eval run against APIBOX at that time.
- Configuration: apibox/qwen3.8-flash, contextual@2 (translate@2), chunk 400, 2 in flight. Judge ds/deepseek-v4-pro (judge@1, thinking medium).

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
eval gate GREEN: 1 pass(es), spend $0.1438 at nominal prices (APIBOX prices unverified, scripts/eval/pricing.ts)
```

The translation made 57 calls over the 23 passages, including one marker repair, no lost segments, and 25 of 25 code-bearing segments preserved. Tone cleared its floor by 0.01.

## Earlier runs of the same code

| run | fidelity | naturalness | tone | terminology | verdict at the time | under the 0.20 minimum |
|---|---|---|---|---|---|---|
| 2026-10-11 pass 1 | 4.22 | 3.87 | 4.70 | 4.30 | red, terminology < 4.34 | green |
| 2026-10-12 pass 1 | 4.26 | 3.78 | 4.48 | 4.30 | red, terminology < 4.34 | green |

Four other passes ended without a verdict because APIBOX stopped answering chat requests: two on 2026-10-11, after the first pass in the table, and two on 2026-10-12, early in the morning. The gate correctly reported them as failed passes with no scores.
