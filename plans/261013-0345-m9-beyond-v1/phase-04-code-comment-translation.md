---
title: "Phase 4: Code-comment translation"
status: todo
priority: P3
effort: "2.5d"
dependencies: []
tier: pro
feature_id: code-comments
---

# Phase 4: Code-comment translation

## Goal

Translate the comments inside read-only code blocks while every code byte outside the comments stays identical, behind
a setting (M9 §2.6). Pro feature id `code-comments`.

## Context links

- Spec: `docs/plans/M9-beyond-v1.md` §2.6; DESIGN §4.1 and §8 (`DESIGN.md:810-813`: editor surfaces stay excluded
  from any "translate code comments" option).
- Scout: `plans/reports/scout-261013-1036-m8-track-surfaces.md` §6.
- Code segments today: kind `code`, `translate: false` (`src/segment/segmenter.ts:61`), text from `codeText`
  (`:304-320`, verbatim), language from `codeLang` (`:322-333`) stored as `Segment.codeLang`
  (`src/engine/types.ts:32-33`). `CODE_BLOCK = 'pre, .cm-content, .CodeMirror-code'` (`src/segment/code-block.ts:6`).
- The engine skips `translate: false` segments (`src/engine/engine.ts:105`, `chunker.ts:55`).
- Panel rendering of code: `src/entrypoints/sidepanel/SegmentList.tsx:270-279`; copy: `:75-77`.
- Cross-plan gate: `plan.md` "Cross-Plan Dependencies" (`featureAvailable('code-comments')`).

## Requirements

- A preference `codeComments: boolean`, default `false` (`Preferences`, `src/shared/settings.ts:245`, read by
  `readPreferences` `:292`). Effective only when `featureAvailable('code-comments')` is true.
<!-- Updated: Validation Session 1 - gate resolved once and stored -->
- Gate: `featureAvailable('code-comments')` is awaited once, when the panel receives a page's extract result
  (`controller.ts:321`, already async), and the answer is stored on that tab's document session next to its segments.
  Sync code (rendering, job start) reads the stored value and never calls `featureAvailable`. In Options, the toggle
  is shown disabled when the feature is locked, with the licensing plan's `<ProLock>` note (`pro.locked`, "Part of
  Pro") beside that control only.
- Only blocks whose segment `domPath` ends in a `pre[n]` step are eligible. Editor surfaces (`.cm-content`,
  `.CodeMirror-code`) and block-level `<code>` are never eligible (DESIGN §8). Author opt-out (`translate="no"`,
  `.notranslate`) already keeps segments out; comment segments inherit their block's opt-out.
- Comment extraction is a pure function per language family, conservative: when the lexer is unsure, the block gets
  no comment segments.
<!-- Red Team: identity check cannot catch lexer misreads -->
  - C family (`js javascript mjs cjs ts typescript java c cpp cs go rust swift kotlin scala php`): `//` and `/* */`,
    with single, double and template strings; JS-like regex literals end the block's extraction when ambiguous. A
    `//` starts a comment only at line start or after whitespace (so `https://` and `url(//cdn…)` never do).
  - JSX family (`jsx tsx`): only comments that start a line (`//` lines, `/* */` and `{/* */}` blocks); a `//` or
    `/*` after other text on the line is left alone, because JSX text children can hold URLs and prose.
  - CSS family (`css scss less`): `/* */` only; `scss` and `less` also `//` at line start. CSS has no `//` comments.
  - Hash family (`py python rb ruby sh bash zsh shell console yaml yml toml r perl`): `#` outside strings; Python
    triple quotes are strings (docstrings are not translated); shell `#` only at line start or after whitespace.
  - Dash family (`sql lua hs haskell`): `--`.
  - Markup (`html xml svg vue`): `<!-- -->`.
  - No `codeLang`, or one not listed: no extraction.
- Only the comment body is translated. Delimiters, indentation and continuation prefixes (`*` lines in block
  comments, repeated `//` on merged line comments) are kept and re-applied to the translated lines.
- The translated text cannot break out of its comment: `*/` → `* /`, `-->` → `-- >`, and a line comment's
  translated newlines are re-prefixed.
- **Byte-identity check**: a pure `codeOutsideComments(text, spans)` returns the concatenation of every byte outside
  the comment spans. The rendered block is accepted only when it equals the original's; otherwise the block shows its
  original code unchanged and logs a diagnostics entry (kind only). Fail closed.
<!-- Red Team: identity check cannot catch lexer misreads -->
  This check only catches splice bugs: if the lexer reads code as a comment, that code is inside a span on both
  sides and the check passes. Lexer misreads are guarded separately: by the start-of-line/after-whitespace rule
  above, by a negative corpus test (step 2a) that must yield zero spans, and by a human-reviewed snapshot of every
  span extracted from the fixtures (step 4).
- With the setting off or not available, extraction output, the job, the cache and the panel are unchanged from the base commit (v1 behaviour for code blocks).

## Architecture

```
content.ts → extractPage → Segment[] (unchanged; content script and snapshots untouched)
panel controller.ts:321 extract result
  └─ available = await featureAvailable('code-comments')   ← the one gate call site, stored on the doc session
     if prefs.codeComments && available
       withCodeComments(segments): for each eligible code segment
         spans = extractComments(seg.text, seg.codeLang)        (src/segment/comments.ts, pure)
         emit after it one segment per comment:
           { id: hash(seg.id + start + end + body), kind: 'comment', text: body, translate: true,
             commentOf: { id: seg.id, start, end, prefix } }
jobs → engine (comment segments translate like paragraphs; code stays translate:false)
SegmentList: 'comment' segments are not blocks of their own; the parent code block renders
  spliceComments(code, spans, finals) → codeOutsideComments check → shown, or original on mismatch
```

`SegmentKind` gains `'comment'` and `Segment` gains an optional `commentOf` (additive, `src/engine/types.ts:7, 9-38`).
The engine treats `comment` like any translatable segment; no stage changes.

## Related files

- **Create:** `src/segment/comments.ts` (lexers, `extractComments`, `spliceComments`, `codeOutsideComments`),
  `src/segment/comments.test.ts`, `tests/code-identity.test.ts` (every code segment of every `fixtures/docs/*.json`).
- **Modify:** `src/engine/types.ts` (`SegmentKind`, `commentOf`), `src/shared/settings.ts` (`codeComments` preference),
  `src/entrypoints/sidepanel/controller.ts` (`:321`, the gate and `withCodeComments`),
  `src/entrypoints/sidepanel/SegmentList.tsx` (`:270-279` code block with translated comments; `:75-77` copy keeps
  the original code), `src/entrypoints/options/*` (the setting, disabled with `<ProLock>` beside it when locked),
  `src/shared/features.ts` (create the default only if it does not exist yet, per `plan.md`),
  `src/shared/portable.ts` (export and import the new preference), `src/locales/en.yml`, `src/locales/vi.yml`,
  `e2e/flows.spec.ts` (one comment flow on `sites/docusaurus-code-blocks.html`), `scripts/bundle-budget.json`.

## Steps

1. Write `docs/plans/M9-code-comments.md` (M9 §3). If `src/shared/features.ts` does not exist yet, create it with the shared
   contract in `plan.md` (always `true`) and add the M9 ids to `FeatureId`.
2. Write `extractComments` per family with a table-driven test per language (strings containing delimiters, nested
   quotes, escaped quotes, URLs with `//` in strings, shebangs, JSDoc, empty comments, CRLF). Ambiguity returns `[]`.
<!-- Red Team: identity check cannot catch lexer misreads -->
2a. Negative corpus (`src/segment/comments.test.ts`): every entry must yield zero spans, for example
   `background: url(//cdn.example.com/a.png);` in `css`, `<p>See https://x.dev/docs</p>` in `jsx`, a regex literal
   containing `//`, `"a // b"`, a template literal containing `/* b */`, `echo ${#arr}` in `bash`, `color: #fff` in
   `css`, and a CSS string containing `//`.
3. Write `spliceComments` and `codeOutsideComments`; property-style test: for random translations (including
   `*/`, `-->`, newlines, empty strings), `codeOutsideComments(spliced) === codeOutsideComments(original)`.
4. `tests/code-identity.test.ts`: for every code segment in `fixtures/docs/*.json`, splice a mock translation into
   every extracted comment and assert byte identity outside comments; also snapshot every extracted span (language,
   delimiter, first 40 characters) per fixture, so a lexer change is visible and a human reviews the full list once.
<!-- Red Team: identity check cannot catch lexer misreads -->
   Record the comment count per fixture in the phase report, including which fixtures yield none and why (for
   example `mkdocs-material-admonitions` has 17 code segments with no `codeLang`; `mdn-promise-then` uses
   `javascript`, now an alias).
5. Add `'comment'` and `commentOf`; confirm with `pnpm run typecheck` and `check:engine` that no engine code needs a
   change beyond the type.
6. Preference, options UI, export/import of the preference.
7. Gate and derivation at `controller.ts:321`: await `featureAvailable('code-comments')` once per extract result,
   store it on the document session, derive comment segments from the stored value; comment segments inherit the
   parent's `hidden` flag.
8. Panel: render the parent block with finals spliced in, run the identity check, fall back to the original on
   mismatch; comment status (pending, final, failed) shown on the block; Copy gives the original code.
9. E2E on the Docusaurus code fixture with the mock provider: setting on → comments show `vi:`; a DOM read of every
   rendered code block's text outside comments equals the original; setting off → no comment segments exist.
10. Run `pnpm run eval:gate` (the engine type changed) and record it.

## Todo

- [ ] One-page track plan; `features.ts` exists with the M9 ids in `FeatureId`
- [ ] Lexers with per-language tests, aliases and the zero-span negative corpus
- [ ] Splice and identity functions with property tests
- [ ] Fixture-wide identity test, reviewed span snapshot, per-fixture comment counts in the report
- [ ] `comment` kind and `commentOf`
- [ ] Preference, options UI, portable
- [ ] Gate resolved once per extract result and stored; derivation in the controller
- [ ] Panel rendering with the fail-closed check
- [ ] E2E flow
- [ ] Eval gate recorded

## Success criteria

<!-- Red Team: identity check cannot catch lexer misreads -->
- M9 §2.6 done when: code tokens are byte-identical on all code fixtures (`tests/code-identity.test.ts` over every
  code segment of `fixtures/docs/*.json`, the zero-span negative corpus, the human-reviewed span snapshot, and the
  e2e DOM check on the Docusaurus fixture); comments translated (the e2e shows translated comments). An empty
  extraction cannot pass: the report states the comment count per fixture, the Docusaurus fixture yields at least one
  comment for each listed language whose blocks there contain comments, and every span in the snapshot has been
  reviewed as a real comment.
- Setting off: existing snapshot, jobs and panel tests unchanged and green.

## Guarantee to keep

Code stays byte-identical: the identity check is enforced at render time and fails closed. Editor surfaces stay
excluded (DESIGN §8).

## Verification

```
pnpm run test -- src/segment/comments.test.ts tests/code-identity.test.ts
pnpm check
pnpm run e2e
pnpm run eval:gate
```

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| A lexer misreads code (a URL, CSS `url(//…)`, JSX text) as a comment and the translation changes code | Medium × High | The identity check cannot catch this (same spans on both sides); guarded instead by the start-of-line/after-whitespace rule, CSS without `//`, JSX line-start-only, the negative corpus and the reviewed span snapshot |
| Merged line-comment translations change line count | High × Low | Allowed inside comment spans; the identity check compares bytes outside spans only |
| Comment segments inflate cost on code-heavy docs | Medium × Low | Off by default; the cost readout counts them like any segment |
| `domPath` shape changes and editor blocks become eligible | Low × High | A test asserts `.cm-content` and `.CodeMirror-code` fixtures produce no comment segments |

## Security

Comment text goes to the provider only when the user turned the setting on; it is page content and already covered
by the privacy notice. Translated comments render as text (Preact text nodes), never HTML. Typed text in editors is
never read (DESIGN §8).

## Rollback

Turn the default off (already off) or remove the controller derivation; with no comment segments everything is v1.
Cached comment translations are keyed by their own segment ids and are simply unused.
