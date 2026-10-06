# Eval set (M2-E8)

23 English passages (target language `vi`) for scoring translation quality: tech blogs, docs, opinion, and idiom/humor/sarcasm. Each is an excerpt of openly licensed text; source, author and license are in its front matter and below. Excerpts are cut (and shortcodes, images and wiki markup removed) so they are a few hundred words each; the `note` line of a file says what was cut.

```
eval/passages/<id>.md      the passages (front matter + markdown-ish blocks; parsed by scripts/eval/passages.ts)
eval/runs/<name>/          a scored run kept in git: summary.json, <id>.output.json, human-scores.md, judge.json
```

## Workflow

```
pnpm run eval -- --set eval [--out dir]        # translate every passage with the current strategy/prompt
pnpm run eval:sheet -- <run-dir>               # write <run-dir>/human-scores.md (refuses to overwrite scores without --force)
pnpm run eval:judge -- <run-dir> [--mock]      # Gemini judge → <run-dir>/judge.json (model pinned in scripts/eval/judge-core.ts)
pnpm run eval:report -- <run-dir> [<run-dir> …] [--out file]   # markdown table, one column per run, first run = baseline
```

The human sheet is the source of truth: fill in `fidelity`, `naturalness`, `tone`, `terminology` (1–5) in each passage section. The rubric with anchors for 1/3/5 is at the top of the sheet (scripts/eval/rubric.ts). The judge is checked against the human scores (the report prints mean absolute difference, bias and agreement within 1 point) before it is used as a gate.

A column is named `strategy / prompt / model` from the run's `summary.json`, so `contextual` and `translate@2` runs join the report without changing it.

## Passages

| id | category | source | author | license | code |
|---|---|---|---|---|---|
| `go-errors-are-values` | tech-blog | [Errors are values](https://go.dev/blog/errors-are-values) | Rob Pike | CC BY 4.0 | yes |
| `go-share-memory` | tech-blog | [Share Memory By Communicating](https://go.dev/blog/codelab-share) | Andrew Gerrand | CC BY 4.0 | yes |
| `rust-async-await-primer` | tech-blog | [Async-await on stable Rust!](https://blog.rust-lang.org/2019/11/07/Async-await-stable/) | Niko Matsakis (Rust async-await working group) | MIT OR Apache-2.0 | yes |
| `rust-async-ecosystem` | tech-blog | [Async-await on stable Rust! (ecosystem)](https://blog.rust-lang.org/2019/11/07/Async-await-stable/) | Niko Matsakis (Rust async-await working group) | MIT OR Apache-2.0 |  |
| `so-branch-prediction` | tech-blog | [Why is processing a sorted array faster than processing an unsorted array?](https://stackoverflow.com/a/11227902) | Mysticial (Stack Overflow answer) | CC BY-SA 4.0 | yes |
| `docker-multistage` | docs | [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) | Docker, Inc. and contributors | Apache-2.0 | yes |
| `k8s-pods` | docs | [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) | The Kubernetes Authors | CC BY 4.0 |  |
| `mdn-closures` | docs | [Closures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures) | MDN contributors | CC BY-SA 2.5 (prose), CC0 (code samples) | yes |
| `mdn-using-promises` | docs | [Using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises) | MDN contributors | CC BY-SA 2.5 (prose), CC0 (code samples) | yes |
| `rust-async-executor` | docs | [Applied: Build an Executor (Asynchronous Programming in Rust)](https://rust-lang.github.io/async-book/02_execution/04_executor.html) | The Rust async-book contributors | MIT OR Apache-2.0 | yes |
| `rust-book-ownership` | docs | [What Is Ownership?](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html) | Steve Klabnik, Carol Nichols and contributors (The Rust Programming Language) | MIT OR Apache-2.0 |  |
| `rust-book-panic` | docs | [To panic! or Not to panic!](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html) | Steve Klabnik, Carol Nichols and contributors (The Rust Programming Language) | MIT OR Apache-2.0 |  |
| `wp-not-a-dictionary` | docs | [Wikipedia:Wikipedia is not a dictionary](https://en.wikipedia.org/wiki/Wikipedia:Wikipedia_is_not_a_dictionary) | Wikipedia contributors | CC BY-SA 4.0 |  |
| `go-gofmt` | opinion | [go fmt your code](https://go.dev/blog/gofmt) | Andrew Gerrand | CC BY 4.0 |  |
| `go2-here-we-come` | opinion | [Go 2, here we come!](https://go.dev/blog/go2-here-we-come) | Robert Griesemer | CC BY 4.0 |  |
| `wp-dont-bite-newcomers` | opinion | [Wikipedia:Please do not bite the newcomers](https://en.wikipedia.org/wiki/Wikipedia:Please_do_not_bite_the_newcomers) | Wikipedia contributors | CC BY-SA 4.0 |  |
| `wp-template-regulars` | opinion | [Wikipedia:Don't template the regulars](https://en.wikipedia.org/wiki/Wikipedia:Don%27t_template_the_regulars) | Wikipedia contributors | CC BY-SA 4.0 |  |
| `bierce-devils-dictionary` | humor | [The Devil's Dictionary (selected entries)](https://www.gutenberg.org/ebooks/972) | Ambrose Bierce (1911) | Public domain |  |
| `pep20-zen` | humor | [PEP 20 – The Zen of Python](https://peps.python.org/pep-0020/) | Tim Peters | Public domain (PEP 20 is placed in the public domain) |  |
| `so-regex-html` | humor | [RegEx match open tags except XHTML self-contained tags](https://stackoverflow.com/a/1732454) | bobince (Stack Overflow answer) | CC BY-SA 4.0 |  |
| `swift-modest-proposal` | humor | [A Modest Proposal (closing section)](https://www.gutenberg.org/ebooks/1080) | Jonathan Swift (1729) | Public domain |  |
| `wodehouse-jeeves` | humor | [My Man Jeeves (Corky and his uncle Mr. Worple)](https://www.gutenberg.org/ebooks/8164) | P. G. Wodehouse (1919) | Public domain |  |
| `wp-beans` | humor | [Wikipedia:Don't stuff beans up your nose](https://en.wikipedia.org/wiki/Wikipedia:Don%27t_stuff_beans_up_your_nose) | Wikipedia contributors | CC BY-SA 4.0 |  |

Sources: Rust blog / async-book / Rust book (MIT OR Apache-2.0); Go blog (CC BY 4.0, https://go.dev/copyright); MDN (prose CC BY-SA 2.5, code samples CC0); Kubernetes docs (CC BY 4.0); Docker docs (Apache-2.0); Wikipedia and Stack Overflow (CC BY-SA 4.0, attribution above); PEP 20, Swift, Wodehouse and Bierce (public domain). Translations of CC BY-SA texts in `eval/runs/` are adaptations under the same license.
