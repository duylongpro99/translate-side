# Implementation report: performance, bundle budget, diagnostics

Branch `m6` in `../translate-side-m6`, from f6e5092 to 278180e. Not pushed.

## Summary

The 100-screen page now stays within budget. Each renderer has no long task over 100 ms, and the JS heap of
each tab stays within its measured value plus 25%. The panel's only long task (~142 ms) turned out to be the
engine's document-wide check, not `patch()`, and is fixed with identical output. The bundle has a checked
gzip budget per file and in total, enforced by `pnpm check` and CI. Settings can review and export a local
diagnostics log of the last 50 page jobs. The panel has an error boundary. The privacy notice is at version 2
and has a line about diagnostics.

## Commits

| Commit | What |
|---|---|
| 031dc35 | perf: the wrong-script check tests only letters of the scripts it knows (`src/engine/check/checks.ts`) |
| 807d5a1 | test: long-task and heap budgets on the 100-screen page, measured over CDP |
| 00f644e | build: gzip bundle budget, `check:bundle` in `pnpm check` and CI |
| b47c245 | feat: local diagnostics log (`src/shared/diagnostics.ts`, `onJobRecord` in jobs/translator) |
| ee0908e | feat: review and export the log in Settings |
| cc6497f | feat: panel error boundary |
| b4300a6 | feat: privacy notice version 2 with the diagnostics line |
| 1e15502 | test: e2e with a provider error that echoes the page |
| 278180e | docs: README |

## Step 1 profile breakdown

Method:
- A CDP `Tracing` trace (devtools.timeline) plus a `Profiler` sampling CPU profile, both started from the test
  harness. There is no hook in the shipped code.
- Chrome traces one target at a time, so the page tab and the panel tab are recorded in separate runs of the
  same flow: read, first screens, Translate the rest, every block final.
- Attribution used an unminified copy of the build, from a scratch WXT config that is not committed.
- The fixture `long-100-screens` was in front, with the mock provider. There were 3 runs on each build.

| Renderer | Task | Before | After the check fix |
|---|---|---|---|
| page | content-script read: `extractPage` ~43 ms JS, `watchViewport` 2, `readSignature` 1, GC 3 | 50–55 ms | same (production build: max 50.2 ms over 5 runs) |
| panel | engine check stage: `scriptsIn` 104 ms, `bigrams` 8, `checkScript` 6, `copiesNeighbour` 2, GC 3 | 141–149 ms | no task ≥ 50 ms |
| panel | one SSE parse task (`_iterSSEMessages`) | 68 ms (one run) | not seen |

Consequences:
- **Step 2 skipped.** Extraction is the page's longest task, but it runs about 50 ms, under the 100 ms budget.
  `extractPage` is unchanged and there is no sliced entry.
- **`patch()` never appeared as a long task.** The O(n) carry-over is left as it is.
- **Compose and Readability are not long tasks** on this fixture.

## Budgets

- **`e2e/budgets.json`.**
  - Long tasks: 100 ms per renderer.
  - Heap: JSHeapUsedSize after a forced GC once every block is translated, the maximum of 5 production runs
    plus 25%.

  | Tab | Measured | Budget |
  |---|---|---|
  | page | 2,859,680 B | 3,574,600 B |
  | panel | 13,466,680 B | 16,833,350 B |

- **`scripts/bundle-budget.json`.** Gzip level 9 of each built .js and .css file, named without its hash,
  plus 10%. The baseline total was 279,529 B, so the total budget is 307,482 B. After this phase the total is
  282,290 B. `--update "<note>"` regenerates the budget. A new or missing file fails the check.

## Diagnostics sample (from the e2e, mock 400 that quotes the segments)

```json
{
  "format": "translate-side-diagnostics",
  "formatVersion": 1,
  "exportedAt": "2026-10-12T03:35:45.597Z",
  "entries": [
    {
      "at": "2026-10-12T03:35:45.179Z", "cached": 0, "calls": 1, "chrome": "156.0.0.0", "chunks": 1,
      "durationMs": 146, "endedAt": "2026-10-12T03:35:45.325Z",
      "errors": [{ "count": 9, "kind": "bad_request", "message": "The provider rejected the request, or the connection is set up wrongly.", "status": 400 }],
      "extension": "0.0.1", "failed": 9, "id": "1791776145179-7ozk68", "lazy": false, "model": "mock-model",
      "outcome": "done", "presetId": "custom-openai", "promptIds": ["translate@2"], "segments": 9,
      "strategy": "contextual", "tokens": { "cachedInput": 0, "input": 0, "output": 0 }, "type": "page-job"
    }
  ]
}
```

The e2e asserts the following:
- No segment text, no "Invalid request" (the provider's message), no `127.0.0.1`, and no page path appear in
  the file or in storage.local.
- With site names off (the default), there is no origin.

## Verification

- `pnpm check` is green: 97 files and 1797 tests, then build, `check:bundle` and `check:manifest`. The
  manifest is unchanged and no permission was added.
- `pnpm run e2e`: 29 passed, including both perf tests and the diagnostics flow, with zero console errors.

## Deviations (for the supervisor)

1. **`src/engine/check/checks.ts` was changed.** It is not in the plan's file list. `scriptsIn` now
   pre-filters with one combined regex, and its output is identical. A test was added. The eval gate applies.
2. **The diagnostics hook is `onJobRecord`, not `onJobEnd`.** It is called at the start (`started`) and at
   the end of each run, and also with `replaced` when a running job is replaced. Lazy rounds are separate
   runs, so a long read adds several entries.
3. **The panel's `JobConnection` gained `presetId`** (`route.ts`), so the log can name the preset.

## Open items

- **CI risk.** Page extraction is about 50 ms locally against the 100 ms budget, and the perf spec has not
  run on a GitHub runner yet.
- **The eval gate** must be run by the tester, because `src/engine/**` changed.
- **Entries stay `started` when the panel closes.** No end record is written for a panel close (there is no
  unload hook), so those entries stay `started` by design.
