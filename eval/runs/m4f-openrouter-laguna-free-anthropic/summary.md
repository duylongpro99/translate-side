# Eval run 2026-10-09T06-14-54-029Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `openrouter-anthropic/poolside/laguna-s-2.1:free`, target `vi`, chunk 1500 tokens, 1 in flight. 

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| docker-multistage | 8 | 0 | 1 | 1 (0) | 2 | 1258 | 0 | 957 | 26.3 | 1.9 | $0.00000 |
| go-gofmt | 7 | 1 | 0 | 1 (0) | 6 | 608 | 0 | 380 | 16.4 | 2.3 | $0.00000 |
| wodehouse-jeeves | 4 | 0 | 1 | 1 (0) | 6 | 1411 | 0 | 1235 | 45.1 | 15.7 | $0.00000 |
| **total** | 19 | 1 | 2 | 3 (0) | 14 | 3277 | 0 | 2572 | 87.8 | | $0.00000 |

Characters per token (provider-counted; the engine assumes 3.5): input 3.99, output 1.92 over 5 calls.
S2 thresholds on 3 chunks / 19 segments: 1 chunks with parser fixes {"cut":1}, 12 re-requested, 0 flagged merged; length ratio vs chunk median: max 1.29, over 1.2/1.4/1.6: 1/0/0; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 1.00.
Thinking: none.
Nonce probe not run (--probe-nonce).

go-gofmt errors: rate_limit: Provider returned error
