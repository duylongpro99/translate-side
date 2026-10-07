# Eval run 2026-10-07T12-46-23-143Z

Strategy `contextual` (translate@2, analyze@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 1500 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 1 (0) | 1 | 1182 | 0 | 585 | 10.5 | 2.5 | $0.00009 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 958 | 0 | 330 | 5.2 | 2.6 | $0.00006 |
| rust-async-await-primer | 8 | 0 | 0 | 1 (0) | 1 | 1156 | 0 | 528 | 8.1 | 1.6 | $0.00009 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 1108 | 0 | 474 | 8.1 | 3.2 | $0.00008 |
| so-branch-prediction | 11 | 0 | 0 | 1 (0) | 1 | 1216 | 0 | 562 | 10.6 | 1.4 | $0.00009 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 1037 | 0 | 360 | 6.9 | 1.5 | $0.00007 |
| k8s-pods | 10 | 0 | 0 | 1 (0) | 1 | 1160 | 0 | 546 | 10.0 | 1.4 | $0.00009 |
| mdn-closures | 6 | 0 | 0 | 1 (0) | 1 | 1055 | 0 | 391 | 7.3 | 1.6 | $0.00007 |
| mdn-using-promises | 8 | 0 | 0 | 1 (0) | 1 | 1013 | 0 | 378 | 6.7 | 1.3 | $0.00007 |
| rust-async-executor | 7 | 0 | 0 | 1 (0) | 1 | 1144 | 0 | 518 | 9.6 | 1.6 | $0.00009 |
| rust-book-ownership | 4 | 0 | 0 | 1 (0) | 1 | 1049 | 0 | 423 | 8.0 | 1.4 | $0.00007 |
| rust-book-panic | 7 | 0 | 0 | 1 (0) | 1 | 1190 | 0 | 554 | 9.4 | 1.4 | $0.00009 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 941 | 0 | 285 | 4.8 | 2.7 | $0.00006 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 892 | 0 | 227 | 4.3 | 1.6 | $0.00005 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 1030 | 0 | 394 | 6.1 | 1.3 | $0.00007 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 978 | 0 | 385 | 10.2 | 2.6 | $0.00007 |
| wp-template-regulars | 4 | 0 | 0 | 1 (0) | 1 | 1017 | 0 | 410 | 8.9 | 2.7 | $0.00007 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 2 | 968 | 0 | 277 | 6.0 | 2.0 | $0.00006 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 1135 | 0 | 502 | 9.4 | 1.6 | $0.00008 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 1003 | 0 | 386 | 7.4 | 7.2 | $0.00007 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 1023 | 0 | 401 | 8.4 | 7.3 | $0.00007 |
| wodehouse-jeeves | 4 | 0 | 0 | 1 (0) | 1 | 1125 | 0 | 456 | 9.9 | 2.8 | $0.00008 |
| wp-beans | 4 | 0 | 1 | 1 (0) | 2 | 2113 | 0 | 433 | 9.6 | 1.4 | $0.00011 |
| **total** | 149 | 0 | 1 | 23 (0) | 25 | 25493 | 0 | 9805 | 185.2 | | $0.00174 |

Brief (analyze@1): parsed for 0/0 docs asked (23 one-chunk docs skipped, M2-D9); 0 in / 0 out tokens, $0.00000 (in the totals above). Per doc: go-errors-are-values skipped –, go-share-memory skipped –, rust-async-await-primer skipped –, rust-async-ecosystem skipped –, so-branch-prediction skipped –, docker-multistage skipped –, k8s-pods skipped –, mdn-closures skipped –, mdn-using-promises skipped –, rust-async-executor skipped –, rust-book-ownership skipped –, rust-book-panic skipped –, wp-not-a-dictionary skipped –, go-gofmt skipped –, go2-here-we-come skipped –, wp-dont-bite-newcomers skipped –, wp-template-regulars skipped –, bierce-devils-dictionary skipped –, pep20-zen skipped –, so-regex-html skipped –, swift-modest-proposal skipped –, wodehouse-jeeves skipped –, wp-beans skipped –.
Characters per token (provider-counted; the engine assumes 3.5): input 4.10, output 3.67 over 24 calls.
S2 thresholds on 23 chunks / 149 segments: 0 chunks with parser fixes {}, 7 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.47, over 1.2/1.4/1.6: 10/5/5; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.61.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 0 tokens over 0 calls, max 0; no outliers (≥ 2000).
Nonce probe not run (--probe-nonce).
