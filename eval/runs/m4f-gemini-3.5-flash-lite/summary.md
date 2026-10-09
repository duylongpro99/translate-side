# Eval run 2026-10-09T03-59-53-267Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `gemini/gemini-3.5-flash-lite`, target `vi`, chunk 1500 tokens, 2 in flight. 

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 1 (0) | 1 | 895 | 0 | 630 | 4.5 | 1.2 | $0.00184 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 665 | 0 | 358 | 2.6 | 1.2 | $0.00109 |
| rust-async-await-primer | 8 | 0 | 0 | 1 (0) | 1 | 872 | 0 | 568 | 4.3 | 1.4 | $0.00168 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 821 | 0 | 517 | 4.1 | 1.9 | $0.00154 |
| so-branch-prediction | 11 | 0 | 0 | 1 (0) | 1 | 922 | 0 | 610 | 3.6 | 0.9 | $0.00180 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 748 | 0 | 408 | 2.9 | 1.0 | $0.00124 |
| k8s-pods | 10 | 0 | 0 | 1 (0) | 1 | 868 | 0 | 559 | 3.5 | 0.9 | $0.00166 |
| mdn-closures | 6 | 0 | 0 | 1 (0) | 1 | 763 | 0 | 426 | 3.1 | 0.8 | $0.00129 |
| mdn-using-promises | 8 | 0 | 0 | 1 (0) | 1 | 720 | 0 | 403 | 3.1 | 1.2 | $0.00122 |
| rust-async-executor | 7 | 0 | 0 | 1 (0) | 1 | 857 | 0 | 525 | 3.6 | 1.2 | $0.00157 |
| rust-book-ownership | 4 | 0 | 0 | 1 (0) | 1 | 760 | 0 | 426 | 3.1 | 1.2 | $0.00129 |
| rust-book-panic | 7 | 0 | 0 | 1 (0) | 1 | 902 | 0 | 587 | 3.9 | 0.9 | $0.00174 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 647 | 0 | 316 | 2.8 | 1.7 | $0.00098 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 599 | 0 | 238 | 2.2 | 0.9 | $0.00077 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 738 | 0 | 428 | 3.6 | 1.0 | $0.00129 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 684 | 0 | 408 | 30.4 | 29.0 | $0.00123 |
| wp-template-regulars | 4 | 0 | 0 | 1 (0) | 1 | 721 | 0 | 427 | 2.5 | 0.9 | $0.00128 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 666 | 0 | 340 | 2.8 | 1.2 | $0.00105 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 845 | 0 | 502 | 4.1 | 1.0 | $0.00151 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 708 | 0 | 422 | 3.6 | 3.4 | $0.00127 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 726 | 0 | 430 | 3.9 | 3.4 | $0.00129 |
| wodehouse-jeeves | 4 | 0 | 0 | 1 (0) | 1 | 839 | 0 | 485 | 4.1 | 1.6 | $0.00146 |
| wp-beans | 4 | 0 | 1 | 1 (0) | 2 | 1555 | 0 | 504 | 5.1 | 0.9 | $0.00173 |
| **total** | 149 | 0 | 1 | 23 (0) | 24 | 18521 | 0 | 10517 | 107.4 | | $0.03185 |

Characters per token (provider-counted; the engine assumes 3.5): input 4.11, output 3.55 over 24 calls.
S2 thresholds on 23 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.85, over 1.2/1.4/1.6: 20/11/8; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.65.
Thinking: none.
Nonce probe not run (--probe-nonce).
