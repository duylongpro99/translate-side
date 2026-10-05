# S3 — Extraction quality on docs sites → extraction policy and fallback thresholds

Status: proposed (review round 1 addressed) · Date: 2026-10-05 · `@mozilla/readability` 0.6 + jsdom · Spike code:
`spikes/s3/` · Fixtures: `fixtures/sites/`

## Question

Readability is tuned for articles. On docs sites, does it lose code blocks, tables, admonitions or headings, or keep
sidebars? How does it compare with walking `main`/`article`/`[role=main]`? What "poor result" heuristic (text ratio,
lost `pre` count) should trigger the fallback? Which segment kinds need special handling?

Plan §5 default: "Readability first; 'poor result' heuristic (text ratio, lost `pre` count) triggers the
`main`/`article`/`[role=main]` walk."

## Method

- **Fixtures (round 1: new set).** The repository is public, so every fixture is now under a permissive or CC license.
  The four all-rights-reserved pages of the first set (GitBook docs, Medium, Substack, The Guardian) were replaced and
  removed from branch history. The replacements cover the same cases:

  | Fixture | Family | License |
  |---|---|---|
  | `docusaurus-code-blocks` | Docusaurus docs | CC-BY-4.0 |
  | `mkdocs-material-admonitions` | MkDocs Material docs | MIT |
  | `mdbook-rust-book-ownership` | mdBook, GitBook-style docs (replaces GitBook) | MIT OR Apache-2.0 |
  | `mdn-promise-then` | MDN | CC-BY-SA-2.5 prose, CC0/MIT code |
  | `docsrs-tokio` | docs.rs / rustdoc | MIT |
  | `github-readme-bat` | GitHub README | MIT OR Apache-2.0 (README only, see Limits) |
  | `wikipedia-futures-promises` | Wikipedia | CC-BY-SA-4.0 |
  | `goblog-pipelines` | long-form blog essay, go.dev (replaces Medium) | CC-BY-4.0 text, BSD-3-Clause code |
  | `twir-671` | newsletter issue, This Week in Rust (replaces Substack) | CC-BY-SA-4.0 |
  | `globalvoices-bangladesh-protests` | news article, Global Voices on WordPress (replaces The Guardian) | CC-BY-3.0 text |

  Authors, history links and changes are in `fixtures/sites/ATTRIBUTION.md`. There is also a `license` field per
  fixture in `manifest.json`.

  Pages were captured as rendered DOM by headless Chrome 154, with open shadow roots kept as declarative shadow DOM.
  They were then scrubbed (`spikes/s3/scrub.mjs`, at every shadow depth): scripts, iframes, network hints, tracking
  `<meta>` and `data-hydro*`/`data-analytics*`/`data-ophan*`-style attributes are removed. See
  `fixtures/sites/README.md`.

- **Ground truth for content.** A hand-picked content root per site (`contentSelector` in the manifest), minus
  `nav`/`aside`/`footer`/`button`/hidden non-tab elements. This is close to the walk's own exclusion list, so it is
  only used for *content kept* (did the method lose real content), never for noise.

- **Noise, judged independently (B1).** `spikes/s3/noise.json` is a hand-checked list of UI noise per fixture. I made
  it by reading the actual block-by-block output of both methods (`dump-blocks.mjs`), not from any selector the walk
  uses. Each item is the exact text of an element, labelled with a kind:
  - **ui**: page controls; edit, feedback and share links; widget labels;
  - **meta**: read time, last-updated, version badges, tag and category lists;
  - **promo**: subscribe, paywall, donate, related or most-viewed stories;
  - **hidden**: hidden by the site's CSS in the real page, which jsdom can't see;
  - **glyph**: letterless permalink anchors (¶, §, zero-width space).

  The article's own byline and date, and the author's own in-body links (TWiR's "Subscribe here"), count as content.
  `noise-score.mjs` counts occurrences in each output, as outermost elements whose text equals the item (→ `noise.md`).
  `noise-locate.mjs` shows where each item sits in the markup.

- **Methods compared.**
  - **R**: `new Readability(clone).parse()`.
  - **W**: the walk in `walk.mjs`. It takes the outermost `[role=main]`/`main` (else `article`) and narrows to a single
    `article` holding ≥ 50% of its text. It then removes nav/aside/footer/landmark roles, forms, buttons,
    `aria-hidden` and `[hidden]` (except `[role=tabpanel]`), plus language-switcher lists.
  - **+G**: generic in-content selectors (`noise-selectors.mjs`): `.sr-only`/`.visually-hidden`, paywall boxes,
    `editsection` links, letterless `#` anchors.
  - **+S**: per-generator selectors for Docusaurus, MDN, rustdoc, MediaWiki, WordPress and go.dev, keyed by
    `<meta name=generator>` or the host.

  Every method runs after **shadow flattening**: each open shadow root is composed into the light tree, and slots
  receive the host's light children.

- **Other metrics.**
  - **Content blocks kept**: truth leaf blocks of ≥ 15 chars, not on the noise list, found in the output text.
  - **`pre` kept**: each truth `<pre>` needs a byte-identical (whitespace-normalized) output `<pre>`, matched as a
    multiset.
  - **Headings kept** (`structure.mjs`).
  - The 5-gram recall/precision of the first round is still printed by `analyze.mjs` (`results.md`). Its "chrome
    leak" column only counts text from page landmarks (nav/aside/footer/header outside the truth), the same elements
    the walk removes. So it is **circular for W and is not used as a noise measure** (B1).

- **Scripts.** `analyze.mjs` (→ `results.md`), `structure.mjs` (→ `structure.md`), `thresholds.mjs`, `policy.mjs`
  (→ `policy.md`), `kinds.mjs` (→ `kinds.md`), `noise-score.mjs` (→ `noise.md`), and `why-headings.mjs` plus
  `why-headings-fix.mjs` (→ `why-headings-fix.txt`). Re-run with `cd spikes/s3 && npm i && node <script>`.

## Evidence

### Noise, judged on the actual output (`noise.md`)

Visible noise occurrences (kinds ui, meta, promo) per output:

| Fixture | R | W | W+G | W+G+S | R+G+S | Noise left in W (examples) |
|---|---|---|---|---|---|---|
| Docusaurus | 0 | 20 | 20 | 0 | 0 | "Version: 3.10.2", fake browser bar "http://localhost:3000" ×13, "Live Editor" ×3, "Result" ×3 |
| MkDocs Material | 0 | 0 | 0 | 0 | 0 | — (13 ¶ glyphs) |
| mdBook (Rust Book) | 0 | 0 | 0 | 0 | 0 | — |
| MDN | 1 | 11 | 11 | 0 | 0 | Baseline badge, "See full compatibility", "Help improve MDN", "View this page on GitHub", "Report a problem…" |
| docs.rs | 1 | 5 | 5 | 0 | 0 | rustdoc toolbar "Search", "Settings", "Help", "Source"; "Expand description" |
| GitHub README | 0 | 0 | 0 | 0 | 0 | — |
| Wikipedia | 16 | 31 | 12 | 0 | 0 | "[edit]" ×19, "Edit links", "From Wikipedia, the free encyclopedia", "Jump up to:" ×7, category links |
| Go blog | 0 | 4 | 4 | 1 | 0 | "The Go Blog", next/previous article links, "Blog Index" |
| TWiR newsletter | 0 | 0 | 0 | 0 | 0 | — |
| Global Voices news | 0 | 29 | 29 | 0 | 0 | language switcher, 14 category/tag links, "Support our work", "Donate now", two related-story lists with dates, comment form |
| **Sites with 0 visible noise** | **7/10** | **4/10** | **4/10** | **9/10** | **10/10** | |

- **Size of the noise.** In W it is 0–5.3% of output chars: Global Voices 5.3%, MDN 2.0%, Docusaurus 1.7%, Wikipedia
  1.1%, all others < 0.3%. In R it is 0–0.5%.
- **Hidden kind.** Wikipedia has 10 more items (short description, hidden maintenance categories, a citation-error
  message) in W. A visibility check in Chrome would drop them; jsdom cannot.
- **Glyph kind.** Docusaurus has 17 in W, MkDocs 13, docs.rs 18, Go blog 10. The +G anchor rule removes them all.
- **The +S selectors were written from these same fixtures.** W+G+S reaching 9/10 shows that a per-generator table
  *can* clean these pages. It is not evidence that it generalizes. On its own, +G changes only Wikipedia (31 → 12) and
  no site's zero-noise count.
- **Content.** None of the in-content selectors removed content. Content blocks kept and `pre` kept are the same for
  W, W+G and W+G+S on 10/10.

### Content and code (`noise.md`, `results.md`)

| Fixture | R content blocks | W content blocks | R `pre` identical | W `pre` identical |
|---|---|---|---|---|
| Docusaurus | 91% | 100% | **40/59** | 59/59 |
| MkDocs Material | 100% | 100% | 17/17 | 17/17 |
| mdBook | 99% | 100% | 15/15 | 15/15 |
| MDN | 93% | 100% | 12/12 visible | 12/12 visible |
| docs.rs | 98% | 100% | 8/8 | 8/8 |
| GitHub README | 100% | 100% | 58/58 | 58/58 |
| Wikipedia | 99% | 100% | 4/4 | 4/4 |
| Go blog | 97% | 100% | **9/26** | 26/26 |
| TWiR | 99% | 100% | – | – |
| Global Voices | 100% | 100% | – | – |

- **Criterion #2 coverage (N5a).** Criterion #2 (code intact) is tested on the 8 fixtures that have `pre`. TWiR and
  Global Voices have none, so on those it is vacuous.
- **MDN's missing `pre`.** MDN has 13 truth `pre`. The 13th is the source of the hidden "Try it" `<mdn-code-example>`,
  which isn't visible on the page, so both methods are scored on 12 visible.
- **Paywall (N5b).** The paywalled Substack preview of the first set is gone. All ten fixtures are full, free pages.
  No fixture now exercises a paywall, which is a limit.

### Why Readability loses what it loses (N1, `why-headings*.mjs`, `why-headings-fix.txt`)

Each cause was confirmed by removing it and re-running.

| Fixture | Loss | Cause | Re-run without the cause |
|---|---|---|---|
| Docusaurus | headings 6/19 | `h2` classes contain `anchorTargetHideOnScrollNavbar_*`, matching the *negative* regex (`scroll`) | (first round: confirmed with `peek.mjs`) |
| Docusaurus | `pre` 40/59 | inactive tab panels are `hidden`, and Readability drops hidden subtrees (19 of 26 panels) | — |
| docs.rs | headings 13/19 | `h2.section-header` matches the *unlikelyCandidates* regex (`header`), so "Re-exports", "Modules", "Macros" and "Attribute Macros" are removed. The `h1` goes to `article.title`. | h2–h4 11 → 15 |
| Wikipedia | headings 9/19 | each heading sits in `div.mw-heading` together with a `span.mw-editsection` "[edit]" link; that wrapper is dropped, along with its heading | h2/h3 9 → 18 |
| Go blog | `pre` 9/26 | code comments are `<span class="comment">`; *unlikelyCandidates* matches `comment`, so **comments are deleted from inside `<pre>`**: the text of 54 of the 55 comments is absent from the output. The code is changed silently, and the `pre` count stays 26. | identical `pre` 9 → 25 |
| MDN, GitBook (first set) | intro paragraph | outside the subtree picked as top candidate | — |
| mdBook, Go blog, MkDocs, Medium (first set) | the `h1` | moved to `article.title` (metadata, not lost) | — |

Substack in the first set (0/11 headings) had the same cause as docs.rs: `h2.header-anchor-post` matches `header`.
The reviewer guessed that Medium's one missing heading was the promo heading "Get Andrej Karpathy's stories in your
inbox". In fact Readability *kept* that promo heading. The heading it dropped was the `h1` title.

### Poor-result signals

- **Text ratio.** R len / W len is 0.77–1.00 (`results.md`, column "R len / W len" from `analyze.mjs`; the first
  round wrongly cited `thresholds.mjs`, which prints W/R). The lowest value, Global Voices at 0.77, is caused by the
  *walk's* noise, not a Readability loss. Docusaurus (0.89) and the Go blog (0.85) are real losses, but they sit
  inside the same range.
- **`pre` count.** It catches Docusaurus, but not the Go blog: the count is equal, and the content is changed.
- **Heading-loss alternative** (R headings < 0.8 × W headings). It triggers on Docusaurus (6 < 15.2), docs.rs
  (13 < 14.4) and Wikipedia (9 < 15.2): 3 of the new set.
  - It does not trigger on MDN (15 vs 13.6), mdBook, the Go blog (10 vs 9.6), TWiR or Global Voices.
  - In the first set it also triggered on Substack, making 4 there: Docusaurus, Substack, Wikipedia and docs.rs. The
    first round said 3 because it missed docs.rs (tester correction).
- **No count-based signal catches the Go blog.** Detecting changed code needs a reference text, that is, running the
  walk anyway.

### Walk-quality guards (`thresholds.mjs`, `policy.md`) — N2

| Signal | Range on the 10 fixtures |
|---|---|
| Walk text (chars) | 8,132–32,003 |
| Walk link density | 0.02–0.19, except **TWiR 0.58** |
| Walk / body text | 0.74–0.99 |

- **The link-density guard (≤ 0.35) fired once, on a legitimate page.** TWiR is lists of links, and the walk extracts
  it perfectly (100% content, 0 noise). The policy then fell back to Readability, which was also good there (99%,
  0 noise), so no harm on this set. But the guard has no true positive: no fixture is a real link farm or index page.
- **The 500-char floor never fired.** The smallest walk is 8,132 chars.
- Both thresholds are therefore untested against real negative examples.

### Negative controls (`policy.md`)

- **No semantic container** (`main`/`article` renamed to `div`, `role=main` removed): the policy falls back to
  Readability on 10/10, with the Readability losses above.
- **Whole page in one `<main>`:** walk recall 99–100% (MDN 99%), precision 75–100%. Global Voices is the worst: its
  sidebar and related stories are inside `main` already.

### Docs-specific blocks inside the content roots (`kinds.md`)

- **Tabs:** Docusaurus has 26 `role=tabpanel`, 19 of them hidden. Global Voices has 2.
- **`details`/`summary`:** MkDocs 3, MDN 1, docs.rs 1.
- **Admonitions:** Docusaurus `.theme-admonition` and MkDocs `.admonition`. The GitHub count comes from loose class
  matches.
- **Figures:** mdBook 10, MDN 2.

## The trade-off (replaces the first round's "criterion #1 met")

Criterion #1 (≥ 8/10 without nav/footer noise) is **not met by either method** on this set, judged on the actual
output: R 7/10, W 4/10. The first round's "chrome leak 0/10" only showed that the walk removes the landmarks it is
told to remove.

The two methods fail differently:

- **The walk keeps everything and adds UI noise.** All content blocks and all code blocks are kept on 10/10. The cost
  is 0–5% of output chars of in-content UI text: badges, edit and feedback links, tag lists, related stories. That
  noise is visible: it gets translated and shown, and it costs tokens. Nothing is lost.
- **Readability is cleaner and loses content silently.** It has less noise (7/10 clean, ≤ 0.5% of chars). But it
  loses or corrupts content on docs sites with no usable signal:
  - code changed on 2 of 8 fixtures with code (hidden tab panels; Go code comments deleted inside `pre`);
  - headings lost on 3 (class-name regexes);
  - intro paragraphs lost.

  A reader can't see what is missing.
- **Neither is good enough alone for criterion #1.** Criterion #2 (code intact, 10/10) is met only by the walk.

## Deviation from plan default

**Deviation (b), kept with corrected evidence: walk first, Readability as the fallback.** The plan default is the
reverse: Readability first, walk as the fallback.

- **Why walk first.** Criterion #2 is a hard requirement for a docs translator. Readability breaks it on 2 of 8 code
  fixtures. For one of them (the Go blog) no count-based poor-result rule can tell, short of running the walk as a
  reference.
- **What walk first costs.** Criterion #1 is unmet (4/10) until M0-E5 adds noise removal. The first round's claim that
  it was met is withdrawn.
- **Proposed policy:**
  1. Build the working copy by **composing open shadow roots** into the clone (slots → assigned light children).
  2. **Walk** as in `spikes/s3/walk.mjs`, plus the **generic in-content rules** (+G): visually-hidden helpers, paywall
     boxes, edit-section links, letterless permalink anchors.
  3. **Visibility filter** in the content script: drop elements that fail `checkVisibility()`, except
     `[role=tabpanel]` and the content of closed `details` (see Consequences). On Wikipedia this would drop the 10
     hidden-kind items.
  4. Accept the walk when it has ≥ 500 chars. Keep the link-density guard only as a *tie-breaker*, not a rejection:
     it misfired on TWiR (follow-up below).
  5. Otherwise run **Readability** on the composed clone, and accept it when it has ≥ 500 chars.
  6. Otherwise show the "extraction failed → selection mode" hint (DESIGN §9).
- **The open question for the user.** Should M0 also ship a small **per-generator noise table** (+S: Docusaurus, MDN,
  rustdoc, MediaWiki, WordPress, …)? On these fixtures it brings the walk to 9/10, but it is overfitted to them and
  has to be maintained. The alternative is to accept criterion #1 as unmet in M0 and track noise as an M3 polish item.
  - The supervisor/user decides. Either way, I propose rewording criterion #1 to "judged against a hand-checked noise
    list". "nav/footer" invites the circular measure.
- **If the user keeps the plan default instead**, the poor-result rule needs a heading-loss signal (R headings
  < 0.8 × walk headings, which falls back on 3 of the new set). Even then the Go blog's code corruption passes
  undetected.

## Decision (pending the deviation above)

- **Extraction policy:** the walk-first policy above.
- **Thresholds:** walk ≥ 500 chars; Readability ≥ 500 chars. Link density is not a rejection threshold.
- **Segment kinds:**
  - No new kind is needed in M0. Admonitions and `details` extract as ordinary `p`/`li`/`code` blocks.
  - A `summary` becomes a `p`.
  - Tab panels are segmented like other content.
  - Figure captions use the existing `caption` kind.
  - A dedicated `callout` kind is left for M3.
- **Fixtures:** `fixtures/sites/` (10 HTML files + `manifest.json` + `ATTRIBUTION.md` + README) for M0-E8, plus the
  noise list `spikes/s3/noise.json` as the reference for criterion #1.

## Consequences

- **M0-E5, shadow DOM.** Shadow-root composition must run before extraction (`flattenShadow` is the reference).
  Closed shadow roots stay invisible; no fixture needed them.
- **M0-E6, `domPath` must encode shadow-host boundaries** (N3). A segment inside a shadow root (MDN's 13 code
  examples, GitHub's 30 roots) can't be found again from a light-DOM path. The path needs a "host → shadowRoot" step
  each time it crosses one.
- **M0-E5/M0-E6, hidden tab panels** (N3). On Docusaurus 19 of 26 panels (19 of 59 `pre`) are extracted and segmented
  but never visible until the reader switches tabs. Proposal: segment them, as their ids must be stable, but don't
  translate them in the first pass. Translate a panel when it becomes visible (`role=tabpanel` loses `hidden`, watched
  with a MutationObserver), as a high-priority job. This keeps token cost proportional to what is read.
- **M0-E5, CSS-hidden content** (N3). Use `checkVisibility()` in the live page. It must treat hidden tab panels and
  closed `details` content as *kept, lazily translated*, consistent with the tab rule above; otherwise those would be
  dropped. jsdom can't evaluate CSS, so M0-E8 snapshot tests cover the `[hidden]` attribute path only and mark the CSS
  path as manual/e2e.
- **M0-E5 follow-ups for the thresholds** (N2):
  - Collect negative examples for the link-density guard (index pages, link farms, tag archives) before giving it any
    rejecting role.
  - Collect a page whose walk is < 500 chars but real (a short docs page), to set the floor.
  - Both are untested today.
- **M0-E8.**
  - jsdom tests must flatten `<template shadowrootmode>` first.
  - `noise.json` is the reference list for criterion #1.
  - jsdom and `@mozilla/readability` go into the root `devDependencies` properly (N8).
- **Rebase step (N8).** `spikes/s3` has its own `package.json`/`package-lock.json`. When `spikes/` is added to the
  eslint ignores, check that the root pnpm workspace globs don't include `spikes/*` and that `pnpm check` doesn't
  traverse `spikes/s3/node_modules`.

## Proposed spec changes

1. **DESIGN §4.1 item 1.**
   - Old: "Runs Readability on a cloned DOM. If the result is poor (too little text compared with the page), it falls
     back to walking `main`/`article`/`[role=main]`."
   - New: "Composes open shadow roots into a working copy, then walks `main`/`article`/`[role=main]`, removing landmark
     chrome, generic in-content UI (visually-hidden helpers, edit links, permalink glyphs) and elements that fail
     `checkVisibility()`. Inactive tab panels and closed `details` are kept and translated when shown. If the walk finds
     no container or too little text, it falls back to Readability on the composed copy, then to selection mode."
   - Only if deviation (b) is accepted.
2. **DESIGN §2 table, "Content extraction" row.**
   - Old: "Use it for articles, with a DOM-walk fallback for docs sites and SPAs."
   - New: "DOM walk first, so docs-site structure and code survive; Readability as the fallback for pages without
     semantic containers."
   - Only if (b) is accepted.
3. **ROADMAP M0-E5.**
   - Old: "Readability on a cloned DOM; poor-result heuristic; `main`/`article`/`[role=main]` walk fallback"
   - New: "shadow-composed clone; `main`/`article`/`[role=main]` walk with in-content noise rules and visibility
     filter; Readability fallback"
   - Only if (b) is accepted.
4. **Plan §3 criterion #1.**
   - Old: "Fixture sites with no nav/footer noise in segments"
   - New: "Fixture sites with no UI noise in segments, judged against the hand-checked list `spikes/s3/noise.json`"
   - Target unchanged (≥ 8 of 10). Applies either way.
5. **ROADMAP §2 S3 row: fixture families.**
   - Old: "GitBook, … Medium, Substack, …, one news site"
   - New: "mdBook (GitBook-style), …, a long-form blog essay, a newsletter issue, one news site (all permissively
     licensed)"
   - Applies either way.

## Limits of this spike

- **jsdom, not Chrome.** CSS-hidden content can't be seen. The visibility-filter step and the "hidden" noise kind are
  argued, not measured.
- **One page per family.** The noise list is mine, made by reading outputs, so a second labeller might differ on
  borderline items. Examples: Docusaurus "Live Editor"/"Result", and the Go blog's "The Go Blog".
- **No fixture exercises a paywall,** a real link farm, a page without semantic containers (only simulated), or a
  closed shadow root.
- **GitHub page chrome.** `github-readme-bat` includes github.com's own page markup around the README, which the
  README's license doesn't cover. That's an open item in `ATTRIBUTION.md` for the user: keep it, or cut the fixture
  down to the README article.
- **History rewrite.** The replaced fixtures' blobs may survive as unreachable objects in the local object store until
  `git gc`. They are in no commit on any branch. `git log --all` on their paths is empty.
