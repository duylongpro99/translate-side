# Eval run 2026-10-11T14-18-07-182Z

Strategy `contextual` (translate@2, analyze@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 400 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 2 (1) | 4 | 5309 | 0 | 5070 | 47.9 | 2.5 | $0.00065 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 958 | 0 | 338 | 8.5 | 5.3 | $0.00006 |
| rust-async-await-primer | 8 | 0 | 0 | 2 (1) | 4 | 5156 | 0 | 2359 | 20.4 | 1.7 | $0.00039 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 1108 | 0 | 472 | 7.0 | 2.9 | $0.00008 |
| so-branch-prediction | 11 | 0 | 0 | 2 (1) | 4 | 5217 | 0 | 2033 | 15.5 | 1.5 | $0.00036 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 1037 | 0 | 368 | 7.0 | 1.7 | $0.00007 |
| k8s-pods | 10 | 0 | 0 | 2 (1) | 4 | 4982 | 0 | 4638 | 44.4 | 1.4 | $0.00060 |
| mdn-closures | 6 | 0 | 0 | 2 (1) | 4 | 4775 | 0 | 2780 | 25.0 | 1.3 | $0.00041 |
| mdn-using-promises | 8 | 0 | 0 | 2 (1) | 4 | 4659 | 0 | 1524 | 11.5 | 1.3 | $0.00029 |
| rust-async-executor | 7 | 0 | 0 | 2 (1) | 4 | 5325 | 0 | 2732 | 24.2 | 1.5 | $0.00043 |
| rust-book-ownership | 4 | 0 | 0 | 2 (1) | 4 | 4742 | 0 | 1271 | 11.0 | 1.4 | $0.00027 |
| rust-book-panic | 7 | 0 | 0 | 2 (1) | 4 | 4951 | 0 | 4809 | 45.6 | 1.7 | $0.00061 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 941 | 0 | 295 | 6.5 | 3.5 | $0.00006 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 892 | 0 | 223 | 4.8 | 1.4 | $0.00005 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 1030 | 0 | 392 | 7.1 | 1.7 | $0.00007 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 978 | 0 | 368 | 7.5 | 3.6 | $0.00007 |
| wp-template-regulars | 4 | 0 | 0 | 2 (1) | 4 | 4761 | 0 | 1681 | 13.4 | 2.1 | $0.00031 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 968 | 0 | 272 | 5.0 | 1.6 | $0.00006 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 1135 | 0 | 500 | 9.4 | 1.5 | $0.00008 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 1003 | 0 | 387 | 7.5 | 7.2 | $0.00007 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 1023 | 0 | 401 | 8.4 | 7.4 | $0.00007 |
| wodehouse-jeeves | 4 | 0 | 0 | 2 (1) | 4 | 4947 | 0 | 2468 | 23.4 | 2.6 | $0.00039 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 971 | 0 | 287 | 5.5 | 1.5 | $0.00006 |
| **total** | 149 | 0 | 0 | 34 (11) | 56 | 66868 | 0 | 35668 | 366.3 | | $0.00549 |

Brief (analyze@1): parsed for 11/11 docs asked (12 one-chunk docs skipped, M2-D9); 8172 in / 4993 out tokens, $0.00073 (in the totals above). Per doc: go-errors-are-values ok 6.3s, go-share-memory skipped –, rust-async-await-primer ok 5.9s, rust-async-ecosystem skipped –, so-branch-prediction ok 6.1s, docker-multistage skipped –, k8s-pods ok 6.0s, mdn-closures ok 6.3s, mdn-using-promises ok 4.7s, rust-async-executor ok 5.4s, rust-book-ownership ok 5.5s, rust-book-panic ok 4.6s, wp-not-a-dictionary skipped –, go-gofmt skipped –, go2-here-we-come skipped –, wp-dont-bite-newcomers skipped –, wp-template-regulars ok 7.0s, bierce-devils-dictionary skipped –, pep20-zen skipped –, so-regex-html skipped –, swift-modest-proposal skipped –, wodehouse-jeeves ok 5.6s, wp-beans skipped –.
Characters per token (provider-counted; the engine assumes 3.5): input 4.17, output 1.59 over 45 calls.
S2 thresholds on 34 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.27, over 1.2/1.4/1.6: 16/6/3; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.60.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 17316 tokens over 11 calls, max 3576; OUTLIERS (≥ 2000 reasoning tokens or cut by the cap): go-errors-are-values call 4 (chunk 1) 3560 tokens, 41.6s, stop end; k8s-pods call 19 (chunk 1) 3352 tokens, 38.4s, stop end; rust-book-panic call 39 (chunk 1) 3576 tokens, 39.9s, stop end.
Nonce probe not run (--probe-nonce).
