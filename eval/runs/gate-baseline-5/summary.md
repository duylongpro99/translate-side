# Eval run 2026-10-11T14-30-58-288Z

Strategy `contextual` (translate@2, analyze@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 400 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 1 | 2 (1) | 5 | 7130 | 1024 | 5199 | 55.3 | 2.3 | $0.00069 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 958 | 0 | 337 | 5.2 | 2.6 | $0.00006 |
| rust-async-await-primer | 8 | 0 | 0 | 2 (1) | 4 | 5167 | 0 | 2428 | 21.2 | 1.4 | $0.00039 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 1108 | 0 | 469 | 8.0 | 3.5 | $0.00008 |
| so-branch-prediction | 11 | 0 | 0 | 2 (1) | 4 | 5199 | 0 | 2278 | 18.2 | 1.5 | $0.00038 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 1037 | 0 | 370 | 6.0 | 1.6 | $0.00007 |
| k8s-pods | 10 | 0 | 0 | 2 (1) | 4 | 4986 | 0 | 3037 | 30.1 | 1.3 | $0.00045 |
| mdn-closures | 6 | 0 | 0 | 2 (1) | 4 | 4720 | 0 | 2961 | 25.9 | 1.7 | $0.00043 |
| mdn-using-promises | 8 | 0 | 0 | 2 (1) | 4 | 4595 | 0 | 1360 | 10.7 | 1.6 | $0.00027 |
| rust-async-executor | 7 | 0 | 0 | 2 (1) | 4 | 5344 | 0 | 2075 | 17.6 | 2.0 | $0.00037 |
| rust-book-ownership | 4 | 0 | 0 | 2 (1) | 4 | 4810 | 0 | 2023 | 18.3 | 1.4 | $0.00034 |
| rust-book-panic | 7 | 0 | 4 | 2 (1) | 5 | 6584 | 1024 | 7782 | 79.1 | 1.4 | $0.00091 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 941 | 0 | 303 | 6.2 | 3.1 | $0.00006 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 892 | 0 | 220 | 4.4 | 1.4 | $0.00005 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 1030 | 0 | 394 | 7.3 | 1.5 | $0.00007 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 978 | 0 | 373 | 6.8 | 2.3 | $0.00007 |
| wp-template-regulars | 4 | 0 | 0 | 2 (1) | 4 | 4637 | 0 | 2134 | 18.5 | 2.4 | $0.00035 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 968 | 0 | 280 | 6.0 | 1.5 | $0.00006 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 1135 | 0 | 498 | 9.1 | 1.5 | $0.00008 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 1003 | 0 | 383 | 7.4 | 7.2 | $0.00007 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 1023 | 0 | 408 | 8.1 | 7.1 | $0.00007 |
| wodehouse-jeeves | 4 | 0 | 0 | 2 (1) | 4 | 5101 | 0 | 2685 | 23.7 | 2.4 | $0.00042 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 971 | 0 | 286 | 5.3 | 1.4 | $0.00006 |
| **total** | 149 | 0 | 5 | 34 (11) | 58 | 70317 | 2048 | 38283 | 398.3 | | $0.00579 |

Brief (analyze@1): parsed for 11/11 docs asked (12 one-chunk docs skipped, M2-D9); 8172 in / 4733 out tokens, $0.00071 (in the totals above). Per doc: go-errors-are-values ok 6.1s, go-share-memory skipped –, rust-async-await-primer ok 5.8s, rust-async-ecosystem skipped –, so-branch-prediction ok 6.3s, docker-multistage skipped –, k8s-pods ok 6.1s, mdn-closures ok 4.9s, mdn-using-promises ok 4.7s, rust-async-executor ok 5.6s, rust-book-ownership ok 6.1s, rust-book-panic ok 5.2s, wp-not-a-dictionary skipped –, go-gofmt skipped –, go2-here-we-come skipped –, wp-dont-bite-newcomers skipped –, wp-template-regulars ok 6.3s, bierce-devils-dictionary skipped –, pep20-zen skipped –, so-regex-html skipped –, swift-modest-proposal skipped –, wodehouse-jeeves ok 7.0s, wp-beans skipped –.
Characters per token (provider-counted; the engine assumes 3.5): input 4.17, output 1.48 over 47 calls.
S2 thresholds on 34 chunks / 149 segments: 0 chunks with parser fixes {}, 4 re-requested, 0 flagged merged; length ratio vs chunk median: max 1.98, over 1.2/1.4/1.6: 12/5/2; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 1.00.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 20037 tokens over 11 calls, max 6548; OUTLIERS (≥ 2000 reasoning tokens or cut by the cap): go-errors-are-values call 4 (chunk 1) 3613 tokens, 43.5s, stop end; rust-book-panic call 40 (chunk 1) 6548 tokens, 68.8s, stop max_tokens.
Nonce probe not run (--probe-nonce).
