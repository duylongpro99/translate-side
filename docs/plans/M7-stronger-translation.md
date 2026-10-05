# M7 — Stronger translation (v1.1)

Size: L · Depends on: M2 (stages, context providers), M4 (routing roles), M6 (regression gate)

## 1. Goal

**Offer a "Best" mode that measurably beats the default without making reading any slower, and
let the translator learn from the user's own corrections.**

The engine was designed for this from M1: segments have revisions (DESIGN §5.2), so a stronger
strategy can show the fast `contextual` draft first and replace it with a reviewed version
later. The user reads at Balanced speed and gets Best quality a moment later. Learning from
edits is the second lever: the user's corrections become examples that future passages
retrieve, with no change to stages, only a new context provider.

## 2. Done looks like

- A quality mode control: **Fast** (`single-pass`), **Balanced** (`contextual`, default),
  **Best** (`refine`). Advanced settings expose the exact strategy.
- In Best mode, drafts appear as fast as in Balanced. Then blocks are quietly replaced by a
  reviewed revision with a subtle "refined" marker.
- If the job budget runs out, the review pass is skipped and drafts stay.
- Routing settings have a **Review with** row (defaults to the translate model).
- Any translated block can be edited inline. The correction is saved locally and used as an
  example when similar passages appear later.

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | `refine` vs `contextual` on fidelity or naturalness (eval set, human + judge) | clear margin of improvement |
| 2 | Cost of `refine` relative to `contextual` | ≤ 2× |
| 3 | Time to first draft in Best mode vs Balanced | no worse |
| 4 | Budget exhausted mid-review | drafts kept, no failure |
| 5 | Edited passage reused on a similar passage | visible in output; retrieved snippet logged |
| 6 | Regression gate (M6) | green for Balanced; Best has its own baseline |

## 4. Out of scope

- Embedding-based retrieval for translation memory (lexical similarity first; embeddings later).
- `agentic` strategy (M8).
- Sharing or syncing translation memory between devices.

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| What `review` fixes | DESIGN §5.3 | Targeted fixes only: meaning errors, omissions, unnatural phrasing, term consistency. Output the changed segments, not a full re-translation. |
| When a revision replaces a draft | M7-E2 | Only if `check` passes on the revision; otherwise keep the draft. |
| Cache with revisions | DESIGN §7 | Store the highest revision; Best-mode cache key includes `refine@version` and `review@N`. |
| Translation memory storage | M7-E4 | IndexedDB, local only; included in export only if the user opts in. |
| TM retrieval | M7-E5 | Lexical similarity (e.g. token overlap) over source text, top-k within the provider's token budget. |
| Role naming in UI | ROADMAP §8 item 9 | Add the `review` row to the routing UI now. |

## 6. Work plan

**Sub-goal A — a better second pass**
- M7-E1 `review` stage and `review@1` prompt (source + draft → targeted fixes).
- M7-E2 `refine` strategy = `contextual` draft → `review` → `check`; `revision: 2` events;
  "refined" marker; budget-aware skip.
- M7-E6 Harness: `refine` vs `contextual` with cost ratio. Iterate on `review@N` until the margin
  is clear, then record a Best baseline for the gate.

**Sub-goal B — users choose quality, not strategies**
- M7-E3 Quality modes Fast / Balanced / Best; advanced strategy setting; `review` role in
  routing UI.

**Sub-goal C — learn from the user**
- M7-E4 Inline editing of a translated block; (source, corrected target) stored in a local
  translation memory.
- M7-E5 `TranslationMemoryProvider` with lexical similarity retrieval.

## 7. Demo script

1. Show the harness table: `refine` vs `contextual`, scores and cost ratio.
2. Open a dense article in Balanced, then in Best; time the first draft in both.
3. Watch refined markers appear in Best mode; open one block and compare draft vs refined.
4. Set a tiny budget; show review skipped and drafts kept.
5. Edit a block's translation; open another article with a similar sentence; show the
   correction applied.

## 8. Risks

| Risk | Mitigation |
|---|---|
| `review` over-edits and makes text worse | Targeted-fix prompt; `check` must pass; eval gate on Best baseline. |
| Refined text replacing what the user is reading is distracting | Replace off-screen first; subtle marker; setting to keep drafts until scroll. |
| Translation memory retrieves irrelevant examples | Similarity threshold; cap examples per chunk; measure on eval set. |

## 9. Handoff to M8

- The `review` stage and revision UI, reused by `agentic`.
- Context provider pattern proven a second time (TM), for `SiteStyleProvider` and
  `DomainProvider`.
