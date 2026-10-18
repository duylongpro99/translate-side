---
title: "M7 — Stronger translation (v1.1)"
description: "Best mode (refine: contextual draft, then a checked review revision), Fast/Balanced/Best quality modes, a Review with route, inline edits and a local translation memory retrieved by lexical similarity."
status: in-progress
priority: P2
effort: 10.5d
branch: m7
tags: [engine, frontend, eval, storage, pro]
blockedBy: []
blocks: [261013-0345-m8-beyond-v1]
created: 2026-10-13
---

# M7 — Stronger translation (v1.1)

## Overview

The source plan is `docs/plans/M7-stronger-translation.md` (goal, §3 criteria, §5 decisions, §6 tasks M7-E1..E6).
Design inputs: `plans/reports/scout-261013-1036-m7-engine-surfaces.md` (12 risks, each decided in the phase that owns it)
and `plans/reports/brainstorm-261013-1036-free-pro-pricing.md` (Best mode and translation memory are Pro features).

Delivery follows the M6 convention: start from master @ dc717b2, branch `m7` in a worktree, a supervisor using
`docs/prompts/implement-plan.md`, and a log in `docs/progress/progress-m7.md`.

## Phases

| # | Phase | Plan tasks | Depends on | Effort | Model | Status |
|---|---|---|---|---|---|---|
| 1 | [Review stage and refine strategy](./phase-01-review-stage-and-refine-strategy.md) | M7-E1, M7-E2 (engine) | — | 2d | Opus (engine design) | Pending |
| 2 | [Eval: refine vs contextual, Best baseline](./phase-02-eval-refine-vs-contextual-and-best-baseline.md) | M7-E6 | 1 | 1.5d + owner | Opus (prompt iteration, live runs) | Pending |
| 3 | [Best mode in the panel](./phase-03-best-mode-in-the-panel.md) | M7-E2 (shell) | 1 | 2d | Opus (cache, concurrency) | Pending |
| 4 | [Quality modes and review routing](./phase-04-quality-modes-and-review-routing.md) | M7-E3 | 3 | 1d | Sonnet | Pending |
| 5 | [Inline edit and memory store](./phase-05-inline-edit-and-memory-store.md) | M7-E4 | 4 | 2d | Opus (user data) | Pending |
| 6 | [Translation memory provider](./phase-06-translation-memory-provider.md) | M7-E5 | 1, 2, 5 | 1.5d | Sonnet | Pending |
| 7 | [Release candidate and demo](./phase-07-release-candidate-and-demo.md) | §3, §7 | 1–6 | 0.5d + owner | Sonnet | Pending |

**Order.** 1 → (2 ∥ 3) → 4 → 5 → 6 → 7. Phases 2 and 3 run in parallel because their files are disjoint: phase 2
owns `scripts/eval/**`, `eval/**` and, once phase 1 is accepted, `src/engine/prompts/review.ts`; phase 3 owns
`src/entrypoints/sidepanel/**`, `src/shared/cache.ts` and `e2e/**`. Phases 3 → 4 → 5 are sequential because each
edits `jobs.ts` and `translator.ts`. Phase 6 follows phase 5 for the same reason, and phase 2 because it adds
`--memory` to `scripts/eval/run.ts`.

## Success criteria (plan §3)

<!-- Updated: Validation Session 1 - paired same-session margin; Best held back if missed -->
- [ ] #1 In one paired session (5 `contextual` + 5 `refine`, interleaved, same judge), refine beats contextual on fidelity or naturalness by at least that dimension's gate margin (≥ 0.2), with no dimension worse by more than its margin; the blind sheet prefers refine on a strict majority of non-tied passages (phase 2).
- [ ] #2 `refine` costs ≤ 2× `contextual` on the eval set (cost and token ratios) (phase 2).
- [ ] #3 Time to first draft in Best is no worse than Balanced, including later lazy rounds (`pnpm run latency` with both strategies, e2e and lazy tests) (phases 3, 7).
- [ ] #4 Budget exhausted mid-review: drafts kept, no `segment.failed`, concurrent reviews reserve their cost (phases 1, 3).
- [ ] #5 An edited passage is reused on a similar passage: visible in the output, the retrieved entry is logged, and local-only corrections never reach a cloud route (phase 6).
- [ ] #6 `pnpm run eval:gate` is green for Balanced; Best has its own baseline in `eval/gate-best.json` (phases 2, 7).
- [ ] Pro launch condition (brainstorm): Best beats Balanced by the #1 margin. If it does not after `review@3`, Best is **held back from store releases** (neither shipped free nor sold) via `BEST_MODE_RELEASED` until a later prompt passes (phases 2, 4, 7).

## Cross-Plan Dependencies

| Plan | Relation | Contract |
|---|---|---|
| `plans/261013-0348-pro-subscription-licensing` | Consumes M7's gates | M7 creates `src/shared/features.ts`: `type FeatureId = 'best-mode' \| 'translation-memory'` and `featureAvailable(id): Promise<boolean>`, returning `true` until licensing replaces the body; it must answer from cached state (no network on the job-start path). Access is resolved **once per job start** in `Jobs.start` and stored on the job; sync code (`defaultEngine`, cache scope, strategy reads at `jobs.ts:916/1419/1489/1604`) reads the stored value and never calls the Promise. `best-mode` gates `refine` from every source (header mode, advanced override, imported settings); a job asked for `refine` without it runs `contextual`. A locked Best is shown in the header select **disabled with a "(Pro)" suffix**, with the lock note only next to that control; M7 renders both, licensing owns the note's wording and link. `translation-memory` gates only similar-entry retrieval; edits and exact reuse stay free. Whichever plan lands first creates the file with this signature. |
| `plans/261013-0345-m8-beyond-v1` | Blocked by M7 | It reuses the review stage, the revision marker and the context-provider pattern (source plan §9). |

## Constraints

- The engine boundary holds (`scripts/check-engine-boundary.mjs`): the engine imports only `src/engine/` and
  `src/llm/types.ts`. Translation-memory data reaches it through `JobOptions`, never through `src/shared/`.
- Engine coverage stays at 95/90/95/95 (`vitest.config.ts`) with the new stage, strategy and provider included.
- Live eval and latency runs need the owner's provider keys and spend. Agents never read `.env`; each live step is
  marked **owner** and runs only when the owner starts it or gives the go-ahead.
- No telemetry. The memory store is local only; diagnostics hold counts and hashed ids, never text.
- Local-only site rules hold for memory examples too: an entry made under one never reaches a non-local route.
- Conventional commits, no plan ids or finding codes in code, comments or test names (`.claude/rules`).

## Non-goals

Licensing and its entitlement check, the lock note's wording, embeddings, the `agentic` strategy, and syncing memory
between devices.

## Key risks

- Review over-edits. The candidate is accepted only when it passes every post-check; the Best gate catches regressions.
- Lazy pages: reviews could delay the next round. Once drafts are done, low water drops pending reviews, so only
  in-flight calls are waited for (phase 3).
- Refine may miss the margin. Phase 2 is time-boxed to 3 prompt versions; Best is then held back (Validation Session 1).
- Memory examples cross sites. Filtered by origin and local-only provenance before sending (phase 6).

## Red Team Review

### Session — 2026-10-13

**Findings:** 10 (1 Critical, 5 High, 4 Medium). All accepted by the user.
**Report:** `plans/261013-0348-m7-stronger-translation/reports/red-team-261013-1043-m7.md`

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | Corrections made on local-only sites leak to cloud providers through retrieval | Critical | Accept | Phases 5, 6, 7; plan.md constraints |
| 2 | Refined revisions cached under the review model's scope miss on reload | High | Accept | Phases 1, 3 |
| 3 | Segments the review leaves unchanged or rejects are reviewed again on every reload | High | Accept | Phases 1, 3 |
| 4 | Switching quality mode does not re-translate the page | High | Accept | Phase 4 |
| 5 | Selection snippets would run `refine` and analyze | High | Accept | Phase 3 |
| 6 | On lazy pages, reviews hold up the next round | High | Accept | Phases 1, 3 |
| 7 | An imported memory file is untrusted input that overrides translations and injects prompt text | Medium | Accept | Phase 5 |
| 8 | The review budget check ignores the reasoning reserve and concurrent calls | Medium | Accept | Phases 1, 3 |
| 9 | The margin compares refine with a frozen M6 baseline | Medium | Accept (paired same-session design) | Phase 2; plan.md #1 |
| 10 | Loading up to 5,000 memory entries on every run start delays the first draft | Medium | Accept | Phase 6 |

### Whole-Plan Consistency Sweep

- **Searched for superseded terms** across plan.md and phases 1–7: "ship Best anyway", "owner decides the sale",
  "to be confirmed by the owner", `doc.strategy ??` precedence, `strategyOf`, `keyFor(job, id, state.model)` for
  review finals, "5 refine runs" against `eval/gate.json`, "preferred or tied", `store.list(doc.targetLang, 5000)`
  per run, "one call site in `translator.ts`", entries without `origin`/`localOnly`, and "examples go only to the
  provider that already receives this page". Each remaining hit is either the corrected text or an explanation of
  why the old reading is wrong.
- **Reconciled:** the gate reads moved from `translator.ts` to `Jobs.start` (phases 3, 4, 6 and the contract row);
  the header renders the locked option, so Non-goals now exclude only licensing and the note's wording; phase 4
  touches `jobs.ts` only for `BEST_MODE_RELEASED`; phase 7 sets that switch and skips the Best gate when held back;
  success criteria #1, #3, #4 and #5 now name the paired design, lazy rounds, the reservation and the local-only
  rule.
- **File ownership:** unchanged. Phases 3 → 4 → 5 → 6 stay sequential because each touches `jobs.ts` and
  `translator.ts`; phases 2 and 3 remain disjoint.
- **Unresolved:** `parseImport`'s handling of unknown fields (phase 4), whether `SegParser` accepts a subset of ids
  (phase 1), and whether `eval:gate --baseline` can reuse existing run folders (phase 2) are still `[UNVERIFIED]`;
  each has a stated fallback.

## Validation Log

### Session 1 — 2026-10-13

| # | Question | Answer | Propagated to |
|---|---|---|---|
| 1 | Refine misses the margin after `review@3` | Best is held back from store releases (not shipped free, not sold) until it passes | plan.md criteria and risks; phase 2 time box; phase 4 `BEST_MODE_RELEASED`; phase 7 step 5 |
| 2 | Translation-memory split | Inline editing and exact-source reuse of your own edits are free; retrieval of similar edits into prompts is Pro (`translation-memory`) | Phase 5 decisions; phase 6 requirement 6; contract row |
| 3 | Budget scope | Stays per run (each lazy round); acceptable | Phase 1 Risk 4; phase 3 Risk 4 |
| 4 | Margin design | Finding 9's paired same-session design: 5 contextual + 5 refine, interleaved, same judge; the blind sheet needs a strict majority of non-tied passages | Phase 2 decisions, steps 6 and 8, success criteria; plan.md #1 |
| 5 | Gate contract amendments (agreed across the three plans) | Access resolved once at job start and stored; `best-mode` gates every source of `refine`; locked Best disabled with "(Pro)" and the note only beside the header select | Phases 3, 4, 6; contract row |
