# S3 — Extraction quality on docs sites → extraction policy and fallback thresholds

Status: **user decisions 2026-10-05 recorded** (deviation (b) approved; criterion #1 with G+S; GitHub fixture cut to the README); review rounds 1–2 addressed · Date: 2026-10-05 · `@mozilla/readability` 0.6 + jsdom · Spike code:
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
  | `github-readme-bat` | GitHub README | MIT OR Apache-2.0 (the README article only: cut by user decision, see below) |
  | `wikipedia-futures-promises` | Wikipedia | CC-BY-SA-4.0 |
  | `goblog-pipelines` | long-form blog essay, go.dev (replaces Medium) | CC-BY-4.0 text, BSD-3-Clause code (verified at go.dev/copyright: "Creative Commons Attribution 4.0", code "BSD license") |
  | `twir-671` | newsletter issue, This Week in Rust (replaces Substack) | CC-BY-SA-4.0 |
  | `globalvoices-bangladesh-protests` | news article, Global Voices on WordPress (replaces The Guardian) | CC-BY-3.0 text |

  **GitHub fixture cut (user decision 2026-10-05).** `github-readme-bat` now holds only the README article
  (`article.markdown-body`), with the doctype, `<base>`, charset, viewport and title (`spikes/s3/cut-github.mjs`).
  The github.com page markup around it is GitHub's, not covered by bat's license, so it is gone. The 30 open shadow
  roots were all in that page markup, so the fixture now has none. Every S3 number was re-scored after the cut. Three
  GitHub numbers changed from the cut: walk / body text 0.84 → 1.00; whole-page-in-`main` control precision
  92% → 100%, link density 0.11 → 0.04 (`policy.md`, `thresholds.mjs`). Global Voices changed in the same re-score,
  from the tester's added label ("বাংলা"), not from the cut: noise items 49 → 50, W 14.5% → 14.6% of output chars,
  upper bound W 60 → 63, W+G+S 8 → 10 (`noise.md`). The S2 chunk files did not change.

  Authors, history links and changes are in `fixtures/sites/ATTRIBUTION.md`. There is also a `license` field per
  fixture in `manifest.json`.

  Pages were captured as rendered DOM by headless Chrome 154, with open shadow roots kept as declarative shadow DOM.
  They were then scrubbed (`spikes/s3/scrub.mjs`, at every shadow depth): scripts, iframes, network hints, tracking
  `<meta>` and `data-hydro*`/`data-analytics*`/`data-ophan*`-style attributes are removed. See
  `fixtures/sites/README.md`. In round 2 the scrub also removes hidden form inputs (comment-form nonces), Gravatar
  `<img>`s and HTML comments other than the attribution header. Global Voices' comment form itself is kept, because
  its labels are a labelled noise case. Re-scrubbing changed no score.

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
| MDN | 1 | 13 | 13 | 0 | 0 | Baseline badge and its description, "See full compatibility", "Help improve MDN", last-modified line, "View this page on GitHub", "Report a problem…" |
| docs.rs | 1 | 5 | 5 | 0 | 0 | rustdoc toolbar "Search", "Settings", "Help", "Source"; "Expand description" |
| GitHub README | 0 | 0 | 0 | 0 | 0 | — |
| Wikipedia | 16 | 31 | 12 | 0 | 0 | "[edit]" ×19, "Edit links", "From Wikipedia, the free encyclopedia", "Jump up to:" ×7, category links |
| Go blog | 0 | 4 | 4 | 1 | 0 | "The Go Blog", next/previous article links, "Blog Index" |
| TWiR newsletter | 0 | 0 | 0 | 0 | 0 | — |
| Global Voices news | 0 | 50 | 50 | 0 | 0 | language switcher ("Read this post in", "বাংলা"), 21 category/tag links, donation widget, two related-story lists (6 cards with bylines and dates), comment form |
| **Sites with 0 visible noise** | **7/10** | **4/10** | **4/10** | **9/10** | **10/10** | |

- **Size of the noise.** In W it is 0–14.6% of output chars: Global Voices 14.6%, MDN 3.6%, Docusaurus 1.7%,
  Wikipedia 1.1%, all others < 0.3%. In R it is 0–0.5%. (Round 1 said 5.3% for Global Voices; the tester found
  related-story cards, tag links and the donation widget missing from the list. They are now labelled.)
- **Hidden kind.** Wikipedia has 13 more items (short description, hidden maintenance categories, a citation-error
  message) in W. A visibility check in Chrome would drop them; jsdom cannot.
- **Glyph kind.** Docusaurus has 17 in W, MkDocs 14, docs.rs 18, Go blog 10, Wikipedia 100 ("↑" footnote
  back-links). The +G anchor rule removes them all.
- **The +S selectors were written from these same fixtures.** W+G+S reaching 9/10 shows that a per-generator table
  *can* clean these pages. It is not evidence that it generalizes. On its own, +G changes only Wikipedia (31 → 12) and
  no site's zero-noise count.
- **Content.** None of the in-content selectors removed content. This is measured against the truth minus *only* the
  labelled `noise.json` items (round 2, C1: round 1 also subtracted the G/S selectors from the truth, which made the
  check circular). W, W+G and W+G+S keep 100% of content blocks and every `pre` on 10/10, **with two caveats**
  (review round 2):
  - **D1.** The truth is also stripped by the walk's own exclusion list (`noise-score.mjs:61` removes `walk.mjs`
    `NOISE`), so W's recall can't see what that list drops. One real case: Global Voices'
    `blockquote#original-tab-0`, a jQuery UI tab panel (`role=tabpanel`, `aria-hidden="true"`, `display: none`) with
    the 317-char Bangla original of a quote. The walk drops it through `[aria-hidden=true]`. Only `[hidden]` has the
    `:not([role=tabpanel])` exception. Readability loses it too. So "100% of content" holds only for content the
    walk's exclusion list doesn't touch.
  - **Global Voices' recall check is trivial.** It strips 0 items from its truth, because all its labelled noise sits
    outside the `contentSelector`, so its 100% says nothing. While fixing C1, the first
  re-run showed apparent losses under +G (Wikipedia 62%). Each one traced back to an unlabelled noise item, which is
  now labelled ("↑"/"↩" back-links, MDN's baseline description and last-modified line), not to content
  (`missing-blocks.mjs`, `g-diagnose.mjs`). Review round 2 (D2) found that `g-diagnose.mjs`'s filter was a no-op
  (`base.contains ? true : true`). It now keeps only hits whose text the walk would keep. Re-run on all 10 fixtures,
  it reports only fragments of labelled noise (Wikipedia's `[`, `]`, `edit` pieces of "[edit]") and MDN's
  visually-hidden compatibility-table labels ("desktop", "mobile", "Legend"). That is UI text, not content.
- **Counting method (C2).** Items are counted as elements whose whole text equals the item. Noise that sits as a bare
  text node or inside a larger element would be missed. Upper bound: a whole-word substring count over the output
  text gives R 6/10, W 4/10, W+G+S 8/10, R+G+S 9/10 sites with zero visible noise (`noise.md`). The extra hits are
  Global Voices' tag words ("Bangladesh", "Protest"), which also occur in the article text. Global Voices is the only
  site where the two counts differ. (Round 2 said "and the Go blog", which was wrong: its counts are the same under
  both methods.)

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
| Go blog | `pre` 9/26 | code comments are `<span class="comment">`; *unlikelyCandidates* matches `comment`, so **comments are deleted from inside `<pre>`**: all 54 comments are gone (55 `span.comment`, one of which is a highlight
  marker whose text survives elsewhere). The code is changed silently, and the `pre` count stays 26. | identical `pre` 9 → 25 |
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
| Walk / body text | 0.74–1.00 (GitHub 1.00, since the fixture is now just the article) |

- **The link-density guard (≤ 0.35) fired once, on a legitimate page.** TWiR is lists of links, and the walk extracts
  it perfectly (100% content, 0 noise). The policy then fell back to Readability, which was also good there (99%,
  0 noise), so no harm on this set. But the guard has no true positive: no fixture is a real link farm or index page.
- **The 500-char floor never fired.** The smallest walk is 8,132 chars.
- Both thresholds are therefore untested against real negative examples.

### Negative controls (`policy.md`)

- **No semantic container** (`main`/`article` renamed to `div`, `role=main` removed): the policy falls back to
  Readability on 10/10, with the Readability losses above.
- **Whole page in one `<main>`:** the walk is chosen on 9/10. TWiR goes to Readability, because of the link-density
  guard (0.58). Where chosen, walk recall is 99–100% (MDN 99%) and precision 75–100%. Global Voices is the worst: its
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

- **The walk keeps everything and adds UI noise.** All content blocks and all code blocks are kept on 10/10, except
  content its exclusion list drops, such as the `aria-hidden` tab panel on Global Voices (D1 above). The cost
  is 0–14.6% of output chars of in-content UI text: badges, edit and feedback links, tag lists, related stories. That
  noise is visible: it gets translated and shown, and it costs tokens. Apart from that exception, nothing is lost.
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
     `[role=tabpanel]` and the content of closed `details` (see Consequences). On Wikipedia this would drop the 13
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

## Decision

**User decisions 2026-10-05:**

- **Deviation (b): approved.** The order is walk first, then Readability as the fallback, then a selection hint.
- **Criterion #1:** M0-E5 ships the generic + per-site (**G+S**) cleanup selectors. Criterion #1 is judged against the
  hand-labelled noise list (`noise.json`). +S is the chosen M0-E5 policy. The caveat stays: the +S selectors were
  written from these same fixtures, so they may overfit.
- **GitHub fixture:** cut to the README article and re-scored (Method).
- **Repo LICENSE:** MIT, with `fixtures/` excluded, since `fixtures/sites/ATTRIBUTION.md` covers them. It is added in
  the final Phase B step.
- **Spec changes:** all approved. They are applied in the final Phase B step.


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
  examples; GitHub's 30 roots were in the page markup that has now been cut) can't be found again from a light-DOM path. The path needs a "host → shadowRoot" step
  each time it crosses one.
- **M0-E5/M0-E6, hidden tab panels** (N3). On Docusaurus 19 of 26 panels (19 of 59 `pre`) are extracted and segmented
  but never visible until the reader switches tabs. **The rule must cover every way a panel is hidden** (D1): the
  `hidden` attribute (Docusaurus), `aria-hidden="true"` plus `display: none` (jQuery UI, the Global Voices quote tabs),
  and CSS. The walk's exclusion list therefore becomes `[aria-hidden=true]:not([role=tabpanel])`, as `[hidden]`
  already is. Proposal: segment them, as their ids must be stable, but don't
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

**Applied in 1802f7f** (user decisions 2026-10-05), with D13's generic + per-site selectors in M0-E5 and criterion #1. The M0 plan §5 extraction-policy row was updated to match in a follow-up commit.

1. **DESIGN §4.1 item 1.**
   - Old: "Runs Readability on a cloned DOM. If the result is poor (too little text compared with the page), it falls
     back to walking `main`/`article`/`[role=main]`."
   - New: "Composes open shadow roots into a working copy, then walks `main`/`article`/`[role=main]`, removing landmark
     chrome, generic in-content UI (visually-hidden helpers, edit links, permalink glyphs) and elements that fail
     `checkVisibility()`. Inactive tab panels and closed `details` are kept and translated when shown. If the walk finds
     no container or too little text, it falls back to Readability on the composed copy, then to selection mode."
   - Deviation (b) was approved on 2026-10-05.
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
- **One page per family.** The noise list is mine, made by reading outputs, and the tester found gaps in round 2 (now
  fixed). A second labeller might still differ on borderline items. Labelled as noise: Docusaurus "Live
  Editor"/"Result", the Go blog's "The Go Blog". Treated as content: tab labels (Docusaurus npm/Yarn/pnpm/Bun, Global
  Voices "Translation"/"Original Quote"), the article date line ("Translation posted …"), and the article byline even
  where the theme repeats it (Global Voices ×4).
- **The counter matches whole element text** (C2). See the upper-bound row in `noise.md`.
- **No fixture exercises a paywall,** a real link farm, a page without semantic containers (only simulated), or a
  closed shadow root.
- **GitHub page chrome is gone.** Since the cut (user decision), `github-readme-bat` no longer tests noise or
  shadow DOM outside the README. Its whole-page and walk / body numbers are trivially clean.
- **Fixture scripts are not idempotent.** Running scrub.mjs + attribution.mjs re-adds one newline after the header
  of fixtures committed without it; the pair is stable after one run. In the committed state only `github-readme-bat`
  has the newline; the other 9 don't. Making all 10 consistent is logged for Phase C (M0-E8).
- **History rewrite.** The replaced fixtures are in no commit on any branch, and `git log --all` on their paths is
  empty, so they can't be pushed. Their blobs are still *reflog-reachable* in the local object store. Removing them
  needs `git reflog expire --expire=now --all && git gc --prune=now`, which was not run (supervisor's call).
