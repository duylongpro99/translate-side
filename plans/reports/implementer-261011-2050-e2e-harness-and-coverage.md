# Implementer report: E2E harness and coverage (M6-E2)

Branch `m6` in the `../translate-side-m6` worktree, based on e749530. Nothing pushed.
The suite is ready for its first CI run on `m6`, which needs a push.

## Outcome

`pnpm run build && pnpm run e2e` passes: 20 page specs, 4 flow specs and the page-count check (25 tests),
with zero console errors from the worker, the panel and the page. `pnpm check` is green and now includes
coverage, with thresholds on `src/engine/**` and `src/llm/**`. CI gets an `e2e` job and runs on pushes to `m6`.
No file under `src/` changed (`git diff e749530 -- src/` is empty), and `check:manifest` passes unchanged.

## Commits

| Hash | Subject |
|---|---|
| 5e5580c | test: add Sphinx docs, Jekyll blog post and Discourse thread site fixtures |
| 9dc9464 | test: Playwright e2e suite for the built extension against a mock provider |
| 6337489 | test: coverage thresholds for engine and llm in pnpm check |
| d072885 | ci: run the e2e suite and coverage, and build the m6 branch |
| e880c11 | test: e2e flow for a malformed provider stream and Retry failed |

## Step 1: spike answers

The spike ran in headless `channel: 'chromium'` (Playwright 1.64.0, Chromium 156), using the ext-run pattern.

1. **Panel binding: yes.** The panel tab was opened in the background and showed `idle`. Once the worker
   made the fixture tab active (`chrome.tabs.update`), the panel bound to it and ran the job.
2. **Console capture: yes, from all three sources.**
   - `Worker.on('console')` receives the worker's errors.
   - The fixture tab's `page.on('console')` receives `console.error` from the extension's isolated world
     (a content-script world). CDP `Runtime.consoleAPICalled` sees the same messages, so the CDP fallback
     is not needed.
   - The panel tab's `page.on('console')` receives the panel's errors. It also repeats the worker's messages.
   - A negative check confirmed that the gate fails a test on each source: an isolated-world error, a
     worker error and a panel error.
3. **One page against the mock: yes.** On goblog-pipelines, 73 of 73 blocks were final (26 kept),
   from 1 analyze call and 6 translate calls, in 1.0 s.

## What was built

- **`e2e/fixtures.ts`** (the harness).
  - **Build copy:** the build is copied to `.output/e2e-ext`, and `http://127.0.0.1/*` is added to the
    copy's host permissions.
  - **Launch:** one persistent context per test, using the throttling flags from `e2e/playwright.config.ts`.
  - **Seeding:** through the worker: the `custom-openai` mock connection with a placeholder key, plus the
    privacy acknowledgement (optional).
  - **Panel:** opened as a background tab. The page tab is made active and Alt+T is replayed through the
    worker, as `ext-run.mjs` does.
  - **Console gate:** any console error fails the test. Each test may allow only the errors it provokes
    on purpose.
- **`e2e/servers.ts`** (Node `http` only).
  - **Fixture server:** serves `fixtures/` on 127.0.0.1:4173.
  - **Mock:** an OpenAI-chat SSE mock on 127.0.0.1:4174. It routes the analyze call by `<document>`,
    answers each segment with `vi:` in the segment grammar, injects a 429 or a malformed stream on demand,
    and logs every call.
  - **Ports:** fixed. A port in use fails with the `lsof -i :PORT` hint.
- **`e2e/pages.spec.ts`:** one test per page, each with an explicit expectation.
  - 18 *whole* pages: every block is final, or kept by design.
  - 2 *lazy* pages: the first five translatable blocks are final, some are still waiting, and the bar says
    "the rest as you read". After "Translate the rest", every block is final.
- **`e2e/flows.spec.ts`:**
  - **Privacy:** the notice blocks sending (0 mock calls) until "Got it". Then the page translates, and
    the acknowledgement is stored.
  - **SPA route change:** a pushState link makes the panel read the page again, and nothing is sent until
    "Translate this page". Then only new segments go out: the note shared by every route was sent once.
  - **429:** the backoff note shows "Rate limited", then the job recovers. Exactly one 429 was sent.
  - **Malformed stream:** the chunk's blocks fail, and "Retry failed" sends the same segments again and
    finishes them.
- **Coverage:** `vitest` and `@vitest/coverage-v8` are pinned at 5.0.3, and `@playwright/test` at 1.64.0.
  `test:coverage` replaces `test` in `pnpm check` and in CI.
- **CI:** `m6` is added to the push branches, and the unit step runs `test:coverage`. A new `e2e` job runs
  `playwright install --with-deps chromium`, then the build, then `pnpm run e2e`. It uploads
  `test-results/` and `playwright-report/` only on failure, with `actions/upload-artifact@v7` (the latest
  major release).
- **Fixtures:**

  | Fixture | Source | License | Segments | Translatable |
  |---|---|---|---|---|
  | `sphinx-quickstart` | sphinx-doc.org | BSD-2-Clause | 87 | 77 |
  | `jekyll-4-0-0-released` | jekyllrb.com | MIT | 43 | 42 |
  | `julia-discourse-sin-loop` | discourse.julialang.org | CC-BY-SA-4.0, code also MIT | 60 | 52 |

  Manifest, ATTRIBUTION, README and snapshots are updated, and the 12 existing snapshots did not change.
  Stack Overflow was the first choice for the forum page, but Cloudflare serves headless Chrome a challenge
  page, so a Discourse Q&A thread replaces it.

## Evidence

- **e2e:** `pnpm run e2e` gives 25 passed in 34 s. A `--repeat-each=3` run of the first 24 tests (before
  the malformed flow existed) gave 72 of 72 passed, with no flakes.
- **Coverage** (unit suite, 1723 tests). Thresholds are the measured values rounded down to the nearest 5.

  | Area | Statements | Branches | Functions | Lines | Thresholds (S/B/F/L) |
  |---|---|---|---|---|---|
  | `src/engine/**` | 98.28 | 91.50 | 98.64 | 99.42 | 95 / 90 / 95 / 95 |
  | `src/llm/**` | 90.87 | 86.79 | 88.98 | 93.01 | 90 / 85 / 85 / 90 |
  | all files | 93.89 | 88.09 | 90.67 | 96.47 | none |

  The thresholds are enforced: a temporary engine statements threshold of 99 failed with
  `Coverage for statements (98.28%) does not meet "src/engine/**" threshold (99%)`.
- **`pnpm check`:** exit 0. That covers lint, typecheck, engine boundary, 1723 tests with coverage, build,
  and `check:manifest` OK.
- **`git diff e749530 -- src/`:** empty.

## Deviations and findings for the supervisor

1. **`large-table` is lazy.** It has 609 translatable cells, over `LAZY_SEGMENTS` (400). The phase file's
   Starting point names only `long-100-screens` as lazy. The spec gives `large-table` the lazy expectation
   too. That reflects measured behaviour and changes no scope.
2. **The SPA flow clicks "Translate this page" after the route change.** A read after a navigation is not
   a request to translate (by design, M5-E3), so the panel offers it. The flow asserts that nothing is
   sent before the click, and that only new segments are sent after it.
3. **A fourth flow covers the malformed stream.** The phase file asks the mock to inject one "for the error
   flows". Without this flow, that capability would be unused. The flow pins today's behaviour: no
   automatic retry, the blocks fail, and "Retry failed" recovers them.
4. **Files changed outside the phase's Files list:**
   - `spikes/s3/sites.json`, `capture.mjs` and `attribution.mjs`: the capture tooling that
     `fixtures/sites/README.md` prescribes. `capture.mjs` gained an opt-in `viewportHeight` (2 lines),
     because Discourse renders only the posts near the viewport.
   - `e2e/tsconfig.json`: type-checks the e2e files. It runs as part of `pnpm run e2e`, so the root
     `tsconfig.json` and the `typecheck` script are untouched.
   - `fixtures/sites/layout-table-thread.html`: the replica's `<meta name="referrer" content="Question">`
     logged a console error, and is now `origin`. Its snapshot did not change.
5. **What the harness changes in the test environment (never in the product):**
   - Requests to hosts other than 127.0.0.1 (the captured pages' `<base href>` stylesheets, fonts and
     images) get an empty 200, so runs are offline and deterministic.
   - Relative assets that were never stored (`s.gif`) get an empty 200. A missing `.html` is still a 404.
   - The fixture server cuts `<link rel="manifest">` from the HTML it serves. Chromium reads an intercepted
     cross-origin manifest as empty, whatever the answer, and logs a syntax error. Three pages have one.
   - Errors logged after the harness starts closing the browser are ignored. Closing it makes the worker's
     tab cleanup log "The browser is shutting down".

## Manual items for phase 7 (step 8)

These M5 open human items are not covered by e2e:

- the real permission prompt (e2e grants `http://127.0.0.1/*` through the copied manifest);
- rapid `Alt+T` presses and the toolbar-icon toggle (e2e replays the action handler's work through the worker);
- the Chrome 138–140 toggle fallback;
- screen-reader speech;
- dark-mode contrast;
- the real docked side panel (e2e drives `sidepanel.html` as a background tab).

## Left open

- **Coverage timing in CI:** under coverage, the slowest unit test (`layout-table-thread` fixture chunks)
  takes 9.5 s locally against a 30 s timeout. It timed out once while another full test run was going on
  at the same time. If the CI runner is much slower, it could flake. The first CI run will show the margin.
- **Production console noise:** on a malformed SSE line, the OpenAI SDK logs `console.error("Could not
  parse message into JSON")` in the panel. This is not an extension bug. It is noted for the beta's
  diagnostics.
- **Extraction gap on forums:** Discourse quotes and link previews sit in `<aside>`, and extraction drops
  them as page chrome (`src/extract/clean.ts`). Quoted text in forum threads is not translated.
- **Missing noise lists:** `fixtures/noise.json` has no list for the three new fixtures. The forum page
  has a few UI strings ("select all", "1 / 9").
- **Re-capture command is broken:** a full `node attribution.mjs` run throws on the two layout-table
  replicas, which have no entry. The README's command doesn't work as written. This bug predates the phase.
