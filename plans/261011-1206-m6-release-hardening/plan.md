---
title: "M6 — Release hardening → v1.0"
description: "Make v1.0 ready for the Chrome Web Store, with a local eval gate, e2e on 20 fixture pages, versioned storage, local diagnostics, en/vi UI and a complete store package."
status: pending
priority: P1
effort: 10d
branch: m6
tags: [infra, frontend, docs, critical]
blockedBy: []
blocks: []
created: 2026-10-11
---

# M6 — Release hardening → v1.0

## Overview

The source plan is `docs/plans/M6-release-hardening.md`: goal, §3 success criteria, §5 decisions and §8 risks. This
directory is its execution plan. The brainstorm contract
(`plans/reports/brainstorm-261011-1855-m6-release-hardening.md`) adds four user decisions:

1. the eval gate runs in CI using a GitHub Actions secret. Validation Session 2 superseded this: the gate is local
   only, and CI holds no secret;
2. the Haiku 4.5 cost is measured through OpenRouter;
3. M6 prepares the store package and the user publishes it and runs the beta;
4. the UI ships in English and Vietnamese.

Evidence comes from three reports in `plans/reports/`: `scout-261011-1901-m6-eval-ci-e2e.md`,
`scout-261011-1901-m6-storage-perf-i18n.md` and `researcher-261011-1901-m6-extension-e2e-store-i18n.md`.

The work starts from master @ ae9f9fb, with all of M5 merged. Delivery follows the M5 convention: a supervisor using
`docs/prompts/implement-plan.md`, a log in `docs/progress/progress-m6.md`, and a branch `m6` in a worktree.

## Phases

| # | Phase | Plan tasks | Depends on | Effort | Model | Status |
|---|---|---|---|---|---|---|
| 1 | [Eval regression gate and Haiku cost](./phase-01-eval-regression-gate.md) | M6-E3, §3 #4 | — | 1.5d | Opus (design + live runs) | Pending |
| 2 | [E2E harness and coverage](./phase-02-e2e-harness-and-coverage.md) | M6-E2 | — | 2d | Opus (new harness) | Pending |
| 3 | [Storage versioning and sync quota](./phase-03-storage-versioning-and-sync-quota.md) | M6-E6 | 2 | 1.5d | Opus (data safety) | Pending |
| 4 | [Performance, bundle, diagnostics](./phase-04-performance-bundle-diagnostics.md) | M6-E4, M6-E5 | 2, 3 | 1.5d | Opus (privacy + concurrency) | Pending |
| 5 | [UI localization (en, vi)](./phase-05-ui-localization.md) | M6-E7 | 3, 4 | 1.5d | Sonnet | Pending |
| 6 | [Store package and docs](./phase-06-store-package-and-docs.md) | M6-E1, M6-E8 | guides: —; privacy/listing: 3, 4 + http decision; assets/zip: 5 | 1.5d | Sonnet | Pending |
| 7 | [Release candidate and beta handoff](./phase-07-release-candidate-and-beta.md) | M6-E9 | 1–6 | 0.5d + user | Sonnet | Pending |

**Order.** Phases run 1 → 2 → 3 → 4 → 5 → 6 → 7.

Phases 1 and 2 may run in parallel, because their file ownership is disjoint:
- Phase 1 owns `scripts/eval/**` and `eval/**`.
- Phase 2 owns `e2e/**`, `.github/workflows/ci.yml`, `vitest.config.ts` and `fixtures/**`. Later phases append to
  `ci.yml` only after phase 2 is accepted.

Phase 6 may start its local-model guide and README work alongside phases 1–4, because plan §6 allows E1 and E8 to
run in parallel. Its privacy and listing text waits for phases 3 and 4 and the `http://*/*` decision. Its
screenshots and zip wait for phase 5.

## Success criteria (plan §3, with the contract's readings)

- [ ] #1 v1.0 is published. Agent part: the package is submission-ready (phase 6). User part: unlisted, then listed (phase 7).
- [ ] #2 E2E on 20 fixture pages with the mock provider: 20/20 pass with no console errors (phase 2).
- [ ] #3 Eval scores of the shipped default (model, quirks, strategy) at chunk 400 stay within the margin of the M2 c400 baseline. A local `pnpm run eval:gate` run with real calls is green and recorded; CI has no eval job (phase 1, Validation Session 2).
- [ ] #4 The cost per long article on Haiku 4.5 is measured through OpenRouter and documented against ≈ $0.04 (phase 1).
- [ ] #5 Memory and responsiveness on a 100-screen page stay within the set budget (phase 4).
- [ ] #6 The bundle stays within budget, which is set in phase 4 because S7 recorded no number (phase 4).
- [ ] #7 Settings and cache migrate from every earlier schema version, and this is tested (phase 3).
- [ ] #8 Sync storage over quota with a synthetic large glossary: no failure; it falls back as designed (phase 3).
- [ ] #9 Closed beta: the fix list exists; the user runs the beta; items are closed or scheduled (phase 7).
- [ ] The English and Vietnamese UI both load with matching keys (phase 5).
- [ ] Each open human item from M5 is either covered by e2e or on the beta checklist (phases 2 and 7).

## Constraints

- The repo is public. Never commit keys, `.env` contents, absolute home paths or the username. CI holds no secrets;
  the eval gate runs locally from `.env`.
- No telemetry. Diagnostics stay in `storage.local`, and the user exports them.
- The production manifest must not change, apart from:
  - `default_locale`, the `__MSG_*__` strings and the version;
  - whatever the `http://*/*` decision requires (Validation Log).

  `check:manifest` keeps asserting it. Tests change only a copied manifest, never production source.
- Commits are conventional and contain no plan IDs or finding codes in code comments (`.claude/rules`).

## Non-goals

- New features, telemetry, and translating the UI into languages other than en and vi.
- The agent uploading to the store or recruiting beta users.
- Closing the M2 accepted gap (contextual ≥ single-pass), which belongs to M7.

## Key risks

- The judge margin rests on a single re-judge pair, and translation-run variance has never been measured. Phase 1
  measures both before setting the margin.
- Store policy expects user data over HTTPS, while the manifest offers `http://*/*` for LAN gateways. This needs a
  decision before phase 6 finalises the justifications.
- Playwright cannot open the docked side panel or accept a permission prompt. The harness drives `sidepanel.html` as
  a background tab in the fixture's window, from a copied manifest with test `host_permissions`. The real panel and
  the real prompt go on the beta checklist.
- Sync storage is shared by every device a user has, including devices still on M5. Phase 3 keeps the legacy sync
  items and confines overflow to one device, so no device loses data.

## Red Team Review

### Session — 2026-10-11

**Findings:** 15 after merging about 40 raw findings from 4 reviewers. All 15 are accepted, 2 of them only partly;
4 sub-points are rejected.
**Severity breakdown:** 3 Critical, 10 High, 2 Medium.
**Report:** `plans/reports/red-team-261011-1915-m6-plan.md`

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | The sync chunks and pointer lose data across devices and versions, and they break the listeners | Critical | Accept (redesigned: legacy item plus overflow to this device's local storage) | Phase 3 |
| 2 | Migration races across contexts, and a fresh device can wipe sync | Critical | Accept | Phase 3 |
| 3 | The gate never runs analyze, brief or revise, and tests the harness configuration instead of the shipped default | Critical | Accept | Phase 1 |
| 4 | Gate statistics (n=3) and the 20-minute timeout | High | Accept | Phase 1 |
| 5 | A skipped gate looks green; the secret reaches install scripts; the trigger is too broad | High | Accept, partly (a protected environment is rejected) | Phase 1 |
| 6 | The `?tabId=` hook and e2e build mode are unnecessary and fight the D14 active-tab gating | High | Accept | Phase 2 |
| 7 | The shared mock crosses phase ownership | Medium | Accept | Phase 2 |
| 8 | Async extraction misses `content.ts`, introduces races, and its cause is unproven | High | Accept | Phase 4 |
| 9 | Building old commits is costly, the upgrade e2e changes the extension id, and M3 can't reach the mock | High | Accept | Phase 3 |
| 10 | Storage fixtures could commit real keys | High | Accept | Phase 3 |
| 11 | Diagnostics redaction, a history leak, write races and abandoned jobs | High | Accept | Phases 4, 7 |
| 12 | The privacy claim contradicts auto-translate, and the notice is not re-shown | High | Accept | Phases 4, 6 |
| 13 | The `http://*/*` decision against the HTTPS rule has no owner | High | Accept → user decision | plan.md, Phase 6 |
| 14 | i18n breaks the tests, misses the `llm/errors.ts` messages, and two phases own onboarding | High | Accept | Phases 5, 6 |
| 15 | Lazy page expectation, the m6 CI trigger, coverage in `pnpm check`, unrequested extras | Medium | Accept, partly (merging phase 7 and dropping the spend cap are rejected) | All |

### Whole-Plan Consistency Sweep

- **Decision delta:**
  - no sync chunks or pointer;
  - no e2e build mode or `?tabId=` hook;
  - the gate runs at chunk 400 with the shipped constants against the M2 c400 baseline;
  - diagnostics are app-owned fields, one key per entry;
  - the dropped extras are axe, the JSX scan test, the Vietnamese listing, the S7 doc, the options boundary and the
    rubric hash.
- **Stale terms:** a grep for `build:e2e`, `tabId`, `axe`, `Vietnamese variant`, `S7-bundle`, `chunked`, `pointer`
  and `rubric` across the plan files finds only the explanatory "Updated" markers and phase 3's explanation of why
  §5's pointer is not used.
- **Reconciled:**
  - phase 6 now depends on phases 3, 4 and 5;
  - phase 4 now depends on phases 2 and 3, because both phases touch `translator.ts`;
  - the onboarding file is owned by phase 5;
  - `ci.yml` is owned by phase 2;
  - success criterion #3 has been reworded.
- **Unresolved:** the `http://*/*` decision. It is asked in validation.

## Validation Log

### Session 1 — 2026-10-11

**Verification:** skipped. The Red Team Review above already checked the plan's claims against the code (about 100
`file:line` checks across 4 roles), and every failed claim was corrected in the red-team edits.

| # | Question | Answer | Propagated to |
|---|---|---|---|
| 1 | `http://*/*` against the store's HTTPS rule | Keep the manifest. The code allows plain-HTTP provider endpoints only on loopback and private networks, with a warning, and refuses public HTTP. | Phase 6 (decision gate, step 1a, files) |
| 2 | Bundle budget, since S7 recorded none | The measured gzip per entry and chunk plus 10%, enforced in CI | Phase 4 step 4 (already so) |
| 3 | The panel's O(n) `patch()` if it is the long task | Fix it in M6 | Phase 4 step 3, risks, files |
| 4 | Execution | Supervisor loop as in M5: `docs/prompts/implement-plan.md`, log `docs/progress/progress-m6.md`, branch `m6` in a worktree | Handoff |

### Whole-Plan Consistency Sweep

- **The HTTP decision:** the plan.md Constraints already allow manifest changes the decision requires, and this one
  needs none.
- **Phase 6 ordering:** step 1a has no dependency on phases 3–5. It may run early, but it touches `Providers.tsx`,
  which phase 3 also edits for its listeners. Run it after phase 3 is accepted.
- **Phase 4:** its files now include `jobs.ts` for the `patch()` fix. Phase 4 runs after phase 3, so the two don't
  overlap.
- No unresolved contradictions remain.

### Session 2 — 2026-10-11

| # | Question | Answer | Propagated to |
|---|---|---|---|
| 1 | Should CI hold `AIBOX_API_KEY` for the eval gate? | No. Keep CI simple and take the judge out of CI. The gate runs locally (`pnpm run eval:gate`) before merging engine, LLM or default changes, in each affected phase's test round, and at the release candidate. | plan.md (overview, ownership, #3, constraints), Phase 1 (goal, done-criteria reading, steps 6, 7 and 9, files, verification, risks), Phase 2 demo note, Phase 7 step 1 |

This reverses brainstorm decision 1 and red-team finding 5, which was about the CI secret and the trigger and is now
moot. Finding 3 (the shipped configuration at chunk 400) and finding 4 (5 runs, a timeout inside the script) still
apply to the local gate. The plan's §3 #3 wording "gate green in CI" is read as a recorded local run.

**Sweep:** a grep for `eval-gate.yml`, `Actions secret`, `AIBOX_API_KEY` and `CI run of the gate` across the plan
files finds only this log and the Updated markers.


### Session 3 — 2026-10-12

| # | Question | Answer | Propagated to |
|---|---|---|---|
| 1 | What should the margin floor be? A shipped-default gate pass went red on terminology alone, 4.30 against a 0.137 margin, with no change to the code. | Raise `MIN_MARGIN` to 0.20, and recompute `eval/gate.json` from the existing 5 baseline runs with no new calls. Naturalness and terminology margins become 0.20; fidelity and tone stay at 0.26. | Phase 1 step 3, `scripts/eval/gate.ts`, `eval/gate.json`, `eval/README.md` |

The reviewer judged the two terminology scores of 4.30 to be judge noise, not drift: a different set of passages lost
a point each time, and the pooled SD over 8 passes is 0.10, which fits a 0.20 margin.
