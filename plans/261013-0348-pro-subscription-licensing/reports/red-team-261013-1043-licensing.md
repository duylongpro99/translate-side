# Red team: Pro subscription licensing plan

Plan: `plans/261013-0348-pro-subscription-licensing/` (plan.md, phase-01..06). Date 2026-10-13.
Accepted decisions not argued: v1 free, Pro $5/month, BYOK, no server, only new M7/M8 features gated, no beta grant.

## Finding 1: A "definitive negative" is any 404 or any 200 without `granted`, and a lapse is never re-checked

**Severity:** Critical

**Location:** plan.md States and the text under it (:99, :102-103); phase-02 step 3 `needsCheck` (:78-79), step 4 mapping (:117-122); plan.md Key risks (:203).

**Flaw:** The adapter treats the HTTP status alone as the provider's verdict. "validate 404, 200 not `granted`" maps to `revoked`, and that turns Pro off "at once". `lapsed` is "never re-checked automatically", so it stays until the user clicks Check again. Nothing checks that the response came from Polar: no content-type check, no check of the error body's shape, and no rule for a 200 whose body is not JSON. The kill switch is "a one-line patch", but it still has to pass Chrome Web Store review and auto-update before users get it.

**Failure scenario:**
- A hotel or airport captive portal, or a corporate TLS-inspecting proxy, answers `api.polar.sh` with a 200 HTML login page, or with its own 403/404. The user goes from paid Pro to "Your Pro subscription has ended" and stays there.
- A wrong `benefitId` in the production config can't be tested in CI, because CI uses the mock. The same happens if Polar renames or versions `/v1/customer-portal/license-keys/validate`. In either case every paying user's first check after 24 h writes `verdict: revoked`. Nobody is re-checked, and the fix has to go through store review, which takes days.

**Evidence:** phase-02:79 says "`lapsed` and `device-limit` are never re-checked automatically". phase-02:118 maps "validate 404, 200 not `granted`, or a `benefit_id` mismatch → revoked". researcher:62-64 notes that 404 covers many causes. plan.md:203 calls the kill switch "a one-line patch", which ignores review latency. phase-01 step 4 (:44-53) records success and failure bodies, but phase 2 never requires the adapter to match them.

**Suggested fix:**
- Count a response as definitive only if it is `application/json` and matches the recorded Polar shape: a validated-key object with `status`, or Polar's error envelope with a known error type for 404/403.
- Treat everything else, including HTML, a parse failure and an unknown error type, as `transient`.
- Re-check `lapsed` lazily, at most once a day, for 30 days. A false revoke then fixes itself.
- Add a production smoke step in phase 6 Part A row 10 that validates with the shipped `benefitId`.

## Finding 2: The "no store release with the License section" rule freezes master for M7 and M8 releases

**Severity:** High

**Location:** plan.md Release sequencing (:128-139); phase-03 step 2 (:65-66, "It is always rendered").

**Flaw:** Phases 1-5 may merge before M7, and the License section is always rendered. So no store release can come from master until phase 6, and phase 6 waits on the M7 margin and on the owner's "launch". The sibling plans assume they can ship before that.

**Failure scenario:**
- M7 misses the margin, and its plan offers to "ship Best in v1.1 anyway (not sold)". That v1.1 is built from master, which now has a License section selling nothing, and the rule forbids the release.
- M8 phases "merge or release an accepted phase without waiting for the others" from the same master and hit the same block.
- The only escape the plan offers is cutting from the `v1.0.0` tag, which drops every M7 and M8 commit. In practice the result is either an indefinite release freeze or someone quietly breaking the rule.

**Evidence:** plan.md:136-139. phase-03:66. M7 plan.md:84 ("ship Best in v1.1 anyway (not sold)") and :51 (the owner decides the sale). M8 plan.md:31 (release an accepted phase independently).

**Suggested fix:** Render `<LicenseSection>` only when `Object.values(PRO_FEATURES).some((f) => f.gated)` or a `license` record exists. This is the same registry that phase 6 flips. Then delete the freeze rule and the v1.0.0-tag workaround. Phase 4's e2e can opt in with an injected registry, or by seeding a record.

## Finding 3: The Best gate is on the mode, so M7's advanced strategy override and settings import bypass it

**Severity:** High

**Location:** plan.md Cross-Plan Dependencies (:145, "only producing new Pro output is" gated); phase-06 Part B steps 1-2 (:52-59).

**Flaw:** In M7, Best means mode `best` → strategy `refine`, but an advanced override "picks any of the three directly". The override lives in the sync item `quality` and is exported and imported. The licensing plan says it owns gating and the locked-path e2e, yet it never says the gate has to apply to the resolved strategy `refine` rather than to the mode `best`. Its launch tests cover only "the Best control is disabled".

**Failure scenario:** An unlicensed user opens Options › Quality › Advanced, picks the `refine` strategy, and gets Best output for free. The same happens if they import a settings file containing `"quality": {"strategy": "refine"}`. No forking or DevTools is needed, so this is not the accepted "forks can remove it" case. It is a gate hole in the shipped UI.

**Evidence:** M7 phase-04:24-25 ("An advanced override picks any of the three directly"). M7 phase-04:43-46 (`quality` goes into the export). M7 phase-04:53 (`strategyFor(quality, await featureAvailable('best-mode'))`, which does not say whether the override is gated). Licensing phase-06:56-59 tests only the header control.

**Suggested fix:**
- State in the contract table that `best-mode` gates the strategy `refine` wherever it comes from: the mode, the override, or an import.
- Add a phase 6 e2e: no license, override `refine`, and the job runs `contextual`.
- Add a unit test in M7's `strategyFor` that licensing names as a launch gate.

## Finding 4: Phase 4's teardown check "no Pro lock" cannot hold once phase 6 gates the always-visible header control

**Severity:** High

**Location:** phase-04 step 6 (:88-89); phase-06 Part B step 2 (:56-59); phase-03 Requirements (:35-37) and step 3 (:70-73).

**Flaw:**
- Phase 4 makes every test without the license fixture fail if any `[data-pro-lock]` is visible.
- M7 keeps Best listed in the always-visible header `quality-mode` select. Phase 6 expects the unlicensed Best control to show "Part of Pro", and `<ProLock>` renders a span whenever the feature is unavailable.
- After the launch flip, every unlicensed panel e2e test therefore ends with a visible lock and fails.
- Phase 3 also says "the call site disables its own control". Best is an `<option>` of a shared `<select>`, so disabling "its control" either disables Fast and Balanced too, or puts a lock span beside the select permanently. That contradicts "the panel's translation flow never shows it unless the user reaches for a Pro control".

**Failure scenario:** On launch day the phase 6 change turns the whole e2e suite red. The likely "fix" deletes or weakens the teardown assertion, and with it the plan's main no-lock guarantee.

**Evidence:** phase-04:88-89. phase-06:57 ("unlicensed: the Best control is disabled with 'Part of Pro'"). M7 phase-04:41-42 ("When Best is unavailable, the header still lists it"). M7 phase-04:69 (the select sits beside `style-mode`, `HeaderControls.tsx:55`). phase-03:70-73.

**Suggested fix:**
- Define the locked UI for a select option: the option is disabled with the suffix "(Pro)", and the `<ProLock>` note appears only when the user picks it, or in Options.
- Narrow the teardown assertion to "no lock for a feature the test did not touch", using an allow-list per spec.
- Write this into the contract table so M7 builds it.

## Finding 5: Activating a second key deactivates the working one before the new one is proven

**Severity:** High

**Location:** phase-02 step 3 `activateLicense` (:89-95).

**Flaw:** "If a record for another key exists, it first tries to deactivate it (best effort)." On `invalid` or `transient` it "writes nothing". Order of operations:
1. Deactivate the old activation at Polar.
2. Activate the new key, which fails.
3. Leave the old record, whose activation id is now dead, in storage.

**Failure scenario:** A user in `lapsed` (or someone who just wants to retype the key) pastes a mistyped key, or is offline. Their real activation is deleted at Polar. The next validate returns 404, because the activation no longer matches (researcher:62-63). The verdict becomes `revoked`, and the user sees "Your Pro subscription has ended" on a paid subscription. "Check again" re-sends the dead activation id and keeps failing.

**Evidence:** phase-02:93-95. researcher:62-63 (validate answers 404 when "the activation does not match"). phase-03:58-59 (the `lapsed` view offers "a field to enter another key").

**Suggested fix:**
- Activate the new key first. Deactivate the old one only after a successful activate, then write the new record with a compare-and-set.
- Add a unit test: an invalid new key leaves the old record and its activation untouched, and makes no deactivate call.

## Finding 6: Slots leak, look identical in the portal, and a freed browser is told the subscription ended, which "Check again" can't fix

**Severity:** Medium

**Location:** phase-02 step 4 (:115, the fixed label), step 4 mapping (:120-121); plan.md States `device-limit` (:100) and Key risks (:206); phase-03 `lapsed` and `device-limit` views (:58-61).

**Flaw:**
- **Slots leak.** Uninstalling, resetting the profile or clearing extension data deletes `storage.local` but not the Polar activation. With 3 slots, a few reinstalls cause `device-limit`.
- **Slots look identical.** The fix is "free a slot in Manage subscription", but every activation has the same label, "Translate Side (Chrome)". The user can't tell the dead slot from a live browser.
- **A freed browser is told the subscription ended.** The live browser whose slot is freed gets a 404 on its next validate, is mapped to `revoked`, and shows "Your Pro subscription has ended". "Check again" can never succeed there, because it re-validates the dead activation id. Only Remove plus re-activate recovers.
- **The 403 fallback can't work.** The plan's way to tell device-limit from revoked on a 403 is "one validate". After a refused activate there is no `activation_id`, and a key with a limit must send one on every validate (researcher:65-66).

**Failure scenario:** A user reinstalls the extension twice, hits `device-limit`, opens the portal, sees three identical "Translate Side (Chrome)" rows, and frees the wrong one. Their laptop then says the paid subscription "has ended", with a Check again button that never works.

**Evidence:** phase-02:115 (the fixed label). phase-02:120-121 and plan.md:206 (the validate fallback). researcher:62-63, :65-66. phase-03:58-61. phase-06 Part A (:36-48) has no reinstall or portal-deactivation row.

**Suggested fix:**
- Use a label that is not identifying but tells slots apart: `Translate Side (Chrome) · activated 2026-10-13`. The date is already in `activatedAt`.
- Map a validate 404 where the key itself is still valid, but the activation is gone, to a new `deactivated` state. Its action is "Activate again on this browser", which runs an activate, not a validate. Phase 1 can capture a fixture for this: validate after deactivating in the portal.
- Drop the "follow-up validate" fallback and record the 403 body difference as a phase 1 pass condition.
- Add Part A rows for reinstall and for deactivation in the portal.

## Finding 7: The clock-skew rules contradict each other, and the formulas freeze checks or extend grace indefinitely

**Severity:** Medium

**Location:** phase-02 step 3 (:76-82); plan.md States `active` and `grace` (:96-98).

**Flaw:**
- **Prose and formulas disagree.** The prose says a future `lastOkAt` "counts as stale". But `needsCheck` requires `now − lastOkAt ≥ FRESH_MS`, and with a future `lastOkAt` that difference is negative, so no check ever fires. `active` requires `now − lastOkAt < 7 d`, and a negative difference always passes.
- **Backoff also freezes.** `nextCheckAt` is computed from a wrong clock. If it lands in the future, later corrected time leaves `nextCheckAt ≤ now` false for as long as the skew lasted.
- **Grace is never bounded by `lastCheckAt`.**

**Failure scenario:**
- (a) A machine with its clock a year ahead (a dead CMOS battery, a VM snapshot) validates and writes `lastOkAt` a year ahead. The clock is then corrected. For the next year `needsCheck` stays false, so a cancelled or refunded subscription is never detected.
- (b) A churned user blocks `api.polar.sh` in `/etc/hosts` and sets the clock back a week whenever Pro would turn off. Every check fails as transient, `now − lastOkAt` stays under 7 days, and Pro stays on with no code change. That is cheaper than the accepted fork bypass, and it needs no developer skills.

**Evidence:** phase-02:76-77 (future = stale), :78 (the `needsCheck` formula), :81 (backoff from `now`). plan.md:96-97.

**Suggested fix:**
- Define `age = now − lastOkAt`. If `age < −SKEW` (for example 10 min), the record counts as stale and due: `needsCheck` is true, and if that check fails, the state is `unconfirmed` (off), not `active`.
- Clamp `nextCheckAt` to at most `now + 12 h` when it is read.
- Add `lastCheckAt > now + SKEW` (a clock rollback) to the same stale-and-due rule.
- Add the three cases to the unit matrix by name.

## Finding 8: The compare-and-set is not atomic, and `ifAvailable` turns the user's Check now into a silent no-op

**Severity:** Medium

**Location:** phase-02 step 3 `refreshLicense`, `activateLicense`, `removeLicense` (:83-99); phase-03 step 1 (:45-46, :59).

**Flaw:**
- Only the refresh takes the `translate-side-license` lock. Activate and Remove write without it, so "re-read, then write if unchanged" is two awaits with a gap. A Remove that lands between the refresh's `get` and its `set` is overwritten, and the license comes back.
- Also: `ifAvailable: true` "returns at once if the lock is held", and that includes `{ force: true }`. When Settings' on-mount refresh, or a panel's background refresh, holds the lock, the user's "Check now" or "Check again" returns without validating and shows the stale state.
- The existing `withMigrationLock` that the plan cites queues instead of skipping.

**Failure scenario:** The user presses Remove in Settings while the panel's background refresh is between its re-read and its write. The `granted` record comes back, and Pro looks still active on a browser whose slot was just freed. Or: the user renews in the portal, comes back, and presses Check again while the mount refresh is in flight. Nothing happens, and they see "ended".

**Evidence:** phase-02:84-88 (only the refresh takes the lock, with `ifAvailable`). phase-02:89-99 (activate and remove take no lock). `src/shared/migrate.ts:26-32` (the cited pattern calls `locks.request(MIGRATION_LOCK, task)` with no `ifAvailable`). plan.md:204 claims the compare-and-set alone fixes the resurrection.

**Suggested fix:**
- Make Activate, Remove and forced checks take the same lock in queueing mode. Keep `ifAvailable` only for the lazy background refresh.
- Make the "slow" unit test interleave Remove between the refresh's re-read and its write, not only during `validate`.

## Finding 9: "The contract is unchanged" ignores M8's synchronous call sites, and the plan's claim about M8 is stale

**Severity:** Medium

**Location:** plan.md Key decision 7 (:194-196) and Cross-Plan Dependencies (:146); phase-02 step 2 (:50-70).

**Flaw:**
- `featureAvailable` returns only a Promise, and the licensing plan offers nothing synchronous.
- M8's chosen sites are synchronous. `domain-packs` goes in `defaultEngine`, a sync method that returns `TranslationEngine`. `deep-mode` replaces four sync `this.deps.strategy ?? PANEL_STRATEGY` expressions. `code-comments` goes in `extract`, where each await is followed by a `s.generation !== generation` re-check, and a new await opens a stale-generation race.
- Each M8 phase will invent its own way to hoist the value, which breaks "at most one call site per id" or adds races.
- plan.md:146 says M8 plan.md:87 "still proposes `isEntitled(api, feature)`… and must switch". It already uses `featureAvailable`, so the cross-plan claim was not re-checked.

**Failure scenario:** M8 phase 5 needs the gate in `defaultEngine`. It either turns the engine factory async, touching `jobs.ts:1296` and every engine test, or caches the boolean on the job at an unspecified point. A license change mid-job then leaves the gate decision and the `<ProLock>` display out of step.

**Evidence:**
- `src/entrypoints/sidepanel/jobs.ts:1311` (`private defaultEngine(...): TranslationEngine`, sync) and `:1296`.
- `jobs.ts:916, 1419, 1489, 1604` (sync strategy reads).
- `src/entrypoints/sidepanel/controller.ts:321-322` (an await followed by a generation guard).
- M8 plan.md:91-94 (the sites) and :87 (already `featureAvailable`).
- Licensing plan.md:146 (the stale claim).

**Suggested fix:**
- In the contract, add a rule: resolve entitlements once at job start, in the async job setup, into the `JobDoc` or job record, and pass them down. `featureAvailable` stays the single async source.
- Correct plan.md:146.
- Add an M8-facing note that sync sites read the job's resolved value, never call `featureAvailable` themselves.

## Finding 10: The "every README feature works without a license" acceptance test proves no behaviour, and phase 6 breaks it

**Severity:** Medium

**Location:** phase-04 step 5 (:74-87); plan.md Success criteria (:110-111); phase-06 step 4 (:65).

**Flaw:**
- The test checks that a title string exists in a file and that the file contains no `license:` text. It runs nothing. Before phase 6 every id is ungated, so the covering e2e tests cannot fail because of licensing at all.
- After phase 6, the real risk is a gate wired into a shared v1 path: `translation-memory` in `translator.ts`, `deep-mode` at strategy resolution. That risk is caught only if those e2e tests happen to assert output. The static map adds nothing to that.
- Phase 6 then adds a "Pro" row to the same README feature table. Under the "row set equals the map's keys" rule, that row must be mapped to a test showing it works without a license, which is the opposite of what the row means.
- The phase 4 503 and offline flows make Chromium log "Failed to load resource" errors. The harness fails a test on any console error unless that test sets `allowedConsole`, and phase 4 never mentions it.

**Failure scenario:** At launch, a gated id's call site returns the wrong fallback, for example memory examples `undefined` while the cache key still includes memory. Cached v1 translations miss and pages re-translate. The acceptance test stays green, because it greps strings. Separately, the README Pro row makes the test fail, or gets mapped to a fake entry.

**Evidence:**
- phase-04:76-87 (the map, file and title presence, the grep for `license:`).
- phase-06:65 ("Add one 'Pro' row or note under Features").
- `README.md:58-76` (the parsed table).
- `e2e/fixtures.ts:119` and `:165` (any console error fails the test unless allow-listed).
- phase-04:67 (the 503 flow).

**Suggested fix:**
- Replace the static map with a behavioural check: run the existing free e2e specs once with the launch registry (`best-mode` and `translation-memory` gated) and no license, before phase 6 merges, and assert their outputs are unchanged.
- Exclude a row marked Pro from the parser.
- Have `license.spec.ts` set `allowedConsole` for the expected 503, 404 and offline errors.

Status: DONE_WITH_CONCERNS
Summary: 10 findings. The Critical one: any non-JSON 404 or 200 from a portal or proxy, or a wrong production `benefitId`, permanently revokes paying users, because a lapse is never re-checked. The High ones: the License section blocks M7 and M8 releases; M7's strategy override and import bypass the Best gate; the no-lock teardown check fails once Best is gated; and activating a mistyped key destroys the working license.
