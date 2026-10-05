flatten shadow DOM: true

| fixture | truth chars | pre | tbl | det | R recall | R precision | R chrome leak | R pre kept | R tbl/det | W recall | W precision | W chrome leak | W pre kept | W tbl/det | R len / W len |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| docusaurus-code-blocks | 19445 | 59 | 2 | 0 | 89% | 96% | 0 | 40/59 | 2/0 | 100% | 100% | 0 | 59/59 | 2/0 | 0.89 |
| mkdocs-material-admonitions | 13916 | 17 | 0 | 3 | 98% | 99% | 0 | 17/17 | 0/3 | 100% | 100% | 0 | 17/17 | 0/3 | 0.99 |
| gitbook-code-block | 4013 | 6 | 0 | 0 | 87% | 99% | 0 | 6/6 | 0/0 | 100% | 100% | 0 | 6/6 | 0/0 | 0.89 |
| mdn-promise-then | 12479 | 13 | 2 | 1 | 92% | 99% | 0 | 12/13 | 2/0 | 100% | 100% | 0 | 12/13 | 2/1 | 0.93 |
| docsrs-tokio | 14401 | 8 | 0 | 1 | 98% | 99% | 0 | 8/8 | 0/1 | 100% | 100% | 0 | 8/8 | 0/1 | 0.99 |
| github-readme-bat | 27334 | 58 | 2 | 0 | 100% | 100% | 0 | 58/58 | 2/0 | 100% | 100% | 0 | 58/58 | 2/0 | 1.00 |
| medium-software-2-0 | 13549 | 0 | 0 | 0 | 99% | 100% | 0 | 0/0 | 0/0 | 100% | 100% | 0 | 0/0 | 0/0 | 0.99 |
| substack-pragmatic-shopify | 17937 | 0 | 0 | 0 | 96% | 99% | 0 | 0/0 | 0/0 | 100% | 98% | 0 | 0/0 | 0/0 | 0.96 |
| wikipedia-futures-promises | 31402 | 4 | 0 | 0 | 98% | 99% | 0 | 4/4 | 0/0 | 100% | 99% | 0 | 4/4 | 0/0 | 0.97 |
| guardian-iphone-review | 9335 | 0 | 0 | 0 | 99% | 100% | 0 | 0/0 | 0/0 | 100% | 93% | 0 | 0/0 | 0/0 | 0.90 |
flatten shadow DOM: false

| fixture | truth chars | pre | tbl | det | R recall | R precision | R chrome leak | R pre kept | R tbl/det | W recall | W precision | W chrome leak | W pre kept | W tbl/det | R len / W len |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| docusaurus-code-blocks | 19445 | 59 | 2 | 0 | 89% | 96% | 0 | 40/59 | 2/0 | 100% | 100% | 0 | 59/59 | 2/0 | 0.89 |
| mkdocs-material-admonitions | 13916 | 17 | 0 | 3 | 98% | 99% | 0 | 17/17 | 0/3 | 100% | 100% | 0 | 17/17 | 0/3 | 0.99 |
| gitbook-code-block | 4013 | 6 | 0 | 0 | 87% | 99% | 0 | 6/6 | 0/0 | 100% | 100% | 0 | 6/6 | 0/0 | 0.89 |
| mdn-promise-then | 6239 | 0 | 1 | 1 | 88% | 100% | 0 | 0/0 | 1/0 | 100% | 100% | 0 | 0/0 | 1/1 | 0.89 |
| docsrs-tokio | 14401 | 8 | 0 | 1 | 98% | 99% | 0 | 8/8 | 0/1 | 100% | 100% | 0 | 8/8 | 0/1 | 0.99 |
| github-readme-bat | 27334 | 58 | 2 | 0 | 100% | 100% | 0 | 58/58 | 2/0 | 100% | 100% | 0 | 58/58 | 2/0 | 1.00 |
| medium-software-2-0 | 13549 | 0 | 0 | 0 | 99% | 100% | 0 | 0/0 | 0/0 | 100% | 100% | 0 | 0/0 | 0/0 | 0.99 |
| substack-pragmatic-shopify | 17937 | 0 | 0 | 0 | 96% | 99% | 0 | 0/0 | 0/0 | 100% | 98% | 0 | 0/0 | 0/0 | 0.96 |
| wikipedia-futures-promises | 31402 | 4 | 0 | 0 | 98% | 99% | 0 | 4/4 | 0/0 | 100% | 99% | 0 | 4/4 | 0/0 | 0.97 |
| guardian-iphone-review | 9335 | 0 | 0 | 0 | 99% | 100% | 0 | 0/0 | 0/0 | 100% | 93% | 0 | 0/0 | 0/0 | 0.90 |
