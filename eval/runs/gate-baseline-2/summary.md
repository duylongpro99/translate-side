# Eval run 2026-10-11T13-23-59-642Z

Strategy `contextual` (translate@2, analyze@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 400 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 2 (1) | 4 | 5089 | 0 | 2192 | 19.3 | 2.2 | $0.00037 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 958 | 0 | 338 | 6.3 | 3.1 | $0.00006 |
| rust-async-await-primer | 8 | 0 | 0 | 2 (1) | 4 | 5325 | 0 | 3393 | 30.0 | 1.9 | $0.00049 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 1108 | 0 | 477 | 7.9 | 3.1 | $0.00008 |
| so-branch-prediction | 11 | 0 | 0 | 2 (1) | 4 | 5144 | 0 | 2861 | 24.3 | 1.6 | $0.00043 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 1037 | 0 | 383 | 6.6 | 2.1 | $0.00007 |
| k8s-pods | 10 | 0 | 0 | 2 (1) | 4 | 5006 | 0 | 4387 | 44.0 | 1.6 | $0.00057 |
| mdn-closures | 6 | 0 | 0 | 2 (1) | 4 | 4796 | 0 | 2330 | 21.3 | 1.3 | $0.00037 |
| mdn-using-promises | 8 | 0 | 0 | 2 (1) | 4 | 4805 | 0 | 2276 | 20.8 | 2.0 | $0.00037 |
| rust-async-executor | 7 | 0 | 0 | 2 (1) | 4 | 5347 | 0 | 1690 | 15.5 | 1.4 | $0.00033 |
| rust-book-ownership | 4 | 0 | 0 | 2 (1) | 4 | 4622 | 0 | 3486 | 32.4 | 1.5 | $0.00048 |
| rust-book-panic | 7 | 0 | 0 | 2 (1) | 4 | 4936 | 0 | 5050 | 48.1 | 1.8 | $0.00063 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 941 | 0 | 287 | 5.0 | 2.7 | $0.00006 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 892 | 0 | 228 | 4.7 | 1.4 | $0.00005 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 1030 | 0 | 394 | 6.9 | 1.3 | $0.00007 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 978 | 0 | 376 | 7.8 | 3.1 | $0.00007 |
| wp-template-regulars | 4 | 0 | 0 | 2 (1) | 4 | 4727 | 0 | 2165 | 20.0 | 2.1 | $0.00035 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 968 | 0 | 278 | 6.6 | 2.0 | $0.00006 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 1135 | 0 | 492 | 9.9 | 2.7 | $0.00008 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 1003 | 0 | 398 | 8.0 | 7.9 | $0.00007 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 1023 | 0 | 399 | 8.6 | 7.7 | $0.00007 |
| wodehouse-jeeves | 4 | 0 | 0 | 2 (1) | 4 | 5029 | 0 | 2578 | 24.4 | 2.8 | $0.00040 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 971 | 0 | 289 | 6.1 | 1.5 | $0.00006 |
| **total** | 149 | 0 | 0 | 34 (11) | 56 | 66870 | 0 | 36747 | 384.6 | | $0.00559 |

Brief (analyze@1): parsed for 11/11 docs asked (12 one-chunk docs skipped, M2-D9); 8172 in / 4906 out tokens, $0.00072 (in the totals above). Per doc: go-errors-are-values ok 4.7s, go-share-memory skipped –, rust-async-await-primer ok 6.4s, rust-async-ecosystem skipped –, so-branch-prediction ok 6.7s, docker-multistage skipped –, k8s-pods ok 6.2s, mdn-closures ok 6.1s, mdn-using-promises ok 5.3s, rust-async-executor ok 5.6s, rust-book-ownership ok 5.0s, rust-book-panic ok 4.6s, wp-not-a-dictionary skipped –, go-gofmt skipped –, go2-here-we-come skipped –, wp-dont-bite-newcomers skipped –, wp-template-regulars ok 8.5s, bierce-devils-dictionary skipped –, pep20-zen skipped –, so-regex-html skipped –, swift-modest-proposal skipped –, wodehouse-jeeves ok 5.9s, wp-beans skipped –.
Characters per token (provider-counted; the engine assumes 3.5): input 4.16, output 1.53 over 45 calls.
S2 thresholds on 34 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.04, over 1.2/1.4/1.6: 11/2/2; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.63.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 18475 tokens over 11 calls, max 3790; OUTLIERS (≥ 2000 reasoning tokens or cut by the cap): rust-async-await-primer call 9 (chunk 1) 2039 tokens, 23.6s, stop end; k8s-pods call 19 (chunk 1) 3117 tokens, 37.8s, stop end; rust-book-ownership call 35 (chunk 1) 2418 tokens, 27.4s, stop end; rust-book-panic call 39 (chunk 1) 3790 tokens, 42.5s, stop end.
Nonce probe not run (--probe-nonce).
