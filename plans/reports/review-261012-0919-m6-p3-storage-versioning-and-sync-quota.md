# Review: storage versioning and sync quota (round 1)

Scope: `git diff b8ddad4..m6` in ../translate-side-m6, which holds commits 71664c0 (feat) and fa59c68 (test).
The reviewer only read the code and ran the affected unit suites: 36 files and 595 tests, all passing.

## Verdict

The committed code has **no blocking findings**. The sync overflow, the single quota guard, the listener
moves, the locked compare-and-set migration, the fixtures and the cache test all match the phase file's
Design section and steps 1 to 6.

The phase **cannot be accepted yet**. Steps 7 and 8 are not committed: `e2e/upgrade.spec.ts`,
`scripts/e2e-upgrade.mjs`, `pnpm run e2e:upgrade`, and the real-Chromium quota flow. That leaves
§7 demo 3 and 4 and the real-Chrome half of §3 #8 without evidence. The working tree has uncommitted
`e2e/` edits, which suggests this work is in progress. I will review it when it is pointed to.

## Non-blocking findings

**N1. The migration runner applies only one writing step per run.** (`src/shared/migrate.ts:74-82`)
- Cause: after a step writes `{...patch, schemaVersion: N}`, `items` is merged with `patch` only, so
  `items.schemaVersion` keeps the old value.
- Failure scenario: a later build adds a step 2 with a non-empty patch, and storage is at version 0.
  1. Step 1 writes version 1.
  2. Step 2's compare-and-set guard compares the stored 1 with the expected `undefined`. It writes nothing.
  3. `migrateAgain` returns storage at version 1 as though another runner had migrated it.
  4. The caller gets settings without step 2. Step 2 lands only on the next read.
- Violates: plan step 2, "ordered, idempotent steps". It is latent today because `MIGRATIONS` has a single step.
- Fix: set `items[versionKey] = step.version` after a successful write. Add a two-step test.

**N2. Any sync write error turns a list into overflow.** (`src/shared/sync-quota.ts:89-95`)
- The catch also takes errors that have nothing to do with size, such as
  `MAX_WRITE_OPERATIONS_PER_MINUTE` or a transient failure.
- Failure scenario: a burst of site-list edits hits the write-rate limit.
  - The list moves to `storage.local`, and Options shows "Too large to sync".
  - Until the next save that fits, sync edits from other devices are ignored on this device.
- The design says overflow happens "when a save would not fit". No data is lost, but the device diverges for no stated reason.
- Suggestion: fall back only on quota errors, or say why in the notice.

**N3. `saveRouting` is no longer a single write.** (`src/shared/providers.ts:503-508`)
- The site rules are saved first, then the routing item. The old guarantee, "the two never disagree after
  a failure half way", is gone.
- Failure scenario: the routing write fails, for example on the rate limit. The new rules are then stored next to the old routing.
- The routing's `assertFits` runs before the rules are saved, so it checks the total against the old rules.
- Impact is low because a rule only names a profile. The doc comment should say that the two writes are separate.

**N4. The notice does not state the accepted limit.** (`src/shared/sync-quota.ts:27`)
- The Design says: "while a device is in overflow, sync edits made elsewhere to that list are not merged
  into it. The UI notice says so."
- `OVERFLOW_NOTICE` is the plan's exact wording. It says other devices keep the last synced version, but not
  that their edits stop reaching this device. The plan contradicts itself here, so the supervisor should decide.

**N5. Plan IDs appear in new code comments and a test name.**
- `src/shared/migrate.ts:1` and `src/shared/sync-quota.ts:1`: "plan M6-E6".
- `src/shared/settings.test.ts:183`: a describe name containing "(plan M2-E6)".
- `src/entrypoints/sidepanel/translator.test.ts:25`: a rewritten comment containing "(plan M5-E3)".
- Violates: plan.md:81 and the constraints in the goal. The phase 1 review handled this the same way (N4 there). It is a trivial rewording.

**N6. A comment is stale, and reads are now serialized.** (`src/entrypoints/options/Options.tsx:64-65`)
- The comment says "A read already in flight is shared (providers.ts migrateProviders)". Reads are no longer
  shared. Each `readProviderSettings` call now waits for an exclusive cross-context Web Lock.
- The comment's conclusion still holds: a later read sees the change.
- Every route resolution in the panel now queues behind reads in Options and the worker. Each holder does
  only a few storage gets, so this is acceptable, but the implementer should know about it.

**N7. Two deviations should be reported.** (`src/shared/portable.ts:60-61`)
- `MAX_GLOSSARY` was raised from 500 to 5000. The implementer flagged this one.
  - Judgement: acceptable. Demo 4 and the 1,000-entry round-trip need it.
  - 5,000 entries at the maximum lengths are about 2.7 MB, well under the 10 MB limit of `storage.local`.
- `MAX_SITE_RULES` was raised from 200 to 1000. The implementer did **not** flag this one.
  - It is needed for the 300-rule round-trip test, and it is acceptable for the same reason.
  - It must be listed as a deviation in the phase report.

## Known items judged

- **"M2 equals M3" is false; `m3.json` covers M2.** The README's corrected statement holds.
  `git diff 55327d3 4524123 -- src/shared/settings.ts` shows no change to `prefs`, `glossary` or `secret:*`,
  only the `SECRET_PREFIX` refactor. M3 adds only device data: `spend` and `privacyNotice` in local, and snippet
  records in session. No migration reads that data, and `m3.json` includes it.
- **`MAX_GLOSSARY`:** see N7.

## Verified without findings

- **Overflow follows the Design:**
  - A list that fits is written to its M5 sync key.
  - An overflow writes the list and `overflow:<key>` in one `local.set`.
  - Sync keeps the last value that fit.
  - Reads prefer local while the marker is set.
  - A list that shrinks goes back to sync and clears both local keys.
  - Nothing is written to sync for the overflow: no pointer, chunk or index item.
- **The four quota guards are gone:**
  - `checkQuota` is replaced by `assertFits` at every caller.
  - The glossary guard, the inline import check and `SYNC_ITEM_BYTES` are deleted.
  - The glossary, `siteRules` and both site lists use `saveListWithOverflow` and `readList`. Import and export do too, through the readers.
- **Every listener in "Starting point" is moved:**
  - `onProviderSettingsChanged`, which follows `siteRules` through `onListChanged`, replaces the `isProviderKey` listeners in Options, Providers and translator.
  - The never-list listeners in controller and translator use `onListChanged`, as do the Options site lists.
  - App.tsx listens to all three areas.
  - No direct sync read of a list key is left.
- **Migration:**
  - It runs under `navigator.locks` with the read inside the lock.
  - Writes are compare-and-set, guarded by the version.
  - A fresh device writes nothing, a newer version is left untouched, and a per-context queue is the fallback.
  - Only extension contexts call it (worker, panel, options), never a content script, so the lock is not shared with a page's origin.
  - Nothing inside the lock takes it again, so it cannot deadlock.
  - Compare-and-set over chrome.storage cannot be atomic. The remaining window is one await and covers only keys that were absent.
- **The two-device test:** an M5-shaped device B keeps reading and editing the synced glossary while A overflows.
  Neither loses data.
- **Fixtures and the cache test:**
  - Every `secret:*` value is `sk-test-fixture-<n>`.
  - `no-real-keys.test.ts` lives under `tests/**`, which the vitest projects include, so it runs in `pnpm check`.
  - `cache.test.ts:171` covers database version 1 surviving a reopen.
- **No production test hooks:** `src/shared/testing.ts` is imported only by test files.

Status: DONE_WITH_CONCERNS
Summary: The committed work has no blocking findings and seven non-blocking ones. Acceptance waits on steps 7–8 (the e2e upgrade and the real-Chrome quota flow), which are not yet committed.

## Unresolved questions

- N4: should the notice also say that edits from other devices stop reaching this device? The plan's exact wording omits it.

## Round 2 (8706b7d, 22fb5b6, 34ece14)

There are **no blocking findings**. N1–N6 are resolved, and steps 7 and 8 match the plan. The unit tests pass:
51 files, 797 tests.

- **Fixes (22fb5b6):**
  - Each migration step now carries its version, and a test with two writing steps covers it.
  - A list overflows only on Chrome's space errors. The write-rate limit is reported as a save error, and a test covers it.
  - The routing quota check runs after the site rules are saved, and the two writes are documented.
  - The notice now states that edits from other devices stop reaching this device.
  - The plan IDs and the stale comment are removed.
- **Step 8 (8706b7d):** in real Chromium, a 1,000-entry glossary is saved through Options (import, then the form).
  - It stays on this device with the notice, and sync keeps the seeded empty list.
  - The next translate prompt contains the probe term.
- **Step 7 (34ece14):** the M3 build (4524123) is upgraded in place to the current build.
  - The M3 build is made in a temporary worktree and run from one fixed directory with a copied manifest.
  - Calls to the APIBOX host go to the mock.
  - The test seeds `m3.json` through the worker and fills the cache before the upgrade.
  - After the reload, `reason` is `update`, every seeded key is unchanged, the cached page makes zero provider calls, and there are no console errors.
  - It is excluded from CI.

Residual, non-blocking:
- **R1** (`src/shared/migrate.ts:82`): the version is added to `items` even when the step's write failed.
  - Failure scenario: a later step also writes. Its guard then mismatches, and that run returns settings
    marked as the latest version without either patch.
  - It is latent because there is only one step today.
  - Fix: add the version only after a successful write.

Still to record: the console output of `pnpm run e2e:upgrade` in the phase report.

## Round 3 (5184a29, e8d26a7, and the upgrade mechanics)

There are **no blocking findings**. From the review side, phase 3 can be accepted.

**5184a29 (fix for R1)**
- `stored` now tracks what sync really holds and is the compare-and-set expectation. A failed step's patch
  stays in `pending` and is written with the next step's.
- The case that was wrong in round 2 is now correct: step 1's write fails, step 2 writes both patches, and the
  version becomes 2. The new test covers it.
- If the last step's write fails, the run still returns the migrated view and the next run tries again. That
  matches the documented contract.
- The migration and provider tests passed when I ran them: 78 tests. The full suite was run by the implementer (see the report).

**e8d26a7 (phase report)**
- The report records the `e2e:upgrade` output: 7 calls, then 0 calls after the upgrade, `reason: "update"`,
  and every kept and added key.
- It lists the deviations (import caps, the M2/M3 claim, two writes in `saveRouting`, no site rules seeded for
  M3) and the review rulings.
- It contains no home paths or usernames. The temporary path is shortened to `<tmp>`.

**The upgrade mechanics have no production hook**
- `src/`, `wxt.config.ts` and `background.ts` contain no reference to `developerPrivate`, the probe or the
  debug port.
- The `onInstalled` listener is added only through the test's CDP session.
- The extra host permissions go only into the test's copy of each manifest.

**The mechanics are reliable enough for a recorded local demo**
- The watcher attaches before the reload. On the worker's session, the breakpoint, the run and the evaluation
  are sent in order, and every other target is released at once.
- The listener is added before the worker's script runs, so it is in place before Chrome dispatches
  `onInstalled`.
- `developerPrivate` is a private API, but the run uses Playwright's pinned Chromium, and the API is used only
  on `chrome://extensions`, as a user would.
- Its weak points can only cause a failed run, never a false pass:
  - an API change in a later Chromium;
  - the probe poll timing out after 5 s;
  - the cache settling being a heuristic (a stable row count every 500 ms).

**One caveat for the demo narrative.** The `reason: "update"` comes from reloading the swapped build.
`previousVersion` is 0.0.1, and both builds have version 0.0.1, so no version bump was exercised. The
substantive evidence is the build swap under the same extension id, with storage and IndexedDB kept. For the
release build's version change, Chrome's storage behaviour is the same. Say so if the demo claims a
"version upgrade".
