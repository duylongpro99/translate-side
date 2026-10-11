---
phase: 3
title: "Storage versioning and sync quota"
status: pending
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 3: Storage versioning and sync quota

<!-- Updated: Red Team 2026-10-11. No chunks and no sync pointer: the legacy sync item is kept, and an oversized
     list overflows to this device's storage.local. One quota guard replaces four. Every listener is covered.
     Migration is locked and compare-and-set. Shape fixtures use placeholder keys. Only M3 is built, for demo 3,
     from a fixed directory with route interception. The cache step is reduced to one test. -->

## Goal

Upgrading from any earlier build keeps every setting, the glossary, the site rules, the keys and the cache. A large
glossary or many site rules never make a save fail, and no device, including one still on M5, loses data.

## Plan tasks owned

- M6-E6: settings and cache schema versioning with migrations, and a sync quota guard.

## Done criteria (copied from docs/plans/M6-release-hardening.md)

- §2: "Upgrading from any earlier build migrates settings and cache without data loss." and "A large glossary or many
  site rules don't break sync storage."
- §3 #7: "Settings/cache migration from every earlier schema version | tested"
- §3 #8: "Sync storage over quota (synthetic large glossary) | no failure; falls back as designed"
- §5: "Sync quota strategy | Glossary and site rules move to `local` with a sync pointer (or chunked items) when over
  quota."

  This plan uses the `local` branch of that default without a pointer item. A pointer in sync reaches every device,
  and an index item conflicts with the existing sync design (`src/shared/providers.ts:31-32`).
- §7 demo 3 and 4: "Install an M3-era build with data; upgrade to v1.0; show settings, glossary and cache intact." /
  "Load a synthetic 1,000-entry glossary; show it still saves and syncs as designed."

Spec: DESIGN.md §4.3.1, §4.3.4, §7; ROADMAP §8 item 17.

## Starting point

- **Sync items.**
  - The glossary is one sync item, `glossary` (`src/shared/settings.ts:322-390`).
  - `siteRules` is one sync item owned by `providers.ts`: read at `:281`, written by `saveRouting` at `:504`, key
    defined at `:53`.
  - The site allow and never lists are sync items in `src/shared/sites.ts` (`editList` :136-146, `MAX_SITES` = 200).
  - The provider records are found by key prefix with no index item (`providers.ts:31-32`).
- **Four quota guards:**
  1. `checkQuota` (`providers.ts:403`; callers `providers.ts:448,460,486,505,524` and `portable.ts:640`);
  2. the glossary guard (`settings.ts:372-386`);
  3. an inline import check (`portable.ts:554-555`);
  4. `SYNC_ITEM_BYTES` in `sites.ts:24,143`.
- **Listeners that match exact keys:**
  - `providers.ts:67` (`isProviderKey`, used at `Options.tsx:67,580-581`, `Providers.tsx:110-112` and
    `translator.ts:579`);
  - `controller.ts:175-178` (`SITE_NEVER_KEY`, the never-translate stop);
  - `translator.ts:582-589` (never list, `GLOSSARY_KEY`);
  - `Options.tsx:374-376` (site lists).
- **Migration.**
  - `migrateProviders` (`providers.ts:338-388`) deduplicates per `api` object, so per context only. It runs from
    `onInstalled` (`background.ts:20-35`) and from every reader.
  - It writes only keys that don't exist yet (`:364`).
  - The per-device marker is `migratedRoute` in local storage (`:55,352-361`).
  - `schemaVersion` first appears at 6af810b (M4).
- **Existing shapes.** `scripts/eval/migration.ts:5-57` has M1 and M2/M3 shapes. It seeds real `.env` keys, which
  must not be copied into fixtures.
- **Cache.** IndexedDB at version 1 already has `onupgradeneeded` (`src/shared/cache.ts:149-155`). No schema change
  is planned.

## Design: sync overflow

- **While a list fits** within the per-item and total quota, it is written to its existing sync key, exactly as M5
  does. M5 devices keep working.
- **When a save would not fit:**
  - The full list is written to `storage.local` under the same key name, and a local marker
    (`overflow:<key>` = true) is set on this device.
  - The sync item keeps the last value that fit. Other devices keep the synced version and lose nothing.
  - Options shows: "Too large to sync. Changes stay on this device; other devices keep the last synced version."
- **Reads on this device** take the local copy when the marker is set, and sync otherwise.
- **When the list shrinks** to fit again, the save goes to sync and clears the marker and the local copy.
- **Accepted limit:** while a device is in overflow, sync edits made elsewhere to that list are not merged into it.
  The UI notice says so. Merging is out of scope.
- **One module,** `src/shared/sync-quota.ts`, owns the byte counting, `fits()`, `saveListWithOverflow()`,
  `readList()` and `onListChanged(key, cb)`. `onListChanged` watches both the sync key and the local key and marker.

## Steps

1. **Shape fixtures.** Write `tests/fixtures/storage/{m1,m3,m4,m5}.json` with the keys `{ sync, local, session }`.
   - **Sources:** `scripts/eval/migration.ts` scenarios (M1, M2/M3) and the source shapes at 6af810b (M4) and
     ae9f9fb (M5), with `file:line` citations in each fixture's README entry. M2 equals M3: there is no storage
     change between 55327d3 and 4524123 in `src/shared`, and the fixture README states this.
   - **Keys:** every `secret:*` value is a placeholder, `sk-test-fixture-<n>`.
   - **Test:** `tests/fixtures/storage/no-real-keys.test.ts` fails on any other value. It runs in `pnpm check`.
2. **Migration runner** (`src/shared/migrate.ts`).
   - **Ordering:** ordered, idempotent steps under the existing sync `schemaVersion`. Per-device state extends the
     `migratedRoute` marker, with no second version number. Step 1 is `migrateProviders`. New steps exist only
     where a stored shape actually changes.
   - **Locking:** the runner runs inside `navigator.locks.request('translate-side-migrate', …)` and re-reads the
     version inside the lock.
   - **Writes:** each write is compare-and-set against the value read in the lock. When there is no legacy data, it
     writes nothing; a fresh device must never write over data that sync has not yet downloaded.
   - **Newer versions:** a newer stored version leaves the data untouched.
   - **Callers:** `onInstalled` and the readers, as now.
3. **One quota guard.** Implement `sync-quota.ts` and replace all four guards:
   - `checkQuota` callers move to it;
   - the glossary guard in `settings.ts` is deleted;
   - the inline check at `portable.ts:554-555` is deleted, and the import goes through `saveListWithOverflow`;
   - `SYNC_ITEM_BYTES` in `sites.ts` is deleted.

   The glossary, `siteRules` (in `providers.ts` `saveRouting` and the reader) and the site lists all use
   `saveListWithOverflow` and `readList`.
4. **Listeners.** Move every listener above to `onListChanged`:
   - `providers.ts:67` `isProviderKey` and its consumers (`Options.tsx:67,580-581`, `Providers.tsx:110-112`,
     `translator.ts:579`);
   - `controller.ts:175-178`, `translator.ts:582-589` and `Options.tsx:374-376`.

   A test: adding the current site to the never list while a job runs stops that job, both in the sync layout and in
   overflow.
5. **Cache.** One test: segments stored at version 1 are still there after reopening. No code change.
6. **Unit tests** (CI, `pnpm check`). The fake storage enforces Chrome's limits: 8,192 bytes per item, 102,400
   total and 512 items. The tests:
   - **Shapes:** each fixture migrates with every meaningful value preserved, checked by deep compare.
   - **Concurrency:** two runners share one fake storage with interleaved awaits, and a save interleaves with the
     migration. No edit is lost.
   - **Fresh device:** a fresh device with empty sync writes nothing.
   - **Large lists:** a 1,000-entry glossary and 300 site rules save without error, read back identically on this
     device, and report overflow.
   - **Two devices** (one fake sync, two fake locals): A overflows; B, on the old M5 shape, still reads and edits
     its last synced glossary; neither loses data.
   - **Round-trip:** an M5 export imports, and a new export imports.
7. **Upgrade e2e** (`pnpm run e2e:upgrade`; run locally and recorded, not in CI).
   - **Old build:** build M3 (4524123) in a temporary `git worktree`. Load it from one fixed directory with the
     phase 2 harness (copied manifest). Its provider is a fixed APIBOX URL, so `context.route('https://api.ai-box.vn/**')`
     serves the mock SSE.
   - **Seeding:** through the worker: settings, glossary entries and site rules. Translate one fixture page to fill
     the cache.
   - **Upgrade:** overwrite the same directory with the current build, reload the extension, and assert
     `onInstalled` gave `reason === 'update'`.
   - **Assertions:** everything is intact, and the cached page translates again with zero calls on the intercepted
     route.
8. **Real Chrome quota.** In the e2e flows, save the 1,000-entry glossary through the Options UI in real Chromium.
   Assert no error, the overflow notice, and that the glossary is used by the next translation.

## Files

- **Create:** `src/shared/migrate.ts`, `src/shared/sync-quota.ts` and their tests;
  `tests/fixtures/storage/{m1,m3,m4,m5}.json`, its README and `no-real-keys.test.ts`; `e2e/upgrade.spec.ts`,
  `scripts/e2e-upgrade.mjs`.
- **Modify:**
  - `src/shared/providers.ts` (guard, siteRules, `isProviderKey`, migration hook-up);
  - `src/shared/settings.ts` (glossary);
  - `src/shared/sites.ts` (lists);
  - `src/shared/portable.ts` (import and export through the module);
  - `src/entrypoints/background.ts`;
  - `src/entrypoints/sidepanel/controller.ts` and `src/entrypoints/sidepanel/translator.ts`;
  - `src/entrypoints/options/Options.tsx` and `src/entrypoints/options/Providers.tsx` (listeners and the overflow
    notice).
- **Tests to update:** `providers.test.ts:155,414-427`, `Providers.test.tsx:402-458`, `settings.test.ts:186-239`,
  `Options.test.tsx:264` and `portable.test.ts`.

## Verification

- `pnpm check` is green, including the migration, quota, listener and no-real-keys suites.
- `pnpm run e2e` passes the quota flow.
- The `pnpm run e2e:upgrade` output is recorded in the phase report: the M3 → current upgrade keeps every item,
  `reason` is update, and the cached page makes zero calls.

## Risks

- **The M3 build fails** because of toolchain drift. Every milestone has wxt 0.21.4 and a lockfile, so a build is
  likely. If it fails, report it; do not fake demo 3.
- **`navigator.locks` is missing in a context.** Fall back to the per-context dedupe and record the gap. Chrome 138
  supports locks in workers and extension pages.
