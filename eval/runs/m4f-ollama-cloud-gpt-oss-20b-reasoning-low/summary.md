# Eval run 2026-10-09T04-13-45-082Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `ollama-cloud/gpt-oss:20b`, target `vi`, chunk 1200 tokens, 4 in flight. 

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 1 (0) | 1 | 934 | 71 | 610 | 7.8 | 2.2 | n/a |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 713 | 68 | 365 | 4.7 | 2.1 | n/a |
| rust-async-await-primer | 8 | 0 | 0 | 1 (0) | 1 | 902 | 478 | 546 | 6.3 | 1.3 | n/a |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 857 | 478 | 490 | 6.5 | 2.8 | n/a |
| so-branch-prediction | 11 | 0 | 0 | 1 (0) | 1 | 955 | 478 | 570 | 7.9 | 1.7 | n/a |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 787 | 478 | 419 | 5.3 | 1.0 | n/a |
| k8s-pods | 10 | 0 | 0 | 1 (0) | 1 | 907 | 478 | 553 | 6.8 | 1.0 | n/a |
| mdn-closures | 6 | 0 | 0 | 1 (0) | 1 | 818 | 478 | 441 | 5.3 | 1.1 | n/a |
| mdn-using-promises | 8 | 0 | 0 | 1 (0) | 1 | 763 | 478 | 398 | 5.2 | 1.0 | n/a |
| rust-async-executor | 7 | 0 | 0 | 1 (0) | 1 | 893 | 478 | 555 | 6.5 | 1.0 | n/a |
| rust-book-ownership | 4 | 0 | 0 | 1 (0) | 1 | 804 | 478 | 480 | 5.9 | 1.2 | n/a |
| rust-book-panic | 7 | 0 | 0 | 1 (0) | 1 | 942 | 478 | 572 | 6.3 | 1.3 | n/a |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 696 | 478 | 330 | 4.6 | 2.8 | n/a |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 645 | 478 | 237 | 3.3 | 1.0 | n/a |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 780 | 478 | 420 | 5.6 | 1.1 | n/a |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 729 | 480 | 435 | 5.8 | 2.5 | n/a |
| wp-template-regulars | 4 | 0 | 0 | 1 (0) | 1 | 772 | 478 | 435 | 5.4 | 1.5 | n/a |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 716 | 478 | 305 | 4.7 | 1.8 | n/a |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 854 | 478 | 524 | 8.8 | 1.8 | n/a |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 757 | 478 | 436 | 4.9 | 4.6 | n/a |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 781 | 478 | 424 | 5.4 | 4.3 | n/a |
| wodehouse-jeeves | 4 | 0 | 0 | 1 (0) | 1 | 881 | 479 | 505 | 6.6 | 1.9 | n/a |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 719 | 478 | 357 | 6.1 | 1.3 | n/a |
| **total** | 149 | 0 | 0 | 23 (0) | 23 | 18605 | 10180 | 10407 | 135.5 | | n/a |

Characters per token (provider-counted; the engine assumes 3.5): input 3.91, output 3.30 over 23 calls.
S2 thresholds on 23 chunks / 149 segments: 1 chunks with parser fixes {"unclosed-end":1}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.58, over 1.2/1.4/1.6: 17/8/3; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.09.
Thinking (translate calls): {"control":"effort","lowest":"low","reserveTokens":6000}. Reasoning: 0 tokens over 0 calls, max 0; no outliers (≥ 2000).
Nonce probe not run (--probe-nonce).
