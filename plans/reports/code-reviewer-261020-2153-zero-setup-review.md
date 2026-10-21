# Code review: zero-setup translation with Chrome built-in AI

Branch `feat/chrome-builtin-zero-setup`, reviewed 2026-10-20 against `plan.md` and phases 2–4. The reviewer could
not write report files, so the controller recorded its findings here with what was done about each.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| H1 | High | A job held by the privacy notice sent text over the route it resolved before the wait. A route changed meanwhile (a local-only rule, another model) did not apply. The same held for explain and redo. | Fixed. `Jobs.cleared` resolves the route again after the notice is acknowledged, for runs, explain and redo. Test: `privacy.test.tsx`, "a route changed while the notice waited applies". |
| M1 | Medium | A stored Gemini Nano fallback link promoted to primary (keyless default) lost `onDevice`. It then ran contextual with analyze, sent memory examples and waited for the notice. | Fixed. `FallbackLink.onDevice` is carried through the promotion. Test: `providers.test.ts`, "a stored Gemini Nano fallback standing in for a keyless default". |
| M2 | Medium | A second pair turned on while the page still ran never re-ran its blocks, and its prompt came back. | Fixed. A ready pair clears `onDeviceSetup`, and the page runs again once the running job ends. Test: `on-device.test.ts`, "a pair turned on while the page still runs". |
| L1 | Low | After a promotion the privacy notice named the keyless default as where text goes. | Fixed. `routedSummary` mirrors the promotion. |
| L2 | Low | The onboarding built-in path said "translating on this device" even when an existing key routes the sample to the cloud. | Fixed. The line is dropped; the sample's "Translated by …" line names what ran. |
| L3 | Low | A refused Nano turn-on in onboarding does not name the engine. | Not changed. The error text (`NotAllowedError: …`) is shown with Try again; naming the engine adds little. |

Checked and found to hold: no `create()` on a job path for a model or pair that is not `available`; the
`Jobs.start` synchronous invariant and abort handling; gate keys per Jobs; cache keys for on-device jobs; the
`Routing.onDevice` round trip; en/vi parity.

The reviewer's own unit-test run reported 17 failures. It ran for about 7,000 s while an e2e run used the same
worktree and the machine's load average was near 40, and it kept only the last lines of output. The controller
reran the full suite after the fixes; see the progress notes in the plan for the result.
