# Eval run 2026-10-11T13-39-18-920Z

Strategy `contextual` (translate@2, analyze@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 400 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 2 (1) | 4 | 5248 | 0 | 2815 | 23.8 | 2.3 | $0.00043 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 958 | 0 | 338 | 6.5 | 3.2 | $0.00006 |
| rust-async-await-primer | 8 | 0 | 0 | 2 (1) | 4 | 5298 | 0 | 3663 | 33.8 | 1.7 | $0.00051 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 1108 | 0 | 477 | 7.5 | 2.9 | $0.00008 |
| so-branch-prediction | 11 | 0 | 0 | 2 (1) | 4 | 5105 | 0 | 2062 | 17.8 | 1.3 | $0.00036 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 1037 | 0 | 362 | 6.5 | 1.5 | $0.00007 |
| k8s-pods | 10 | 0 | 0 | 2 (1) | 4 | 5014 | 0 | 2799 | 25.5 | 1.3 | $0.00042 |
| mdn-closures | 6 | 0 | 0 | 2 (1) | 4 | 4711 | 0 | 2550 | 22.9 | 1.3 | $0.00039 |
| mdn-using-promises | 8 | 0 | 0 | 2 (1) | 4 | 4846 | 0 | 1544 | 12.1 | 1.4 | $0.00030 |
| rust-async-executor | 7 | 0 | 0 | 2 (1) | 4 | 5307 | 0 | 2236 | 18.3 | 1.6 | $0.00038 |
| rust-book-ownership | 4 | 0 | 0 | 2 (1) | 4 | 4795 | 0 | 1322 | 10.7 | 1.3 | $0.00028 |
| rust-book-panic | 7 | 0 | 0 | 2 (1) | 4 | 5048 | 0 | 3875 | 38.1 | 1.5 | $0.00053 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 941 | 0 | 289 | 5.0 | 2.7 | $0.00006 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 892 | 0 | 210 | 4.3 | 1.3 | $0.00005 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 1030 | 0 | 397 | 6.5 | 1.5 | $0.00007 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 978 | 0 | 385 | 7.8 | 2.9 | $0.00007 |
| wp-template-regulars | 4 | 0 | 0 | 2 (0) | 3 | 2577 | 0 | 1397 | 13.3 | 2.0 | $0.00021 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 968 | 0 | 289 | 7.0 | 2.1 | $0.00006 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 1135 | 0 | 497 | 8.6 | 1.5 | $0.00008 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 1003 | 0 | 382 | 7.7 | 7.4 | $0.00007 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 1023 | 0 | 400 | 8.0 | 7.1 | $0.00007 |
| wodehouse-jeeves | 4 | 0 | 0 | 2 (1) | 4 | 5071 | 0 | 2905 | 27.0 | 2.4 | $0.00044 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 971 | 0 | 290 | 6.1 | 1.4 | $0.00006 |
| **total** | 149 | 0 | 0 | 34 (10) | 55 | 65064 | 0 | 31484 | 324.7 | | $0.00504 |

Brief (analyze@1): parsed for 10/11 docs asked (12 one-chunk docs skipped, M2-D9); 8172 in / 5090 out tokens, $0.00074 (in the totals above). Per doc: go-errors-are-values ok 7.6s, go-share-memory skipped –, rust-async-await-primer ok 7.3s, rust-async-ecosystem skipped –, so-branch-prediction ok 4.6s, docker-multistage skipped –, k8s-pods ok 5.6s, mdn-closures ok 4.8s, mdn-using-promises ok 5.4s, rust-async-executor ok 5.0s, rust-book-ownership ok 5.5s, rust-book-panic ok 7.2s, wp-not-a-dictionary skipped –, go-gofmt skipped –, go2-here-we-come skipped –, wp-dont-bite-newcomers skipped –, wp-template-regulars none 6.7s, bierce-devils-dictionary skipped –, pep20-zen skipped –, so-regex-html skipped –, swift-modest-proposal skipped –, wodehouse-jeeves ok 6.0s, wp-beans skipped –.
Characters per token (provider-counted; the engine assumes 3.5): input 4.16, output 1.80 over 44 calls.
S2 thresholds on 34 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.27, over 1.2/1.4/1.6: 12/5/3; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.60.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 13341 tokens over 11 calls, max 2595; OUTLIERS (≥ 2000 reasoning tokens or cut by the cap): rust-async-await-primer call 9 (chunk 1) 2231 tokens, 26.4s, stop end; rust-book-panic call 39 (chunk 1) 2595 tokens, 30.9s, stop end.
Nonce probe not run (--probe-nonce).
