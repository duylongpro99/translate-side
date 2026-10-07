# Eval run 2026-10-07T07-15-22-734Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 1500 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 1 (0) | 1 | 905 | 0 | 603 | 10.7 | 2.2 | $0.00009 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 681 | 0 | 352 | 6.7 | 3.4 | $0.00005 |
| rust-async-await-primer | 8 | 0 | 0 | 1 (0) | 1 | 879 | 0 | 520 | 9.3 | 1.5 | $0.00008 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 831 | 0 | 469 | 9.3 | 3.7 | $0.00007 |
| so-branch-prediction | 11 | 0 | 0 | 1 (0) | 1 | 939 | 0 | 566 | 8.9 | 1.4 | $0.00008 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 760 | 0 | 375 | 6.6 | 1.8 | $0.00006 |
| k8s-pods | 10 | 0 | 0 | 1 (0) | 1 | 883 | 0 | 522 | 8.6 | 1.8 | $0.00008 |
| mdn-closures | 6 | 0 | 0 | 1 (0) | 1 | 778 | 0 | 388 | 6.4 | 1.3 | $0.00006 |
| mdn-using-promises | 8 | 0 | 0 | 1 (0) | 1 | 736 | 0 | 377 | 7.1 | 1.6 | $0.00006 |
| rust-async-executor | 7 | 0 | 0 | 1 (0) | 1 | 867 | 0 | 511 | 8.9 | 1.5 | $0.00008 |
| rust-book-ownership | 4 | 0 | 0 | 1 (0) | 1 | 772 | 0 | 422 | 8.2 | 1.5 | $0.00006 |
| rust-book-panic | 7 | 0 | 0 | 1 (0) | 1 | 913 | 0 | 556 | 9.8 | 1.5 | $0.00008 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 664 | 0 | 286 | 5.6 | 2.9 | $0.00005 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 615 | 0 | 227 | 5.0 | 1.3 | $0.00004 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 753 | 0 | 397 | 7.2 | 1.5 | $0.00006 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 701 | 0 | 391 | 7.9 | 3.0 | $0.00006 |
| wp-template-regulars | 4 | 0 | 0 | 1 (0) | 1 | 740 | 0 | 410 | 8.8 | 2.9 | $0.00006 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 691 | 0 | 282 | 7.2 | 3.3 | $0.00005 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 858 | 0 | 497 | 9.2 | 1.3 | $0.00007 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 726 | 0 | 381 | 7.9 | 7.7 | $0.00006 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 746 | 0 | 401 | 8.0 | 6.9 | $0.00006 |
| wodehouse-jeeves | 4 | 0 | 0 | 1 (0) | 1 | 848 | 0 | 475 | 10.7 | 3.1 | $0.00007 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 694 | 0 | 291 | 7.1 | 1.8 | $0.00005 |
| **total** | 149 | 0 | 0 | 23 (0) | 23 | 17980 | 0 | 9699 | 184.8 | | $0.00149 |

Characters per token (provider-counted; the engine assumes 3.5): input 4.04, output 3.67 over 23 calls.
S2 thresholds on 23 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.51, over 1.2/1.4/1.6: 11/3/2; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.15.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":3000}]}, cap via max_completion_tokens. Reasoning: 0 tokens over 0 calls, max 0; no outliers (≥ 2000).
Nonce probe not run (--probe-nonce).
