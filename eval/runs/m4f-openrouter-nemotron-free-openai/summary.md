# Eval run 2026-10-09T04-35-31-625Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `openrouter/nvidia/nemotron-3-super-120b-a12b:free`, target `vi`, chunk 1500 tokens, 1 in flight. 

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 7 | 0 | 1 (0) | 2 | 1778 | 0 | 2304 | 18.5 | – | $0.00000 |
| docker-multistage | 8 | 8 | 0 | 1 (0) | 2 | 1480 | 0 | 1584 | 13.2 | – | $0.00000 |
| mdn-closures | 6 | 6 | 0 | 1 (0) | 2 | 1536 | 0 | 1792 | 15.9 | – | $0.00000 |
| go-gofmt | 7 | 7 | 0 | 1 (0) | 2 | 1200 | 0 | 788 | 9.3 | – | $0.00000 |
| pep20-zen | 21 | 21 | 0 | 1 (0) | 2 | 1650 | 0 | 1656 | 13.1 | – | $0.00000 |
| wodehouse-jeeves | 4 | 4 | 0 | 1 (0) | 2 | 1674 | 0 | 1900 | 16.0 | – | $0.00000 |
| **total** | 53 | 53 | 0 | 6 (0) | 12 | 9318 | 0 | 10024 | 85.9 | | $0.00000 |

Characters per token (provider-counted; the engine assumes 3.5): input 4.05, output 0.00 over 12 calls.
S2 thresholds on 6 chunks / 53 segments: 0 chunks with parser fixes {}, 53 re-requested, 0 flagged merged; length ratio vs chunk median: max 0.00, over 1.2/1.4/1.6: 0/0/0; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 1.00.
Thinking: none.
Nonce probe not run (--probe-nonce).

go-errors-are-values errors: unknown: The model did not return this segment in a usable form

docker-multistage errors: unknown: The model did not return this segment in a usable form

mdn-closures errors: unknown: The model did not return this segment in a usable form

go-gofmt errors: unknown: The model did not return this segment in a usable form

pep20-zen errors: unknown: The model did not return this segment in a usable form

wodehouse-jeeves errors: unknown: The model did not return this segment in a usable form
