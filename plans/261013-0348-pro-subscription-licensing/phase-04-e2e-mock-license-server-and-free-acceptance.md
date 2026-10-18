---
phase: 4
title: "Phase 4: E2E mock license server and the free-feature acceptance test"
status: todo
priority: P2
effort: "0.75d"
dependencies: [2, 3]
---

# Phase 4: E2E mock license server and the free-feature acceptance test

## Overview

This phase exercises the real build's license flow in Chromium against a local mock of the Polar license
endpoints, so CI never calls Polar. It also adds a behavioural acceptance test: a walk through the README features
with no license, which records a baseline that phase 6 compares against after the launch flip.

## Starting point (verified)

- The e2e harness runs the production build copied to `.output/e2e-ext`, and only the copy's manifest is changed
  (`e2e/fixtures.ts:23-32`). There is no e2e build mode (M6 red-team finding 6). So the production URL
  `https://api.polar.sh/...` must be routed, not swapped, and the build's registry is the shipped one: nothing is
  gated before phase 6.
- The mock servers are Node `http` servers on fixed ports with a control object (`e2e/servers.ts:13-16`, `mockServer`
  at :78, `listen` at :159). They start once per worker (`e2e/fixtures.ts:91-101`).
- A catch-all route answers every request that is not for `127.0.0.1` and fails the test if the worker or the panel
  made it (`e2e/fixtures.ts:152-157`). In Playwright, a route registered later is matched first, so a license route
  added after it takes precedence.
- Any console error fails a test unless the test lists it in `allowedConsole` (`e2e/fixtures.ts:119`, `:165`).
- No e2e test seeds a `license` item (`e2e/fixtures.ts:179` seeds only `secret:mock` and `privacyNotice`).
- The License section renders only with a gated id or a record (phase 3). In this build the license specs therefore
  start from a seeded record.

## Requirements

- [ ] The extension's own production URL is exercised. No config or build change is made for tests.
- [ ] Every e2e test that does not opt in to the license fixture fails if the extension makes a license call.
- [ ] Every e2e test fails on a visible `[data-pro-lock]` for a feature not in its `allowedLocks`.
  <!-- Red Team: teardown narrowed to an allow-list -->
- [ ] The free-feature test runs the features. It fails when a README feature row has no step, or when an
  outcome differs from the baseline.
  <!-- Red Team: behavioural free-feature check -->

## Implementation Steps

1. **Spike: CORS preflight under routing.** The adapter's JSON POST triggers a preflight. Check that a route on
   `https://api.polar.sh/**` sees, or Playwright answers, the `OPTIONS` request [UNVERIFIED]. If it does not,
   forward with `route.fetch({ url: <mock URL> })`, and have the mock answer `OPTIONS` with 204 and
   `access-control-allow-origin: *` (as `mockServer` does, `e2e/servers.ts:100-105`). Record the outcome in the
   phase report.
2. **`licenseServer()` in `e2e/servers.ts`.**
   - It listens on `LICENSE_PORT = 4175`.
   - It serves `POST /v1/customer-portal/license-keys/{activate,validate,deactivate}` with the bodies and content
     types from `src/shared/license-fixtures/` (phase 1), so the mock and the unit tests agree.
   - It keeps an in-memory table of keys: `{ status: 'granted' | 'revoked', activations: string[], limit }`.
   - `LicenseControl` provides:
     - `addKey(key, { limit })`;
     - `revoke(key)`;
     - `freeActivation(id)`, the portal deactivation;
     - `failNext(n, status)`, which answers with 503 or 429 and `Retry-After`;
     - `htmlNext(n)`, a 200 HTML page, as a captive portal would answer;
     - `offline(on)`, which drops the connection;
     - `calls: { path, body }[]`;
     - `allow(on)`;
     - `reset()`.
   - The header comment follows the file's style and says what the mock answers.
3. **Wire it into `e2e/fixtures.ts`.**
   - Start the server with the others, in the `servers` fixture.
   - After the catch-all route, add `context.route('https://api.polar.sh/v1/customer-portal/license-keys/*', …)`.
     It forwards to the mock. When `allow` is off, it reports `"<from> requested a license check"` as a failure.
   - Add a `license` fixture that turns `allow` on for the test that uses it and resets the mock.
   - Add an `allowedLocks: FeatureId[]` option, default `[]`, like `allowedConsole`.
   - At teardown:
     - a test without the `license` fixture must show `calls.length === 0`;
     - no open extension page may show a `[data-pro-lock]` whose feature is not in `allowedLocks`.
4. **`e2e/license.spec.ts`.** Each test seeds its starting record through the worker, sets `allowedConsole` for the
   errors it provokes (the 503, 404 and offline "Failed to load resource" lines), and uses the `license` fixture.
   <!-- Red Team: seeded records and allowedConsole -->
   - Seed a `lapsed` record, enter a key the mock knows in "enter another key", and press Activate. The status shows
     active, the stored record has no `email` field, and the activation label has the date form.
   - Revoke the key in the mock and press Check now. The status shows "ended" at once.
   - Mistyped key: from an active record, enter an unknown key. An error shows, the record is unchanged, and the
     mock saw no deactivate.
   - Grace: seed a `granted` record with `lastOkAt` 2 days ago, with the mock failing (503) and then answering HTML
     (`htmlNext`). Open Settings. The status shows the grace line, not "ended", and the stored verdict is still
     `granted`.
   - Device limit: a key with `limit: 1` already activated elsewhere shows the device-limit view.
   - Portal deactivation: `freeActivation`, then Check now shows the `deactivated` view. "Activate again on this
     browser" makes it active.
   - Remove: the item is gone, and the mock saw one deactivate.
   - Remove while offline shows the confirm, and Remove anyway clears the item.
5. **`e2e/free-features.spec.ts`**: the behavioural free-feature walk.
   <!-- Red Team: behavioural free-feature check -->
   - **Row guard.** The spec has a `STEPS` list named after the README feature-table rows (`README.md:59-76`). Its
     first check parses the table and asserts the row names equal the step names. Rows marked "Pro" are excluded,
     though phase 6 puts the Pro note outside the table anyway.
   - **The walk** runs with no license and does at least the following:
     - translate a fixture page: side by side, streaming, the brief, checked output;
     - switch the style mode;
     - add a glossary entry and translate again;
     - translate a selection;
     - follow an SPA route change;
     - reload and resume from the cache;
     - read the cost readout;
     - use the keyboard (J/K, O) and check the translation's `lang`;
     - follow the hover link;
     - export settings;
     - read the diagnostics;
     - check that the copied manifest has no `host_permissions` beyond the test one.
   - **The outcome** is recorded per step: block statuses, the segments and glossary terms in the translate
     requests (from `MockCall`), the cache hits on resume, and the exported file's top-level keys.
   - With `FREE_BASELINE=record` the spec writes `e2e/free-baseline.json`. Otherwise it compares against that file
     and fails on any difference.
   - Phase 6 re-records the baseline on the launch branch with the flags off, flips them, and re-runs this spec.

## Todo

- [ ] Preflight spike recorded
- [ ] `licenseServer` and `LicenseControl` (including `freeActivation`, `htmlNext`)
- [ ] License route and fixture; `allowedLocks`; teardown checks
- [ ] `e2e/license.spec.ts`, 8 flows with `allowedConsole`
- [ ] `e2e/free-features.spec.ts` and `e2e/free-baseline.json`

## Files

- Modify: `e2e/servers.ts`, `e2e/fixtures.ts`.
- Create: `e2e/license.spec.ts`, `e2e/free-features.spec.ts`, `e2e/free-baseline.json`.

## Success Criteria

- `pnpm run e2e` is green, including both new specs, and no test reached a host outside `127.0.0.1`.
- The phase report shows two failures on purpose: one from deleting a step from `STEPS`, one from editing a baseline value.
- A grep for `api.polar.sh` in `.github/workflows/` and `scripts/` finds nothing; CI has no Polar secret.

## Risks

- **Port 4175 in use.** `listen` already reports the stale owner (`e2e/servers.ts:159-164`). Do not pick another port.
- **The baseline is brittle across unrelated changes** (for example M7 changing a prompt). It is compared only on
  the same code with the flags off and then on. A change elsewhere re-records it in the same commit, with a note.

## Rollback

Revert the phase's commits. The harness returns to its M6 shape.
