# Red team on the M6 plan (plans/261011-1206-m6-release-hardening), 2026-10-11

## Scope & Complexity Critic (Contract Verifier)

1. **CRITICAL.** Phase 3 builds both chunking and local overflow. The new keys break consumers the plan does not
   list:
   - the glossary change listener (`translator.ts:589`, `GLOSSARY_KEY in changes`);
   - `isProviderKey` (`providers.ts:67`), which is exact for 'siteRules'; reloads use it at `Options.tsx:67,580` and
     `Providers.tsx:110`;
   - site rules live in `providers.ts:281,504` (`saveRouting` / read), not in `sites.ts`;
   - the import writes single items at `portable.ts:547,554-557`;
   - tests pin the single-item shape: `providers.test.ts:155,414-427`, `Providers.test.tsx:402-458`,
     `settings.test.ts:186-239`, `Options.test.tsx:264`.

   Fix: one mechanism, local overflow plus a pointer, with every consumer listed.
2. **HIGH.** There are four quota mechanisms, not two:
   - `checkQuota` (`providers.ts:403`; callers `providers.ts:448,460,486,505,524` and `portable.ts:640`);
   - the glossary guard (`settings.ts:372-386`);
   - an inline import check (`portable.ts:554-555`);
   - the `sites.ts:24,143` `SYNC_ITEM_BYTES`.

   Fix: list all four and delete the duplicates.
3. **HIGH.** The e2e build mode and the production `?tabId=` hook repeat what `ext-run.mjs` already does without
   touching production code (`ext-run.mjs:50-54,118-132`). Fix: reuse that approach and limit the spike to headless
   mode and console capture.
4. **MEDIUM.** The shared mock module refactors `run.ts`, which Phase 1 owns, and creates a third mock (`run.ts:103-125`,
   `llm/testing.ts:30`, `engine/testing.ts:62`). Fix: a self-contained mock in `e2e/servers.ts`.
5. **HIGH.** Async `extractPage` misses its only production caller, `content.ts:43`, whose `read()` is synchronous.
   `watch.ts` doesn't call it. There are 32 call sites, 30 of them in tests. Fix: keep the synchronous version and
   add a sliced entry point for `content.ts`.
6. **HIGH.** The gate's path filter misses `DEFAULT_PROFILE` (`settings.ts:133,168`) and `PANEL_STRATEGY`
   (`jobs.ts:80`). The harness hard-codes the model (`run.ts:147`). The rubric hash and the spend cap are
   unrequested: the judge is versioned by `judge@1` (`judge-core.ts:10-16`).
7. **HIGH.** Building five milestone commits is costly. `scripts/eval/migration.ts:5-16` already has M1/M3 shapes,
   and `cache.ts:149-150` already has `onupgradeneeded`. Fix: use migration.ts shapes plus source shapes, and build
   only M3 for demo 3.
8. **MEDIUM.** Unrequested extras: axe contrast (a new dependency), the JSX scan test, a Vietnamese store listing,
   an S7 decision doc that duplicates `bundle-budget.json`, and an options-page boundary (plan §6 says "in the
   panel").
9. **MEDIUM.** File-ownership overlaps: `ci.yml` is touched by Phases 2 and 4, `check-manifest.mjs` by 2 and 5,
   `options/*` by 3, 4 and 5. `test:coverage` would be missing from `pnpm check` (`package.json:23`, `ci.yml:18`).
   Phase 7 is thin enough to merge into 6. Phase 5 omits `action.default_title` (`wxt.config.ts:20`).

## Security Adversary (Fact Checker; 36 claims: 29 verified, 6 failed, 1 unverified)

1. **HIGH.** When the secret is missing, the gate exits 0 and shows green, so a skipped run looks like a pass. A push
   on any branch also spends money. Fix: fail on master and m6 when the secret is missing, push only to master and
   m6, use a protected `environment: eval`, and count a run as green only if it made calls.
2. **HIGH.** The gate doesn't test the app's default model (`settings.ts:133-135`, while `run.ts:147` is hard-coded).
   The path filter misses `src/engine/**` (parsing, chunker, context, stages) and `src/llm/**`: 30 commits since
   8bc7484, of which only 9 are in prompts or strategies. Fix: resolve the model from the default profile, filter
   on `src/engine/**`, `src/llm/**` and `settings.ts`, and test that the gate uses the default model.
3. **HIGH.** A job-level secret env reaches the install scripts (`postinstall: wxt prepare`, esbuild) and actions
   pinned by tag (`ci.yml:12-14`). Fix: step-level env on the gate step only, `permissions: contents: read`, and
   SHA-pinned actions.
4. **HIGH.** The production guard can't work: `tabId` already appears in the production chunks and in
   `background.js`, and `check-manifest.mjs:23-26` scans only `chunks/`. Fix: drop the hook (as `ext-run.mjs:113-124`
   does). Any e2e-only code gets a sentinel string, and every `.js` in the output and the zip is scanned for it.
5. **HIGH.** The storage-fixture capture could commit real keys: the harnesses seed real `.env` keys
   (`migration.ts:47-57`, `ext-run.mjs:92`). Fix: placeholder keys only, plus a test that rejects non-placeholder
   `secret:*` values.
6. **HIGH.** The diagnostics redaction helpers don't exist as described: `KEY_LIKE` (`portable.ts:203`) only detects
   and isn't exported. Provider error bodies can echo page text (`errors.ts:89-96,108`, `sdk.ts:74-79`). Fix: store
   only the error kind, the status and the app's own messages, never `serverMessage`, `raw` or stacks, and add a
   test with page text in the error body.
7. **MEDIUM.** The diagnostics export is effectively a 50-site history, and the beta sends testers to public
   issues. Fix: leave origins out by default with an opt-in, preview the file before export, tell testers to send
   it privately, and list diagnostics in the privacy policy.
8. **HIGH.** The privacy claim "only on user action" contradicts auto-translate on allowlisted sites
   (`sites.ts:4-7,115-125`, against `PrivacyNotice.tsx:33`). The notice version isn't bumped for the new
   diagnostics. Fix: describe auto-translate in the policy, listing and notice, and bump the notice version.
9. **HIGH.** The `http://*/*` decision has no owner and no gate. The Constraints forbid one of the options, and
   check-manifest hard-asserts the pattern (`:17`). Fix: an explicit user decision before phase 6 step 3, and
   update the Constraints to allow it.
10. **MEDIUM.** Chunked sync loses edits made on another device still running M5, which keeps writing the legacy
    key (`settings.ts:322-326`, `providers.ts:53`). Fix: keep writing the legacy key, or merge it, and add a test
    with both present.

Failed claims: "presets.ts holds the default models" (actually `settings.ts:133`); the tabId guard; the portable
redaction helpers; "the privacy notice is the compliant disclosure"; "onboarding mentions rebinding" (it doesn't).

## Failure Mode Analyst (Flow Tracer)

1. **CRITICAL: the local-only pointer is shared through sync.** Device B sees an empty glossary. B saves a short
   list, which then overrides A's chunks, and A's 1,000 local entries are orphaned. Every cached page also misses,
   because the cache key holds `glossaryHash` (`cache.ts:87-90`).

   Fix: the pointer records the owning device and a revision, and other devices never overwrite it. Or drop local
   overflow and refuse the save with a clear message. Add a test with two devices sharing one fake sync.
2. **CRITICAL: migration runs in several contexts at once.** Deduplication is per context
   (`providers.ts:338,348-350`). The worker's onInstalled run and an options save can interleave and lose an edit.
   A fresh device can also run the migration before sync has downloaded, and then wipe the synced glossary.

   Fix: `navigator.locks`, re-read inside the lock, compare-and-set writes, and write nothing when there is no
   legacy data. Test deterministic interleavings.
3. **HIGH: mixed versions across devices and rollback.** An M5 device reads and writes only `glossary` and
   `siteRules` (`settings.ts:361-365`, `providers.ts:281,504`).

   Fix: keep writing the legacy single item while it fits (dual-write), merge a newer legacy item when reading, and
   document what a downgrade loses.
4. **HIGH: exact-key listeners.** These miss chunk keys: `providers.ts:67`, `controller.ts:176-178`,
   `Options.tsx:374-376`, `translator.ts:579`. Fix: an `isChunkOf` / `onLogicalChange` helper, with the files added
   to the plan.
5. **HIGH: the M3 build can't use the mock.** M3 has a fixed APIBOX base URL (`presets.ts:9` @4524123) and no
   connections. Fix: Playwright `context.route('https://api.ai-box.vn/**')` serves the mock, and the test counts
   calls on that route.
6. **HIGH: the gate never evaluates a default-model change.** The model is hard-coded in `run.ts:153`, and
   `settings.ts` `DEFAULT_PROFILE` (:133,168) isn't in the path filter.
7. **HIGH: the gate times out on failure.** A gate pass takes about 10-11 minutes (translate 185 s, judge about 7
   minutes), so a failure plus the re-run is about 21 minutes, over the 20-minute timeout. With n=3 the SD is
   unreliable, there is about a 50% false-fail risk across 4 dimensions, and the gate only fires after landing.

   Fix: a 45-minute timeout, at least 5 runs or a paired per-passage test, and a skipped run doesn't count.
8. **HIGH: async extraction.** It races on `last` (`content.ts:35,41-56,96-99,120-131`). The watcher's `maxWait` of
   3 s can livelock (`watch.ts:46,66`). `compose` and Readability are single blocks (`index.ts:44,83-85`). The
   156 ms long task was measured during a lazy translate, not during extraction.

   Fix: one in-flight read per document, commit `last` atomically, suspend the watcher's max timer while a read
   runs, and profile first.
9. **HIGH: the panel in a tab.** It follows `onActivated` (`controller.ts:155-158,180`), and only the active tab's
   job sends requests (`jobs.ts:721-727`). Hidden-tab throttling slows things down; `ext-run.mjs:61` sets flags to
   avoid it.

   Fix: separate windows, pin semantics, and run perf without the throttling-disable flags.
10. **MEDIUM: diagnostics.** Two Jobs instances per panel (`translator.ts:106,109`) race on one key, and abandoned
    jobs are never recorded. CI doesn't run on `m6` (`ci.yml:3-6`).

    Fix: one key per entry, or a lock; a "started" entry; skip snippet jobs; add an `m6` push trigger.

## Assumption Destroyer (Scope Auditor)

1. **CRITICAL: the gate never reaches analyze, brief or revise.** Every baseline passage is 1 chunk with no brief
   (summary.md: 23 (0) briefed). A one-chunk document skips analyze (`contextual.ts:15-16`). A multi-chunk M2
   baseline already exists: `baseline-contextual-translate2-qwen3.8-flash-c400`.
2. **HIGH: the gate tests the wrong configuration.**
   - The shipped default is `settings.ts:132-140,167-168` (chunkTokens 1200, `APIBOX_QWEN_QUIRKS`, `llm/presets.ts:41`),
     but the harness defaults to 1500 (`run.ts:53`).
   - The paths filter misses `settings.ts`, `llm/presets.ts` and `jobs.ts`.
   - OpenRouter's `anthropic/claude-haiku-4.5` has no PRICES entry (`pricing.ts:22-27`), so the run needs `--price`.
3. **HIGH: the `?tabId=` hook fights D14 and `onActivated`** (`controller.ts:155-158,180`, `jobs.ts:721-727`). The
   ext-run pattern already works (`ext-run.mjs:105-118`, throttling flags at :65).
4. **CRITICAL: chunked keys break the listeners.** These include the never-translate stop (`controller.ts:175-178`,
   `translator.ts:582-589`), `isProviderKey` (`providers.ts:67`), and the Options and Providers reloads.
5. **HIGH: the sync pointer contradicts the no-index design** (`providers.ts:31-32`). It also breaks devices still
   on the older version. The local schemaVersion mirror duplicates `migratedRoute` (`providers.ts:55,352-361`).
6. **HIGH: the upgrade e2e loses data.** The unpacked id depends on the path, and `ext-run` uses mkdtemp
   (`ext-run.mjs:50-51`). Fix: one fixed directory, then reload and assert `reason === 'update'`. `schemaVersion`
   first appears at 6af810b.
7. **MEDIUM: diagnostics writers.** There are 3 `Jobs` sites (`translator.ts:106,109`, `Onboarding.tsx:252`). Reuse
   the `SpendLedger`/`onSpend` injection pattern (`spend.ts:241-256`, `translator.ts:93-95`) and one key per entry.
8. **HIGH: i18n breaks the unit tests.** The fake browser has no i18n (`settings.ts:290` guard), and 36 test files
   (231 assertions) check English text. The `llm/errors.ts` messages are user-visible but out of scope. The
   onboarding file is owned by phase 5 vs phase 6; the rebinding note is missing (`Onboarding.tsx:88`).
9. **MEDIUM: the lazy page can't meet "every block translated".** CI doesn't run on m6 (`ci.yml:3-6`).
10. **MEDIUM: time-slicing rests on an unproven cause.** The 156 ms was a whole-job figure, and the panel's `patch()`
    O(n) is a known carry-over (`progress-m5.md:401-409`). `compose` and Readability are single blocks. The password
    check runs only at the start (`extract/index.ts:77-87`).

Probes:
- The milestone commits are valid, and their shapes are unchanged between 6af810b and 60a8e5a.
- Only 2 of the 5 fixtures/docs files are ≥2,500 words (goblog 3,331, docusaurus 2,566), so a third needs
  `eval:capture`.
- The lockfile has vitest 5.0.3.
- The eval mock routes analyze calls by `user.startsWith('<document>')` (`run.ts:109`).

---

## Adjudication: 15 merged findings

| # | Merged finding | Sev | Sources | Disposition | Applies to |
|---|---|---|---|---|---|
| 1 | The sync redesign (chunks + local overflow + pointer) loses data across devices and versions, breaks the never-list, glossary and siteRules listeners, contradicts the no-index rule, and misses 4 guards and their real owners | Critical | S1,S2,S10; F1,F3,F4; A4,A5; Sc1,Sc2 | **Accept (redesign).** No chunks and no pointer. The legacy single sync item stays and is written while the list fits. Over the limit, the full list goes to `storage.local` on this device only, the sync item keeps the last value that fit, and the UI says "too large to sync; changes stay on this device". Other devices and M5 builds are unaffected. One guard replaces the 4. Every listener also watches the local key. All consumers are listed. | Phase 3 |
| 2 | Migration races across contexts; a fresh device wipes synced data | Critical | F2 | **Accept.** `navigator.locks` and a re-read inside the lock. Writes nothing when there is no legacy data. The per-device state extends `migratedRoute` (no second version). Deterministic interleaving tests. | Phase 3 |
| 3 | The gate never runs analyze/brief/revise; it tests the harness configuration, not the shipped default; the paths filter misses the files where the default lives | Critical | A1,A2; S2; F6; Sc6 | **Accept.** The gate reads the model, quirks and strategy from `DEFAULT_PROFILE` and `PANEL_STRATEGY`, and runs at chunk 400 so every passage is multi-chunk and briefed. It asserts briefed > 0. §3 #3 compares against the M2 c400 baseline. Paths: `src/engine/**`, `src/llm/**`, `src/shared/settings.ts`, `src/shared/presets.ts`, `sidepanel/jobs.ts`, `scripts/eval/**`, `eval/**`. | Phase 1 |
| 4 | Gate statistics and timeout: n=3, 20 minutes is too short for a re-run | High | F7 | **Accept.** 5 baseline runs, `timeout-minutes: 45`, a phase timeout inside the script, and the verdict always printed. | Phase 1 |
| 5 | A skipped gate looks green; secret exposure; trigger width | High | S1,S3 | **Accept, partly.** On master and m6, a missing secret fails the run. Push only to master and m6, plus workflow_dispatch. A step-level secret env, `permissions: contents: read`, and SHA-pinned actions. **Rejected:** a protected environment with required reviewers. With one developer, it would block their own pushes, and the step-level secret plus a branch filter carry the risk. | Phase 1 |
| 6 | The `?tabId=` hook, the e2e build mode and the production guard are unnecessary; the hook fights D14 and `onActivated`; the guard can't work | High | Sc3; S4; F9; A3 | **Accept.** Drop the hook and the build mode. Reuse the ext-run pattern: a copied manifest with test-host `host_permissions`, the panel in its own window, the fixture tab active, and the throttling flags recorded. Production code is untouched, so the only guard needed is "production build unchanged". | Phase 2 |
| 7 | The shared mock refactors `run.ts`, which phase 1 owns, and creates a third mock | Medium | Sc4 | **Accept.** A self-contained HTTP mock in `e2e/servers.ts`. Mind the analyze routing (`run.ts:109`). | Phase 2 |
| 8 | Async extraction misses `content.ts:43`, races on `last`, can livelock the watcher, and the cause is unproven | High | Sc5; F8; A10 | **Accept.** Profile first, attributing long tasks to extraction or to the panel's `patch()`. Slice only if extraction is the cause: keep a synchronous `extractPage`, add a sliced entry point used by `content.ts`, one in-flight read per document, an atomic `last`, a watcher max-timer suspended during a read, and a password re-check after the last slice. Add a panel long-task budget. | Phase 4 |
| 9 | Building old commits is costly; the upgrade e2e loses its id because the path differs; M3 can't reach the mock; the cache step is a no-op | High | Sc7; F5; A6 | **Accept.** Shape fixtures come from `scripts/eval/migration.ts` plus source shapes cited by `file:line`. Only M3 is built, for demo 3. It loads from one fixed directory, is swapped and reloaded, and asserts `reason === 'update'`. `context.route('https://api.ai-box.vn/**')` serves the mock. The cache step becomes a single "segments survive reopen" test. | Phase 3 |
| 10 | Storage fixtures could commit real keys | High | S5 | **Accept.** Placeholder keys only, plus a test in `pnpm check` that rejects any other `secret:*` value. | Phase 3 |
| 11 | Diagnostics: no free-text redaction exists; provider bodies echo page text; the history leaks; writers race; abandoned jobs aren't logged | High | S6,S7; F10; A7 | **Accept.** Store the kind, the status and the app's own messages only (never `serverMessage`, `raw` or stacks). One key per entry, pruned to 50. `onJobEnd` is injected like `onSpend`, for page jobs only. A "started" entry is updated at the end. Origins are left out unless the user opts in. A preview comes before export. The beta tells testers to send the file privately. | Phases 4, 7 |
| 12 | The privacy policy's "user action only" claim contradicts auto-translate on allowlisted sites; the notice isn't re-shown | High | S8 | **Accept.** The policy, listing and notice describe auto-translate. The privacy notice version is bumped when diagnostics ship. Storage claims are written after phase 3. | Phases 4, 6 |
| 13 | `http://*/*` vs the HTTPS rule: no owner, and the Constraints forbid one option | High | S9 | **Accept → user decision** (validation). The Constraints allow whatever is chosen. | plan.md, Phase 6 |
| 14 | i18n breaks the unit tests (no i18n in the fake browser, 36 files); `llm/errors.ts` messages are missing; onboarding is edited by two phases; `default_title` is not localized | High | A8; Sc9 | **Accept.** A vitest setup loads `en` messages into a `getMessage` stub. `LLMError.kind` maps to keys. Phase 5 owns the onboarding rebinding note. `action.default_title` is localized. | Phases 5, 6 |
| 15 | Plan hygiene: the lazy page can't meet "all blocks"; CI doesn't run on m6; `test:coverage` is missing from `pnpm check`; extras beyond scope | Medium | A9; F10; Sc8,Sc9 | **Accept, partly.** Expectations are per page (lazy pages get the window plus "Translate the rest"). An `m6` push trigger in `ci.yml`. `test:coverage` goes inside `pnpm check`. Drop axe (dark-mode contrast goes to the beta checklist), the JSX scan test, the Vietnamese store listing, the S7 decision doc (the budget lives in `bundle-budget.json` and the log), the options-page boundary (plan §6 says "panel") and the judge rubric hash (`judge@1` is the version). The Haiku cost run uses `--price 1,0.1,5`. **Rejected:** merging phase 7 into phase 6, because phase 7 is the user-gated release and the supervisor needs it as a separate gate. **Rejected:** dropping the gate spend cap; it is cheap protection for a paid secret in CI. | All |
