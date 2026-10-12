# Storage shape fixtures

What each earlier build left in `chrome.storage`, as `{ sync, local, session }`. The migration tests
(`src/shared/migrate.test.ts`) load each one, migrate it with the current build and check that every
meaningful value is still there. The values are realistic but made up; every `secret:*` value is a
placeholder `sk-test-fixture-<n>`, which `no-real-keys.test.ts` enforces.

| Fixture | Build | Source of the shape |
|---|---|---|
| `m1.json` | M1 | `scripts/eval/migration.ts:53-58` (scenario `m1`): `prefs` with `targetLang` and `sourceLang` in sync, the Gemini key under `secret:gemini` in local. |
| `m3.json` | M2 and M3 (4524123) | `scripts/eval/migration.ts:46-51` (scenario `m3`) and, at 4524123, `src/shared/settings.ts:159` (`secret:`), `:240` (`prefs` with style, gloss and budget), `:291` (`glossary`), `src/shared/spend.ts:10` (`spend`), `src/entrypoints/sidepanel/privacy.ts:10` (`privacyNotice`). |
| `m4.json` | M4 (6af810b) | At 6af810b, `src/shared/providers.ts:6-11` (sync layout schema 1: `schemaVersion`, `conn:<id>`, `profile:<id>`, `routing` without `basicMigrated`, `siteRules`), `:51` (`migratedRoute`, local), `:60` (`tabRoute:<tabId>`, session), `src/shared/settings.ts:179,269,320`, `src/shared/spend.ts:14,19` (`spend`, `spendLimit`), `src/shared/onboarding.ts:9` (`onboarding`). |
| `m5.json` | M5 (ae9f9fb) | At ae9f9fb, as M4 plus `src/shared/providers.ts:229` (`routing.basicMigrated`, the terminal `basic` fallback), `:61` (`siteAllowlist`), `src/shared/sites.ts:20` (`siteNever`), `src/shared/settings.ts:258-259` (`prefs.captions`, `prefs.altText`), and the per-day and per-model spend ledger. |

M2 has no fixture of its own. At 55327d3 the only stored keys are `prefs`, `glossary`
(`src/shared/settings.ts:216,267`) and `secret:<id>` (`:136`). M3 adds only device data next to
them: the `spend` ledger and `privacyNotice` in local, and selection records in session. The sync
shape and the keys are the same, so `m3.json` covers M2 (an M2 device simply lacks the local
additions, which no migration reads).
