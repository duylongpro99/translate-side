# Eval run 2026-10-09T06-13-41-393Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `openrouter/poolside/laguna-s-2.1:free`, target `vi`, chunk 1500 tokens, 1 in flight. 

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 749 | 0 | 758 | 13.4 | 1.6 | $0.00000 |
| go-gofmt | 7 | 1 | 2 | 1 (0) | 3 | 1574 | 0 | 628 | 17.2 | 1.3 | $0.00000 |
| wodehouse-jeeves | 4 | 0 | 1 | 1 (0) | 3 | 1411 | 416 | 1229 | 35.2 | 6.1 | $0.00000 |
| **total** | 19 | 1 | 3 | 3 (0) | 7 | 3734 | 416 | 2615 | 65.8 | | $0.00000 |

Characters per token (provider-counted; the engine assumes 3.5): input 3.85, output 1.93 over 5 calls.
S2 thresholds on 3 chunks / 19 segments: 1 chunks with parser fixes {"stray":1}, 4 re-requested, 0 flagged merged; length ratio vs chunk median: max 1.52, over 1.2/1.4/1.6: 3/1/0; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.97.
Thinking: none.
Nonce probe not run (--probe-nonce).

go-gofmt errors: unknown: The translation failed the quality checks (markers, code, links, numbers or length)
