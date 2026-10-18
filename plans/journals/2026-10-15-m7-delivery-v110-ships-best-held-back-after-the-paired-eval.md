---
title: "M7 delivery: v1.1.0 ships, Best held back after the paired eval"
date: 2026-10-15
summary: "v1.1.0 shipped with quality modes, inline edits and translation memory; Best failed its margin and is held back behind a build switch"
---

# M7 delivery: v1.1.0 ships, Best held back after the paired eval

**Date**: 2026-10-15 15:00 (Asia/Saigon)
**Severity**: Medium
**Component**: M7 stronger translation (review stage, Best mode, translation memory, eval harness)
**Status**: Resolved for the agent part; owner demo, store upload and v1.1.0 tag still open

## What Happened

M7 ran from 2026-10-13 14:00 to 2026-10-15 14:35 via `/ak:cook`: a subagent implemented each phase, a reviewer subagent tore it apart, the controller accepted. All seven phases are accepted and master is fast-forwarded to `m7` and pushed. No tag.

Shipped in v1.1.0:
- Quality modes (Fast, Balanced, Best) with a "Review with" route, behind `featureAvailable()`.
- Inline edit of translated passages, stored in a local memory DB.
- Translation memory: exact reuse of edits, and similar-edit retrieval as few-shot examples (needs 2 shared words). Corrections made on local-only sites never go to cloud models. "Use corrections from other sites" is a separate local setting, default off.
- A release switch: `BEST_MODE_RELEASED` is now the build flag `WXT_BEST_PREVIEW=1`. Release builds have Best off, with the Best radio, keep-drafts and "Review with" hidden.

Package: `translate-side-1.1.0-chrome.zip`, 331,294 B, built from 8b1a40e. `pnpm check` 2104 tests, e2e 42 passed, upgrade e2e from v1.0.0 passed.

## The Brutal Truth

The headline feature did not work. Best (refine plus a same-model review) was the reason for the milestone and the Pro launch condition. It failed, and we spent about $2.40 and two days proving it. The code is mergeable and tested, and it ships dark. The memory and edit features are real value, but they were the side dishes.

The most annoying part is that the 2+2 screen looked like a win. It missed the gain clause by 0.004 on naturalness, and we spent another $1.47 on a 5+5 to find out it was noise.

## Technical Details

The Best experiment (judge ds/deepseek-v4-pro, shipped model qwen3.8-flash):
- review@1, 1+1 screen: naturalness -0.13, fidelity/tone/terminology +0.00/-0.04/-0.04. It made 28 real changes. Nine gloss removals and eight small fixes helped. Five added glosses, four literalisations and two new errors hurt. It fixed none of the 17 faults the judge cites.
- review@2 (rewritten from the judge notes), 2+2: fidelity +0.065, naturalness +0.196 against a 0.200 margin, tone +0.130, terminology +0.261. This was a near-pass.
- review@2, paired 5+5 (gate args, 154/591/0/0 accepted/unchanged/rejected/skipped): deltas +0.043/+0.061/+0.017/+0.009 against margins 0.264/0.200/0.264/0.200. FAIL on the gain clause. Cost x1.39, tokens x1.62.
- The 2+2 contextual baseline had drifted below `gate.json` by -0.23 naturalness, and one passage (wodehouse-jeeves) scored 1 on every dimension in one run. The "near-pass" rode on baseline noise.

Bugs the reviews caught before they shipped:
- Phase 3: lazy review rounds restarted forever when the screen showed only untranslatable (code-only) blocks. The reviewer reproduced it. Fixed in 71d2c4a. The same shape still exists on Balanced lazy pages (`leave()`/`lazyWindow` re-cuts from the top). It does not loop, and it was left alone to keep Balanced prompts byte-identical.
- Phase 5: the local-only flag was lost through export and re-import. A corrected local-only page could come back as cloud-eligible. That is the Critical red-team finding showing up in real code. It took 5 coordinated changes, including `put`. Export now carries `localOnly` (no origin), import may only make it stricter, and the mark is also set from the site rule at edit time.
- Phase 7: the privacy doc said the review call carries corrections. A phase 6 test said it does not. The doc review confirmed the doc was wrong (the call sends source, draft, brief and glossary). The README "about twice the cost" was also unmeasured (live is about 1.3-1.5x).

The eval bundler crash: after the release switch landed, `eval:gate` and `latency` died at load because the eval bundle never defined `WXT_BEST_PREVIEW`. Fixed in 33192b7. It cost no spend, and the zip was unaffected.

The judge outage: the first Balanced gate (10:30-11:20) was red for infrastructure reasons. Translation was fine (0/149 lost, code 25/25), but the judge endpoint never answered. It scored 0/23, hit 60 s timeouts and then the 25-minute pass timeout. Cost about $0.01. The owner chose to probe about every 30 min (at most 8 probes), then rerun. The judge was back on the first probe. The rerun at 14:10 was green and scored 23/23: fidelity 4.26 (floor 3.96), naturalness 3.87 (3.70), tone 4.65 (4.34), terminology 4.57 (4.28). Spend $0.16.

## What We Tried

- review@1 as shipped in phase 1. It was a regression on naturalness.
- review@2, which names five fault kinds, follows the gloss mode and forbids echoes. It gained a little and was nowhere near the margin.
- Screening at 1+1, then 2+2, then paired 5+5. Only the last one was trustworthy.
- review@3 was ruled out by the owner on 2026-10-15.

## Root Cause Analysis

- Best failed because a same-model reviewer shares the drafter's blind spots. It cannot find faults the drafter cannot see, so it mostly shuffles glosses. The agent said at review@2 time that +0.20 was unlikely. We ran the experiment anyway, which was reasonable because the owner was paying for evidence.
- The wasted effort came from trusting small screens. With SE around 0.13 on a 1+1 screen, and baseline drift of 0.23 on a 2+2, those screens cannot tell +0.20 from zero.
- The bundler crash and the lost local-only flag had the same cause: a switch or field added in one layer, with no test crossing the layer boundary (build flag to eval bundle, memory entry to export file).

## Lessons Learned

- 1+1 and 2+2 eval screens are too noisy to gate spend. Treat them as a smoke test only. Go straight to a paired 5+5 when the decision matters.
- A same-model reviewer gains about +0.05. Do not expect more without a stronger "Review with" model, ideally outside the judge's family.
- Any privacy-relevant flag needs a round-trip test through export and import, and through every write path.
- Docs that describe what leaves the device must be checked against a test, not memory.
- Build flags need to be defined in every bundle that imports the gated code, including the eval harness.
- A judge outage is not a quality failure. Probe, wait and rerun. Do not tune the product around it.

## Next Steps

- Owner: the section 7 demo with real keys (Balanced timing, edits, an edit reused on another article).
- Owner: upload to the store (`docs/store/submission.md`), then tag `v1.1.0` on the zip's commit.
- Licensing plan: replace the `featureAvailable` body and the `panel.controls.qualityLocked` placeholder text. The Pro launch condition is NOT met, so Best must not be sold.
- Later Best attempt: try a stronger "Review with" model and re-run the paired 5+5. `eval/gate-best.json` does not exist yet.
- Carry-overs: the Balanced lazy-page re-cut, cache ignoring memory state, stale edits in an open panel after "Clear translation memory", edits hidden when the route fails, and engine branch coverage about 90.3-92% against a 90% floor.
- The M7 plan files and reports under `plans/` are still untracked.

Full record: `docs/progress/progress-m7.md`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
