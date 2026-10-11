---
phase: 7
title: "Release candidate and beta handoff"
status: pending
priority: P1
effort: "0.5d + user time"
dependencies: [1, 2, 3, 4, 5, 6]
---

# Phase 7: Release candidate and beta handoff

## Goal

v1.0.0 is tagged as a release candidate with every automated gate green, and the user has what they need to run
the unlisted beta and then list the extension. Beta findings flow into a tracked fix list.

## Plan tasks owned

- M6-E9: closed beta (unlisted listing), the fix list, then a public listing. The agent prepares and tracks; the
  user uploads and runs it (contract decision 3).

## Done criteria (copied from docs/plans/M6-release-hardening.md, with the contract's readings)

- §2: "v1.0 is published, first unlisted for a closed beta, then listed."
- §3 #1: "v1.0 published | unlisted, then listed". Agent part: done when phase 6's package exists and this phase's
  checklist is handed over. User part: open until the user confirms.
- §3 #9: "Closed beta | a handful of users; fix list closed or scheduled". The fix list exists and stays open until
  the user has run the beta.
- §7 demo: all six steps can be shown from the repo and CI runs.

## Steps

1. **Release-candidate check on `m6`.** Run `pnpm check` (which includes coverage and the bundle check),
   `pnpm run e2e`, `pnpm run eval:gate` (local; CI has no eval job), `pnpm run e2e:upgrade` and
   `pnpm run zip`. Record each result in `docs/progress/progress-m6.md`.
2. **Beta checklist.** `docs/store/beta-checklist.md` is for the user and the beta testers. It covers what e2e cannot
   (from phase 2, step 8):
   - the real Chrome permission prompt, for an allowlisted site and for a custom endpoint;
   - rapid `Alt+T` presses and the toolbar-icon toggle;
   - the Chrome 138–140 toggle fallback;
   - screen-reader speech (VoiceOver);
   - dark-mode contrast of the panel and options pages;
   - the real docked panel with hover and scroll sync;
   - a native reader's review of the Vietnamese UI text;
   - and "try it on your own sites; if something fails, export diagnostics and send the file privately, not in a
     public issue". Site names are left out unless the tester includes them.
3. **Fix list.** Add a "Beta fix list" section to `docs/progress/progress-m6.md`. Each item has a source (tester or
   diagnostics file), a severity, a status (open, fixed in a commit, or scheduled for M7) and a link. Beta sites that
   failed become new fixtures (plan §8).
4. **Hand over to the user.** Point to `docs/store/submission.md` (phase 6): create the item, upload the zip,
   complete the Privacy tab from `listing.md`, set visibility to Unlisted, and submit. After approval, share the
   link with the testers. When the fix list has no open blocker, switch to Public.
5. **Tag.** Once the user confirms the upload, create the annotated tag `v1.0.0` on the commit that built the zip.
   The tag is created only when the user asks; pushing is the user's call.

## Files

- Create: `docs/store/beta-checklist.md`.
- Modify: `docs/progress/progress-m6.md` (the release-candidate results and the fix list).

## Verification

- Every automated gate from step 1 is green with recorded output.
- The beta checklist covers every M5 open human item: compare it with the FINAL STATE in `progress-m5.md`.
- The M6 log's FINAL STATE lists exactly which §3 rows are met and which wait on the user (#1 and #9).

## Risks

- **Store review takes a long time.** This is outside the agent's control. M7 work may start on a new branch once
  the release candidate is tagged. The M6 log keeps #1 and #9 open.
