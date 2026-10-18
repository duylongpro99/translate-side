---
title: "Phase 4: Quality modes and review routing"
status: todo
priority: P2
effort: "1d"
dependencies: [3]
---

# Phase 4: Quality modes and review routing

## Goal

Users choose **Fast**, **Balanced** (default) or **Best** in the panel header and in Options. Advanced settings
expose the exact strategy and the "keep drafts on screen" choice. Routing has a **Review with** row. Best is behind
the `best-mode` feature id, available by default; access is enforced once per job start (phase 3) and shown in the
header select.

## Context links

- Source: `docs/plans/M7-stronger-translation.md` §2 rows 1 and 4, §5 row 6, §6 M7-E3.
- Spec: `DESIGN.md` §4.3.1 (`review?` defaults to translate, line ~331), §5.3 (modes map, line ~596).
- Pricing and gating: `plans/reports/brainstorm-261013-1036-free-pro-pricing.md`; plan.md Cross-Plan Dependencies.

## Requirements

1. Modes map to strategies: fast → `single-pass`, balanced → `contextual`, best → `refine`. An advanced override
   picks any of the three directly.
<!-- Red Team: mode switch does not re-translate -->
2. A mode change (or an override or keep-drafts change) restarts the open page's job with the new strategy, keeping
   its brief and cost, and reading the cache, through both `refresh` and `resume` in `translator.ts`.
<!-- Updated: Validation Session 1 - feature access resolved once per job start; best-mode gates every source -->
3. `best-mode` gates `refine` from every source: the header mode, the advanced override and imported settings. The
   check is the one in `Jobs.start` (phase 3); this phase wires `deps.featureAvailable` to `src/shared/features.ts`
   and adds no other enforcement. Sync code never calls the Promise.
4. A locked Best is listed in the header select **disabled, with a "(Pro)" suffix**, and a one-line lock note appears
   next to that select only. Nothing else in the panel or Options mentions the lock.
5. The Review with row saves `Routing.review` (absent = same as translate) and counts as a routed profile.
6. English and Vietnamese strings, with matching keys.
<!-- Updated: Validation Session 1 - Best is held back from releases if the margin is missed -->
7. A release switch, `BEST_MODE_RELEASED` in `src/shared/quality.ts` (default `true`): when false, Best is not listed
   anywhere (not even locked), `refine` is not offered as an override, and `Jobs.start` treats a `refine` request as
   `contextual`. Phase 7 sets it from the phase 2 outcome.

## Decisions

- **Storage.** A new sync item `quality` = `{ mode, strategy?, keepDraftsOnScreen }`, not new fields in `prefs`.
  The reason: `updatePreferences` (`src/shared/settings.ts:317-324`) rebuilds `prefs` from `readPreferences`, which
  copies only known fields (`:292-305`), so a v1.0 device that saves any preference would erase a quality field from
  sync. A separate item is never written by v1.0 builds. Its size is tiny and well within the per-item quota in
  `src/shared/sync-quota.ts:20-25`.
- **Gate contract** (shared with the licensing plan). `src/shared/features.ts` exports `type FeatureId =
  'best-mode' | 'translation-memory'` and `featureAvailable(id: FeatureId): Promise<boolean>`, which returns `true`
  in M7. It must stay cheap (no network on the job-start path; the licensing plan answers from its cached state).
  Enforcement reads it once per job start and stores the answer on the job (phase 3). The header select reads it for
  display only. The licensing plan replaces the body and owns the lock note's wording and any link in it.
- **Export.** `quality` goes into the settings export next to `prefs` as an optional field. The importer's handling
  of unknown fields must be confirmed at `src/shared/portable.ts:379` (`parseImport`) `[UNVERIFIED]`: if it ignores
  them, `EXPORT_VERSION` (`:55`) stays 1; otherwise bump it and keep reading version 1. An imported
  `strategy: 'refine'` is stored as is and gated at job start like any other source.

## Architecture and data flow

```
storage.sync 'quality' ─► readQuality (clean: unknown mode → balanced; unknown strategy → none)
translator.readSettings (:86) ─► Settings { prefs, glossary, quality }
translator.docFor (:133) ─► JobDoc { strategy: requestedStrategy(quality), keepDraftsOnScreen }   (no feature call)
translator.changes (:182-185) ─► { languages, output, quality }    quality = strategy or keepDraftsOnScreen differ
  refresh (:215) and resume (:239): quality alone → restart with { keepCost: true, keepBrief: true }, cache read
Jobs({ featureAvailable }) (:112) ─► Jobs.start resolves job.strategy once (phase 3)
HeaderControls select ─► updateQuality({ mode, strategy: undefined }); Best: hidden if !BEST_MODE_RELEASED,
                         disabled "(Pro)" + lock note if !await featureAvailable('best-mode')
Options ─► mode, advanced strategy, keepDraftsOnScreen; Providers Review with ─► saveRouting({ review })
```

## Related files

- **Create:** `src/shared/quality.ts` (types, `QUALITY_KEY`, `BEST_MODE_RELEASED`, `readQuality`, `updateQuality`
  serialized like `updatePreferences`, `requestedStrategy`) and `src/shared/quality.test.ts`;
  `src/shared/features.ts` and `src/shared/features.test.ts`.
- **Modify:**
  - `src/entrypoints/sidepanel/translator.ts` (`Settings` `:81`, `readSettings` `:86`, `Jobs` deps `:112`,
    `settingsKey` `:149`, `docFor` `:133-140`, `changes` `:182-185`, `refresh` `:215`, `resume` `:239`, `onSync` `:592`);
  - `src/entrypoints/sidepanel/jobs.ts` (only the `job.strategy` resolution in `start()` from phase 3 also reads
    `BEST_MODE_RELEASED`);
  - `src/entrypoints/sidepanel/prefs.ts` (`PrefsStore` also loads and watches `quality`);
  - `src/entrypoints/sidepanel/HeaderControls.tsx` (a `quality-mode` select beside `style-mode` at `:55`, the locked
    option and the lock note);
  - `src/entrypoints/options/Options.tsx` (a Quality section near the style and budget rows at `:174-201`);
  - `src/entrypoints/options/Providers.tsx` (`routedIds` `:75` adds `review`; a `route-review` row after
    `route-analyze` at `:382-394`);
  - `src/shared/portable.ts` (export and import of `quality`);
  - `src/locales/en.yml`, `src/locales/vi.yml`.
- **Tests:** `translator.test.ts`, `header.test.tsx`, `Options.test.tsx`, `Providers.test.tsx`, `portable.test.ts`,
  `locales.test.ts`.

## Implementation steps

1. Write `quality.ts` with the cleaning rules and `requestedStrategy(q)`: the override if set, else the mode's
   strategy. It never consults features.
2. Write `features.ts` with the contract above, and a test that both ids return true.
3. Wire `translator.ts`: `docFor` sets the requested strategy; `Jobs` gets `featureAvailable` from `features.ts`
   (the snippet `Jobs` keeps its `single-pass` seam). Add `quality` to `changes()` and handle it in `refresh` and
   `resume`. <!-- Red Team: mode switch does not re-translate --> Tests through `refresh`: Balanced → Best restarts
   with `refine` and the brief kept; Best → Balanced shows the Balanced cache with zero calls; an override change
   restarts; a keep-drafts change restarts.
4. Gating tests (`translator.test.ts`, with `featureAvailable` stubbed false): Best mode → `contextual`; the
   advanced override `refine` → `contextual`; an imported `quality` with `strategy: 'refine'` → `contextual`; and
   with `BEST_MODE_RELEASED = false`, all three → `contextual`. <!-- Updated: Validation Session 1 - best-mode gates every source -->
5. Extend `PrefsStore` and add the header select (Fast, Balanced, Best, with titles). With an override set, the
   select shows the mode and its title names the override; choosing a mode clears it. Locked Best: `disabled`, the
   label plus " (Pro)", and the lock note beside the select (`aria-describedby`). Tests for released/locked/hidden.
6. Add the Options Quality section: mode radios, an Advanced disclosure with the strategy select and the
   keep-drafts checkbox. Write through `updateQuality`. Options shows no lock UI.
7. Add the Review with row in `Providers.tsx`, copying the analyze row's "same as translate" option. Add `review` to
   `routedIds`, so a profile used for review cannot be deleted silently (`routingWithout`,
   `src/shared/providers.ts:580-589`, already clears it).
8. Export and import `quality`; round-trip test with an M6 export (no `quality`), which still imports.
9. Locale keys in both files.

## Todo

- [ ] `quality.ts` with cleaning, serialized updates, `requestedStrategy` and `BEST_MODE_RELEASED`
- [ ] `features.ts` contract and test
- [ ] `translator.ts`: requested strategy in `docFor`, `featureAvailable` into `Jobs`, `quality` in `changes()` for refresh and resume
- [ ] Gating tests: header mode, override, import, release switch
- [ ] Header select with the locked "(Pro)" option and lock note; Options section; advanced override and keep-drafts
- [ ] Review with row; `routedIds` includes review
- [ ] Export and import of `quality`, M6 file still imports
- [ ] en and vi keys

## Success criteria

- Switching Balanced → Best in the header re-translates the page with `refine` (a jobs diagnostics record shows it),
  and Best → Balanced shows the Balanced cache with zero calls (tested through `refresh`).
- `featureAvailable('best-mode')` appears in `src` only at the `Jobs.start` resolution and in `HeaderControls.tsx`.
- With the feature stubbed false, no refine job starts from the header, the override or an import.
- A locked Best is disabled with "(Pro)" and the note sits only beside the select.
- The Review with row saves and clears `Routing.review`, and Best uses that model for review calls (e2e mock records
  the model per call).

## Verification

- `pnpm vitest run --project shell src/shared/quality.test.ts src/shared/features.test.ts src/entrypoints`
- `pnpm check`
- `pnpm run e2e`

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| A v1.0 device erases the new setting | — | Avoided by the separate sync item (Decisions). |
| A mode switch is silently ignored | — | Avoided: `quality` is a `changes()` flag, tested through `refresh` and `resume`. |
| The header gets crowded at narrow panel widths | M × L | One compact select; the a11y and header tests run at the narrow width used in M5. |
| The licensing plan lands first with another signature | L × M | The signature is fixed in plan.md; whichever plan lands first creates the file. |
| A slow `featureAvailable` delays the first request | L × M | The contract requires a cached answer; phase 3 resolves it before route resolution, and a test bounds it. |

**Rollback.** Remove the `quality` reader: every run is Balanced again. The sync item is harmless to older builds.

## Security

The setting holds no secret. `featureAvailable` makes no network call in M7; any call it makes later belongs to the
licensing plan and its privacy text.
