---
phase: 2
title: "Phase 2: Entitlement core: registry, state machine, provider adapter"
status: todo
priority: P2
effort: "1.25d"
dependencies: [1]
---

# Phase 2: Entitlement core: registry, state machine, provider adapter

## Overview

This phase builds the non-UI half:
- the Pro feature registry and `featureAvailable`, which M7 and M9 call once per job;
- the license record in `storage.local`;
- the pure, clock-skew-aware state machine;
- the locked refresh, activate and remove;
- the provider adapter chosen in phase 1.

There is no UI yet. Every registry entry is `gated: false`, so nothing changes for users.

## Starting point (verified)

- Keys are stored per item in `storage.local`, never sync: `saveApiKey`/`removeApiKey`
  (`src/shared/settings.ts:182-199`). The license follows the same rule with one item, `license`.
- Cross-context mutual exclusion already uses Web Locks: `withMigrationLock` (`src/shared/migrate.ts:26-32`). It
  queues (`locks.request(name, task)`, with no `ifAvailable`). The license code queues too, except for the lazy
  background refresh.
- A storage fake with interleaving (`slow`) exists: `fakeArea` (`src/shared/testing.ts:22`).
- The engine must not import browser code (`scripts/check-engine-boundary.mjs`), so every `featureAvailable` call
  site is in shell code.
- `src/shared/features.ts` may already exist, created by M7 or M9 with the agreed signature and a body that returns
  `true` (plan.md, Gate contract).
- The sync sites M9 named exist: `defaultEngine` is synchronous (`src/entrypoints/sidepanel/jobs.ts:1311`), and
  `extract` re-checks a generation after its await (`src/entrypoints/sidepanel/controller.ts:321-322`). This is why
  the contract resolves access once at job start.

## Requirements

- [ ] `featureAvailable(id)` never waits on the network. It answers from the stored record and starts a background
  refresh when one is due.
- [ ] Only a definitive negative turns Pro off: JSON in a shape phase 1 recorded. Everything else is transient.
- [ ] No refresh resurrects a license the user removed or replaced. Activate, Remove and forced checks are never
  silently skipped.
- [ ] A failed activation of a new key changes nothing at Polar or in storage.
- [ ] The stored record holds no customer email or name, and nothing from the response but the whitelisted fields.
- [ ] No request is made for a user without a `license` record.

## Implementation Steps

1. **Take over the hook file.** If `src/shared/features.ts` exists, keep its exported names and signature exactly
   and replace only the body. If it does not exist, create it with that signature. Add `pro-licensing` to the push
   branches in `.github/workflows/ci.yml:5`.
2. **Registry and gate: `src/shared/features.ts`.** This is the shared contract (plan.md, Gate contract), which M7
   and M9 call. It takes no `api` argument, and uses WXT's `browser` internally.
   <!-- Updated: Validation Session 1 - job-start resolution and the translation-memory split -->
   ```ts
   export const PRO_FEATURES = {
     'best-mode': { plan: 'M7', gated: false },          // gates the refine strategy from every source
     'translation-memory': { plan: 'M7', gated: false }, // gates only similar-edit retrieval into prompts
     'deep-mode': { plan: 'M9', gated: false },
     pdf: { plan: 'M9', gated: false },
     'domain-packs': { plan: 'M9', gated: false },
     'code-comments': { plan: 'M9', gated: false },
   } as const;
   export type FeatureId = keyof typeof PRO_FEATURES; // = the union M7 and M9 declared
   export function featureAvailable(id: FeatureId): Promise<boolean>; // = entitlement(browser, id).then((e) => e.available)
   export async function entitlement(api: Browser, id: FeatureId, opts?: { now?: number; registry?: typeof PRO_FEATURES }): Promise<{ available: boolean; state: LicenseState | 'free' }>;
   export function proVisible(registry = PRO_FEATURES, record?: LicenseRecord): boolean; // some id gated, or a record exists
   ```
   - An ungated id returns `true` (state `'free'`) without reading storage.
   - A gated id reads the record and derives the state. When `needsCheck` is true it calls `refreshLicense(api)`
     without awaiting it, and returns `state ∈ {active, grace}`.
   - The tests and the UI hook call `entitlement` with an injected `api`, `now` and registry. `featureAvailable` is
     the one-line production wrapper.
   - The header comment states the contract: call once at job start, store the result on the job, and let sync
     code read the stored value.
   - If M7 or M9 already declared `FeatureId` as a plain union, derive it from the registry and keep the same members.
3. **Record and state machine: `src/shared/license.ts`.**
   <!-- Red Team: clock skew, lapsed re-check, lock modes, activate-first -->
   - **The record.** `LICENSE_KEY = 'license'`, with the type
     `{ v: 1, provider: 'polar' | 'lemonsqueezy', key, activationId?, verdict: 'granted' | 'revoked' | 'deactivated' | 'device-limit', expiresAt?, activatedAt, lastOkAt?, lastCheckAt, nextCheckAt?, failures, revokedAt? }`.
   - **Reading.** `readLicense` cleans what it reads field by field. A malformed record reads as none, and nothing
     is written over it.
   - **State.** `licenseState(record, now)` is pure and follows plan.md's States table, with `FRESH = 24 h`,
     `GRACE = 7 d` and `SKEW = 10 min`. A record is skewed when `age = now − lastOkAt < −SKEW` or
     `lastCheckAt > now + SKEW`. A skewed record counts as `active` until the check it triggers answers, and
     `unconfirmed` (off) if that check fails.
   - **When to check.** `needsCheck(record, now)` is true when:
     - (verdict `granted` and (`age ≥ FRESH` or skewed)) and `min(nextCheckAt, now + 12 h) ≤ now`. The clamp is
       applied when the value is read, so a `nextCheckAt` written under a wrong clock cannot freeze checks;
     - or verdict `revoked`, `now − revokedAt ≤ 30 d`, and the last check was ≥ 24 h ago. This is the lazy
       self-heal for a false revoke.

     `device-limit` and `deactivated` are re-checked only on the user's action.
   - **Backoff** after the n-th consecutive transient failure:
     `nextCheckAt = now + max(retryAfterMs, min(1 h × 2^(n−1), 12 h))`, honouring `Retry-After` in seconds or as an
     HTTP date.
   - **One lock, two modes.** Every write path runs inside `navigator.locks.request('translate-side-license', …)`.
     - The lazy background refresh, `refreshLicense(api)`, passes `{ ifAvailable: true }` and returns at once when
       the lock is held.
     - `refreshLicense(api, { force: true })` (Check now, Check again), `activateLicense` and `removeLicense` queue,
       so they are never skipped.
     - Inside the lock, each one reads the record, makes its call, re-reads the record, and writes only if `key`
       and `activationId` are unchanged (compare-and-set).
     - Without Web Locks, it falls back to an in-context queue, as `withMigrationLock` does.
   - **`activateLicense(api, key)`**, in this order:
     1. Trim the key and activate it with the label `Translate Side (Chrome) · activated YYYY-MM-DD` (today's date;
        no device detail).
     2. On success, deactivate the old record's activation if it is a different one (best effort; a failure is
        ignored, because the user can free the slot in the portal), then write the new `granted` record.
     3. On `device-limit`, keep any old record. If there was none, write a `device-limit` record with no
        `activationId`, so the UI can offer Try again.
     4. On `invalid`, `revoked` or `transient`, write nothing, deactivate nothing, and return the error.
   - **`reactivateLicense(api)`** handles the `deactivated` state. It runs `activateLicense` with the stored key.
   - **`removeLicense(api)`** calls `deactivate`. On 204 or 404 it removes the item. On a transient error it returns
     `'offline'`, and the UI asks before it removes the item locally with `{ evenIfOffline: true }`. The slot stays
     used until it is freed in the portal.
   - **`onLicenseChanged(api, fn)`** wraps `storage.local.onChanged` for the `license` key.
4. **Provider adapter: `src/shared/license-polar.ts`** (or `license-lemonsqueezy.ts`, per phase 1).
   <!-- Red Team: definitive-answer rule, deactivated mapping, no follow-up validate -->
   - **Interface.** `export interface LicenseProvider` lives in `license.ts`:
     - `activate(key, label) → { ok: true, activationId, expiresAt? } | { ok: false, kind: 'invalid' | 'device-limit' | 'revoked' | 'transient', retryAfterMs? }`;
     - `validate(key, activationId) → { kind: 'granted', expiresAt? } | { kind: 'revoked' } | { kind: 'deactivated' } | { kind: 'transient', retryAfterMs? }`;
     - `deactivate(key, activationId) → 'ok' | 'gone' | 'transient'`;
     - plus `checkoutUrl` and `portalUrl`.
   - **Config.** `import.meta.env.DEV ? SANDBOX : PRODUCTION`. Each holds `api`, `organizationId`, `benefitId`,
     `checkoutUrl` and `portalUrl` from phase 1's table. Confirm that `pnpm build:dev` (`wxt build --mode
     development`) builds with `import.meta.env.DEV` true, and `pnpm build` with it false. The panel's DevView
     depends on the same flag (`src/entrypoints/sidepanel/App.tsx:305`) [UNVERIFIED for `build:dev`].
   - **Every request** is
     `fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'omit', signal: AbortSignal.timeout(10_000) })`.
     It sends `key` and `organization_id`. Validate and deactivate also send `activation_id`, and validate also
     sends `benefit_id`.
   - **The definitive-answer rule.** A response is definitive only if its `content-type` is `application/json`,
     it parses, and it matches a shape recorded in `src/shared/license-fixtures/`:
     - a validated-key object, whose `status` and `benefit_id` are read;
     - Polar's error envelope, with an error type recorded for that status.

     Everything else is `transient`: HTML, a parse failure, an unknown error type or envelope, 429, 5xx, a
     `TypeError` (network or CORS), an `AbortError` (timeout), or any other status.
   - **Mapping definitive answers:**
     - validate 200 with `status: 'granted'` and a matching `benefit_id` → granted;
     - validate 200 with another status or a `benefit_id` mismatch → revoked;
     - validate 404 → `deactivated` when the recorded body for "activation freed" matches, otherwise `revoked`;
     - activate 404 or 422 with a recorded envelope → invalid;
     - activate 403 → `device-limit` or `revoked`, by the field phase 1 found.

     If phase 1 found no difference for a pair, the adapter returns the combined kind, and the UI shows the combined
     view:
     - for the 403 pair: device-limit text that also names an ended subscription;
     - for the 404 pair: the lapsed view, with "Activate again on this browser" as its first action.

     There is no follow-up call to tell them apart.
   - Only whitelisted fields are read from a response. The customer record is never touched.
5. **Tests.**
   - `src/shared/license.test.ts`:
     - every States row;
     - the boundaries: exactly 24 h, exactly 7 d, `expiresAt` equal to now;
     - the three skew cases, named: a future `lastOkAt` (due at once, and `unconfirmed` if the check fails),
       `lastCheckAt` ahead of now (due at once), and a far-future `nextCheckAt` clamped to 12 h;
     - backoff, including `Retry-After`;
     - transient answers never change the verdict;
     - a definitive 404 turns the state lapsed at once;
     - a revoked record is re-checked once a day for 30 days and not after;
     - activate-first: an invalid or offline new key leaves the old record unchanged and makes no deactivate call;
       a valid new key deactivates the old activation only after the activate succeeded;
     - interleaving with the `slow` fake: a Remove queued while a refresh is between its re-read and its write
       leaves no record afterwards;
     - a forced check that starts while a lazy refresh holds the lock waits, then validates (two validate calls in
       all);
     - two concurrent lazy refreshes make one `validate` call;
     - after an activate whose response carries the customer's email and name, the stored record has neither;
     - no record means no adapter call.
   - `src/shared/license-polar.test.ts`:
     - each fixture maps as above;
     - an HTML 200, a JSON 404 with an unknown envelope, a non-JSON 404 and an empty 403 are all transient;
     - each request body has exactly the expected fields (a stub `fetch`);
     - the activation label has the date form.
   - `src/shared/features.test.ts`:
     - the registry keys are exactly the six ids;
     - an ungated id makes no storage read;
     - a gated id follows the state;
     - `proVisible` is false with nothing gated and no record, and true otherwise;
     - static checks: a scan of non-test `src/**/*.{ts,tsx}` finds at most one `featureAvailable(` call per id,
       none in `src/engine/**` and none in `src/entrypoints/content.ts`.

## Todo

- [ ] Hook file taken over with the shared signature unchanged; CI branch added
- [ ] Registry, `featureAvailable`, `entitlement`, `proVisible`
- [ ] Record, `licenseState` with skew, `needsCheck` with the clamp and the lapsed re-check, backoff
- [ ] One lock, two modes; compare-and-set inside the lock
- [ ] Activate-first, reactivate, remove, change listener
- [ ] Provider adapter with the definitive-answer rule and the phase 1 fixtures
- [ ] Unit tests listed above, all green

## Files

- Create: `src/shared/license.ts`, `src/shared/license-polar.ts` (or `license-lemonsqueezy.ts`),
  `src/shared/license-fixtures/*.json`, `src/shared/license.test.ts`, `src/shared/license-polar.test.ts`,
  `src/shared/features.test.ts`.
- Create or replace the body of: `src/shared/features.ts`.
- Modify: `.github/workflows/ci.yml` (branch line).

## Success Criteria

- `pnpm check` is green, and the coverage of `src/shared/license*.ts` is reported (no new threshold).
- The unit tests cover every case listed in step 5.
- There is no change to `wxt.config.ts`, and `pnpm run check:manifest` passes unchanged.

## Risks

- **Web Locks `ifAvailable` in the worker.** It is available in Chrome 138 service workers [UNVERIFIED for the
  `ifAvailable` option specifically]. The in-context fallback keeps it correct, at worst with a duplicate call.
- **Time-based tests are flaky.** Every function takes `now`; no test uses real timers for the state machine.
- **A recorded shape changes at Polar.** A changed shape is transient (Pro stays on in grace), never a revoke. A
  `granted` answer in a new shape would also be transient: after 7 days users become `unconfirmed`. Phase 6's
  production row catches this at launch.

## Rollback

Revert the phase's commits. All entries are ungated, so no behaviour depended on them. If M7/M9 call sites already
import `features.ts`, restore its default-`true` body instead of deleting the file.
