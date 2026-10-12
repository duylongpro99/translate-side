# Eval run 2026-10-11T13-09-39-331Z

Strategy `contextual` (translate@2, analyze@1), style natural, gloss first, personal glossary none, model `apibox/qwen3.8-flash`, target `vi`, chunk 400 tokens, 2 in flight. Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 0 | 0 | 2 (1) | 5 | 5262 | 0 | 2783 | 63.4 | 8.2 | $0.00043 |
| go-share-memory | 4 | 0 | 0 | 1 (0) | 1 | 958 | 0 | 335 | 5.8 | 2.8 | $0.00006 |
| rust-async-await-primer | 8 | 0 | 0 | 2 (1) | 4 | 5135 | 0 | 3246 | 68.3 | 1.7 | $0.00047 |
| rust-async-ecosystem | 7 | 0 | 0 | 1 (0) | 1 | 1108 | 0 | 471 | 8.6 | 3.7 | $0.00008 |
| so-branch-prediction | 11 | 0 | 0 | 2 (1) | 4 | 5139 | 0 | 2859 | 26.1 | 1.4 | $0.00043 |
| docker-multistage | 8 | 0 | 0 | 1 (0) | 1 | 1037 | 0 | 362 | 5.3 | 1.4 | $0.00007 |
| k8s-pods | 10 | 0 | 0 | 2 (1) | 4 | 4960 | 0 | 2130 | 17.7 | 1.3 | $0.00036 |
| mdn-closures | 6 | 0 | 0 | 2 (1) | 4 | 4726 | 0 | 2635 | 25.8 | 1.5 | $0.00040 |
| mdn-using-promises | 8 | 0 | 0 | 2 (1) | 4 | 4859 | 0 | 1673 | 13.3 | 1.9 | $0.00031 |
| rust-async-executor | 7 | 0 | 0 | 2 (1) | 4 | 5394 | 0 | 2645 | 22.2 | 1.6 | $0.00042 |
| rust-book-ownership | 4 | 0 | 0 | 2 (1) | 4 | 4657 | 0 | 1654 | 13.6 | 1.4 | $0.00030 |
| rust-book-panic | 7 | 0 | 0 | 2 (1) | 4 | 4927 | 0 | 3675 | 32.4 | 1.5 | $0.00050 |
| wp-not-a-dictionary | 3 | 0 | 0 | 1 (0) | 1 | 941 | 0 | 296 | 5.6 | 2.9 | $0.00006 |
| go-gofmt | 7 | 0 | 0 | 1 (0) | 1 | 892 | 0 | 226 | 4.1 | 1.5 | $0.00005 |
| go2-here-we-come | 4 | 0 | 0 | 1 (0) | 1 | 1030 | 0 | 394 | 7.2 | 1.3 | $0.00007 |
| wp-dont-bite-newcomers | 4 | 0 | 0 | 1 (0) | 1 | 978 | 0 | 389 | 7.5 | 3.1 | $0.00007 |
| wp-template-regulars | 4 | 0 | 0 | 2 (1) | 4 | 4725 | 0 | 2010 | 17.6 | 1.9 | $0.00034 |
| bierce-devils-dictionary | 7 | 0 | 0 | 1 (0) | 1 | 968 | 0 | 283 | 6.9 | 1.6 | $0.00006 |
| pep20-zen | 21 | 0 | 0 | 1 (0) | 1 | 1135 | 0 | 488 | 9.1 | 1.5 | $0.00008 |
| so-regex-html | 2 | 0 | 0 | 1 (0) | 1 | 1003 | 0 | 388 | 8.5 | 8.2 | $0.00007 |
| swift-modest-proposal | 2 | 0 | 0 | 1 (0) | 1 | 1023 | 0 | 395 | 7.8 | 6.7 | $0.00007 |
| wodehouse-jeeves | 4 | 0 | 0 | 2 (1) | 4 | 5046 | 0 | 2570 | 24.4 | 3.3 | $0.00040 |
| wp-beans | 4 | 0 | 0 | 1 (0) | 1 | 971 | 0 | 287 | 6.5 | 1.5 | $0.00006 |
| **total** | 149 | 0 | 0 | 34 (11) | 57 | 66874 | 0 | 32194 | 407.6 | | $0.00517 |

Brief (analyze@1): parsed for 11/11 docs asked (12 one-chunk docs skipped, M2-D9); 8172 in / 4951 out tokens, $0.00073 (in the totals above). Per doc: go-errors-are-values ok 10.5s, go-share-memory skipped –, rust-async-await-primer ok 6.0s, rust-async-ecosystem skipped –, so-branch-prediction ok 5.8s, docker-multistage skipped –, k8s-pods ok 5.8s, mdn-closures ok 4.9s, mdn-using-promises ok 5.5s, rust-async-executor ok 6.3s, rust-book-ownership ok 6.4s, rust-book-panic ok 4.7s, wp-not-a-dictionary skipped –, go-gofmt skipped –, go2-here-we-come skipped –, wp-dont-bite-newcomers skipped –, wp-template-regulars ok 6.5s, bierce-devils-dictionary skipped –, pep20-zen skipped –, so-regex-html skipped –, swift-modest-proposal skipped –, wodehouse-jeeves ok 6.2s, wp-beans skipped –.
Characters per token (provider-counted; the engine assumes 3.5): input 4.16, output 1.80 over 45 calls.
S2 thresholds on 34 chunks / 149 segments: 0 chunks with parser fixes {}, 0 re-requested, 0 flagged merged; length ratio vs chunk median: max 2.23, over 1.2/1.4/1.6: 11/3/2; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 0.59.
Thinking (translate calls): {"control":"effort","lowest":"off","reserveTokens":0,"byChunk":[{"fromChunk":1,"lowest":"minimal","reserveTokens":6000}]}, cap via max_completion_tokens. Reasoning: 13831 tokens over 11 calls, max 2458; OUTLIERS (≥ 2000 reasoning tokens or cut by the cap): rust-book-panic call 40 (chunk 1) 2458 tokens, 27.3s, stop end.
Nonce probe not run (--probe-nonce).
