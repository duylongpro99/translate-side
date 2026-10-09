# Eval run 2026-10-09T03-59-31-974Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 1500 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 1 (0) | 1 | 905 | 0 | 595 | 8.7 | 2.2 | $0.00008 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 681 | 0 | 348 | 5.9 | 2.6 | $0.00005 |
| rust-async-await-primer | 8 | 0 | 0 | 1 (0) | 1 | 879 | 0 | 527 | 9.9 | 1.6 | $0.00008 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 831 | 0 | 470 | 8.3 | 3.3 | $0.00007 |
| so-branch-prediction | 11 | 0 | 0 | 1 (0) | 1 | 939 | 0 | 568 | 11.3 | 1.7 | $0.00008 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 760 | 0 | 361 | 6.5 | 1.6 | $0.00006 |
| k8s-pods | 10 | 0 | 0 | 1 (0) | 1 | 883 | 0 | 524 | 8.7 | 1.1 | $0.00008 |
| mdn-closures | 6 | 0 | 0 | 1 (0) | 1 | 778 | 0 | 392 | 6.0 | 1.3 | $0.00006 |
| mdn-using-promises | 8 | 0 | 0 | 1 (0) | 1 | 736 | 0 | 374 | 7.9 | 1.5 | $0.00006 |
| rust-async-executor | 7 | 0 | 0 | 1 (0) | 1 | 867 | 0 | 507 | 8.4 | 1.3 | $0.00008 |
| rust-book-ownership | 4 | 0 | 0 | 1 (0) | 1 | 772 | 0 | 417 | 7.3 | 1.1 | $0.00006 |
| rust-book-panic | 7 | 0 | 0 | 1 (0) | 1 | 913 | 0 | 533 | 9.5 | 1.3 | $0.00008 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 664 | 0 | 292 | 4.2 | 2.3 | $0.00005 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 615 | 0 | 229 | 4.4 | 1.2 | $0.00004 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 753 | 0 | 398 | 7.3 | 1.5 | $0.00006 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 701 | 0 | 381 | 7.6 | 2.8 | $0.00006 |
| wp-template-regulars | 4 | 0 | 0 | 1 (0) | 1 | 740 | 0 | 393 | 6.9 | 2.1 | $0.00006 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 691 | 0 | 309 | 5.8 | 1.5 | $0.00005 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 858 | 0 | 495 | 8.4 | 1.4 | $0.00007 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 726 | 0 | 370 | 7.2 | 6.9 | $0.00006 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 746 | 0 | 397 | 7.9 | 6.8 | $0.00006 |
| wodehouse-jeeves | 4 | 0 | 0 | 1 (0) | 1 | 848 | 0 | 478 | 10.1 | 2.8 | $0.00007 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 694 | 0 | 280 | 5.3 | 1.4 | $0.00005 |
| **total** | 149 | 0 | 0 | 23 (0) | 23 | 17980 | 0 | 9638 | 173.5 | | $0.00148 |

Characters per token (provider-counted; the engine assumes 3.5): input 4.04, output 3.67 over 23 calls.
S2 thresholds on 23 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.51, over 1.2/1.4/1.6: 12/6/4; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.60.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 0 tokens over 0 calls, max 0; no outliers (≥ 2000).
Nonce probe not run (--probe-nonce).
