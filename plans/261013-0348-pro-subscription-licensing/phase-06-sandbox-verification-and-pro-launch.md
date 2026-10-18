---
phase: 6
title: "Phase 6: Sandbox verification and the Pro launch"
status: todo
priority: P2
effort: "0.5d + owner"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: Sandbox verification and the Pro launch

## Overview

There are two parts:
- the owner verifies the real provider lifecycle in the sandbox, which CI never touches, plus one production check;
- once M7's margin holds, the launch release turns the gate on for Best mode and translation memory, proves that
  free behaviour did not change, and updates the listing.

The agent prepares, records and makes the code and doc changes. The owner runs the sandbox, signs off the
Vietnamese text, and submits to the store.

**Blocked by M7** (`plans/261013-0348-m7-stronger-translation/`):
- phase 2, which proves the margin (M7 success criterion #1);
- the phases that wire the `best-mode` call site (phase 4) and the `translation-memory` call site (phase 6), built
  to the shared Gate contract in plan.md.

Part A may run before M7 is done. Part B may not.

## Requirements

- [ ] Part A is recorded in `docs/progress/progress-pro.md` with the date, build and outcome per row. No key or
  email appears in it.
- [ ] Part B starts only when the M7 margin is recorded as met and the owner says "launch". If Best misses the
  margin, Part B does not run, and M7 holds Best back from store releases until it passes.
  <!-- Updated: Validation Session 1 - Best held back -->

## Part A: Owner sandbox checklist (dev build, `pnpm build:dev`, which talks to the sandbox)

The License section is hidden while nothing is gated and no record exists (phase 3). For Part A, set
`best-mode: { gated: true }` in a local, uncommitted change before `pnpm build:dev`, and revert it afterwards.
Row 12 runs on the production build after Part B step 2.

<!-- Red Team: reinstall, portal deactivation and production benefitId rows -->

| # | Step | Expected |
|---|---|---|
| 1 | Buy a sandbox subscription with a test card. Paste the emailed key into Settings › Pro and press Activate | Active; the Polar dashboard shows one activation labelled "Translate Side (Chrome) · activated {today}" |
| 2 | Activate the same key in 2 more Chrome profiles, then a 4th | Profiles 2–3 are active; the 4th shows the device-limit view |
| 3 | Remove from this browser in profile 1, then press Try again in profile 4 | Profile 4 becomes active |
| 4 | In profile 2, free its activation in the customer portal, then press Check now there | The `deactivated` view ("This browser was removed…"), not "ended"; Activate again restores it |
| 5 | Uninstall and reinstall the extension in profile 3, then activate again | Record whether a slot leaked (the portal shows the old activation). The dated labels tell the old one apart |
| 6 | DevTools › Network › block the sandbox API host from phase 1, set the record's `lastOkAt` back 2 days (worker console), open Settings | Grace line; Pro stays on |
| 7 | Cancel the subscription in the portal, then press Check now | Still active until the period ends (`cancel_at_period_end`) |
| 8 | Revoke the key in the dashboard, then press Check now | "Your Pro subscription has ended" at once |
| 9 | Simulate a failed renewal (a Polar sandbox decline test card, or the dashboard's past-due action [UNVERIFIED which exists]), then press Check now during the 7-day seller grace | **Unverified behaviour.** Record whether validate answers `granted`. If not, record it in plan.md Key risks and adjust the `lapsed` wording |
| 10 | Resubscribe after a lapse | Record whether the old key is granted again or a new key is issued (plan.md Unresolved question 2) |
| 11 | Settings opens with no key: confirm in DevTools that no request goes to Polar | No request |
| 12 | **Production build with the shipped config**, with the owner's own real purchase: activate once, then Check now | Active after the validate, which proves the shipped `organizationId` and `benefitId`; then Remove frees the slot |
| 13 | A native Vietnamese reader reviews `options.pro.*`, `pro.*` and `panel.privacy.license` | Signed off or fixed |

## Part B: Launch (after the M7 margin and the owner's go-ahead)

1. **Record the free baseline before the flip.** On the launch branch (M7 merged, flags still off), run
   `FREE_BASELINE=record pnpm run e2e -- free-features` and commit `e2e/free-baseline.json`.
   <!-- Red Team: behavioural free-feature check -->
2. **Gate the M7 features.**
   - In `src/shared/features.ts`, set `gated: true` for `best-mode` and `translation-memory`.
   - Check that the M7 call sites follow the Gate contract:
     - both ids are resolved once at job start;
     - Best is a disabled "(Pro)" option in the header select, with the note only beside it;
     - only similar-edit retrieval is gated.
   - Set the `allowedLocks` default in `e2e/fixtures.ts` to `['best-mode']` for panel specs, because the header
     select always shows it. Every other lock still fails a test.
3. **Prove free behaviour did not change.** Re-run `e2e/free-features.spec.ts` against the recorded baseline with
   no license. It must match. Then run the whole e2e suite.
4. **E2E for the locked paths.** Add to `e2e/license.spec.ts`:
   <!-- Red Team: refine gated from every source; Updated: Validation Session 1 - translation-memory split -->
   - **Unlicensed header:** the Best option is disabled with "(Pro)" and the note beside the select, and a
     translation runs `contextual`.
   - **Unlicensed override:** seed `quality` with `{ strategy: 'refine' }`. The job runs `contextual`, as the mock's
     calls show (no review call).
   - **Unlicensed import:** import a settings file with `"quality": { "strategy": "refine" }`. The next job runs
     `contextual`.
   - **Licensed through the mock:** Best runs `refine`.
   - **Translation memory unlicensed:** an inline edit saves, and the same source text reuses the edit exactly. A
     similar passage's prompt carries no retrieved edit.
   - **A cached Best page** stays readable after the mock revokes the key and Check now runs.
   - **Launch gate:** M7's `Jobs.start` gate test (M7 phase 3, wired in phase 4) (unavailable `best-mode` with mode `best`, with the override
     `refine`, and with an imported `refine` all give `contextual`) is green. Name it in the phase report.
5. **Store listing** (`docs/store/listing.md`).
   - Replace `Pricing: free` (`:101`) with "Free. An optional Pro subscription ($5 a month), sold through Polar, adds
     Best mode and learning from your edits. Everything else stays free."
   - Add one PRO paragraph to the detailed description. Reword "sends nothing to its developer" to point to the
     privacy policy's list of outside requests.
   - The owner applies the data-use answers from phase 5 in the dashboard.
6. **README.** Add a short "Pro" note **below** the Features table, not as a row, naming the Pro features and the
   price. Update the Privacy section (`README.md:203-208`) with the one-line license-check note.
7. **Privacy page.** Set "Effective for version X.Y.Z" (`docs/privacy.md:18`) to the launch version.
8. **Run the gates.** Run `pnpm check`, `pnpm run e2e` and `pnpm run e2e:upgrade`. Run the local `pnpm run eval:gate`
   if the M7 release requires it.
9. **Owner.** Build the zip, submit, and switch the Polar product's checkout to public.

## Todo

- [ ] Part A rows 1–13 recorded
- [ ] M7 margin confirmed met (link to the M7 phase 2 report)
- [ ] Free baseline recorded before the flip, and matched after it
- [ ] `best-mode` and `translation-memory` gated; `allowedLocks` default set; locked-path e2e green; M7 launch-gate unit test named
- [ ] Listing pricing line and description; README note; privacy effective version
- [ ] Owner submits and opens the checkout

## Files

- Modify: `src/shared/features.ts` (two flags), `e2e/fixtures.ts` (`allowedLocks` default), `e2e/license.spec.ts`,
  `e2e/free-baseline.json`, `docs/store/listing.md`, `README.md`, `docs/privacy.md` (version line), and
  `src/locales/*.yml` if row 9 or 13 changes wording.

## Success Criteria

- All 13 Part A rows have a recorded outcome. Row 9 is recorded whatever it shows, and row 12 is active.
- With the two ids gated and no license, `e2e/free-features.spec.ts` matches the baseline recorded just before the
  flip, and the whole e2e suite is green.
- `refine` cannot run unlicensed from the header, the override or an import.
- The submitted listing says Free with optional Pro, and the privacy page matches the shipped version.

## Risks

- **M7 misses the margin.** Part B does not run. Best stays out of store releases (M7), and licensing stays merged,
  ungated and hidden.
- **The store reviewer asks about payments.** The test instructions in `docs/store/listing.md` say that Pro is
  optional, that every listed v1 feature works without it, and how to test without buying.
- **A launch-day provider problem.** Kill switch: a patch release with every `gated: false`. It goes through store
  review, so it takes days; the 7-day grace and the transient-by-default rule cover that time.

## Rollback

Set the two flags back to `false` and restore `Pricing: free` in a patch release. Pro users lose nothing, because
everything becomes available. Refunds, if needed, are handled in Polar.
