# M2 — Contextual quality

Size: M · Depends on: M1 · Unblocks: M3 (quality worth using), M7 (stages, providers, eval)

## 1. Goal

**Make translations read as if a native writer wrote them, keeping tone, intent and terminology
across the whole document, and prove it with an eval rather than by eye.**

This is the product's core promise (DESIGN §1, §2 "Why an LLM instead of MT?"). M1 translates
chunk by chunk with no idea what the document is. M2 gives the model what a human translator
would have: who wrote this, for whom, why, in what tone, and which terms matter. The eval set
built here is just as important as the strategy. It's the instrument every later prompt, model
and strategy change is measured with.

## 2. Done looks like

- The panel has a collapsible **"About this document"** section showing the brief: genre,
  audience, purpose, tone and key terms.
- A sarcastic opinion piece stays sarcastic. A Rust blog post keeps "future" and "executor"
  consistent from the first chunk to the last, with a gloss only on first use.
- Natural / Faithful / Simplified style modes visibly change the output.
- Code spans, URLs and numbers come through byte-identical.
- A page already in the target language is skipped with a note.
- The harness prints a markdown table comparing `single-pass` vs `contextual` (and
  `translate@1` vs `@2`) on fidelity, naturalness, tone, terminology and cost.

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | `contextual` vs `single-pass` on fidelity, tone, terminology (human score and LLM judge) | ≥ on all three |
| 2 | Cost of `contextual` relative to `single-pass` | ≤ 1.3× |
| 3 | Segment loss after repair on the eval set | 0 |
| 4 | Code/marker/URL preservation on code-bearing segments | 100% |
| 5 | Brief JSON failure (fenced, prose-wrapped or invalid) never fails the job | falls back to "no brief" |
| 6 | Same-language page skipped | yes |
| 7 | Eval set size | 20–30 passages, scored |

## 4. Out of scope

- Cache, viewport priority, error UX (M3). The brief cache *key* is defined here, the cache
  itself is built in M3.
- `review` stage and `refine` strategy (M7).
- Translation memory, site style, domain providers (M7/M8).
- Glossary sync quota handling beyond a basic guard (M6-E6).

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| Where language detection lives | ROADMAP §8 item 7 | A **shell port**, not in `engine/`. Chain: Chrome `LanguageDetector` → `<html lang>` → model-side detection in the brief. The job carries `sourceLang`. |
| Brief JSON parsing | §8 item 16 | Lenient: accept fenced or bare JSON; on failure continue without a brief. Don't rely on `jsonMode`. |
| Brief cache key | §8 item 10 | `url + contentHash + targetLang + analyze prompt version`. |
| Term gloss behavior | ROADMAP §0 | First occurrence only, for glossary terms and terms with no common equivalent; exposed as a setting. |
| Judge model | M2-E8 | A stronger Claude model than the translator; fixed version so scores stay comparable. |
| Token budget split across context providers | M2-E2 | Brief and glossary first (fixed), context tail gets what remains, capped at ~300 tokens. |

## 6. Work plan

Start with the measuring instrument, so every change after it is measured.

**Sub-goal A — a way to measure quality (start in M0, finish first here)**
- M2-E8 Eval set: 20–30 passages (tech blogs, docs, opinion, idiom/humor/sarcasm), 1–5 rubric
  on fidelity, naturalness, tone, terminology; human scoring sheet; LLM-as-judge script; harness
  comparison report. Score the M1 `single-pass` baseline before changing anything.

**Sub-goal B — document-level understanding**
- M2-E1 `analyze` stage + `analyze@1` (title + first ~1,500 tokens + outline), lenient JSON,
  `artifact` event, panel "About this document".
- M2-E5 Language detection port, fallback chain, skip-if-same-language, mixed-language flag
  (per-segment detection behind a flag).

**Sub-goal C — carry that understanding into every chunk**
- M2-E2 `ContextProvider` interface; `DocumentBriefProvider`, `GlossaryProvider` (personal +
  auto), `ContextTailProvider` (last 1–2 source paragraphs + translations, marked
  do-not-translate); token budgeting.
- M2-E3 Byte-stable system prompt assembly + `translate@2` (brief, glossary, style mode, gloss
  rule). A/B against `translate@1` in the harness.
- M2-E6 Personal glossary storage (sync, with quota guard) and list editor in options.

**Sub-goal D — never ship a broken segment**
- M2-E4 `check` stage v1: count, marker balance, backtick spans byte-identical,
  URL/number/code preservation, length-ratio sanity; re-request failing segments once, then
  `segment.failed`.
- M2-E7 Budget v0: per-job token ceiling from settings, checked by stages.

Finish by re-running the full comparison and recording the result as the **M2 baseline** that
M6's regression gate will defend.

## 7. Demo script

1. Run the harness: show the comparison table (`single-pass` vs `contextual`, `@1` vs `@2`)
   with cost ratio.
2. In the browser, open a sarcastic opinion piece; read three paragraphs aloud in the target
   language; open "About this document".
3. Open a Rust blog post; search the panel for the rendering of "future" and confirm it's the
   same everywhere, glossed once.
4. Add a personal glossary entry ("deploy" → keep as is); retranslate; confirm it applies.
5. Switch style to Simplified on the same page; compare.
6. Open a page already in the target language; confirm it's skipped.

## 8. Risks

| Risk | Mitigation |
|---|---|
| `contextual` doesn't beat `single-pass` clearly | Iterate on `translate@N` and the brief prompt using the harness; context tail size is a tuning knob. |
| LLM judge disagrees with human scores | Keep human scores as the source of truth for M2; calibrate the judge on the human-scored subset before using it as a gate. |
| Brief adds latency to the first segment | Run the brief in parallel with the first viewport chunk, or start the first chunk without it if the brief is slow (decide from measurements). |
| Glossary grows past sync quota | Quota guard now; full fix in M6-E6. |

## 9. Handoff to M3

- `contextual` as the default strategy, with a recorded eval baseline.
- Brief and translation cache key definitions (brief key includes `targetLang`).
- `check` stage and `segment.failed` events for M3's inline retry UX.
- Language detection port, reused by selection mode.
