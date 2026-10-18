---
title: "Phase 7: Release candidate and demo"
status: todo
priority: P2
effort: "0.5d + owner"
dependencies: [1, 2, 3, 4, 5, 6]
---

# Phase 7: Release candidate and demo

## Goal

v1.1 is ready to tag. Every §3 criterion has recorded evidence, the docs describe Best mode, edits and the
translation memory, and the §7 demo has been run. Tagging and publishing stay with the owner.

## Context links

- Source: `docs/plans/M7-stronger-translation.md` §3, §7, §9.
- M6 precedent: `plans/261011-1206-m6-release-hardening/phase-07-release-candidate-and-beta.md`.
- Docs rule: `.claude/rules/documentation-management.md` (update the smallest owning surface).

## Requirements

1. Static and mock gates green: `pnpm check`, `pnpm run e2e`, `pnpm run e2e:upgrade`.
2. **Owner:** live gates and measurements: the Balanced gate, the Best gate, and latency for both strategies.
3. Docs updated where behaviour changed: `DESIGN.md`, `README.md`, `docs/privacy.md`, `eval/README.md`.
4. The version is 1.1.0, in `package.json` (the manifest takes it from there, as `check:manifest` asserts).
5. `docs/progress/progress-m7.md` FINAL STATE lists each criterion with its evidence and anything left open.

## Architecture and data flow

There is no new code. Evidence flows from the gate and latency runs (owner) and the e2e reports into the phase
report and the progress log.

## Related files

- **Modify:**
  - `DESIGN.md`: §5.2 (the review revision is 3; contextual's chunk-0 revise holds 2), §5.3 (the `refine` row and
    the modes), §5.4 (the translation memory provider), §7 (the memory database and the edit override);
  - `README.md` (the feature table: Best mode, edits, translation memory; which ones are Pro is stated by the
    licensing plan, not here);
  - `docs/privacy.md` (edits and memory stay on the device; the memory export is a separate, explicit file;
    examples from other pages go to the page's provider only under the phase 6 rules: never local-only corrections
    to a cloud route, other sites' corrections only with "Use corrections from other sites"); <!-- Red Team: local-only corrections leak to cloud -->
  - the budget hint strings in `src/locales/en.yml` and `src/locales/vi.yml` (`options.style.budgetHint`): the
    limit is per run, which in lazy mode is per round;
  - `src/shared/quality.ts` (`BEST_MODE_RELEASED`);
  - `package.json` (`version`);
  - `e2e/upgrade.spec.ts` (assert the memory DB exists and is empty, and the quality item is absent → Balanced).
- **Owned by the supervisor:** `docs/progress/progress-m7.md`.

## Implementation steps

1. Run `pnpm check`, `pnpm run e2e` and `pnpm run e2e:upgrade -- dc717b2` (the script takes the old commit as its
   first argument, `scripts/e2e-upgrade.mjs:11`), so the upgrade goes from v1.0.0 to the m7 build. The cache, settings and glossary must be intact, the memory DB is created empty, and the
   quality defaults to Balanced.
2. **Owner:** `pnpm run eval:gate` (Balanced, must be green) and `pnpm run eval:gate -- --mode best` (against
   `eval/gate-best.json`; skipped when Best is held back). Expected spend: two passes, up to $0.50 each (`SPEND_CAP_USD`).
3. **Owner:** `pnpm run latency -- --runs 2 --scenarios top,middle` once per strategy (`--strategy contextual`,
   `--strategy refine`). §3 #3 holds when Best's screen time is no worse than Balanced's beyond the run-to-run spread.
4. Update the docs listed above, and verify every claim against the code.
<!-- Updated: Validation Session 1 - Best is held back if the margin is missed -->
5. Set `BEST_MODE_RELEASED` (`src/shared/quality.ts`) from the phase 2 outcome: `true` only when the paired margin
   and the blind sheet passed; otherwise `false`, so the release neither ships Best free nor sells it, and the
   README and privacy text do not mention Best. Then bump the version to 1.1.0. Run `pnpm run check:manifest` and `pnpm run zip`, and record the size and SHA-256.
6. **Owner:** run the §7 demo with real keys: the harness table, first-draft timing in Balanced vs Best, markers
   and the draft toggle, a tiny budget, and an edit reused on another article (same site, or with "Use corrections
   from other sites" on). Record screenshots in the phase report.
7. Write the evidence table (criteria 1–6 and the Pro launch condition) for the progress log.

## Todo

- [ ] `pnpm check`, e2e, upgrade e2e green
- [ ] Owner: Balanced gate green; Best gate green
- [ ] Owner: latency Balanced vs Best
- [ ] DESIGN, README, privacy, budget hint updated and verified
- [ ] `BEST_MODE_RELEASED` set from the phase 2 outcome
- [ ] Version 1.1.0, zip size and SHA-256
- [ ] Owner: §7 demo recorded
- [ ] Evidence table for the progress log

## Success criteria

- Every §3 row has evidence: a test name, an e2e flow, a gate output or a latency number.
- The Pro launch condition (Best beats Balanced by the #1 margin) is reported to the owner as met or not met, with
  the numbers from phase 2, and `BEST_MODE_RELEASED` matches it (Validation Session 1).
- No doc claims behaviour the code does not have (the reviewer checks each changed paragraph against the source).

## Verification

- `pnpm check`, `pnpm run e2e`, `pnpm run e2e:upgrade -- dc717b2`, `pnpm run check:manifest`, `pnpm run zip`
- **Owner:** `pnpm run eval:gate`, `pnpm run eval:gate -- --mode best`, `pnpm run latency -- --strategy refine`

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| The Balanced gate goes red from judge noise | M × M | The gate re-runs a failed pass once (`scripts/eval/gate.ts`); a second red is investigated, not re-rolled. |
| Live latency shows Best slower on screen | L × H | Phases 1 and 3 keep review after all drafts; if it happens, check whether the review route resolution or a held slot is the cause, and fix it before tagging. |
| The upgrade e2e misses the new DB | L × M | Its assertions include the memory DB's existence and emptiness after the upgrade. |

**Rollback.** Nothing is published by this phase. A failed gate leaves the branch untagged.

## Security

Docs and the package carry no keys or personal paths. The privacy text matches the code: no new network
destination in M7.
