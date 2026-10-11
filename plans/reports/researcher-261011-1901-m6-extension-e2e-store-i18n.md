# M6 research: extension e2e, Chrome Web Store listing, i18n, coverage, paid eval in CI

Date: 2026-10-11. Scope: Translate Side (WXT 0.21.4, Preact, Vitest 5.0.x, Node 24, GH Actions ubuntu-latest, min Chrome 138).
Versions checked on npm today: `@playwright/test` 1.64.0, `vitest` 5.0.3, `@vitest/coverage-v8` 5.0.3, `@wxt-dev/i18n` 0.2.8.

## Bottom line (ranked recommendations)

1. **E2E:** use Playwright Test with `chromium.launchPersistentContext(dir, { channel: 'chromium', args: [--disable-extensions-except, --load-extension] })`, run **headless** (no xvfb), load `.output/chrome-mv3`. Test the panel by opening `chrome-extension://<id>/sidepanel.html` in a tab. Grant hosts via an **e2e build mode that lists the test origins in `host_permissions`** (granted at load); unit-test the request flow separately. Do not try to click the native permission prompt.
2. **Store:** expect to need a 128px icon, at least one 1280x800 screenshot, a 440x280 small promo tile, a privacy policy URL, and Privacy-tab answers. Data use for this extension is "Website content" sent to the user's provider. Since the August 2026 policy, an **in-UI prominent disclosure plus consent** is a hard requirement. Plain-HTTP endpoints (`http://*/*`) conflict with the "secure transmission" rule (see Risks). Start **Unlisted** for the first review.
3. **i18n:** use `@wxt-dev/i18n` (module plus `src/locales/{en,vi}.yml`) rather than hand-maintained `public/_locales`. It is a thin, sync wrapper over `chrome.i18n`, so it is framework-agnostic and works in Preact. Set `default_locale: 'en'` and use `__MSG_*__` in the manifest. The Vietnamese code is `vi`.
4. **Coverage:** pin `@vitest/coverage-v8` to the **exact** vitest version, because its peer dependency is `vitest: "5.0.3"`. Use glob keys under `coverage.thresholds`.
5. **Paid eval:** put it in a separate workflow with `workflow_dispatch` plus a `push` to master with a `paths:` filter. Do not run it on `pull_request` (forks get no secrets) or on `pull_request_target`. Gate on a job-level env var, emit `::notice::` when the key is empty, and use `concurrency` with `cancel-in-progress`.

## 1. Playwright e2e for an MV3 extension

**Launch (official).** Extensions work only with `launchPersistentContext`, and only in the Playwright-bundled Chromium. Branded Chrome and Edge "no longer support the command-line flags needed to side-load extensions" [P1]. Chrome 137+ removed `--load-extension` from branded builds; Chromium and Chrome for Testing keep it [C1]. Our min version is 138, so the run must not use `channel: 'chrome'`.

**Headless: yes.** "The `chromium` channel lets extensions run in headless mode" [P1]. Chrome docs note that only new headless supports extensions [C2]. The default `chromium-headless-shell` does not, so pass `channel: 'chromium'` and install it with `pnpm exec playwright install --with-deps chromium`, not `--only-shell`. Xvfb is unnecessary; keep `xvfb-run` only as a fallback if a headed-only bug appears.

**Extension id.** Take it from the MV3 service worker URL [P1]:
```ts
let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker');
const extensionId = sw.url().split('/')[2];
```
Wrap the context and id in Playwright fixtures (the pattern in [P1], and the one WXT points to [W1]). The SW idles out after about 30 s. Playwright keeps the same `Worker`, but an `evaluate` in flight at that moment throws "Service worker restarted" [P1]. Keep SW evaluates short. A fixed id via the manifest `key` is optional; Chrome suggests it only for allow-listing [C2].

**Side panel.** Playwright has no side-panel API, and neither Playwright nor Chrome's e2e docs cover side panels [P1][C2]. The standard workaround is Chrome's documented pattern for extension pages: navigate a tab to `chrome-extension://<id>/sidepanel.html` [C2]. Caveats for our code:
- The panel resolves "current tab" via `tabs.query({active, currentWindow})`. In a tab, the panel page *is* the active tab, so open the fixture page first and then either (a) pass a `?tabId=` query param, which Chrome itself recommends for popups using the active tab [C2], or (b) open the panel page in a second window. Option (a) needs a small test seam, so prefer (b) if the code already filters by window.
- `chrome.sidePanel.open()` can still be smoke-called from the SW (`sw.evaluate`), but it needs a user gesture and returns before the panel loads [S1]. Treat it as untestable UI. Puppeteer 25 adds `triggerExtensionAction` and `installExtension` but no side-panel target either [PP1]. That is not a reason to switch.

**Optional host permissions.** `permissions.request()` requires a user gesture and shows native browser UI. Playwright's `page.click` provides the gesture, but no documented API, flag, or CDP method accepts the prompt (no source found; Playwright's `grantPermissions` covers web permissions only). Ranked options:
1. **E2E build mode** (recommended). A `wxt build --mode e2e` (or env flag) manifest hook adds the test origins (`http://127.0.0.1/*` for the fixture page and mock provider) to `host_permissions`. Unpacked installs grant these at load. This is real behavior with zero flake. Cost: the e2e manifest differs from prod, so `check:manifest` must keep asserting the prod build has no required hosts.
2. Click the in-panel "Grant" button with Playwright and assert only that the prompt was requested (stub `chrome.permissions.request` in page context). This covers wiring but not the grant itself.
3. CDP `Extensions` domain (needs `--enable-unsafe-extension-debugging`). Not verified to expose permission grants; skip.

**Collecting errors (fail the test on any).**
- Extension pages (sidepanel/options in tabs): `page.on('console')` filtered to `type()==='error'`, plus `page.on('pageerror')` [P2].
- Service worker: `Worker.on('console')`, added in **Playwright 1.57** [P3]. There is no worker `pageerror`, so uncaught SW errors only surface if logged. Install `self.addEventListener('error'|'unhandledrejection', e => console.error(...))` via `sw.evaluate` at fixture start, and re-check after an SW restart.
- Content scripts: they run in the tab's isolated world, and their console output arrives on that tab's `page.on('console')`. Expected from CDP semantics but **not confirmed in docs**; verify with a deliberate `console.error` in the first spike.
- `context.on('weberror')` covers pages only [P2].

**WXT guidance.** WXT's e2e page only says "use Playwright, point it at `.output/chrome-mv3`" and links an example [W1]. It is relevant only for the path; follow Playwright's docs.

## 2. Chrome Web Store listing (2026)

| Item | Requirement | Source |
|---|---|---|
| Icon | 128x128 PNG (96 art + 16px transparent pad), also inside the ZIP | [S2] |
| Screenshots | at least 1, up to 5, 1280x800 or 640x400, square corners, no padding | [S2] |
| Small promo tile | 440x280, **required** | [S2] |
| Marquee | 1400x560, optional | [S2] |
| Description | non-empty, accurate, no keyword stuffing (same keyword more than 5 times), no anonymous testimonials | [S3] |
| Privacy tab | single purpose; justification per permission; remote-code yes/no; data-type checkboxes; Limited Use certifications; privacy policy URL | [S4] |

**Data use for a BYO-key LLM translator.** Sending page text to a provider counts as handling (collect and transmit) of "Website content" user data [S5]. That triggers four requirements: (a) a privacy policy is required, even for local-only handling; (b) a **prominent in-UI disclosure plus an affirmative user action** before first send, where a store listing or privacy policy alone does not count; (c) transmission over HTTPS/WSS; (d) a Limited Use statement on the homepage or one click away [S5]. The July 2026 update (enforced **2026-08-01**) tightened this. Data must be strictly necessary to the single purpose, disclosure is required even when the data ties to that purpose, and users must be notified of post-install changes. It also bans extensions built to bypass AI-service guardrails [S6]. API keys stored locally and sent only to the chosen provider fit this model. State it plainly in the policy.

**Remote code.** Answer "No". Calling a remote LLM API and rendering the returned text is data, not code; MV3 forbids executing remotely hosted code [S4]. Never `eval` or inject model output as script or HTML.

**Broad optional hosts.** Review time grows with broad host access (`<all_urls>`-like) and "dangerous" permissions. New developers and new items also get closer review [S7]. Expect days to weeks. Mitigate with precise justifications for `https://*/*` (user-chosen provider endpoints and per-site allowlist, requested at runtime) and test instructions that include a way to try the extension without a paid key (for example built-in AI on 138+).

**Visibility.** Public, Unlisted (installable by URL), or Private (testers/groups); all three get the same review [S8]. Deferred publish: untick "publish after review", then publish within 30 days or the item reverts to draft [S9]. Docs found do not explicitly state that visibility can be switched after publishing; the dashboard has historically allowed it (unverified).

**MV3-only.** MV2 is gone from stable; this extension is already MV3, so there is no action.

## 3. Localization

- WXT copies `public/` as-is [W2], and since WXT 0.20 `public/` sits at the project root (this repo already uses `public/icon`). So `public/_locales/<lang>/messages.json` would be copied verbatim. That works, but the files would be untyped.
- **Recommended: `@wxt-dev/i18n`** [W3][W4]. Setup: `pnpm i @wxt-dev/i18n`, `modules: ['@wxt-dev/i18n/module']`, `manifest.default_locale: 'en'`, and files in `src/locales/en.yml` and `vi.yml` (YAML, JSON or TOML; nested keys; plurals). The build emits `_locales/*/messages.json` plus types. In code: `i18n.t('panel.title')`, `i18n.t('items', n)`. It is plain sync `chrome.i18n` underneath and needs no framework adapter, so it works in Preact components and in content scripts. Its trade-off, inherited from `chrome.i18n`, is that the language follows the browser UI language and has no in-app switcher [W3].
- Manifest: `name: '__MSG_extName__'`, `description: '__MSG_extDescription__'`, and a `default_locale` that is mandatory once `_locales` exists [W3]. The keyboard-command `description` also accepts `__MSG_*__`. Store-listing text is localized separately in the dashboard.
- Vietnamese locale folder is `vi` (Chrome locale list). Keep `engine/` free of `chrome.*` (existing boundary rule), so pass strings in rather than calling `i18n` there.
- Unit tests: `chrome.i18n.getMessage` must be stubbed in jsdom, or the generated messages loaded.

## 4. Vitest 5 coverage

- `@vitest/coverage-v8@5.0.3` declares the peer `vitest: "5.0.3"` (exact; npm today). Vitest warns that "Running mixed versions is not supported" [V2]. Pin both identically. The repo has `"vitest": "5"`, so change to the same exact version or let renovate bump them together.
- Per-directory thresholds [V1]:
```ts
coverage: { provider: 'v8', include: ['src/**'], thresholds: {
  lines: 80, branches: 70,                       // global aggregate (includes glob files)
  'src/engine/**': { lines: 90, branches: 85 },  // globs do NOT inherit globals or perFile
  'src/shared/**/*.ts': { lines: 85, perFile: true },
}}
```
Negative numbers mean a maximum count of uncovered items. `{ 100: true }` sets all four metrics. `autoUpdate` exists but rewrites config, so keep it off in CI [V1].

## 5. Paid LLM eval in Actions (public repo)

- Fork PRs: "secrets are not passed to the runner", and `GITHUB_TOKEN` is read-only [G1][G2]. Do **not** use `pull_request_target` to get secrets, because it runs untrusted code with base-repo context [G2].
- Secrets cannot be used in `if:` directly. Map the secret to a job-level `env` and test that instead [G1].
```yaml
on:
  workflow_dispatch:
  push: { branches: [master], paths: ['src/engine/**', 'eval/**', 'scripts/eval*.mjs'] }
concurrency: { group: eval-${{ github.ref }}, cancel-in-progress: true }
permissions: { contents: read }
jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment: eval            # optional: required reviewers + env-scoped secret
    env: { LLM_KEY: '${{ secrets.LLM_EVAL_KEY }}' }
    steps:
      - if: env.LLM_KEY == ''
        run: echo "::notice title=Eval skipped::LLM_EVAL_KEY not set (fork or not configured)"
      - if: env.LLM_KEY != ''
        uses: actions/checkout@v7
      # ...install, then: pnpm run eval with a hard sample cap and budget
```
Add a cost guard inside `scripts/eval.mjs` (max items/tokens), since `paths:` alone does not cap spend. A protected `environment` with required reviewers is the strongest gate against accidental burns [G3].

## Risks and trade-offs

| Decision | Risk | Mitigation |
|---|---|---|
| e2e host grant via build mode | Prod/e2e manifest drift | `check:manifest` asserts the prod build has no required hosts |
| Panel-in-tab | Misses real side-panel lifecycle (open/close, window binding) | Keep the existing unit tests on panel toggling; manual smoke before release |
| `http://*/*` optional hosts | CWS "secure transmission" rule for user data [S5] | Allow HTTP only for localhost/LAN with an explicit in-UI warning, justify in review notes, or drop `http://*/*` for the store build (needs a decision) |
| Headless Chromium != Chrome stable | Rare behavior gaps | Same Chromium major as stable (Playwright 1.64); manual release smoke on stable |

## Unresolved questions

1. Does content-script `console.error` arrive on Playwright's `page.on('console')`? Verify in the spike.
2. Is there any supported way to auto-accept `permissions.request` in Chromium automation? None found.
3. Should the store build keep `http://*/*`, given the HTTPS transmission requirement? This is a product decision.
4. Can visibility switch from Unlisted to Public without re-review? Not stated in the docs found.

## Sources
- [P1] https://playwright.dev/docs/chrome-extensions
- [P2] https://playwright.dev/docs/api/class-browsercontext
- [P3] https://playwright.dev/docs/api/class-worker
- [PP1] https://pptr.dev/guides/chrome-extensions
- [C1] https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ
- [C2] https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing
- [S1] https://github.com/GoogleChrome/chrome-extensions-samples/issues/1020
- [S2] https://developer.chrome.com/docs/webstore/images
- [S3] https://developer.chrome.com/docs/webstore/program-policies/listing-requirements
- [S4] https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- [S5] https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- [S6] https://developer.chrome.com/blog/cws-policy-updates-2026
- [S7] https://developer.chrome.com/docs/webstore/review-process
- [S8] https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- [S9] https://developer.chrome.com/docs/webstore/publish
- [W1] https://wxt.dev/guide/essentials/e2e-testing
- [W2] https://wxt.dev/guide/essentials/project-structure
- [W3] https://wxt.dev/guide/essentials/i18n
- [W4] https://wxt.dev/i18n
- [V1] https://vitest.dev/config/coverage
- [V2] https://github.com/vitest-dev/vitest/commit/e662c7b2 (mixed-version warning)
- [G1] https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- [G2] https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- [G3] https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
