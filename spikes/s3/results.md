flatten shadow DOM: true

| fixture | truth chars | pre | tbl | det | R recall | R precision | R chrome leak | R pre kept | R tbl/det | W recall | W precision | W chrome leak | W pre kept | W tbl/det | R len / W len |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| docusaurus-code-blocks | 19445 | 59 | 2 | 0 | 89% | 96% | 0 | 40/59 | 2/0 | 100% | 100% | 0 | 59/59 | 2/0 | 0.89 |
| mkdocs-material-admonitions | 13916 | 17 | 0 | 3 | 98% | 99% | 0 | 17/17 | 0/3 | 100% | 100% | 0 | 17/17 | 0/3 | 0.99 |
| mdn-promise-then | 12479 | 13 | 2 | 1 | 92% | 99% | 0 | 12/13 | 2/0 | 100% | 100% | 0 | 12/13 | 2/1 | 0.93 |
| docsrs-tokio | 14401 | 8 | 0 | 1 | 98% | 99% | 0 | 8/8 | 0/1 | 100% | 100% | 0 | 8/8 | 0/1 | 0.99 |
| github-readme-bat | 27334 | 58 | 2 | 0 | 100% | 100% | 0 | 58/58 | 2/0 | 100% | 100% | 0 | 58/58 | 2/0 | 1.00 |
| wikipedia-futures-promises | 31402 | 4 | 0 | 0 | 98% | 99% | 0 | 4/4 | 0/0 | 100% | 99% | 0 | 4/4 | 0/0 | 0.97 |
| mdbook-rust-book-ownership | 24487 | 15 | 0 | 0 | 100% | 100% | 0 | 15/15 | 0/0 | 100% | 100% | 0 | 15/15 | 0/0 | 1.00 |
| goblog-pipelines | 19309 | 26 | 0 | 0 | 81% | 95% | 0 | 9/26 | 0/0 | 100% | 100% | 0 | 26/26 | 0/0 | 0.85 |
| twir-671 | 14070 | 0 | 1 | 0 | 99% | 100% | 0 | 0/0 | 1/0 | 100% | 100% | 0 | 0/0 | 1/0 | 1.00 |
| globalvoices-bangladesh-protests | 6275 | 0 | 0 | 0 | 99% | 100% | 0 | 0/0 | 0/0 | 100% | 78% | 0 | 0/0 | 0/0 | 0.77 |
flatten shadow DOM: false

| fixture | truth chars | pre | tbl | det | R recall | R precision | R chrome leak | R pre kept | R tbl/det | W recall | W precision | W chrome leak | W pre kept | W tbl/det | R len / W len |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| docusaurus-code-blocks | 19445 | 59 | 2 | 0 | 89% | 96% | 0 | 40/59 | 2/0 | 100% | 100% | 0 | 59/59 | 2/0 | 0.89 |
| mkdocs-material-admonitions | 13916 | 17 | 0 | 3 | 98% | 99% | 0 | 17/17 | 0/3 | 100% | 100% | 0 | 17/17 | 0/3 | 0.99 |
| mdn-promise-then | 6239 | 0 | 1 | 1 | 88% | 100% | 0 | 0/0 | 1/0 | 100% | 100% | 0 | 0/0 | 1/1 | 0.89 |
| docsrs-tokio | 14401 | 8 | 0 | 1 | 98% | 99% | 0 | 8/8 | 0/1 | 100% | 100% | 0 | 8/8 | 0/1 | 0.99 |
| github-readme-bat | 27334 | 58 | 2 | 0 | 100% | 100% | 0 | 58/58 | 2/0 | 100% | 100% | 0 | 58/58 | 2/0 | 1.00 |
| wikipedia-futures-promises | 31402 | 4 | 0 | 0 | 98% | 99% | 0 | 4/4 | 0/0 | 100% | 99% | 0 | 4/4 | 0/0 | 0.97 |
| mdbook-rust-book-ownership | 24487 | 15 | 0 | 0 | 100% | 100% | 0 | 15/15 | 0/0 | 100% | 100% | 0 | 15/15 | 0/0 | 1.00 |
| goblog-pipelines | 19309 | 26 | 0 | 0 | 81% | 95% | 0 | 9/26 | 0/0 | 100% | 100% | 0 | 26/26 | 0/0 | 0.85 |
| twir-671 | 14070 | 0 | 1 | 0 | 99% | 100% | 0 | 0/0 | 1/0 | 100% | 100% | 0 | 0/0 | 1/0 | 1.00 |
| globalvoices-bangladesh-protests | 6275 | 0 | 0 | 0 | 99% | 100% | 0 | 0/0 | 0/0 | 100% | 78% | 0 | 0/0 | 0/0 | 0.77 |
