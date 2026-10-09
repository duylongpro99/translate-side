# Eval run 2026-10-09T03-59-53-267Z

Strategy `single-pass` (translate@1), style natural, gloss first, personal glossary none, model `ollama-cloud/gpt-oss:20b`, target `vi`, chunk 1200 tokens, 4 in flight. 

| doc | segments | lost | repaired | chunks (briefed) | calls | input | cached | output | wall s | first final s | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-errors-are-values | 7 | 7 | 0 | 1 (0) | 2 | 1868 | 1004 | 2304 | 40.7 | – | n/a |
| go-share-memory | 4 | 4 | 0 | 1 (0) | 2 | 1426 | 549 | 1320 | 28.5 | – | n/a |
| rust-async-await-primer | 8 | 5 | 1 | 1 (0) | 2 | 1726 | 954 | 1936 | 32.9 | 17.0 | n/a |
| rust-async-ecosystem | 7 | 7 | 0 | 1 (0) | 2 | 1714 | 1334 | 1752 | 28.5 | – | n/a |
| so-branch-prediction | 11 | 7 | 1 | 1 (0) | 2 | 1842 | 954 | 2198 | 33.5 | 16.2 | n/a |
| docker-multistage | 8 | 1 | 0 | 1 (0) | 2 | 1338 | 954 | 978 | 17.1 | 8.9 | n/a |
| k8s-pods | 10 | 5 | 5 | 1 (0) | 2 | 1814 | 956 | 2264 | 37.0 | 37.0 | n/a |
| mdn-closures | 6 | 6 | 0 | 1 (0) | 2 | 1636 | 1295 | 1792 | 25.7 | – | n/a |
| mdn-using-promises | 8 | 8 | 0 | 1 (0) | 2 | 1526 | 956 | 1556 | 21.5 | – | n/a |
| rust-async-executor | 7 | 6 | 0 | 1 (0) | 2 | 1772 | 954 | 2020 | 29.7 | 16.6 | n/a |
| rust-book-ownership | 4 | 4 | 0 | 1 (0) | 2 | 1608 | 1281 | 1716 | 23.2 | – | n/a |
| rust-book-panic | 7 | 6 | 0 | 1 (0) | 2 | 1863 | 954 | 2214 | 29.5 | 14.7 | n/a |
| wp-not-a-dictionary | 3 | 3 | 0 | 1 (0) | 2 | 1392 | 1173 | 1148 | 15.0 | – | n/a |
| go-gofmt | 7 | 7 | 0 | 1 (0) | 2 | 1290 | 954 | 788 | 9.9 | – | n/a |
| go2-here-we-come | 4 | 4 | 0 | 1 (0) | 2 | 1560 | 1257 | 1560 | 15.9 | – | n/a |
| wp-dont-bite-newcomers | 4 | 4 | 0 | 1 (0) | 2 | 1458 | 1208 | 1488 | 18.7 | – | n/a |
| wp-template-regulars | 4 | 3 | 0 | 1 (0) | 2 | 1501 | 957 | 1556 | 20.2 | 10.7 | n/a |
| bierce-devils-dictionary | 7 | 7 | 0 | 1 (0) | 2 | 1432 | 956 | 1044 | 14.7 | – | n/a |
| pep20-zen | 21 | 21 | 0 | 1 (0) | 2 | 1708 | 1331 | 1656 | 18.7 | – | n/a |
| so-regex-html | 2 | 2 | 0 | 1 (0) | 2 | 1514 | 1234 | 1556 | 16.9 | – | n/a |
| swift-modest-proposal | 2 | 2 | 0 | 1 (0) | 2 | 1562 | 956 | 1584 | 19.9 | – | n/a |
| wodehouse-jeeves | 4 | 4 | 0 | 1 (0) | 2 | 1762 | 957 | 1900 | 24.1 | – | n/a |
| wp-beans | 4 | 4 | 0 | 1 (0) | 2 | 1438 | 956 | 1160 | 17.1 | – | n/a |
| **total** | 149 | 127 | 7 | 23 (0) | 46 | 36750 | 24084 | 37490 | 539.0 | | n/a |

Characters per token (provider-counted; the engine assumes 3.5): input 3.90, output 0.15 over 46 calls.
S2 thresholds on 23 chunks / 149 segments: 8 chunks with parser fixes {"cut":7,"stray":1}, 134 re-requested, 0 flagged merged; length ratio vs chunk median: max 1.44, over 1.2/1.4/1.6: 2/1/0; 40-char tag hold-back: 0 partial tags; highest answer/max_tokens 1.00.
Thinking: none.
Nonce probe not run (--probe-nonce).

go-errors-are-values errors: unknown: The model did not return this segment in a usable form

go-share-memory errors: unknown: The model did not return this segment in a usable form

rust-async-await-primer errors: unknown: The model did not return this segment in a usable form

rust-async-ecosystem errors: unknown: The model did not return this segment in a usable form

so-branch-prediction errors: unknown: The model did not return this segment in a usable form

docker-multistage errors: unknown: The model did not return this segment in a usable form

k8s-pods errors: unknown: The model did not return this segment in a usable form

mdn-closures errors: unknown: The model did not return this segment in a usable form

mdn-using-promises errors: unknown: The model did not return this segment in a usable form

rust-async-executor errors: unknown: The model did not return this segment in a usable form

rust-book-ownership errors: unknown: The model did not return this segment in a usable form

rust-book-panic errors: unknown: The model did not return this segment in a usable form

wp-not-a-dictionary errors: unknown: The model did not return this segment in a usable form

go-gofmt errors: unknown: The model did not return this segment in a usable form

go2-here-we-come errors: unknown: The model did not return this segment in a usable form

wp-dont-bite-newcomers errors: unknown: The model did not return this segment in a usable form

wp-template-regulars errors: unknown: The model did not return this segment in a usable form

bierce-devils-dictionary errors: unknown: The model did not return this segment in a usable form

pep20-zen errors: unknown: The model did not return this segment in a usable form

so-regex-html errors: unknown: The model did not return this segment in a usable form

swift-modest-proposal errors: unknown: The model did not return this segment in a usable form

wodehouse-jeeves errors: unknown: The model did not return this segment in a usable form

wp-beans errors: unknown: The model did not return this segment in a usable form
