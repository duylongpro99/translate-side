---
title: "Pro subscription licensing ($5/month)"
description: "A client-side license check (Polar.sh license keys, Lemon Squeezy fallback) with an entitlement module by feature id, a License section in Settings and a quiet locked-feature state, gating only new M7/M9 features."
status: pending
priority: P2
effort: 4.25d
branch: pro-licensing
tags: [licensing, pro, frontend, privacy, store]
blockedBy: []
blocks: []
created: 2026-10-13
---

# Pro subscription licensing ($5/month)

## Overview

This plan adds the licensing half of the Free/Pro split. The product decision is accepted in
`plans/reports/brainstorm-261013-1036-free-pro-pricing.md`: v1 stays free, Pro costs $5 a month, users keep bringing
their own key, there is no Translate Side server, only new M7/M9 features are gated, and beta testers get no Pro
grant. The provider research is `plans/reports/researcher-261013-1036-pro-subscription-licensing.md`: Polar.sh
license keys first, Lemon Squeezy as the fallback, no new permission (the license endpoints answer CORS `*`), a
24-hour freshness window, a 7-day offline grace and lazy re-checks without `alarms`.

The plan delivers:
- an entitlement module consulted by feature id, with a registry of the six Pro ids;
- a license state machine with a small provider adapter (activate, validate, deactivate), so a provider switch is one file;
- a License section in Settings (activate, status, check now, remove, manage subscription, buy). It is shown only
  once some feature is gated or a license record exists;
- one quiet locked-feature state shared by the panel and Settings, and the hook M7 and M9 call;
- an e2e mock license server, a behavioural test that the README features work without a license, and the privacy
  and store text.

It does not build M7 or M9 features, and it gates no v1 feature.

**Delivery.** It follows the M6 convention: a supervisor using `docs/prompts/implement-plan.md` with this plan as
`{{PLAN_FILE}}`, the two reports above as `{{SPEC_FILE}}`, and `docs/progress/progress-pro.md` as `{{LOG_FILE}}`. Work
happens on branch `pro-licensing` in a worktree, started from master @ dc717b2. The first code phase adds
`pro-licensing` to the CI push branches (`.github/workflows/ci.yml:5`).

## Phases

| # | Phase | Depends on | Effort | Model | Status |
|---|---|---|---|---|---|
| 1 | [Owner gate: provider account and public config](./phase-01-start.md) | — | owner time + 0.25d | Sonnet | Pending |
| 2 | [Entitlement core: registry, state machine, provider adapter](./phase-02-entitlement-core.md) | 1 | 1.25d | Opus (state machine, races) | Pending |
| 3 | [License UI and the locked-feature state](./phase-03-license-ui-and-locked-state.md) | 2 | 1d | Sonnet | Pending |
| 4 | [E2E mock license server and the free-feature acceptance test](./phase-04-e2e-mock-license-server-and-free-acceptance.md) | 2, 3 | 0.75d | Opus (harness routing spike) | Pending |
| 5 | [Privacy and store text](./phase-05-privacy-and-store-text.md) | docs: 2; notice bump: 4 | 0.5d | Sonnet | Pending |
| 6 | [Sandbox verification and the Pro launch](./phase-06-sandbox-verification-and-pro-launch.md) | 1–5, M7 (see below) | 0.5d + owner | Sonnet | Pending |

**Order.** 1 → 2 → 3 → 4 → 5 → 6. Phase 1 is the "phase 0" owner gate: no code starts until it passes. Phase 5's
docs-only steps (privacy page, store answers, justifications) may run alongside phase 4, because they touch only
`docs/**`. Its privacy-notice step waits for phase 4, because both touch `e2e/fixtures.ts`.

**File ownership.**

| Phase | Owns |
|---|---|
| 2 | `src/shared/features.ts` (body and registry; the call sites belong to M7/M9), `src/shared/license.ts`, `src/shared/license-polar.ts` (or `license-lemonsqueezy.ts`), their tests, `src/shared/license-fixtures/**`, `.github/workflows/ci.yml` (branch line only) |
| 3 | `src/entrypoints/options/License.tsx`, `src/entrypoints/options/Options.tsx` (one line), `src/entrypoints/sidepanel/ProLock.tsx`, their tests, `src/locales/en.yml` and `vi.yml` (`options.pro.*`, `pro.*`), `src/entrypoints/options/style.css`, `src/entrypoints/sidepanel/style.css` (`.pro-lock` only) |
| 4 | `e2e/servers.ts`, `e2e/fixtures.ts`, `e2e/license.spec.ts`, `e2e/free-features.spec.ts`, `e2e/free-baseline.json` |
| 5 | `docs/privacy.md`, `docs/store/listing.md` (Privacy tab), `docs/store/permission-justifications.md` (Data), `src/entrypoints/sidepanel/privacy.ts` (version), `PrivacyNotice.tsx`, `panel.privacy.*` locale keys, the seed line in `e2e/fixtures.ts`, `src/shared/portable.ts` (header comment) and `portable.test.ts` |
| 6 | the `gated` flags in `src/shared/features.ts`, `docs/store/listing.md` (pricing and description), `README.md` (Pro note, Privacy), `e2e/license.spec.ts` (locked paths), `e2e/free-baseline.json` (re-record before the flip), `e2e/fixtures.ts` (`allowedLocks` default) |

## Data flow

<!-- Red Team: definitive answers, lapsed re-check, lock modes, job-start resolution -->

```text
User pastes key in Settings › Pro (License.tsx)
  └─ license.ts activateLicense(key)   [queued lock "translate-side-license"]
        └─ adapter.activate(new key, label "Translate Side (Chrome) · activated YYYY-MM-DD") ──► Polar (CORS *, credentials omitted)
        └─ success only ─► adapter.deactivate(old key's activation), best effort ─► compare-and-set the new record
        └─ failure ─► nothing at Polar or in storage changes (the old license stays as it was)
  └─ storage.local "license" = { v, provider, key, activationId, verdict, expiresAt, activatedAt, lastOkAt,
                                 lastCheckAt, nextCheckAt, failures, revokedAt }   (no email or name, ever)

Job start in the panel (async setup, shell code only, never src/engine)
  └─ featureAvailable(id) for each Pro id the job can use — once — stored on the job; sync code reads that value
        ├─ registry says not gated ──► true  (every id until its launch flip)
        └─ gated ──► read "license" ──► licenseState(record, now)  (pure, clock-skew aware)
              ├─ due (stale ≥ 24 h, lapsed ≤ 30 d once a day, or clock skew) ──► refreshLicense() in the background
              │     [lock with ifAvailable: skip if any refresh, activate or remove is running]
              │     └─ validate ──► definitive only if JSON and the recorded Polar shape:
              │                       granted ──► lastOkAt = now · known 404/403 error type ──► revoked or deactivated
              │                    · anything else (HTML, parse error, 429, 5xx, network, timeout) ──► transient:
              │                       failures + 1, nextCheckAt = backoff (clamped to ≤ now + 12 h)
              │     └─ re-read and write inside the lock only if key and activationId are unchanged
              └─ on (active, grace) or off (unlicensed, unconfirmed, lapsed, deactivated, device-limit)

Check now / Check again (user click)  ──► refreshLicense({ force: true })  [queued lock: waits, then validates]
Remove (user click)                   ──► removeLicense()                   [queued lock]

UI (panel and Settings): useEntitlement(api, id) ──► { available, state }, live through storage.local.onChanged
  └─ not available ──► a locked option in a shared select: disabled, "(Pro)" suffix; the <ProLock> note
                       ("Part of Pro" + one link) shows only beside that control
```

Nothing calls the license endpoints for a user with no `license` record. The content script never calls them.

## States

<!-- Red Team: definitive answers, deactivated state, clock skew -->

`licenseState(record, now)` is a pure function. The record keeps facts; the state is derived. `age = now − lastOkAt`,
`SKEW = 10 min`, `FRESH = 24 h`, `GRACE = 7 d`. A record is **skewed** when `age < −SKEW` or `lastCheckAt > now + SKEW`
(the clock was moved back after a check). A skewed record is always due for a check.

| State | Condition | Pro | What the License section shows |
|---|---|---|---|
| `unlicensed` | no record | off | Buy link, key field, Activate |
| `active` | verdict `granted`, `0 ≤ age < GRACE` or skewed, and no failed check since `lastOkAt` | on | "Pro is active on this browser", Check now, Manage, Remove |
| `grace` | verdict `granted`, not skewed, a check failed with a transient error, `age < GRACE` | on | "Couldn't reach Polar since {date}. Pro stays on until {date}." |
| `unconfirmed` | verdict `granted` and `age ≥ GRACE`; or skewed and the check since the skew failed | off | "Couldn't confirm your Pro subscription", Check now |
| `lapsed` | verdict `revoked`, or `expiresAt ≤ now` | off at once | "Your Pro subscription has ended", Manage, Check again, Remove, enter another key |
| `deactivated` | verdict `deactivated`: this browser's activation was freed (for example in the portal), but the key is still valid | off | "This browser was removed from your subscription", Activate again on this browser, Remove |
| `device-limit` | activation refused because every slot is in use | off | "This key is already in use on 3 browsers", Manage (free a slot), Try again |

**Definitive answers.** A response is definitive only if it is `application/json` and matches a shape recorded in
phase 1:
- a validated-key object whose `status` is read;
- Polar's error envelope with an error type recorded for 404 or 403.

Anything else is transient and never changes the verdict: HTML, a parse failure, an unknown error type, 429, 5xx,
a network error or a timeout. A definitive negative turns Pro off at once. A `lapsed` record is re-checked lazily
at most once a day for 30 days after `revokedAt`, so a false revoke (a misconfigured `benefitId`, a renamed endpoint
that answers in Polar's shape) heals itself. A lapse never deletes cached translations or any data a Pro feature
produced.

## Gate contract

<!-- Updated: Validation Session 1 - shared gate contract amendments and the translation-memory split -->

Agreed across this plan, M7 and M9:

1. **Signature.** `src/shared/features.ts` exports `type FeatureId` and
   `featureAvailable(id: FeatureId): Promise<boolean>`. It returns `true` until this plan replaces its body.
   Whichever plan lands first creates the file with that signature.
2. **Resolved once at job start.** Feature access is resolved once at job start with the async
   `featureAvailable(id)`, and the result is stored on the job. Sync code (`defaultEngine`, the strategy reads,
   `extract` after its generation guard) reads the stored value and never calls `featureAvailable` itself. A license
   change mid-job applies to the next job.
3. **`best-mode` gates the `refine` strategy from every source:** the header mode, the advanced strategy override,
   and imported settings. When it is unavailable, a job that would run `refine` runs `contextual`.
4. **`translation-memory` gates only similar-edit retrieval into prompts.** Inline editing, and exact-source reuse
   of the user's edits, are free.
5. **Locked option in a shared select.** It is disabled with a "(Pro)" suffix, and the lock note shows only beside
   that control.
6. **Reading is never gated.** Cached output from a Pro feature stays readable after a lapse; only producing new
   Pro output is gated.
7. **One call site per id**, owned by M7 or M9. This plan owns the body, the registry flags and the locked-feature UI.

## Success criteria

<!-- Red Team: behavioural free-feature check; Updated: Validation Session 1 - privacy wording -->

- [ ] Phase 1: the owner confirms an individual in Vietnam can be paid by the chosen provider, and the Pro product
  and license-key benefit exist in sandbox and production. Their public ids are recorded in
  `docs/progress/progress-pro.md`. The 403 and 404 bodies for each cause are recorded.
- [ ] The README features work without a license. `e2e/free-features.spec.ts` walks them with no license and
  records a baseline. Phase 6 re-runs it with the launch registry and finds no difference. The e2e suite makes no
  license call, and shows no lock that a spec has not allowed (phases 4 and 6).
- [ ] `featureAvailable(id)` answers for the six ids `best-mode`, `translation-memory`, `deep-mode`, `pdf`,
  `domain-packs` and `code-comments`. Each id has at most one `featureAvailable` call site in `src/` (phase 2 test).
- [ ] The state machine's unit tests cover every row of the States table, the definitive-answer rule, the three
  clock-skew cases and the lock interleavings. Rate-limit, network and non-Polar answers never turn Pro off.
- [ ] Settings › Pro activates, shows the status, checks again, removes the license from this browser, and links to
  the customer portal. It works in English and Vietnamese with matching keys. It is hidden while nothing is gated
  and no record exists (phase 3).
- [ ] The manifest is unchanged: no `alarms`, no new host permission. `pnpm run check:manifest` passes as is.
- [ ] CI never calls a live Polar or Lemon Squeezy endpoint. The e2e suite routes the production URL to a local
  mock (phase 4).
- [ ] The privacy page and the store data-use answers list the license check as the one call besides the user's
  provider, worded as a list that M9 can extend. They say what it sends and when (phase 5).
- [ ] The owner's sandbox checklist is run and recorded, including the unverified past-due grace and a production
  validate with the shipped `benefitId` (phase 6).
- [ ] Pro goes on sale only when the launch condition below holds (phase 6).

## Release sequencing

<!-- Red Team: no release freeze; Updated: Validation Session 1 - Best held back if it misses the margin -->

- Licensing (phases 1–5) may merge to master before M7. Until phase 6, every registry entry is `gated: false`, so
  every feature is available, nothing is locked, and the License section is hidden. Master stays releasable for M7
  and M9 at any time.
- **The Pro sale goes live only once M7's Best mode beats Balanced by its margin**: M7 success criterion #1, at
  least the dimension's gate margin (≥ 0.2, `eval/gate.json`), mean of 5 runs, and the owner's blind sheet agrees.
- **If Best misses the margin, Best is held back from store releases until it passes.** It is never shipped free
  first, so nothing is taken back later. M7 owns keeping Best out of its releases. This plan's part is that Best
  is gated only in the launch release.
- Phase 6 is the launch. It turns `gated` on for `best-mode` and `translation-memory`, applies the store listing's
  pricing line, and confirms the privacy page's effective version.
- An M9 feature is gated in the M9 release that ships it, and only after phase 6 has run. The M9 plan flips its own
  registry entry in that release.

## Cross-Plan Dependencies

<!-- Red Team: M9 claim corrected; Updated: Validation Session 1 - shared gate contract amendments -->

| Plan | Relationship | What crosses | Contract |
|---|---|---|---|
| `m7-stronger-translation` (`plans/261013-0348-m7-stronger-translation/`) | Phase 6 is blocked by M7 phase 2 (the margin) and by the M7 phases that wire `best-mode` (phase 4) and `translation-memory` (phase 6). Phases 1–5 are not blocked | Two feature ids, checked at one M7-owned call site each: `best-mode` in `Jobs.start` (M7 phase 3), which awaits `featureAvailable('best-mode')` once and turns a `refine` request from `requestedStrategy(quality)` (M7 phase 4) into `contextual` when unavailable, and `translation-memory` in phase 6 | Gate contract items 1–7 above. M7 must: resolve both ids once at job start and store them on the job; make `Jobs.start` run `contextual` for `refine` from the mode, the override or an imported `quality` when `best-mode` is unavailable, with a unit test that phase 6 names as a launch gate; render Best as a disabled "(Pro)" option in the header select, with the note only beside it; and gate only similar-edit retrieval, keeping inline edits and exact-source reuse free. M7 also holds Best back from store releases if it misses the margin |
| `m9-beyond-v1` (`plans/261013-0345-m9-beyond-v1/`) | M9 consumes the check for four ids; nothing here waits on M9 | `deep-mode`, `pdf`, `domain-packs`, `code-comments`, one M9-owned call site each (M9 plan.md, the feature-id table) | Gate contract items 1–7. M9's plan.md already uses `featureAvailable` in `src/shared/features.ts` (corrected 2026-10-13). Its sync sites (`defaultEngine`, `jobs.ts:1311`; the strategy reads at `jobs.ts:916, 1419, 1489, 1604`; `extract` after the generation guard at `controller.ts:321-322`) read the value resolved at job start. M9 shows locks with `<ProLock>` and the `pro.locked` string ("Part of Pro"). M9's `define_term` ships off by default as a second disclosed outside call: it adds "dictionary lookups, only if you turn them on" to the list phase 5 writes |

From the first landing on, this plan owns the body of `src/shared/features.ts` and the registry, and M7 and M9 own
their call sites.

## Test matrix

<!-- Red Team: definitive answers, skew, lock interleavings, behavioural free check, allowedConsole -->

| Level | What | Where |
|---|---|---|
| Unit (vitest `shell` project, `vitest.config.ts:31`) | `licenseState` for every state and boundary (24 h, 7 d, `expiresAt`); the three skew cases by name (future `lastOkAt`, `lastCheckAt` ahead of now, `nextCheckAt` clamped); the definitive-answer rule (HTML 200, non-JSON 404, unknown error type are transient); lapsed re-check once a day up to 30 days; backoff; activate-first ordering (an invalid new key leaves the old record and makes no deactivate call); Remove interleaved between the refresh's re-read and its write (the `slow` fake in `src/shared/testing.ts`); a forced check waits for a running refresh; the stored record keeps no email or name; `entitlement` with gated and ungated ids | `src/shared/license.test.ts`, `license-polar.test.ts`, `features.test.ts` |
| Unit (static) | The registry has exactly the six ids; at most one `featureAvailable` call site per id in non-test `src/`; no call from `src/engine/**` or `content.ts` | `src/shared/features.test.ts` |
| Component (vitest, Preact) | The License section in each state, and hidden with nothing gated and no record; Activate errors; Remove offline asks first; `<ProLock>` renders one note and one link, no dialog; a locked select option shows "(Pro)" and is disabled; en and vi key parity | `src/entrypoints/options/License.test.tsx`, `src/entrypoints/sidepanel/ProLock.test.tsx`, `src/locales/locales.test.ts` (exists) |
| E2E (Playwright, mock license server) | Activate from a seeded record; revoke, then lapsed on Check now; a 503 or an HTML answer keeps it on (grace); device limit; portal deactivation, then Activate again; Remove; `allowedConsole` for the expected errors; no license call, and no lock outside `allowedLocks`, in any non-opted test | `e2e/license.spec.ts`, `e2e/fixtures.ts` teardown |
| E2E (behavioural free check) | A walk through the README features with no license. Phase 4 records the baseline; phase 6 compares it before and after the flip | `e2e/free-features.spec.ts`, `e2e/free-baseline.json` |
| Owner sandbox (manual, local) | The real Polar lifecycle: past-due grace (unverified), reinstall, portal deactivation, and a production validate with the shipped `benefitId` | phase 6 checklist, results in `docs/progress/progress-pro.md` |

## Constraints

- The repo is public. Never commit a license key, a customer email or name, or `.env` contents. The org id, benefit
  id, checkout URL and portal URL are public config and are committed.
- No new permission and no `alarms`. Checks are lazy. The manifest check stays as it is.
- The license record lives in `storage.local` only, never in sync, and is **never exported**, even with "include
  keys" (see Key decisions).
- License calls are made from extension pages or the worker, never from the content script, which runs with the page's origin.
- No telemetry, and no license data in the diagnostics log.
- Conventional commits, with no plan ids or phase numbers in code, test names or commit messages (`.claude/rules`).

## Key decisions

1. **Provider: Polar, behind a three-method adapter.** `LicenseProvider { activate, validate, deactivate }` plus
   its public URLs live in one file (`src/shared/license-polar.ts`). If phase 1 fails, phase 2 writes
   `license-lemonsqueezy.ts` instead (form-encoded, `meta.store_id`/`product_id`/`variant_id` checks), not both.
   The record carries `provider`, so a later switch can still read old records.
2. **Sandbox in dev builds, production in the store build.** The adapter picks its config with
   `import.meta.env.DEV`, which the code already uses (`src/entrypoints/sidepanel/App.tsx:305`). There is no new build mode.
3. **Export never includes the license.** A license is one browser's activation: copying its `activationId` would
   let two browsers share one slot, and removing it on one would break the other. The user can always get the key
   again from the receipt email or the customer portal. The code already leaves it out structurally:
   `buildExport` reads only `secret:<connectionId>` items (`src/shared/portable.ts:172-176`), and an import writes
   only those (`:572-585`). Phase 5 documents this and adds a test.
4. **The gate is a per-id `gated` flag plus the license state.** No global "sale live" switch exists. Each id
   defaults to `gated: false` (available) until its launch. The License section's visibility comes from the same
   registry: it is shown when some id is gated or a record exists.
   <!-- Red Team: License section visibility -->
5. **The locked state is quiet.** A locked option in a shared select is disabled with a "(Pro)" suffix, and the
   `<ProLock>` note ("Part of Pro" and one link to Settings › Pro) shows only beside that control. There are no
   dialogs, banners, badges or repeated notices, and the price is not shown in the extension (the checkout page
   shows it, so a price change needs no release).
   <!-- Updated: Validation Session 1 - locked option rule -->
6. **The privacy notice is shown again to every user once licensing ships** (version 2 → 3,
   `src/entrypoints/sidepanel/privacy.ts:12`), because `docs/privacy.md:18` promises that a change to what it
   describes re-shows the notice. The owner accepted this default.
   <!-- Updated: Validation Session 1 - notice re-shown -->
7. **The gate is M7's contract**, amended as in "Gate contract" above. It takes no `api`, so the testable core is
   `entitlement(api, id, opts)` in the same file, and `featureAvailable` wraps it with WXT's `browser`.
8. **3 activations per key; the store's PII box stays unticked**, because the email in Polar's answer is discarded
   on the device. Both are owner-accepted defaults.
   <!-- Updated: Validation Session 1 - owner defaults -->
9. **Activate first, then free the old slot.** A failed activation changes nothing at Polar or in storage.
   <!-- Red Team: activate-first -->

## Key risks

<!-- Red Team: risks updated for findings 1, 5, 6, 7, 8 -->

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Polar payout onboarding refuses an individual in Vietnam (Stripe Connect Express self-serve countries exclude VN) | Medium | High | Phase 1 gate before any code; Lemon Squeezy fallback through the one-file adapter |
| A captive portal, a proxy or a misconfigured `benefitId` makes paying users look revoked | Medium | High | Only JSON in Polar's recorded shape is definitive; lapsed is re-checked daily for 30 days; production validate in phase 6 row 12 |
| A Polar outage longer than 7 days locks paying users out | Low | High | Lock only on a definitive answer. The kill switch (every `gated: false`) is a patch release, and it goes through store review, which takes days. The 7-day grace covers most of that time |
| A stale refresh writes `granted` after the user pressed Remove | Medium | Medium | Activate, Remove and forced checks take the same queued lock; the refresh re-reads and writes inside it; a unit test interleaves Remove between re-read and write |
| A mistyped second key destroys the working activation | Medium | High | Activate first, deactivate the old one only after success; unit test |
| Leaked or indistinguishable slots lead to `device-limit` or to freeing the wrong browser | Medium | Medium | Activation label carries the activation date; `deactivated` state with "Activate again"; sandbox rows for reinstall and portal deactivation |
| Clock skew freezes checks or extends grace indefinitely | Low | Medium | Skew rule: a skewed record is due at once, and if that check fails it is `unconfirmed` (off); `nextCheckAt` clamped to ≤ 12 h |
| Validate's response during past-due is unverified | Medium | Medium | The seller grace is set to 7 days (phase 1), and the owner tests past-due in the sandbox (phase 6). If validate stops answering `granted` during dunning, Pro turns off until the payment succeeds. Phase 6 records this and words the `lapsed` text to fit |
| Polar's 403 body may not tell device limit from revoked | Medium | Low | Telling them apart is a phase 1 pass condition. If the bodies are the same, 403 maps to one view whose text covers both causes |
| Playwright may not route the CORS preflight to the mock | Low | Medium | Phase 4 spikes it first; fallback is `route.fetch` to the mock license server, which answers `OPTIONS` |
| The Vietnamese strings are an agent draft | High | Low | A native reader signs off in phase 6 |

## Rollback

- Phases 2–4 are additive and every entry is `gated: false`, so reverting their commits restores v1 behaviour. A
  stray `license` item in `storage.local` is harmless to a build without the module.
- Phase 5 is docs and a notice version. Revert the docs together with the code. Lowering the notice version again
  re-shows the notice once, because the acknowledgement must match the version exactly
  (`src/entrypoints/sidepanel/privacy.ts:16`). That costs one click and is harmless.
- Phase 6 (launch): set every `gated` to `false` in a patch release. Pro features become available to everyone,
  and nobody is locked out. The store listing returns to "free". Store review delays this by days.

## Non-goals

- M7 and M9 features, and their call sites (they belong to those plans).
- A yearly plan, team licenses, refunds or coupons in the extension (configured in Polar if at all).
- Any server of our own, webhooks, or account login.
- Firefox licensing (Firefox stays free and is not in this plan).
- Obfuscation against forks (accepted in the brainstorm).

## Red Team Review

### Session — 2026-10-13

**Findings:** 10 (1 Critical, 4 High, 5 Medium). All 10 are accepted by the user.
**Report:** `plans/261013-0348-pro-subscription-licensing/reports/red-team-261013-1043-licensing.md`

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | Any 404 or non-`granted` 200 counts as definitive, and a lapse is never re-checked | Critical | Accept | plan.md (Data flow, States, risks), Phase 1 (pass conditions), Phase 2 (steps 3–4, tests), Phase 6 (row 12) |
| 2 | The "no store release with the License section" rule freezes master | High | Accept | plan.md (Release sequencing, decision 4), Phase 3 (step 2), Phase 4 (seeded records) |
| 3 | The Best gate is on the mode, so the strategy override and settings import bypass it | High | Accept | plan.md (Gate contract 3, Cross-Plan), Phase 6 (e2e, launch gate) |
| 4 | The teardown "no Pro lock" check fails once Best is gated in the header select | High | Accept | plan.md (Gate contract 5), Phase 3 (locked option), Phase 4 (`allowedLocks`), Phase 6 (default) |
| 5 | Activating a second key deactivates the working one first | High | Accept | plan.md (decision 9, risks), Phase 2 (step 3, test) |
| 6 | Slots leak, look the same in the portal, and a freed browser is told the subscription ended | Medium | Accept | plan.md (States `deactivated`), Phase 1 (fixtures), Phase 2 (label, mapping), Phase 3 (view), Phase 6 (rows) |
| 7 | Clock-skew rules contradict the formulas | Medium | Accept | plan.md (States), Phase 2 (step 3, tests) |
| 8 | The compare-and-set is not atomic, and `ifAvailable` makes Check now a no-op | Medium | Accept | plan.md (Data flow, risks), Phase 2 (step 3, tests), Phase 3 (Check now) |
| 9 | Async-only contract versus M9's sync sites; stale claim about M9 | Medium | Accept | plan.md (Gate contract 2, Cross-Plan; claim corrected) |
| 10 | The README acceptance test proves no behaviour, and phase 6 would break it | Medium | Accept | plan.md (criteria, test matrix), Phase 4 (steps 4–5), Phase 6 (re-run) |

## Validation Log

### Session 1 — 2026-10-13

| # | Question | Answer | Propagated to |
|---|---|---|---|
| 1 | What if M7's Best misses the margin? | Best is held back from store releases until it passes; it is never shipped free first. With the License section hidden until something is gated, the release-freeze rule is removed | plan.md (Release sequencing, Cross-Plan), Phase 3 (step 2), Phase 6 (risks) |
| 2 | What exactly does `translation-memory` gate? | Only similar-edit retrieval into prompts. Inline editing and exact-source reuse of edits are free | plan.md (Gate contract 4, Cross-Plan), Phase 2 (registry comment), Phase 6 (launch checks) |
| 3 | How should the privacy claim handle M9's `define_term`? | It ships off by default and is a second disclosed outside call. Phase 5 words the claim as a list M9 can extend ("the license check, and dictionary lookups only if you turn them on") | plan.md (criteria, Cross-Plan), Phase 5 (steps 1–3) |
| 4 | Defaults the owner did not object to | 3 activations per key; the privacy notice is re-shown to every user once licensing ships; the store PII box stays unticked (the email is discarded on the device) | plan.md (decisions 6 and 8), Phase 1 (step 2), Phase 5 (steps 2 and 5) |
| 5 | Shared gate contract amendments, agreed across the three plans | Resolve once at job start; `best-mode` gates `refine` from every source; a locked select option is disabled with "(Pro)", with the note only beside it | plan.md (Gate contract, Cross-Plan), Phases 2, 3 and 6 |

### Whole-Plan Consistency Sweep

- **Superseded terms searched** in plan.md and every phase file: "release freeze", "No store release", "v1.0.0 tag",
  "follow-up validate", "first tries to deactivate", "deactivate it (best effort)" before activation, "ifAvailable"
  on forced checks, "subscription has ended" for a freed slot, "free-features.test.ts", "COVERAGE", and "isEntitled".
  What remains is either an explanatory marker, this log, or a use that is still correct:
  - "best effort" is the deactivation of the old slot after a successful activate;
  - `ifAvailable` is used only by the lazy refresh;
  - "subscription has ended" appears only for the `lapsed` state and the revoke row.
- **Renumbered references:** Unresolved questions were renumbered to 1–3. Phase 1 step 5 now points to question 1
  and phase 6 row 10 to question 2.
- **Reconciled:**
  - every phase now uses `featureAvailable` in `src/shared/features.ts`;
  - the License section is hidden until some id is gated or a record exists (Phases 3, 4 and 6 agree);
  - `ifAvailable` is used only for the lazy background refresh (Phase 2 step 3 and Data flow agree);
  - the e2e free check is behavioural (Phase 4 creates it, Phase 6 re-runs it; `tests/free-features.test.ts` is gone
    from ownership and the test matrix);
  - the README Pro note added at launch sits outside the feature table, so the walk's row list is unaffected;
  - the phase 2 effort went from 1d to 1.25d, and the total from 4d to 4.25d;
  - the former Unresolved questions 1–4 are answered in Validation Session 1;
  - Phase 6 Part A uses a local, uncommitted gated flag so the hidden License section is reachable, and row 12
    (production) runs after the launch flip;
  - privacy and notice wording no longer says "nothing else is sent" anywhere M9's opt-in lookup would make false.
- **Unresolved:** see below. None of them blocks phases 1–5.

## Unresolved questions

1. Do Polar sandbox endpoints answer CORS `*` like production? [UNVERIFIED]; phase 1 checks.
2. Does a resubscription reuse the same key or issue a new one? It decides whether "Check again" in the `lapsed`
   state can succeed. Phase 6 checks it in the sandbox.
3. Do Polar's 404 bodies tell "activation freed" from "key revoked"? If not, the `deactivated` state cannot be told
   apart, and `lapsed` offers "Activate again on this browser" as its primary action instead (phase 2 step 4).
   Phase 1 records the answer.

<!-- slug: pro-subscription-licensing -->
