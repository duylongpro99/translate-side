# S3 — Extraction quality on docs sites → extraction policy and fallback thresholds

Status: proposed (awaiting review) · Date: 2026-10-05 · `@mozilla/readability` 0.6 + jsdom · Spike code: `spikes/s3/` ·
Fixtures: `fixtures/sites/`

## Question

Readability is tuned for articles. On docs sites, does it lose code blocks, tables, admonitions or headings, or keep
sidebars? How does it compare with walking `main`/`article`/`[role=main]`? What "poor result" heuristic (text ratio,
lost `pre` count) should trigger the fallback? Which segment kinds need special handling? Plan §5 default:
"Readability first; 'poor result' heuristic (text ratio, lost `pre` count) triggers the `main`/`article`/`[role=main]`
walk."

## Method

- **Fixtures.** Ten pages, one per family named in ROADMAP §2: Docusaurus, MkDocs Material, GitBook, MDN, docs.rs,
  GitHub README, Medium, Substack, Wikipedia, a news site (The Guardian). They were captured as rendered DOM by headless
  Chrome 154, with open shadow roots kept as declarative shadow DOM. See `fixtures/sites/README.md` and
  `manifest.json` for URLs and capture times.
- **Ground truth.** A hand-picked content root per site (`contentSelector` in the manifest, chosen from each
  generator's markup before any scoring), minus `nav`/`aside`/`footer`/`button`/hidden non-tab elements.
- **Methods compared.**
  - **R** = `new Readability(clone).parse()`.
  - **W** = the walk in `spikes/s3/walk.mjs`. It takes the outermost `[role=main]`/`main` (else `article`), narrows to a
    single `article` holding ≥ 50% of its text, then removes nav/aside/footer/landmark roles, forms, buttons,
    `aria-hidden` and `[hidden]` (except `[role=tabpanel]`), plus language-switcher lists (≥ 5 links, ≥ 80% with
    `lang`/`hreflang`).

  Both run after **shadow flattening**: each open shadow root is composed into the light tree, with slots receiving the
  host's light children.
- **Metrics.**
  - Recall and precision of word 5-gram shingles against the truth.
  - **Chrome leak**: output shingles that appear in the page's nav/aside/footer/header outside the truth. This is
    independent of how the truth root was picked.
  - **`pre` kept**: each truth `<pre>` must have a byte-identical (whitespace-normalized) output `<pre>`, matched as a
    multiset.
  - Headings and `p`/`li` kept, as exact block-text matches.
- Scripts: `analyze.mjs` (→ `results.md`), `structure.mjs` (→ `structure.md`), `thresholds.mjs`, `policy.mjs`
  (→ `policy.md`), `kinds.mjs` (→ `kinds.md`). Re-run: `cd spikes/s3 && npm i && node analyze.mjs`.

## Evidence

### Text and code (`results.md`, shadow flattening on)

| Fixture | R recall | R precision | R `pre` kept | W recall | W precision | W chrome leak | W `pre` kept |
|---|---|---|---|---|---|---|---|
| Docusaurus code-blocks | 89% | 96% | **40/59** | 100% | 100% | 0 | 59/59 |
| MkDocs Material admonitions | 98% | 99% | 17/17 | 100% | 100% | 0 | 17/17 |
| GitBook code-block | **87%** | 99% | 6/6 | 100% | 100% | 0 | 6/6 |
| MDN `Promise.then` | 92% | 99% | 12/13 | 100% | 100% | 0 | 12/13 |
| docs.rs tokio | 98% | 99% | 8/8 | 100% | 100% | 0 | 8/8 |
| GitHub README (bat) | 100% | 100% | 58/58 | 100% | 100% | 0 | 58/58 |
| Medium | 99% | 100% | – | 100% | 100% | 0 | – |
| Substack | 96% | 99% | – | 100% | 98% | 0 | – |
| Wikipedia | 98% | 99% | 4/4 | 100% | 99% | 0 | 4/4 |
| The Guardian | 99% | 100% | – | 100% | 93% | 0 | – |

Chrome leak for R was 0 on all ten. The 1 MDN `pre` missing from both methods is the source of the "Try it" interactive
example. It sits in a `hidden` `<mdn-code-example>` and is not visible on the page. Counting visible `pre` only, both
methods keep 12/12. The walk's W precision below 100% is legitimate content outside the narrow truth root (Guardian
headline, standfirst and captions; Substack title and paywall notice; Wikipedia footnotes). Before the
language-list rule, Wikipedia leaked its 9 interlanguage links ("Català", "Deutsch", …).

### Structure (`structure.md`)

| Fixture | Headings in truth | R kept | W kept | `p`+`li` in truth | R kept | W kept |
|---|---|---|---|---|---|---|
| Docusaurus | 19 | **6** | 19 | 79 | 79 | 79 |
| MkDocs Material | 13 | 12 | 13 | 66 | 66 | 66 |
| GitBook | 12 | 11 | 12 | 38 | **25** | 29 |
| MDN | 21 | 15 | 17 | 38 | 33 | 37 |
| docs.rs | 19 | 13 | 18 | 83 | 83 | 83 |
| GitHub README | 68 | 68 | 68 | 180 | 180 | 180 |
| Medium | 6 | 5 | 6 | 34 | 34 | 34 |
| Substack | 11 | **0** | 11 | 124 | 124 | 124 |
| Wikipedia | 19 | **9** | 19 | 271 | 268 | 269 |
| The Guardian | 7 | 7 | 7 | 59 | 51 | 59 |

Why Readability loses them (checked in its output HTML with `peek.mjs`):

- **Headings.** It removes `h1`/`h2` whose class name matches its "negative" pattern. Docusaurus headings carry
  `anchorTargetHideOnScrollNavbar_*`, which contains "scroll", so "Line numbering", "Code title" and others are
  absent. It also takes the `h1` out into `article.title`.
- **Intro text.** It drops intro paragraphs outside the subtree it picks as the top candidate: MDN's first paragraph
  "The then() method of Promise instances…" and GitBook's lead paragraph.
- **Tabs and hidden blocks.** It drops `hidden` subtrees, which on Docusaurus are the inactive tab panels: 19 of 26
  panels, holding 19 of the 59 `pre`.

None of this shows in a length ratio: R length / W length was 0.89–1.00 on all ten (`thresholds.mjs`).

### Shadow DOM

Without flattening, MDN's truth has **0** `pre` and R recall falls to 88% on a truth half its real size
(`results.md`, second table). All 13 MDN code examples exist only inside open shadow roots. GitHub (30 shadow roots),
GitBook (1) and docs.rs (1) also use them. `Node.cloneNode` does not copy shadow roots, so "Readability on a cloned DOM"
as DESIGN §4.1 puts it would lose them unless the clone is built by composing shadow trees.

### Walk-quality signals (`thresholds.mjs`)

| Signal | Range on the 10 fixtures |
|---|---|
| Walk text (chars) | 4,013–32,081 |
| Walk link density | 0.02–0.19 (Wikipedia highest) |
| Walk / body text | 0.62–0.99 |

### Negative controls (`policy.md`)

- **No semantic container** (`main`/`article` renamed to `div`, `role=main` removed): the policy falls back to
  Readability on 10/10, with the Readability losses above (e.g. Docusaurus 89% recall, 40/59 `pre`).
- **Whole page in one `<main>`:** the walk stays at 100% recall, 92–100% precision, chrome leak 0–15 shingles. The
  noise selectors do the work. The link-density guard never fired, and no fixture tests it.

### Docs-specific blocks inside the content roots (`kinds.md`)

- **Tabs:** Docusaurus has 26 `role=tabpanel`, 19 of them hidden.
- **`details`/`summary`:** MkDocs 3, MDN 1, docs.rs 1.
- **Admonitions:** Docusaurus `.theme-admonition` and MkDocs `.admonition`.
- **Figures and captions:** news and blog sites (Guardian 11, Substack 12).

The admonition counts for GitBook and GitHub come from loose class matches and aren't reliable.

## Deviation from plan default

**Deviation (b): walk first, Readability as the fallback (plan default: Readability first, walk as the fallback).**

- Evidence: on docs sites Readability loses structure the reader and the chunker need. It kept 6/19 headings on
  Docusaurus, 0/11 on Substack and 9/19 on Wikipedia. It also loses intro paragraphs (MDN, GitBook) and inactive tab
  panels (19/59 `pre` on Docusaurus).
  - The plan's poor-result signals can't see these losses. The text ratio stays at 0.89–1.00. The `pre` count catches
    only the tab case.
  - Chunking cuts at headings (DESIGN §5.7 Step 2), so lost headings degrade chunks too.
  - The walk kept every visible block and every `pre` on 10/10 with zero chrome leak.
- Proposed policy:
  1. Build the working copy by **composing open shadow roots** into the clone (slots → assigned light children).
  2. **Walk** as in `spikes/s3/walk.mjs`. Accept it when it has ≥ **500** chars and link density ≤ **0.35**: margin
     over the observed maximum of 0.19, and so far untested by any negative example. Keep `[role=tabpanel]` content
     even when hidden; drop other hidden content.
  3. Otherwise run **Readability** on the composed clone. Accept it when it has ≥ 500 chars.
  4. Otherwise show the "extraction failed → selection mode" hint (DESIGN §9).
- If the user keeps the plan default instead, the poor-result rule needs a **heading-loss** signal (Readability
  headings < 0.8 × walk headings) in addition to text ratio and `pre` count. Docusaurus, Substack and Wikipedia would
  then fall back.

## Decision (pending the deviation above)

- Extraction policy: the walk-first policy above. Thresholds: walk ≥ 500 chars and link density ≤ 0.35; Readability ≥
  500 chars.
- Segment kinds:
  - No new kind is needed in M0. Admonitions and `details` extract as ordinary `p`/`li`/`code` blocks.
  - A `summary` becomes a `p`.
  - Tab panels are segmented like any other content.
  - Figure captions use the existing `caption` kind.
  - A dedicated `callout` kind is left for M3 rendering polish.
- Fixtures: `fixtures/sites/` (10 HTML files + `manifest.json` + README) for M0-E8.

## Consequences

- M0-E5 must implement shadow-root composition before extraction (`flattenShadow` is the reference algorithm). Closed
  shadow roots stay invisible; none of the fixtures needed them.
- M0-E5/E8 tests in jsdom must flatten `<template shadowrootmode>` first, because jsdom doesn't attach declarative
  shadow roots.
- Success criteria #1 and #2 (≥ 8/10 without nav/footer noise; 10/10 code intact) are met by the walk on these
  fixtures in the spike harness (chrome leak 0/10; visible `pre` 10/10). M0-E5/E8 still has to reproduce this with the
  real segmenter.
- DESIGN §4.1 item 1 should be updated: walk first, Readability as fallback, shadow composition, tab panels kept.

## Limits of this spike

- jsdom, not Chrome. Readability uses no computed style, so this is close to what a content script would get. But the
  walk's `[hidden]` handling ignores CSS-hidden elements, which jsdom can't see.
- One page per site family. The truth roots are mine, and for several sites they coincide with the walk's root, so W
  recall of 100% is partly by construction. The chrome-leak and structure metrics don't depend on that choice.
- No page without semantic containers exists among the fixtures. The fallback path was exercised only by synthetic
  renaming.
