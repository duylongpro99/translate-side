# Eval run 2026-10-06T14-18-23-283Z

Model `gemini/gemini-3.5-flash-lite`, target `vi`, chunk 1500 tokens, 2 in flight. 

| doc | segments | lost | repaired | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 1 | 895 | 0 | 643 | 5.0 | 1.5 | $0.00188 |
| go-share-memory | 4 | 0 | 0 | 1 | 665 | 0 | 355 | 3.1 | 1.8 | $0.00109 |
| rust-async-await-primer | 8 | 0 | 0 | 1 | 872 | 0 | 547 | 4.1 | 1.0 | $0.00163 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 | 821 | 0 | 523 | 4.2 | 1.9 | $0.00155 |
| so-branch-prediction | 11 | 0 | 0 | 1 | 922 | 0 | 591 | 5.0 | 1.3 | $0.00175 |
| docker-multistage | 8 | 0 | 0 | 1 | 748 | 0 | 407 | 3.5 | 1.1 | $0.00124 |
| k8s-pods | 10 | 0 | 0 | 1 | 868 | 0 | 564 | 4.1 | 1.1 | $0.00167 |
| mdn-closures | 6 | 0 | 0 | 1 | 763 | 0 | 424 | 3.6 | 1.1 | $0.00129 |
| mdn-using-promises | 8 | 0 | 0 | 1 | 720 | 0 | 417 | 3.7 | 1.1 | $0.00126 |
| rust-async-executor | 7 | 0 | 0 | 1 | 857 | 0 | 520 | 4.4 | 0.9 | $0.00156 |
| rust-book-ownership | 4 | 0 | 0 | 1 | 760 | 0 | 429 | 3.9 | 1.1 | $0.00130 |
| rust-book-panic | 7 | 0 | 0 | 1 | 902 | 0 | 584 | 4.9 | 1.0 | $0.00173 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 | 647 | 0 | 319 | 3.4 | 2.0 | $0.00099 |
| go-gofmt | 7 | 0 | 0 | 1 | 599 | 0 | 241 | 2.4 | 1.1 | $0.00078 |
| go2-here-we-come | 4 | 0 | 0 | 1 | 738 | 0 | 426 | 4.0 | 1.0 | $0.00129 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 | 684 | 0 | 420 | 3.8 | 1.6 | $0.00126 |
| wp-template-regulars | 4 | 0 | 0 | 1 | 721 | 0 | 428 | 3.5 | 1.3 | $0.00129 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 | 666 | 0 | 332 | 3.4 | 1.3 | $0.00103 |
| pep20-zen | 21 | 0 | 0 | 1 | 845 | 0 | 499 | 4.8 | 1.2 | $0.00150 |
| so-regex-html | 2 | 0 | 0 | 1 | 708 | 0 | 400 | 3.3 | 3.1 | $0.00121 |
| swift-modest-proposal | 2 | 0 | 0 | 1 | 726 | 0 | 423 | 3.4 | 3.0 | $0.00128 |
| wodehouse-jeeves | 4 | 0 | 0 | 1 | 839 | 0 | 489 | 4.2 | 1.5 | $0.00147 |
| wp-beans | 4 | 0 | 0 | 1 | 684 | 0 | 336 | 3.2 | 1.1 | $0.00105 |
| **total** | 149 | 0 | 0 | 23 | 17650 | 0 | 10317 | 88.8 | | $0.03109 |

Characters per token (provider-counted; the engine assumes 3.5): input 4.12, output 3.57 over 23 calls.
S2 thresholds on 23 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.55, over 1.2/1.4/1.6: 19/7/6; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.64.
Nonce probe not run (--probe-nonce).
