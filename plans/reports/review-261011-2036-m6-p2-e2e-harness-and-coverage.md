# Review: E2E harness and coverage (m6, e749530..9b4ef69)

Reviewed read-only in `../translate-side-m6`. The commits are 5e5580c, 9dc9464, 6337489, d072885, e880c11 and 9b4ef69.

## Verdict

**There are no blocking findings.** The suite meets §3 #2 locally. On an independent run, `pnpm run e2e` passed
25 of 25 tests (20 page specs, 4 flows, and the page-count check) in 52 s, with the zero-console-error gate active.
`git diff e749530..m6 -- src/` is empty. §2 and the CI part of the §7 demo stay unverified until CI runs on `m6`,
which needs a push. That is a pending item, not a defect.

## Findings

All four findings are non-blocking. Each one concerns how far the "no console errors" gate reaches (§3 #2, and
development-rules.md: "no fake shortcuts to satisfy a check").

1. **Unhandled promise rejections in the content script are not caught.**
   - **Where:** `e2e/fixtures.ts:95-101` (watch) and `:146-153` (translate).
   - **Probe:** I injected a test content script through `chrome.scripting.executeScript`, as the harness does.
     The gate caught its `console.error` (through `page.on('console')`) and its thrown error (through
     `pageerror`). It did not catch its `Promise.reject`: neither `pageerror` nor CDP
     `Runtime.exceptionThrown` reported it. A main-world rejection is reported by both.
   - **Failure scenario:** an async content-script path rejects without a handler, for example a port message
     or an extraction step. Chrome shows it on the page's console as "Uncaught (in promise)", but e2e stays green.
   - **Fix (test side only):** before the content script runs, `translate()` injects a function into the same
     isolated world (`executeScript({ func })`) that sends `unhandledrejection` to `console.error`. This is the
     same approach `fixtures.ts:106-109` already uses for the worker.
2. **The teardown window ignores every error, not only the shutdown one.**
   - **Where:** `e2e/fixtures.ts:89-93`.
   - **Problem:** once `closing` is set, every message is dropped. The stated reason covers only "The browser is
     shutting down".
   - **Failure scenario:** a real error in the worker's tab-removal cleanup (`tabs.onRemoved` handlers) during
     `context.close()` is hidden.
   - **Fix:** while closing, filter on that message instead of dropping all messages.
3. **Only the first worker instance is watched.**
   - **Where:** `e2e/fixtures.ts:103-109`.
   - **Problem:** `worker.on('console')` and the error and rejection listeners are attached to
     `context.serviceWorkers()[0]`. A worker that Chrome restarts within a test (MV3 idle stop, or a crash) is
     a new `Worker` object with no listeners.
   - **Risk today:** low, because tests take about 1–2 s and the flows stay under 30 s.
   - **Fix:** watch `context.on('serviceworker')` too.
4. **External requests are answered with an empty 200 from every source.**
   - **Where:** `e2e/fixtures.ts:101`.
   - **Problem:** the route answers every non-127.0.0.1 request, whoever makes it. The comment's purpose is the
     page's `<base href>` assets.
   - **Failure scenario:** an unexpected outbound call from the extension, for example a stray provider or
     telemetry fetch, would succeed silently instead of showing up. It is noted because the public privacy claim
     is that nothing is sent anywhere except the chosen provider (DESIGN §8).
   - **Optional fix:** record route hits that are not page subresources and assert that none comes from the
     extension.

## Checks that passed

- **Harness, as the phase requires:**
  - It reuses the ext-run pattern: a copied build in `.output/e2e-ext` with `http://127.0.0.1/*` added; the
    throttling flags kept in `playwright.config.ts`; seeding through the worker; and the panel as a
    background tab, activated with `tabs.update`.
  - It adds no production hooks, no e2e build mode and no `?tabId`.
- **Servers:**
  - They use Node `http` only, on the fixed ports 4173 and 4174. On EADDRINUSE they print an `lsof` hint.
  - The mock routes the analyze call by `<document>`, as `run.ts` does. It can inject a 429 with `Retry-After`
    and a malformed stream.
- **Waiting:** the specs wait on `data-testid` and data-status polls. They contain no sleeps.
- **Activation path:**
  - The `translate()` helper matches `injectInto` (`src/shared/inject.ts:25-58`). The only difference is that
    the access record carries no `trigger`, and the panel reads such a record as a gesture
    (`controller.ts:239-241`).
  - The panel's `autoInject` needs a stored allowlist entry (`sites.ts autoTranslates`). The copied host
    permission therefore does not change the panel's behaviour, and there is no injection race.
- **Coverage:**
  - The thresholds are the reported measurements rounded down to 5: engine 98.28/91.50/98.64/99.42 →
    95/90/95/95, and llm 90.87/86.79/88.98/93.01 → 90/85/85/90.
  - `vitest` and `@vitest/coverage-v8` are pinned at 5.0.3, and `@playwright/test` at 1.64.0.
  - `test:coverage` replaces `test` both in `check` and in CI.
  - I did not rerun coverage: another process (pid 59254) held the `coverage/` lock in the worktree at the time.
    The figures above are the implementer's.
- **CI:**
  - The `m6` push trigger is added.
  - The new `e2e` job runs `playwright install --with-deps chromium`, then the build, then `e2e`. It uploads
    artifacts only on failure.
  - The action versions match the existing job.
- **Public repo:**
  - No home path, username, key or token appears in the diff, and the fixtures contain no csrf tokens or emails.
  - The code, test names and commit subjects contain no plan IDs or finding codes.
  - The Co-Authored-By trailers follow the precedent on master.
- **Ignored output:** `.gitignore` covers `.output/`, `coverage/`, `test-results/` and `playwright-report/`.

## Deviations (facts)

1. **`large-table` is tested as lazy.** This matches the code: it has 609 translatable cells, over
   `LAZY_SEGMENTS` = 400, and it passed with the lazy expectation. The phase's Starting point simply missed it.
2. **The SPA flow clicks "Translate this page".** This matches M5 behaviour: a read without a gesture is not
   a translate request.
   - The flow asserts that nothing is sent before the click (`flows.spec.ts:96`), and that only uncached
     segments are sent after it (`:101-104`).
   - It still covers DESIGN §9 ("Unchanged segments come from the cache").
3. **The malformed-stream flow adds scope.** It uses the injection capability that phase step 3 requires.
   - It allows only the OpenAI SDK's two parse messages (`flows.spec.ts:127`).
   - Those messages are product console output on a malformed stream (the report's "Left open" says so).
     The user may want that tracked.
4. **Some files are outside the Files list.**
   - The capture tooling (`spikes/s3/*`) is what `fixtures/sites/README.md` prescribes. The `viewportHeight`
     option is opt-in and used only by Discourse.
   - `e2e/tsconfig.json` is type-checked inside `pnpm run e2e` only, so the root `typecheck` does not cover
     `e2e/`. Lint does.
   - In the `layout-table-thread` replica, the invalid `meta referrer` value was a real page-side console error
     with filler text. Changing it to `origin` touches nothing that extraction reads.
5. **Fixture licenses check out.**
   - Julia Discourse: its ToS (fetched today) puts posts after 2020-03-06 under CC-BY-SA-4.0 and code
     contributions additionally under MIT. The posts are dated 2025.
   - Sphinx is BSD-2-Clause, and the Jekyll repo, including the docs and posts, is MIT.
   - The attribution comment, the manifest, ATTRIBUTION.md and the README table are all present.
   - CC-BY-SA content already has a precedent in the repo (`twir-671`).
6. **The test-environment interceptions are legitimate.** All three only remove page-owned noise: the original
   hosts' assets, missing `s.gif`-type images, and a cross-origin web app manifest that Chromium parses as
   empty. None of them touches extension traffic or extension console channels. The two exceptions are the
   blanket teardown window (finding 2) and the blanket external route, which also covers requests the extension
   might make (finding 4). Neither hides anything in today's run, because both suites pass. Finding 1 is a gap
   the deviation did not introduce: Chromium does not report isolated-world rejections at all.

## Unresolved questions

- Should the SDK's `console.error` on a malformed SSE line count as a product console error under §3 #2? Today
  the malformed flow allows it by design.

## Round 1 re-review (930f1b4, b8ddad4)

**Verdict: there are no blocking findings, and the fixes can be accepted.** I did not run e2e, as asked, because
the tester owns that run. My own probes used a separate test extension on port 4199.

- **Finding 1: my original finding was mostly wrong, and the fix is harmless.**
  - In my first probe, the content script ended with `Promise.reject(...)`. That made the rejection the
    script's completion value. `chrome.scripting.executeScript` hands that value to the caller, so the
    rejection counted as handled and was reported nowhere.
  - A second probe (`probe4`) rejected a promise later, inside a `setTimeout`. That rejection fires the
    isolated world's `unhandledrejection` listeners, and Playwright's `pageerror` reports it too. The original
    gate therefore already caught content-script rejections that happen after the script's first run.
  - A rejection in the script's top-level promise reaches the caller of `executeScript` instead. In the
    harness, that makes `worker.evaluate` in `translate()` fail the test.
  - The new listener (`fixtures.ts:172-177`) is therefore redundant, but it is not wrong. A rejection may now
    be listed twice, once from `pageerror` and once from the listener's console line. That only matters when
    the test has already failed.
  - Keeping or removing it is the implementer's call. I retract the finding as originally stated.
- **Finding 2 is fixed.** Only `/The browser is shutting down/` is dropped, and only once the close has started.
- **Finding 3 is fixed in code, but not proven with a restart.** `context.on('serviceworker')` is registered,
  and a `Set` keeps the first worker from being watched twice. As before, the listeners are added after the
  worker starts, so an error during a restarted worker's startup is missed. The risk is low.
- **Finding 4 is fixed, and the probe confirms it.** In `probe3`, a `fetch` to an outside host made both by
  the worker and by an extension page was routed and recorded. `request.serviceWorker()` identified the worker,
  and the frame URL identified the panel. A content script's requests count as page requests and still get the
  empty 200, as the supervisor ruled.
- **b8ddad4 is fine.** The `describe` options set a 60 s timeout, and the comment states why. It carries no plan
  IDs. The `Review T-B1` comment in the test body was already there before this commit.
