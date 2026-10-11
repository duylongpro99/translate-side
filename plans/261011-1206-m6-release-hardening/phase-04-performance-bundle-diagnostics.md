---
phase: 4
title: "Performance, bundle budget, diagnostics"
status: pending
priority: P2
effort: "1.5d"
dependencies: [2, 3]
---

# Phase 4: Performance, bundle budget, diagnostics

<!-- Updated: Red Team 2026-10-11. Profile before slicing. A synchronous extractPage stays, with a sliced entry
     for content.ts only when profiling shows extraction is the long task. A panel long-task budget is added.
     Diagnostics store app-owned fields only, one key per entry, through an injected onJobEnd, with origins left
     out by default. Only the panel gets the boundary. The privacy notice version is bumped. The S7 doc is dropped. -->

## Goal

A 100-screen page stays responsive and within a memory budget, and the bundle has a checked budget. A user can
export a local log of recent jobs that holds no page text and no secrets. A crash in the panel shows a recoverable
screen instead of a blank one.

## Plan tasks owned

- M6-E4: large-DOM extraction in idle callbacks, a bundle budget and a memory check on a 100-screen page.
- M6-E5: a local, exportable log of the last N jobs, and an error boundary in the panel.

## Done criteria (copied from docs/plans/M6-release-hardening.md)

- §2: "Settings can export a local diagnostic log of the last N jobs (no telemetry)."
- §3 #5: "Memory and responsiveness on a 100-screen page | within the set budget"
- §3 #6: "Bundle size | within the S7 budget"
- §4: "Telemetry of any kind. Diagnostics stay local and user-exported."
- §6: "M6-E5 Diagnostics: local, exportable log of the last N jobs; error boundary in the panel."

## Starting point

- **Extraction.**
  - `extractPage` (`src/extract/index.ts:77`) runs synchronously. Its only production caller is `read()` in
    `src/entrypoints/content.ts:41-56`, which writes the per-document `last`. `read()` serves `extract` (:120-131)
    and the watcher's `reread` (:96-99).
  - The watcher forces a fire at `maxWait` 3 s (`src/extract/watch.ts:46,66`).
  - `composeDocument` and Readability run as single blocks (`index.ts:44,83-85`), and the password and editable
    checks run first (`index.ts:77-87`).
  - Other callers: `scripts/eval/capture.ts:12` and 30 call sites in tests.
- **Measurement.** The 156 ms long task was measured over a whole live lazy job (`docs/progress/progress-m5.md:399-406`).
  The panel's O(n) `patch()` per event is a known carry-over (:409). No memory numbers exist.
- **Bundle.** No S7 number exists. Current gzip sizes in bytes: openai 82,190, anthropic 53,493, pricing 41,801,
  content 19,311, sidepanel 16,357, background 5,145.
- **Jobs.** `new Jobs` is called at `src/entrypoints/sidepanel/translator.ts:106` (page jobs), `:109` (snippet jobs)
  and `src/entrypoints/onboarding/Onboarding.tsx:252`. Spend uses an injected `onSpend` callback with a serialised
  `SpendLedger` (`translator.ts:93-95`, `src/shared/spend.ts:241-256`).
- **Provider errors.** Error text can echo request content: `serverMessage` and `raw` are kept in
  `src/llm/errors.ts:89-96,108`, and the SDK puts the body into its message (`src/llm/sdk.ts:74-79`).
  `portable.ts`'s `KEY_LIKE` (:203) only detects keys and is not exported.

## Steps

1. **Profile first.** With the phase 2 harness on `long-100-screens`, record long tasks through a CDP Performance
   trace, not a production hook. Attribute each one: content-script extraction (compose, Readability, walk), content
   apply, or the panel (`patch()` and render). Record the breakdown in the phase report.
2. **Slice extraction only if step 1 shows it is the long task.**
   - **Entry points:** add `extractPageSliced()` beside the synchronous `extractPage`, which stays for tests and
     `capture.ts`. It yields between walk slices through `requestIdleCallback` with a deadline, falling back to
     `setTimeout`. Output is byte-identical: assert this in a parity test over every fixture.
   - **`content.ts` changes:**
     - one in-flight read per document, where a new request joins the running read or queues after it, and is
       never cancelled;
     - `last` is committed in one synchronous step at the end;
     - the watcher's max timer is suspended while a read is in flight;
     - `hasFocusedPassword` is checked again after the last slice.
   - **If compose or Readability is the long task:** record that in the report. The fix is out of M6 scope unless
     it is small.
3. **Budgets** (`e2e/budgets.json`, enforced by `e2e/perf.spec.ts`), measured on `long-100-screens` with the
   fixture in front:
   - no long task over 100 ms in the content script, and none over 100 ms in the panel;
   - JS heap (CDP `Performance.getMetrics`, tab and panel) after "Translate the rest" at most the measured value
     plus 25%.

   <!-- Updated: Validation Session 1 - patch() is fixed in M6 -->
   If the panel's per-event `patch()` (an O(n) M5 carry-over) breaks the panel budget, fix it in this phase: update
   only the affected blocks per event, with no full-list walk. The budget is not loosened to fit the current
   behavior (Validation Session 1).
4. **Bundle budget.** `scripts/check-bundle.mjs` compares the gzip size of each entry and chunk, and the total,
   against `scripts/bundle-budget.json`. The budget is the measured value plus 10%, and its source is noted in the
   JSON's `note` field. Add a `check:bundle` step after `build` in `ci.yml` and in `pnpm check`.
5. **Diagnostics** (`src/shared/diagnostics.ts`).
   - **Storage:** one `storage.local` key per entry, `diag:<ts>-<rand>`, pruned to the newest 50 on write. There is
     no read-modify-write of a shared key.
   - **Writer:** `createTranslator` gets an injected `onJobEnd`, mirroring `onSpend`, wired for page jobs only, not
     snippet jobs. A "started" entry is written at job start and updated at the end, so abandoned jobs (panel
     closed, worker restarted) still show.
   - **Fields, all app-owned:**
     - time, extension and Chrome version;
     - strategy and prompt ids, the connection preset id and the model id;
     - segment, chunk and call counts, tokens and durations;
     - the outcome, `LLMError.kind`, the HTTP status, and a fixed app message per kind.

     Never stored: `serverMessage`, `raw`, stacks, page text, URLs or base URLs.
   - **Origin:** stored only if the user ticks "include site names" in Options. It is off by default.
6. **Export and clear in Options.**
   - **Before export:** the full JSON is shown, and the user can untick site names.
   - **Download:** through a blob link, needing no new permission.
   - **Wording:** "Nothing is sent automatically. Share this file privately."
7. **Panel error boundary.** `componentDidCatch` at the panel root. The fallback has "Reload panel" and "Copy
   details" (kind and component name only) and writes a diagnostics entry.
8. **Privacy notice.** Bump the privacy notice version (`src/entrypoints/sidepanel/privacy.ts`) and add one line on
   diagnostics: kept on this device, exported only by the user. Users who acknowledged version 1 see the notice once
   more.
9. **Tests.**
   - **Unit:** the 50-entry prune; concurrent writers from two contexts; a provider error whose body contains page
     text is absent from the entry; the snippet jobs are not logged; the boundary fallback.
   - **E2E:** run a job with a mock error body that echoes the page, export, then assert the job is present and no
     page text or origin is.

## Files

- **Create:** `src/shared/diagnostics.ts` and its test; `src/entrypoints/sidepanel/ErrorBoundary.tsx`;
  `scripts/check-bundle.mjs`, `scripts/bundle-budget.json`; `e2e/budgets.json`, `e2e/perf.spec.ts`.
- **Modify:**
  - `src/entrypoints/sidepanel/translator.ts` (`onJobEnd`), `src/entrypoints/sidepanel/main.tsx` (the boundary);
  - `src/entrypoints/sidepanel/privacy.ts` and `src/entrypoints/sidepanel/PrivacyNotice.tsx` (the version and the
    line);
  - `src/entrypoints/options/*` (the Diagnostics section);
  - `package.json`, `.github/workflows/ci.yml` (the step).
  - Only if step 2 applies: `src/extract/index.ts`, `src/entrypoints/content.ts`, `src/extract/watch.ts`,
    `tests/content.test.ts`.
  - Only if the panel's `patch()` breaks its budget: `src/entrypoints/sidepanel/jobs.ts` and the panel views it
    feeds.

## Verification

- The step 1 profile breakdown is in the phase report.
- Snapshot, stability and parity tests are green.
- `pnpm run e2e` passes, including the perf spec. `pnpm run build && pnpm run check:bundle` are green.
- An exported diagnostics file is shown in the report: no page text, origins only when opted in.

## Risks

- **The panel's `patch()` is the real long task.** It is fixed in this phase (Validation Session 1). Its tests are
  the existing jobs and panel suites plus the perf spec.
- **Sliced reads change watcher timing.** The single in-flight read and the suspended max timer guard this. The SPA
  fixtures in e2e cover it.
