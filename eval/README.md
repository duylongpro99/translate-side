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

## Refine (Best) against contextual (Balanced)

```
pnpm run eval -- --set eval --strategy contextual --chunk-tokens 400 --out eval-results/<c>
pnpm run eval -- --set eval --strategy refine --chunk-tokens 400 [--review-prompt review@N] --out eval-results/<r>
pnpm run eval:judge -- eval-results/<c>  &&  pnpm run eval:judge -- eval-results/<r>
pnpm run eval:report -- eval-results/<c> eval-results/<r>     # contextual first: refine's column shows the change
```

`refine` drafts exactly as `contextual` does (translate@2 only), then reviews each chunk of drafts with `--review-prompt` (default: the shipped review prompt). `summary.json` counts, per passage and in total, the segments the review accepted (replaced by a revision that passed every post-check), left unchanged, rejected (the candidate failed a post-check; the draft stays) or skipped, and the review calls' tokens. Each rejected candidate is read back from the recorded review answer and checked again, so `summary.json` also counts the rejections by the check that failed them (`rejectedKinds`: the post-check kinds, `tag` for a page tag brought back, `duplicate` for a copied neighbour). `summary.json` records `reviewPromptHash` beside `promptHash`, so a review prompt edited under the same id shows. The report adds, beside the judge dimensions and the cost ratio, the ratio of input plus output tokens (the APIBOX prices are nominal), those review counts with the share of the reviewer's changes that were rejected, and the rejections by check. With `--mock`, the reviewer leaves odd items unchanged, cuts every fourth item to its first word (the length check rejects it, except on the shortest segments) and returns the other even items' drafts with a fixed suffix (accepted), so a mock run goes through the unchanged, accepted and rejected paths without a key.

## Translation memory in a run

```
pnpm run eval -- --set eval --strategy contextual --prompt translate@2 --chunk-tokens 400 --memory <file> --out eval-results/<m>
```

`--memory` takes a translation-memory export (the file the options page writes, or one written by hand in the same shape) and gives the run its entries for the run's target language as examples. It needs `contextual` or `refine` with `translate@2` (`translate@1` has no context block to carry them). Each document's retrieval is written to `<slug>.memory.json` (hashed ids and counts, never text), and `summary.json` records the number of entries. The harness applies no origin or local-only rule (a file has neither): every entry counts. A run with a memory is never a gate baseline.

## Latency

```
pnpm run latency -- --runs 2 --scenarios top,middle --strategy contextual
pnpm run latency -- --runs 2 --scenarios top,middle --strategy refine
```

Runs the panel's own job code over a page of about 3,000 words made from the fixtures, against the default profile (live calls, `AIBOX_API_KEY` from `.env`), and reports when the screen was first done and when the whole page was. `--strategy` (`single-pass`, `contextual` or `refine`) times Balanced and Best alike; a `refine` run also times its review calls. Results are written to `eval-results/latency-<stamp>.json`.

## Regression gate

```
pnpm run eval:gate                          # one translate + judge pass against eval/gate.json; once more if it fails
pnpm run eval:gate -- --baseline 5          # re-baseline: eval/runs/gate-baseline-<n>/ and eval/gate.json
pnpm run eval:gate -- --timeout-min 25      # the per-pass timeout (default 25)
pnpm run eval:gate -- --mode best           # the Best gate: refine against eval/gate-best.json
pnpm run eval:gate -- --mode best --baseline 5 [--from <run>,<run>,…]   # Best re-baseline: eval/runs/gate-best-baseline-<n>/ and eval/gate-best.json
```

**What it checks.** The gate translates the 23 passages with the configuration the extension ships:
- the model and quirks of `DEFAULT_PROFILE` over `DEFAULT_CONNECTION` (`src/shared/settings.ts`);
- the panel's strategy (`PANEL_STRATEGY`) with its translate prompt;
- the profile's concurrency.

It uses chunk 400, not the profile's 1200, so that the longer passages (about 10 of the 23; the M2 c400 run had 34 chunks, 11 of them briefed) split into several chunks and run the brief, the briefed chunks and the chunk-0 revision. The other passages fit one chunk and skip them, as they would in the extension. The pinned judge (`scripts/eval/judge-core.ts`) then scores the translations. For each dimension, the 23-passage judge mean must reach the baseline mean minus that dimension's margin (`eval/gate.json`).

A pass fails in any of these cases:
- a dimension is below its floor;
- the judge did not score every passage;
- no chunk carried the brief, or no segment was revised;
- a segment was lost;
- the pass reported no priced calls (a mock or an empty run is never green);
- it hit the timeout or the spend cap.

A failed pass is run once more, and the gate is red (exit 1) only when both passes fail. Each pass prints a per-dimension table and its spend, however it ended. The gate refuses with exit 2, before any call, in three cases: the key is missing, `eval/gate.json` is missing, or `gate.json`'s judge differs from the pinned one: the model or prompt id in `judge-core.ts`, or the thinking effort `judge.ts` sends. A gate run stops at $0.50 at the nominal prices in `scripts/eval/pricing.ts`. The APIBOX prices there are unverified. One pass costs about $0.16 and takes about 15 minutes, most of it in the judge.

**When to run it.** CI does not run the gate: it needs paid live calls, and CI holds no key. Run it locally with the keys in `.env`, and record the output (the tables and the spend) in the PR or phase report:
- before merging any change to `src/engine/**`, `src/llm/**`, `src/shared/settings.ts`, `src/shared/presets.ts`, `src/entrypoints/sidepanel/jobs.ts`, `scripts/eval/**` or `eval/**`;
- in every test pass over a diff that touches those paths;
- in the release-candidate check.

**Margins.** The baseline is 5 runs of the gate configuration at the same commit. For each dimension, the margin is the larger of 2 × the sample standard deviation of the 5 runs' judge means and 0.20. The minimum is 0.20 because the judge scores whole points: one point less on 4 or 5 of the 23 passages moves a mean by about 0.2. With a 0.10 minimum, terminology's margin was 0.137, and the unchanged shipped default went red at 4.30 on two passes. That score is below all five baseline runs (4.39–4.57), yet nothing had changed: the net loss was 4 points over 23 passages. `gate.json` records the margins, the SDs, the per-run and baseline means, the judge, the configuration, and the M2 c400 reference (`eval/runs/baseline-contextual-translate2-qwen3.8-flash-c400`). The baseline is refused (exit 3, no `gate.json`) if any dimension's baseline mean is below the M2 c400 judge mean minus its margin.

**Re-baselining.** Re-baseline only on purpose, in its own commit, which holds `eval/gate.json` and the `eval/runs/gate-baseline-*` runs together:
1. Delete the old `eval/runs/gate-baseline-*`.
2. Run `pnpm run eval:gate -- --baseline 5` (at least 3 runs). A run that already finished is kept, so the command resumes after an interruption.
3. Commit the new `gate.json` with the runs.

Re-baseline when the judge changes (a new judge model, prompt id or thinking effort is refused until you do), or when a quality change is accepted. Never re-baseline to turn a red gate green. When the shipped model, quirks or strategy differ from the baseline's, the gate prints a note and compares against the baseline all the same. The baseline stays the quality bar.

**Best gate (`--mode best`).** The same configuration with the `refine` strategy and the shipped review prompt, gated against its own baseline, `eval/gate-best.json` (runs in `eval/runs/gate-best-baseline-*`). The two modes never share a baseline, and the default mode is unchanged. A Best pass also fails when no segment was reviewed (the review pass did not run). Run it beside the Balanced gate whenever the Best mode can ship, once `eval/gate-best.json` exists. A refine pass makes the review calls on top of the Balanced ones, so expect up to twice the translate spend of a Balanced pass; the judge's share is the same.

**When to write `eval/gate-best.json`.** Run `pnpm run eval:gate -- --mode best --baseline 5` only after the refine margin decision (refine against contextual in one paired session, and the blind sheet) is recorded. A Best baseline written before that would gate against an unaccepted quality bar.

**Seeding a baseline from finished runs (`--from`).** `--baseline n --from a,b,…` takes n finished harness runs instead of translating anew. The gate refuses before any call, naming each problem, unless every run is:
- a run of exactly the gate configuration: provider and model, strategy and version, prompt ids, chunk 400, the profile's concurrency, natural style, gloss first, no personal glossary, the shipped thinking and max-tokens parameter;
- a run of the same prompt texts: its `promptHash` (and, for refine, `reviewPromptHash`) equals the hash of the gate's prompts rendered now;
- a run over every passage of the eval set, no more and no fewer;
- a distinct run: two folders holding the same run (the same `run` stamp in `summary.json`) count once and are refused. Each run is copied without its `calls.jsonl` into the mode's baseline folder, judged by the pinned judge if it is not yet, and then the baseline is computed as usual. To let a paired refine-against-contextual session seed the Best baseline, run its refine passes with the gate's own arguments (`translateArgs` in `scripts/eval/gate.ts`): `--set eval --provider apibox --model <the default profile's model> --strategy refine --prompt translate@2 --review-prompt <the shipped review prompt> --chunk-tokens 400 --concurrency <the default profile's>`.

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
