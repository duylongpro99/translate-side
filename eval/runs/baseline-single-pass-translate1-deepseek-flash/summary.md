# Eval run 2026-10-07T02-46-09-276Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `apibox/ds/deepseek-flash`, target `vi`, chunk 1500 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 1 (0) | 1 | 869 | 0 | 895 | 4.3 | 1.4 | $0.00044 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 644 | 256 | 489 | 3.0 | 1.8 | $0.00023 |
| rust-async-await-primer | 8 | 0 | 0 | 1 (0) | 1 | 846 | 256 | 694 | 3.7 | 1.2 | $0.00034 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 797 | 256 | 634 | 3.2 | 1.6 | $0.00031 |
| so-branch-prediction | 11 | 0 | 0 | 1 (0) | 1 | 889 | 256 | 857 | 4.3 | 1.2 | $0.00041 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 720 | 256 | 480 | 2.5 | 1.0 | $0.00024 |
| k8s-pods | 10 | 0 | 0 | 1 (0) | 1 | 849 | 256 | 691 | 3.5 | 1.0 | $0.00034 |
| mdn-closures | 6 | 0 | 0 | 1 (0) | 1 | 750 | 256 | 529 | 2.7 | 1.1 | $0.00026 |
| mdn-using-promises | 8 | 0 | 0 | 1 (0) | 1 | 701 | 256 | 524 | 2.6 | 1.0 | $0.00025 |
| rust-async-executor | 7 | 0 | 0 | 1 (0) | 1 | 834 | 256 | 681 | 3.3 | 0.9 | $0.00033 |
| rust-book-ownership | 4 | 0 | 0 | 1 (0) | 1 | 742 | 256 | 637 | 3.0 | 0.9 | $0.00030 |
| rust-book-panic | 7 | 0 | 0 | 1 (0) | 1 | 887 | 256 | 756 | 3.1 | 0.7 | $0.00037 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 620 | 256 | 426 | 2.6 | 1.8 | $0.00021 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 581 | 256 | 296 | 1.7 | 0.8 | $0.00015 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 713 | 256 | 568 | 2.9 | 1.0 | $0.00027 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 662 | 256 | 604 | 3.0 | 1.4 | $0.00028 |
| wp-template-regulars | 4 | 0 | 0 | 1 (0) | 1 | 704 | 256 | 637 | 3.3 | 1.2 | $0.00030 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 651 | 256 | 466 | 3.2 | 1.3 | $0.00023 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 791 | 256 | 613 | 2.9 | 0.9 | $0.00030 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 691 | 256 | 536 | 3.4 | 3.4 | $0.00026 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 713 | 256 | 622 | 4.2 | 3.8 | $0.00030 |
| wodehouse-jeeves | 4 | 0 | 0 | 1 (0) | 1 | 823 | 256 | 714 | 3.8 | 1.3 | $0.00034 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 657 | 256 | 482 | 3.5 | 1.3 | $0.00023 |
| **total** | 149 | 0 | 0 | 23 (0) | 23 | 17134 | 5632 | 13831 | 73.8 | | $0.00669 |

Characters per token (provider-counted; the engine assumes 3.5): input 4.24, output 2.52 over 23 calls.
S2 thresholds on 23 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 1.77, over 1.2/1.4/1.6: 13/7/2; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.89.
Nonce probe not run (--probe-nonce).
