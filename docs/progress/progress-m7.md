# M7 progress log — Stronger translation (v1.1)

Log for `plans/261013-0348-m7-stronger-translation/` (source plan `docs/plans/M7-stronger-translation.md`).
A fresh session resumes from this file alone.

## Run setup

- Started: 2026-10-13 14:00 (Asia/Saigon), run with `/ak:cook` on the plan (the controller session delegates each
  phase to a subagent implementer, then a reviewer subagent; the controller accepts).
- Base: master @ dc717b2. Phase 2 runs on its own worktree and merges into `m7` once accepted (disjoint files).
- Base note: Branch `m7` in worktree `../translate-side-m7`.
- Owner gates: phase 2 live eval runs (provider keys and spend), phase 7 latency and gate runs, any deviation from the
  plan. Agents never read `.env`.

## Phases

| # | Phase | Status | Commit |
|---|---|---|---|
| 1 | Review stage and refine strategy | **Accepted 2026-10-13 14:30** | df3d52d |
| 2 | Eval: refine vs contextual, Best baseline | **Accepted 2026-10-15** (margin not met; Best held back by owner decision) | ff4c9d7 |
| 3 | Best mode in the panel | **Accepted 2026-10-13 22:35** | 71d2c4a |
| 4 | Quality modes and review routing | **Accepted 2026-10-13 23:00** | b1d504f |
| 5 | Inline edit and memory store | **Accepted 2026-10-14 09:55** | 781ef35 |
| 6 | Translation memory provider | **Accepted 2026-10-14 10:50** | d164a87 |
| 7 | Release candidate and demo | **Agent part accepted 2026-10-15 14:35**; owner part open (demo, upload, tag) | 33192b7 |

## Decisions

- Phase 1 (controller rulings, 2026-10-13): review order is after the screen, then before it, the screen last
  (the phase's data flow and Todo test; step 5's wording differed). `ReviewReport.ids` added so skipped ids are
  reported. Reviews cut by `recut` send no chunk report; phase 3 treats those ids as not reviewed (they stay drafts
  below revision 3). Implementer: Opus (plan marks phase 1 Opus). Engine coverage 98.42/91.78/98.95/99.46.

## Open items
- Phase 1 review (Opus reviewer, 2026-10-13): no blocking findings. Should-fix items sent back to the implementer:
  re-check `reviewWanted` right before the call starts, a test that proves the reservation is released, narrow the
  `‹` rejection to neutralised tag shapes, echoed neutralised tags count as unchanged, a truncated-answer test,
  document that recut drops send no report, skip seeded drafts already at revision 3, drop a type-only assertion.
  The harness's briefed-chunk count for refine runs was sent to phase 2.
- Notes carried to later phases: phase 3 must pass the cached brief whenever it brings drafts (a mostly-seeded job
  can skip analyze); `review@2` should follow the user's gloss mode instead of a fixed "keep glosses" line.
- Phase 2 agent steps (Opus implementer): mock dry run 0/149 lost; mock refine/contextual cost ×1.53, tokens ×1.74.
  New `eval:gate --mode best --baseline 5 --from <runs>` seeds the Best baseline from matching run folders (exact
  config check), so the paired session's refine runs can be reused if they use the gate's arguments
  (`--concurrency 2` today). `latency --strategy refine` works only after phase 3 registers refine in `Jobs`.
- Phase 1 accepted: review fixes in df3d52d, verified by the controller (48 phase tests, engine boundary OK, no
  `segment.failed` emitted in the review stage or refine). `m7-p2` is based on 18fe2ee and merges after review.
- Phase 2 review (Opus reviewer): Balanced gate, ratios and counts correct. Blocking for `--from` seeding: the same
  run can be passed several times, and a subset-of-passages run is accepted. Should-fix: compare prompt hashes (and
  hash the review prompt), unit-test the counting fold and let the mock reject some candidates, record rejected
  candidates by check kind (needed for review@2). All sent back to the implementer.
- Phase 2 agent steps accepted 2026-10-13 14:55 @ ae3fd7e (controller re-ran 53 eval tests; `eval/gate.json` and
  `src/engine` untouched). Best baseline floor = M2 c400 (reviewer: reasonable; the paired margin stays the authority).
  Mock: cost ×1.47, tokens ×1.70, 46/83/20/0 accepted/unchanged/rejected/skipped.
- Owner decision 2026-10-13: run step 6 (screening, contextual + refine review@1, gate args, judged) by an agent.
  `.env` is symlinked into `../translate-side-m7-p2` (gitignored); the agent never opens it.
- Phase 3 implemented (Opus) 2026-10-13 15:40: 77aa6f7, d8cbce2, abed537, b5e6cef. `pnpm check` green (1910 tests),
  e2e 35 passed; Balanced prompts byte-identical (captured before/after); first visible draft Best 677 ms vs Balanced
  652 ms median (1–6% across runs). Deviations: inline `quality` reader in translator.ts (phase 4 moves it to
  quality.ts and adds it to settingsKey/changes()); `chunks/route.js` bundle budget raised to measured + 10%
  (16,063 B gzip) because the panel now carries refine; refined entry wins for identical-text twins; changing
  "Review with" re-drafts the page; no Show-draft shortcut. In review (Opus reviewer).
- Phase 3 review (Opus): nothing blocks; deviations 1–6 accepted. Sent back: lazy Best pages never review cached
  drafts outside the first window (and dropped/cancelled reviews never resume); an await at the top of `start()`
  races once `featureAvailable` reads storage; no automated Balanced byte-identity test; nits (twin tie-break in
  `store()`, unhandled `analyzeAhead`, recut drops in the skipped count, fallback badge on reviewed rows, `skip()`
  record). Later option, not in scope: also write Best drafts under the contextual scope so switching modes or
  "Review with" costs no translate calls.
- Phase 2 step 6 screening (2026-10-13 15:45, qwen3.8-flash, judge ds/deepseek-v4-pro): contextual 4.09/4.04/4.57/4.57,
  refine review@1 4.09/3.91/4.52/4.52 (fidelity/naturalness/tone/terminology). Δ +0.00/−0.13/−0.04/−0.04: the
  gain clause fails, no regression beyond margins. Review 28 accepted / 121 unchanged / 0 rejected / 0 skipped. Cost
  ×1.27, tokens ×1.40. Drift vs gate.json within margins. Spend ≈ $0.30. Runs in `../translate-side-m7-p2/eval-results/screen-{c1,r1}`.
- Step 7 started: review@2 written from the judge notes and the accepted changes (Opus). `m7-p2` merged df3d52d.
- Phase 3 fixes 132aa82, a937722 (Balanced snapshot e2e). Re-review: BLOCKED — lazy rounds restart forever when the
  screen shows only untranslatable blocks (reproduced). Sent back with nits (record during the feature wait, failed
  blocks marked tried, `forDrafts` on Balanced, document no in-session retry of budget/error-skipped reviews).
- review@2 written (ff4c9d7 on m7-p2, Opus): review@1 made 28 real changes (9 gloss removals and 8 small fixes
  helped; 5 added glosses, 4 literalisations and 2 new errors hurt) and fixed none of the 17 faults the judge cites.
  review@2 names five fault kinds, follows the gloss mode, forbids echoes. `REVIEW_PROMPT_ID` stays review@1 until
  a version passes. Agent's view: a same-model reviewer is unlikely to reach +0.20; a 1+1 screen is noise (SE ≈ 0.13).
- Owner decision 2026-10-13 22:20: screen review@2 as 2+2 interleaved on the shipped model (≈ $0.60). Running.
- Phase 3 loop fix 71d2c4a (`pnpm check` 1917 tests, e2e 36 passed, Best first draft +4%); confirmation review running.
- Phase 3 accepted 22:35 @ 71d2c4a after a confirmation review (393 shell tests, no new loop, Balanced unchanged).
  Carry-over (later milestone): on Balanced lazy pages a code-only screen mid-page re-cuts the round from the top
  (`leave()`/`lazyWindow`); it doesn't loop, and was left alone to keep Balanced byte-identical.
- `m7-p2` merged into `m7` (790e914). `pnpm check` then failed only on the `chunks/sites.js` bundle budget (+113 B);
  the phase 4 implementer fixes it first by the measured + 10% rule.
- Phase 4 implemented (Sonnet) 22:40: 970d0fe (sites chunk budget 55418 = measured + 10%), e8e1c61 (quality.ts,
  features.ts per contract, header/Options UI, Review with route, release switch default true, export/import).
  `pnpm check` and e2e green (37 passed), Balanced snapshot unchanged. In review (Opus).
- Phase 4 review (Opus): acceptable, no blocking; deviations accepted (lock note placeholder → licensing phase 3;
  quality docs → phase 7). Sent back before acceptance: quality writes keep unknown fields from newer builds,
  keep-drafts toggles restart only Best, Options' Advanced section not controlled, a local-only Review-with test,
  localized override tooltip, skip empty imported quality.
- Phase 4 accepted 23:00 @ b1d504f (review fixes applied; controller re-ran 480 tests). sites.js budget now 55800.
  One perf.spec flake during the live eval (machine load); passed alone and on the full rerun.
- Phase 2 screening 2 (review@2, 2+2, 2026-10-13 23:15): Δ fidelity +0.065, naturalness +0.196 (margin 0.200),
  tone +0.130, terminology +0.261; gain clause fails by 0.004, no regression. Cost ×1.47, tokens ×1.69. Review
  29/120/0/0 and 37/112/0/0. Drift: contextual below gate.json beyond margin on naturalness (−0.23) and terminology
  (−0.26); wodehouse-jeeves scored 1 on every dimension in c2. Spend ≈ $0.63.
- Owner decision 2026-10-14 09:30: proceed with the paired 5+5 session on review@2 (≈ $1.60), gate arguments so
  its refine runs can seed `eval/gate-best.json`. Running.
- Phase 5 implemented (Opus): eadc14a, 268249d. `pnpm check` 2039 tests, e2e 39 passed, Balanced snapshot unchanged,
  no bundle raise. Controller ruling on the open question: the memory export carries a `localOnly` flag (no origin)
  that import may only make stricter, never looser. In review (Opus).
- Phase 5 review (Opus): BLOCKED on local-only lost through export/re-import (5 coordinated changes incl. `put`).
  Controller rulings: export carries `localOnly` (no origin), import only stricter; local-only mark also from the
  site rule at edit time; imported entries evicted before the user's edits at the cap. Sent back with S1 ("Continue
  anyway" when replacing an edit), S2 (edits kept across a target-language change), S4 (backup larger than the
  import cap), nits (upgrade guard, bidi/zero-width rejection, origin sentinel, editor state). Accepted gap: an edit
  made before its block's review starts does not cancel that review. Possible follow-up: show edits even when the
  route fails.
- Phase 5 accepted 09:55 @ 781ef35 after a confirmation review (local-only mark closed on every write path; 571
  tests). S4: export warns over the 10 MB import cap rather than raising it. Two nits (stale eviction hint, a
  sub-second race in `edit()`) handed to the phase 6 implementer as its first commit. Open: an open panel still
  shows edits after "Clear translation memory" (low impact).
- Phase 6 started (Sonnet): depends on phase 2's harness (merged), not on phase 2's owner steps.
- Phase 6 implemented (Sonnet) 10:20: d52e5ae (phase 5 leftovers) … e3f46bd. `pnpm check` 2096 tests, e2e 42 passed,
  Balanced snapshot unchanged, engine coverage 97.08/90.21/97.96/98.05. route.js budget 17868, total 309287.
  New setting "Use corrections from other sites" (local, default off). Open: the cache key ignores memory state;
  a local default model without a local-only rule withholds local-only corrections. In review (Opus).
- Phase 6 review (Opus): acceptable, no leak on any path. Controller rulings: "Use corrections from other sites"
  applies on every route incl. local-only runs (stricter, keeps the hint true); cache key ignoring memory state
  accepted and documented; local default without a local-only rule accepted (safe side). Sent back: false matches on
  short/link-only segments, per-origin copies of the examples, a load-robust timing test with snapshot warm-up,
  review/fallback tests, nits.
- Phase 6 accepted 10:50 @ d164a87 (controller re-ran 137 memory/retrieval tests and the engine boundary). Examples
  need 2 shared words; snapshot warmed at panel open (+22 ms first request with 5,000 entries). Engine branch
  coverage 90.26 (thin margin, watch in phase 7).
- Phase 7 agent part (Sonnet) 11:05: 863d2ca (upgrade e2e: memory DB empty, quality absent → Balanced), 08d9065
  (docs), 2d9f45d (1.1.0). `pnpm check` 2102 tests, e2e 42 passed, `pnpm run e2e:upgrade dc717b2` passed (note: no
  `--`; pnpm passes it through). Suspect doc claim: privacy text says the review call carries corrections, while a
  phase 6 test says it doesn't — doc review running. Open for the owner: bump the first-run notice version (2 → 3)?
- Phase 7 doc review (Sonnet): privacy text wrong about the review call (it sends source, draft, brief and
  glossary, no corrections); README cost "about twice" unmeasured (live ≈ 1.3–1.5×); Fast sends no examples; cached
  refined text has no draft. Sent back with the upgrade-spec wait fix and dropping the review's discarded memory
  retrieval. Notice version unchanged pending the owner.
- Phase 7 doc fixes 3b6c1ec (controller re-ran review/refine/retrieval tests: 93 passed). Phase 7 waits on: the
  paired-session result → `BEST_MODE_RELEASED`, Best-specific doc paragraphs, the zip; owner live gates, latency,
  §7 demo; the notice-version decision.
- Phase 2 step 8, paired 5+5 session (review@2, 2026-10-14 09:35–12:40, gate args): contextual means
  4.165/3.861/4.609/4.461, refine 4.209/3.922/4.626/4.470 (fidelity/naturalness/tone/terminology). Δ +0.043/+0.061/
  +0.017/+0.009 against margins 0.264/0.200/0.264/0.200: **FAIL** (no gain clause), no regression, no drift
  beyond margins. Cost ×1.39, tokens ×1.62. Review 154/591/0/0. Spend $1.47. The 2+2 near-pass was noise.
  Refine run folders pass the `--from` check apart from the (expected) review prompt id.
- **Owner decisions 2026-10-15:** (1) Best is held back from store releases (`BEST_MODE_RELEASED = false`), no
  review@3; Best's code stays for a later attempt (e.g. a stronger review model). Pro launch condition: NOT met.
  `REVIEW_PROMPT_ID` stays review@1; `eval/gate-best.json` is not written; the Best gate is skipped in phase 7.
  (2) The first-run privacy notice is shown again after 1.1.0 (version bump, a sentence about corrections).
- Phase 7: switch, doc removal, notice, zip in progress.
- Phase 7 8b1a40e, 20e8f78: `BEST_MODE_RELEASED` = build switch `WXT_BEST_PREVIEW=1` (e2e builds the preview into
  `.output-preview`; release builds have Best off); Best radio, keep-drafts and "Review with" hidden when off; notice
  version 3 with a corrections sentence; upgrade e2e expects the notice again and 0 calls before it. `pnpm check`
  2104 tests, e2e 42 passed, upgrade e2e passed. Zip `translate-side-1.1.0-chrome.zip`, 331,294 B, SHA-256
  21339ef0333282dd5384d7c71b8bf969ce2d1b62b0d4616242b2439a111dfa95, from 8b1a40e; controller checked: no home paths
  in the zip.
- Owner decisions 2026-10-15 10:25: an agent runs the Balanced gate and Balanced latency (< $0.60); once green, commit
  this log on m7, fast-forward master to m7 and push. No tag (v1.1.0 is the owner's, after the store upload).
- 33192b7 fix: the eval bundle defines `WXT_BEST_PREVIEW` (the gate and latency scripts crashed at load after the
  release switch; no spend). Zip unaffected (extension build unchanged).
- Balanced gate 2026-10-15 10:30–11:20: **red, infrastructure** — translation fine on both passes (0/149 lost, code
  25/25), but the judge endpoint never answered (0/23 scored, 60 s timeouts, pass timeout 25 min). Not a quality
  result; must be re-run. Spend ≈ $0.01.
- Latency (Balanced, 3,003-word page, 2 runs): top first text 8.8/3.7 s, screen done 16.7/10.9 s; middle 1.8/3.5 s,
  9.9/12.1 s; whole page 95–129 s. No M6 number recorded to compare. JSON `eval-results/latency-2026-10-15T04-21-35-302Z.json`.
- Owner decision 2026-10-15 11:25: retry the gate later — an agent probes the judge about every 30 min (≤ 8 probes),
  then reruns the Balanced gate; merge and push only after a green gate.
- Balanced gate rerun 2026-10-15 14:10 (judge back on the first probe): **green**, exit 0, one pass, 23/23 judged:
  fidelity 4.26 (floor 3.96), naturalness 3.87 (3.70), tone 4.65 (4.34), terminology 4.57 (4.28); 0/149 lost.
  Spend $0.16 (+ $0.006 probe). Run folder `eval-results/gate-2026-10-15T07-12-08-425Z-pass1` (not committed).

## FINAL STATE (2026-10-15)

All seven phases accepted for the agent's part. master is fast-forwarded to m7 and pushed with this log. No tag.

| Criterion | Evidence | Result |
|---|---|---|
| #1 refine beats contextual by the margin | Paired 5+5 session, review@2: Δ +0.043 / +0.061 / +0.017 / +0.009 vs 0.264 / 0.200 / 0.264 / 0.200 | **Not met** |
| #2 refine ≤ 2× contextual | Paired session: cost ×1.39, tokens ×1.62 | Met |
| #3 Best first draft no worse than Balanced | e2e medians: Best within 1–6% of Balanced (mock); live Balanced latency recorded above; live Best latency moot (held back) | Met on mock |
| #4 budget exhausted mid-review keeps drafts | Engine tests (refine/review), panel tiny-budget unit test and e2e flow | Met |
| #5 edited passage reused on a similar passage, local-only never to cloud | e2e flows in `e2e/flows.spec.ts` (reuse, local-only, across-sites), `jobs.retrieval.test.ts` | Met |
| #6 Balanced gate green; Best baseline | Balanced gate green (above); `eval/gate-best.json` not written because Best is held back | Balanced met; Best n/a |
| Pro launch condition | Not met → `BEST_MODE_RELEASED` off in release builds (`WXT_BEST_PREVIEW=1` only for previews/e2e) | Best held back |

Package: `translate-side-1.1.0-chrome.zip`, 331,294 B, SHA-256
21339ef0333282dd5384d7c71b8bf969ce2d1b62b0d4616242b2439a111dfa95, built from 8b1a40e (33192b7 changes only the eval
bundler). Checks at release: `pnpm check` 2104 tests, e2e 42 passed, upgrade e2e from v1.0.0 passed.

**Open for the owner:**
- The §7 demo with real keys (Balanced timing, edits, an edit reused on another article; Best parts are moot).
- The store upload (`docs/store/submission.md`) and the `v1.1.0` annotated tag on the zip's commit after the upload.
- Licensing plan: replace the `featureAvailable` body and the lock-note placeholder text (`panel.controls.qualityLocked`).

**Carry-overs:**
- Best: a later attempt needs a gain the same-model reviewer did not show (review@1 −0.13, review@2 +0.06
  naturalness); a stronger "Review with" model is the likeliest route (not the judge's family). review@3 unused.
- Balanced lazy pages: a code-only screen mid-page re-cuts the round from the top (`leave()`/`lazyWindow`).
- The translation cache ignores memory state (documented; Retranslate picks up a new correction).
- An open panel still shows edits after "Clear translation memory" until the next navigation.
- Edits are not shown when the page's route fails (no key, host permission).
- Engine branch coverage margin is thin (about 90.3–92 % against 90 %).
- The M7 plan files and reports under `plans/` are still untracked in the main checkout.
