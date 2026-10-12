# Review: performance, bundle budget, diagnostics

Range reviewed: `f6e5092..278180e` on branch `m6` (`../translate-side-m6`), 9 commits. I only read the code and ran
one scratch script. Nothing in the worktree was edited or built.

## Verdict

**There are no blocking findings.** All five done criteria are met:
- §2: Settings can export the log. Diagnostics.tsx shows the whole file first and saves it through a blob link.
- §3 #5: a 100-screen page stays within its budget. `e2e/perf.spec.ts` checks long tasks and heap for each renderer.
- §3 #6: the bundle stays within its budget. `check:bundle` runs in `pnpm check` and in CI.
- §4: there is no telemetry. Nothing is sent anywhere, no permission was added and the manifest is unchanged.
- §6: the log keeps the last 50 jobs, and the panel root has an error boundary.

There are 7 non-blocking findings, listed below.

## What was verified

- **`scriptsIn` (`src/engine/check/checks.ts:306`).**
  - Every `SCRIPTS` regex is a single `\p{Script=X}` with only the `u` flag. There is no `g` flag, so no `lastIndex`
    state carries between calls. That makes the union with `gu` match exactly the code points (astral included)
    that some script regex accepts, in text order.
  - `matchAll` works on a copy of the regex, so `ANY_SCRIPT`'s own `lastIndex` is never left changed.
  - I fuzzed the old loop against the new one: 200,000 random strings mixing ASCII, every target script, astral
    Han, lone surrogates, emoji and combining marks, plus every code point from U+0000 to U+10FFFF in overlapping
    windows. There were **0 mismatches**, and empty input gives the same result.
  - The committed test covers order, long text and code spans, but not astral characters or empty input (finding 6).
- **Budgets.**
  - Each renderer is recorded in its own run, with the fixture in front.
  - The heap is read after "Translate the rest", once every block is final, after a forced GC.
  - The page-renderer bound covers every task in that renderer, which is stricter than the content script alone.
  - The test fails if it cannot find the renderer's main thread.
  - The bundle check covers every .js and .css file under the build, each by its unhashed name, plus the total.
    A file that is new or missing from the budget also fails the check. The budget is the measured value plus
    10%, and the JSON's note records where the numbers came from.
- **Diagnostics privacy.**
  - `jobEntry` rebuilds every field from scratch. The following can never reach storage or the export:
    `serverMessage`, `raw`, the error message, a stack, page text, a URL, a base URL, or `JobConnection.origin`/`label`.
  - Errors are reduced to kind, status, count and a fixed message (`KIND_MESSAGES`).
  - The origin is `new URL().origin` and is kept only when `diagnosticsSites === true`. The setting is read on
    every write, and the export can still drop it.
  - The unit test and the e2e test both prove that an echoing 400 leaves no page text, provider message, host or
    path in storage or in the file.
  - Storage uses one key per entry. The prune removes only keys older than the newest 50, so no shared key is ever
    read, changed and written back, and concurrent pruners can only remove old keys. A test covers two writers.
  - Only page jobs are logged. Snippet jobs get `onJobRecord: undefined` (tested), and onboarding has no hook.
  - Production uses `getKeys`, which exists from Chrome 130; the minimum version is 138.
- **Hook shape (supervisor question).**
  - `onJobRecord` meets the plan's intent: a "started" entry at the start, the same key updated at the end, and
    abandoned runs left as `started`. The extra `replaced` write marks a run that a new one cut short, and it is
    not followed by a second end write (tested).
  - Adding `presetId` to `JobConnection` is the smallest way to give the log the preset id.
  - Lazy rounds being separate runs is a trade-off (finding 2), not a defect.
- **Error boundary.**
  - It wraps `App` at the panel root (`main.tsx`) and offers "Reload panel" and "Copy details".
  - "Copy details" copies only the version, the error class and the component name.
  - It writes a `panel-error` entry, which goes through the prune. The test proves the message text never appears.
- **Privacy notice.** The version is now 2 and the diagnostics line is added. The gate test shows that version 1
  now counts as `needed`, so users see the notice once more.
- **Hygiene.**
  - No plan IDs, phase numbers or finding codes appear in the added lines or in the commit subjects.
  - No home paths or usernames appear anywhere in the diff.
  - `wxt.config.ts` is untouched.
  - The `Co-Authored-By` trailer follows the repository's 276-commit precedent.

## Findings (all non-blocking)

1. **The long-task check can pass without measuring anything.** File: `e2e/trace.ts:75`. Violates the review
   requirement that the perf spec be "not trivially passing".
   - Failure scenario: a Chrome update renames the top-level task event, which the code already admits has
     happened (`TOP` lists two names). Or the trace category drops `RunTask`. Then `tasks` is empty, and the
     long-task assertion passes on every run while the heap half still runs.
   - Fix: assert that the main thread had at least one `TOP` event of any duration.
2. **Lazy rounds can crowd one page into most of the 50 slots.** File: `src/entrypoints/sidepanel/jobs.ts:1528`
   (one record per run). Concerns the intent of "the last N jobs" (§2).
   - Failure scenario: reading a 100-screen page in lazy mode writes one entry per round. A single long read can
     push out the user's earlier pages before they export the log for a bug report.
   - The supervisor accepted rounds as runs. Raise it again only if beta reports show it.
3. **The crash entry keeps the error's name as free text.** File: `src/entrypoints/sidepanel/ErrorBoundary.tsx:27`.
   Violates plan step 7, "kind and component name only".
   - Failure scenario: `error.name` is a writable property. An error thrown with a name built from data (a
     library, or an `Object.assign`'d error) puts that string into storage and into "Copy details".
   - The risk is low. A cheap guard: keep `name` only if it matches `/^[A-Za-z][\w$]{0,63}$/`, otherwise use `'Error'`.
4. **`presetId` is not checked against the known presets.** Files: `src/entrypoints/sidepanel/jobs.ts:1604` and
   `route.ts` (`jobConnection`). Violates the plan step 5 rule "Fields, all app-owned".
   - Failure scenario: a settings file imported from someone else (`portable.ts:282` accepts any string up to 100
     characters) or a synced settings entry can set `presetId` to any string, for example a gateway URL. That
     string is then logged and exported.
   - The risk is low because the user imported it. Mapping unknown ids to `'custom'` with `PRESETS` would close it.
5. **An end record brings back an entry the user just cleared.** File: `src/shared/diagnostics.ts:129`, where an
   end write calls `set` without checking or pruning.
   - Failure scenario: the user presses "Clear log" in Options while a job is running. When the job ends, its
     entry reappears as a fresh `diag:` key, so the log is not empty right after clearing. A pruned start key comes
     back the same way and briefly makes 51 entries.
   - No privacy impact; this is cosmetic.
6. **The equivalence test for `scriptsIn` leaves out astral characters and empty input.** File:
   `src/engine/check/checks.test.ts:221`.
   - Equivalence is proven above by fuzzing, but nothing guards a future edit of `SCRIPTS`. For example, adding a
     source with a quantifier or an `i` flag would silently change the union.
   - Suggested test: an astral Han character such as `𠀀`, and the empty string.
7. **The README says "never … addresses" although site names can be turned on.** File: `README.md:71`.
   - Failure scenario: a user who ticked "Include site names" exports origins, which the README says the log never
     holds. The Options hint words it better ("the page's text, its address"); the README could add "site names
     only if you turn them on".

## Unresolved questions

- Whether to fix any of findings 1, 3 and 4 before acceptance is the supervisor's call. I would take finding 1,
  which is a one-line assertion.
- The eval gate for the `src/engine` change and the perf spec on a CI runner are the tester's and the user's,
  as already recorded.

## Re-review of the fix commits (c90e362..8e57a15)

The five fixes resolve findings 1, 3, 4, 6 and 7. **There are no blocking or new findings.** Findings 2 and 5
are carried forward, as the supervisor decided.

- **c90e362** fixes finding 1. `e2e/trace.ts` now throws when the tab's main thread recorded no top-level task
  of any length.
- **58f1211** fixes finding 3. The crash entry keeps the error's name only when it matches
  `/^[A-Za-z][\w$]{0,63}$/`, and otherwise logs `Error`; a thrown non-error is also logged as `Error`. Both
  cases are tested, including a name that holds a URL.
- **3bd4806** fixes finding 4. `jobEntry` logs a preset id only when it is one of the built-in `PRESETS` ids,
  and otherwise logs `custom`.
  - `custom` is the default that `providers.ts:180` already writes for a connection with no preset.
  - `presets.ts` was already part of the panel and options bundles through `providers.ts`, so the bundle does
    not grow.
- **f006d70** fixes finding 6. It adds tests for an astral Han letter (flagged for `vi`, allowed for `zh`) and
  for empty text.
- **8e57a15** fixes finding 7. The README now says "never page text or page addresses, and site names only if
  you turn them on".
- No plan IDs or finding codes appear in the commit messages or in the added code.
- The 4 focused test files pass, 46 tests in all: diagnostics, ErrorBoundary, checks and jobs.diagnostics. I did
  not run the e2e suite.
