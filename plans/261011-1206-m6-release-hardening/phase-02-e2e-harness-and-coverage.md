---
phase: 2
title: "E2E harness and coverage"
status: pending
priority: P1
effort: "2d"
dependencies: []
---

# Phase 2: E2E harness and coverage

<!-- Updated: Red Team 2026-10-11. No e2e build mode and no ?tabId hook: the harness reuses the ext-run pattern.
     The mock is self-contained. Lazy pages have their own expectation. The m6 CI trigger and test:coverage join
     pnpm check. axe is dropped. -->

## Goal

CI loads the built extension in Chromium and translates 20 fixture pages against a local mock provider, with no
console errors. Unit coverage has thresholds for `engine/` and `llm/`. Production code is not changed to make
testing possible.

## Plan tasks owned

- M6-E2: Playwright e2e with the extension loaded, a mock provider and fixture pages; unit coverage targets for
  `engine/` and `llm/`.

## Done criteria (copied from docs/plans/M6-release-hardening.md)

- §2: "CI runs Playwright e2e tests with the extension loaded against a mock provider over 20 fixture pages"
- §3 #2: "E2E on fixture pages, mock provider | 20 of 20 pass, no console errors"
- §5: "Coverage targets | Set for `engine/` and `llm/` only (they hold the logic); UI covered by e2e."
- §7 demo 1: "Show the CI run: lint, typecheck, unit, e2e (20 pages), eval gate green." The eval gate part is shown
  from the recorded local run (phase 1, Validation Session 2).

## Starting point

- **Existing harness.** `scripts/eval/ext-run.mjs` already drives the built extension, using `playwright-core` from
  an env var. It:
  - copies the build and adds `host_permissions` to the copy (:50-54);
  - passes throttling flags (`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, :61/:65);
  - opens `sidepanel.html` in a tab, then makes the page active (`chrome.tabs.update`, :105-118);
  - seeds a `custom-openai` connection (:84-87) and sets the session `access:<tab>` flag (:122-124);
  - waits on `[data-testid=job]` (:132).
- **Active-tab gating.** The panel follows `tabs.onActivated` in its window (`src/entrypoints/sidepanel/controller.ts:155-158,180`),
  and only the active tab's job sends requests (`jobs.ts:721-727`).
- **Fixtures.** 17 HTML pages: 12 in sites, 3 in spa, 2 in long. `long-100-screens` is lazy by design (722
  translatable segments, over `LAZY_SEGMENTS` = 400, `jobs.ts:443,762`).
- **CI.** `ci.yml` runs on push to master/main and on pull requests (`.github/workflows/ci.yml:3-6`). `gh` is
  read-only, so no PR can be opened from here.
- **Coverage.** `vitest.config.ts` has no coverage block. The lockfile resolves vitest 5.0.3 (`pnpm-lock.yaml:1738`).
- **Research** (`researcher-261011-1901-...md` §1):
  - Use `launchPersistentContext` with `channel: 'chromium'`; headless works with extensions.
  - Read the extension id from the service worker URL.
  - There is no side-panel API, and permission prompts cannot be accepted automatically.

## Steps

1. **Spike, half a day at most.** In headless `channel: 'chromium'`, using the ext-run pattern, prove that:
   - the panel page, opened as a background tab in the same window as the fixture, binds to the fixture once that
     tab is made active. The panel follows the active tab of its own window only (`controller.ts:153-158`);
   - console events are captured from the worker, the panel page and the fixture tab, including content-script
     logs, which the research left unconfirmed;
   - one page translates against the mock.

   Record the answers in the phase report.
2. **Harness** (`e2e/fixtures.ts`).
   - **Build copy:** copy `.output/chrome-mv3` to a fixed directory under `.output/e2e-ext/` and add
     `host_permissions: ['http://127.0.0.1/*']` to the copy's manifest. The production build stays untouched.
   - **Launch:** a persistent context with the throttling flags written down in `e2e/playwright.config.ts`.
   - **Seeding:** through the service worker: the mock connection (`custom-openai` → `http://127.0.0.1:4174/v1`,
     placeholder key), the privacy acknowledgement, and the `access:<tab>` flag.
   - **Panel binding:** the panel is a tab in the same window as the fixture page. The fixture tab is made active
     through the worker (`chrome.tabs.update`), as `ext-run.mjs:105-118` does. The panel tab then stays in the
     background, and the throttling flags keep it running. Specs never bring the panel tab to the front, because
     that would rebind the panel to itself and pause the job.
   - **No production hooks:** no production source file changes for testing.
3. **Servers** (`e2e/servers.ts`, self-contained, Node `http` only).
   - **Fixtures:** served from `fixtures/` on `127.0.0.1:4173`.
   - **Mock:** an OpenAI-chat SSE mock on `127.0.0.1:4174`. It returns deterministic output in the segment grammar.
     It routes the analyze call by the request content (compare the eval mock's `user.startsWith('<document>')`,
     `run.ts:109`), so it handles the system message correctly over HTTP. The mock can also inject a 429 and a
     malformed chunk for the error flows.
   - **Ports:** fixed. Find a stale owner with `lsof -i :PORT` rather than starting a duplicate.
4. **Fixtures.** Add 3 openly licensed pages to reach 20: a Sphinx / Read the Docs page, a Hugo or Jekyll blog post,
   and a forum or Q&A thread. Update `fixtures/sites/manifest.json`, the attribution file and the snapshots, following
   `fixtures/sites/README.md`.
5. **Specs** (`@playwright/test`, pinned exact).
   - **Per page** (`e2e/pages.spec.ts`), each with an explicit expectation:
     - *whole* pages: every extracted block shows a translation;
     - *lazy* pages (`long-100-screens`): the blocks around the viewport are translated, then "Translate the rest"
       translates every block.

     Every page also has zero console errors from the worker, the panel and the page.
   - **Flows** (`e2e/flows.spec.ts`):
     - the privacy notice blocks sending until it is acknowledged;
     - an SPA route change re-extracts only new segments (fixtures/spa);
     - a mock 429 shows the retry state, then recovers.
6. **CI.**
   - **Triggers:** add `m6` to the `push` branches in `ci.yml`.
   - **e2e job:** a new job runs `pnpm exec playwright install --with-deps chromium`, `pnpm run build`, then
     `pnpm run e2e`. It uploads the trace and screenshots only on failure.
   - **Ownership:** this phase owns `ci.yml`. Later phases append steps.
7. **Coverage.**
   - **Dependencies:** pin `vitest` and add `@vitest/coverage-v8` at the same exact version.
   - **Thresholds:** `coverage.thresholds` glob entries for `src/engine/**` and `src/llm/**`, at the measured values
     rounded down to the nearest 5.
   - **Script:** `test:coverage` replaces `test` inside `pnpm check` (`package.json:23`), so local and CI checks stay
     the same (`ci.yml:18`).
8. **Manual items.** List the M5 open human items that e2e doesn't cover, for phase 7:
   - the real permission prompt;
   - rapid `Alt+T` presses and the toolbar-icon toggle;
   - the Chrome 138–140 toggle fallback;
   - screen-reader speech;
   - dark-mode contrast;
   - the real docked panel.

## Files

- Create: `e2e/playwright.config.ts`, `e2e/fixtures.ts`, `e2e/servers.ts`, `e2e/pages.spec.ts`, `e2e/flows.spec.ts`,
  and the 3 new fixture HTML files with their snapshots and attribution.
- Modify: `vitest.config.ts`, `package.json` (scripts `e2e`, `test:coverage`, and `check`), `pnpm-lock.yaml`,
  `.github/workflows/ci.yml`, `fixtures/sites/manifest.json`, `.gitignore` (`.output/e2e-ext`, Playwright reports).

## Verification

- `pnpm run build && pnpm run e2e`: 20/20 page specs and all flow specs pass, with zero console errors.
- `git diff master -- src/` shows no change made for testing. `pnpm run check:manifest` passes unchanged.
- `pnpm check`, which now includes coverage, is green. The CI run on `m6` shows green `check` and `e2e` jobs.

## Risks

- **Content-script console capture misses logs.** Capture them through a CDP session on the tab (the
  `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` events), which needs no product change.
- **Timing flakiness.** Wait on panel state (`data-testid`), never on sleeps.
