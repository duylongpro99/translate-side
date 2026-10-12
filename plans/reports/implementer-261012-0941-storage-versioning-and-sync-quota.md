# Implementer report: storage versioning and sync quota (M6-E6)

Branch `m6` in the `../translate-side-m6` worktree, based on b8ddad4. Nothing pushed. The phase 1 eval gate
applies (the diff touches `src/shared/settings.ts`); it was not run here and is left to the tester.

## Outcome

Settings and the cache now survive an upgrade from every earlier build, and a list too large for sync no longer
breaks a save.

- **Demo 3, real.** The M3 build (4524123) was built in a temporary worktree, filled with settings, glossary, key
  and cache, then upgraded in place to the current build. `onInstalled` reported `reason: "update"`, every item
  M3 stored was kept, and the cached page translated again with 0 provider calls.
- **Demo 4.** In real Chromium, a 1,000-entry glossary saves through the Options page with no error. The whole
  list goes to `storage.local` under `glossary` with the marker `overflow:glossary`, and the overflow notice shows.
  Sync keeps the last value that fit, and the next translation's prompts carry the glossary.
- **No sync pointer, index or chunk item.** No production test hooks. The manifest is unchanged and
  `check:manifest` passes. Fixtures use only `sk-test-fixture-<n>` keys, and `no-real-keys.test.ts` enforces it.

## Commits

| Hash | Subject |
|---|---|
| 71664c0 | feat: keep lists too large to sync on this device, and migrate settings under a lock with compare-and-set writes |
| fa59c68 | test: storage shape fixtures from every earlier build, and migration, quota, listener and cache tests |
| 8706b7d | test: a 1,000-entry glossary saves in real Chromium, stays on this device and reaches the prompt |
| 22fb5b6 | fix: overflow a list only when sync is out of space, land every migration step in one run |
| 34ece14 | test: upgrade e2e from the M3 build: settings, glossary, key and cache survive an in-place update |
| 5184a29 | fix: a migration step whose write fails is written with the next step, never marked as done |

22fb5b6 resolves review round 1 (N1–N6). 5184a29 resolves round 2 (R1): a failed step write no longer marks
the run as migrated. Its patch is carried into the next step's write, and the compare-and-set expects what
storage actually holds.

## Changed files

- **New:**
  - `src/shared/sync-quota.ts`, `src/shared/migrate.ts`, `src/shared/testing.ts` and their tests;
  - `tests/fixtures/storage/{m1,m3,m4,m5}.json`, its README and `no-real-keys.test.ts`;
  - `e2e/upgrade.spec.ts`, `scripts/e2e-upgrade.mjs`.
- **Modified:**
  - `src/shared/{providers,settings,sites,portable}.ts`;
  - `src/entrypoints/sidepanel/{controller,translator}.ts`;
  - `src/entrypoints/options/{Options,Providers}.tsx`;
  - `e2e/{flows.spec,servers,playwright.config}.ts`, `package.json` (`e2e:upgrade`);
  - the tests of each.

## Evidence (all on 5184a29)

### `pnpm check`

The run passed: lint, typecheck, the engine boundary, coverage, the build and the manifest check.

```
engine boundary: OK (closure = src/engine/ + src/llm/types.ts + TS lib; ...)
 Test Files  92 passed (92)
      Tests  1757 passed (1757)
.output/chrome-mv3/manifest.json: OK (built manifest matches DESIGN.md §8 / M0-E2)
```

The suites the phase adds are part of this run:
- `migrate.test.ts` (18): every earlier shape, a newer version, a fresh device, a half-downloaded sync, concurrency with and without Web Locks, compare-and-set, two-step runs (one with a failed write), the 1,000-entry glossary with 300 site rules, two devices on one sync, and the export/import round-trip;
- `sync-quota.test.ts` (9);
- `no-real-keys.test.ts`;
- the listener tests in `controller`, `translator`, `snippet` and `Options`;
- the cache v1 test.

### `pnpm run e2e`

26 tests passed, with zero console errors. This includes the new quota flow:

```
  ✓   5 e2e/flows.spec.ts:96:1 › a 1,000-entry glossary saves through the options page, stays on this device with the notice, and the next translation uses it (2.0s)
  26 passed (45.3s)
```

### `pnpm run e2e:upgrade` (recorded console output; the temporary path is shortened)

```
$ git worktree add --detach <tmp>/from 4524123  (in the repository)
$ pnpm install --frozen-lockfile  (in the worktree)
$ pnpm run build  (in the worktree)
$ pnpm run build  (in the repository)
$ pnpm exec playwright test -c e2e/playwright.config.ts e2e/upgrade.spec.ts  (in the repository)
earlier build: 7 provider calls, blocks {"final":73,"kept":26}, 73 cache rows
onInstalled after the reload: {"previousVersion":"0.0.1","reason":"update"}
kept: sync glossary, prefs; local privacyNotice, secret:apibox, spend
added: sync conn:apibox, profile:apibox-deepseek-flash, profile:apibox-deepseek-v4-pro, profile:apibox-qwen3.8-flash, schemaVersion; local migratedRoute
current build, same page: 0 provider calls, blocks {"final":73,"kept":26}
  ✓  1 e2e/upgrade.spec.ts:133:1 › an earlier build upgrades in place: settings, glossary, key and cache survive, and the cached page makes no calls (3.6s)
  1 passed (3.9s)
```

The spec deep-compares every sync and local item the M3 build stored against the same item after the upgrade.
The migration only adds items.

## How the upgrade is observed (step 7)

- **`onInstalled`, with no production hook.** The spec launches Chromium with a fixed `--remote-debugging-port`
  (9339). Before the reload, a test-side CDP client auto-attaches to new targets and waits for the debugger
  before each one starts. It stops the new extension worker on a `beforeScriptExecution` breakpoint and adds an
  `onInstalled` listener that logs the event details. Every other target is released at once.
- **The reload.** It goes through `chrome://extensions` (`developerPrivate.reload`, with developer mode on, as a
  user would set it). `chrome.runtime.reload()` left the extension disabled with `unsupportedDeveloperExtension`
  for an unpacked, command-line-loaded extension.
- **The provider.** M3's fixed provider host (`https://api.ai-box.vn/v1`) is routed to the local mock. The test
  copy of each build's manifest adds that host and `127.0.0.1`, as the e2e harness does for its copy.
- **Settling the cache.** Before the upgrade, the spec waits until the M3 panel's cache writes have settled
  (row count stable). Without the wait, one early run made 4 calls after the upgrade.
- **Kept out of the e2e suite.** `pnpm run e2e` does not run this spec (`testIgnore` unless `UPGRADE_FROM` is
  set). The script removes its temporary worktree afterwards.

## Deviations and findings

1. **Import caps (pending the user).** `MAX_GLOSSARY` went from 500 to 5000 and `MAX_SITE_RULES` from 200 to 1000
   in `portable.ts`. Otherwise an import truncates a large export, so the 1,000-entry glossary would not
   round-trip.
2. **The plan's claim that M2 equals M3 is false.** The plan says there is no storage change in
   55327d3..4524123 under `src/shared`, but M3 adds `spend` and `privacyNotice` in local and snippet records in
   session. The sync shape and keys are identical, so `m3.json` also covers M2; its README says so.
3. **No shared in-flight migration.** `migrateProviders` no longer shares a run per context: a shared run could
   predate a write and return stale settings. The Web Lock serializes runs; without locks, a per-context queue
   does.
4. **A fresh device writes nothing to sync,** not even `schemaVersion`. Sync may not have downloaded another
   device's items yet. `providers.test.ts` was updated.
5. **`saveRouting` makes two writes** (site rules first, then the routing) and returns `{ siteRulesLocal }`. The
   routing's quota check counts the new rules. A failure between the two writes leaves the new rules next to the
   old routing, and the doc comment says so.
6. **Step 7 seeds no site rules.** The plan asked for them, but M3 has no site rules (they came in M4). The spec
   seeds what M3 stores: prefs, glossary, the apibox key placeholder, the privacy notice and spend.
7. **Sync errors (review ruling N2).** Only Chrome's space errors (`QUOTA_BYTES`, `QUOTA_BYTES_PER_ITEM`,
   `MAX_ITEMS`) move a list to this device. Other sync errors, such as the write-rate limits, fail the save as
   they did in M5 and leave the marker alone.

## Open

- The phase 1 eval gate (local, paid) for the `settings.ts` change is for the tester.
- The `site-rules-overflow` notice has a `Providers.test.tsx` case (added after the report was sent): site rules kept on
  this device are listed from there, with the notice.
- Older code still has plan IDs in comments and test names. Only those added in this phase were removed.

## Unresolved questions

- Should the import caps stay at 5000 and 1000 (deviation 1)? This is the user's decision.
