# Eval run 2026-10-07T12-49-29-713Z

Strategy `contextual` (translate@2, analyze@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 400 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 2 (1) | 4 | 5253 | 1024 | 4668 | 51.4 | 2.1 | $0.00058 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 958 | 0 | 335 | 6.3 | 2.9 | $0.00006 |
| rust-async-await-primer | 8 | 0 | 0 | 2 (1) | 4 | 5147 | 0 | 2480 | 31.0 | 1.5 | $0.00040 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 1108 | 1024 | 473 | 8.3 | 3.5 | $0.00005 |
| so-branch-prediction | 11 | 0 | 0 | 2 (1) | 4 | 5197 | 1024 | 3102 | 40.1 | 2.1 | $0.00043 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 1037 | 1024 | 392 | 6.2 | 1.4 | $0.00004 |
| k8s-pods | 10 | 0 | 0 | 2 (1) | 4 | 4947 | 0 | 4681 | 59.6 | 1.5 | $0.00060 |
| mdn-closures | 6 | 0 | 0 | 2 (1) | 4 | 4736 | 0 | 3088 | 35.7 | 1.2 | $0.00044 |
| mdn-using-promises | 8 | 0 | 0 | 2 (1) | 4 | 4578 | 0 | 2005 | 27.8 | 1.3 | $0.00033 |
| rust-async-executor | 7 | 0 | 0 | 2 (1) | 4 | 5325 | 0 | 2753 | 30.8 | 3.1 | $0.00043 |
| rust-book-ownership | 4 | 0 | 0 | 2 (1) | 4 | 4868 | 0 | 1651 | 19.9 | 1.4 | $0.00031 |
| rust-book-panic | 7 | 0 | 0 | 2 (1) | 4 | 4797 | 0 | 2407 | 27.5 | 1.6 | $0.00038 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 941 | 0 | 290 | 5.9 | 3.0 | $0.00006 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 892 | 0 | 215 | 5.2 | 1.6 | $0.00005 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 1030 | 0 | 394 | 7.0 | 1.4 | $0.00007 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 978 | 0 | 376 | 6.4 | 2.6 | $0.00007 |
| wp-template-regulars | 4 | 0 | 0 | 2 (1) | 4 | 4617 | 0 | 1696 | 21.6 | 2.4 | $0.00031 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 968 | 0 | 280 | 6.5 | 1.7 | $0.00006 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 1135 | 0 | 503 | 9.3 | 1.5 | $0.00008 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 1003 | 0 | 387 | 7.4 | 7.1 | $0.00007 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 1023 | 0 | 392 | 7.5 | 6.6 | $0.00007 |
| wodehouse-jeeves | 4 | 0 | 0 | 2 (1) | 4 | 5007 | 0 | 2568 | 25.8 | 2.9 | $0.00040 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 971 | 0 | 290 | 6.2 | 1.4 | $0.00006 |
| **total** | 149 | 0 | 0 | 34 (11) | 56 | 66516 | 4096 | 35426 | 453.4 | | $0.00534 |

Brief (analyze@1): parsed for 11/11 docs asked (12 one-chunk docs skipped, M2-D9); 8172 in / 4810 out tokens, $0.00071 (in the totals above). Per doc: go-errors-are-values ok 8.2s, go-share-memory skipped –, rust-async-await-primer ok 8.7s, rust-async-ecosystem skipped –, so-branch-prediction ok 8.6s, docker-multistage skipped –, k8s-pods ok 7.1s, mdn-closures ok 8.6s, mdn-using-promises ok 9.9s, rust-async-executor ok 7.7s, rust-book-ownership ok 9.2s, rust-book-panic ok 5.5s, wp-not-a-dictionary skipped –, go-gofmt skipped –, go2-here-we-come skipped –, wp-dont-bite-newcomers skipped –, wp-template-regulars ok 10.1s, bierce-devils-dictionary skipped –, pep20-zen skipped –, so-regex-html skipped –, swift-modest-proposal skipped –, wodehouse-jeeves ok 8.3s, wp-beans skipped –.
Characters per token (provider-counted; the engine assumes 3.5): input 4.16, output 1.60 over 45 calls.
S2 thresholds on 34 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.27, over 1.2/1.4/1.6: 14/6/4; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.61.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 17228 tokens over 11 calls, max 3397; OUTLIERS (≥ 2000 reasoning tokens or cut by the cap): go-errors-are-values call 4 (chunk 1) 3196 tokens, 43.1s, stop end; k8s-pods call 19 (chunk 1) 3397 tokens, 52.4s, stop end.
Nonce probe not run (--probe-nonce).
