---
title: "Phase 3: Firefox build"
status: todo
priority: P3
effort: "3d"
dependencies: []
tier: free
---

# Phase 3: Firefox build

## Goal

The same reading experience in Firefox: a WXT Firefox target that opens the reader in Firefox's sidebar
(`sidebar_action`), with no Chrome built-in AI path, checked in CI (M9 §2.2). Free.

## Context links

- Spec: `docs/plans/M9-beyond-v1.md` §2.2; DESIGN §8 (minimal permissions); `docs/decisions/S1-engine-host.md`
  (engine in the panel), `docs/decisions/S5-activetab-navigation.md` (gesture, injection).
- Scout: `plans/reports/scout-261013-1036-m8-track-surfaces.md` §2.
- Chrome-only surfaces:
  - manifest: `wxt.config.ts:17-18` (`minimum_chrome_version`, `sidePanel` permission), `:24-29` (`_execute_action`);
  - panel control: `src/shared/panel.ts:24-31` (`setPanelBehavior`, guarded), `:39-45, :62-76` (`sidePanel?.open`),
    `src/entrypoints/sidepanel/toggle.ts:19` (`sidePanel.close`, guarded);
  - checks: `scripts/check-manifest.mjs:5, 14-22` (Chrome path, `background.service_worker`, `side_panel`),
    `scripts/check-bundle.mjs:9` (`BUILD = '.output/chrome-mv3'`);
  - e2e: `e2e/fixtures.ts:138-143` (`chromium.launchPersistentContext`, `--load-extension`), `:152-163` (service
    worker hooks), `:165-170, :189, :196` (`chrome-extension://` URLs and `worker.evaluate` seeding);
  - CI: `.github/workflows/ci.yml:35-49` (Chromium only).
- Built-in AI already degrades: `CHROME_NANO = false` (`src/llm/client.ts:57`), `Translator` absent →
  "missing" (`src/llm/chrome-translator.ts:41, 49`).

## Requirements

- `pnpm run build:firefox` produces a Firefox package; `pnpm run build` (Chrome) output is unchanged and
  `check:manifest` for Chrome still passes untouched.
- Firefox manifest: `sidebar_action` pointing at the panel page; no `sidePanel` permission; otherwise the same
  permissions (`storage`, `activeTab`, `scripting`, `contextMenus` or its Firefox equivalent) and the same
  `optional_host_permissions`; `browser_specific_settings.gecko` with a fixed id and `strict_min_version`; background
  as an event page (`background.scripts`).
- Toolbar icon and Alt+T open or close the sidebar with the activeTab grant and inject, as in Chrome (S5).
- No Chrome built-in AI: the basic fallback is absent and the panel says so, as it does on Chrome without Translator.
- Manifest and bundle checks run for both targets.
- E2E: `pages.spec.ts` article and docs fixtures (the 15 `sites/*` pages and the 3 `spa/*` pages) pass on Firefox
  with the mock provider. The two `long/*` lazy pages, `perf.spec.ts` (CDP) and `upgrade.spec.ts` stay
  Chromium-only, stated in the spec files.
- A Firefox CI job runs that subset.

## Architecture

```
wxt build -b firefox [--mv3] → .output/firefox-mv3/   (spike decides MV2 vs MV3)
  sidepanel entrypoint → sidebar_action.default_panel     [UNVERIFIED, spike]
  background.ts        → background.scripts (event page) [UNVERIFIED, spike]
panel.ts: open/close through a small port
  Chrome:  sidePanel.open({tabId})                        (today)
  Firefox: sidebarAction.open() / .close() / .toggle()     (same gesture rule: first call, no await)
e2e/fixtures.ts: one fixture API, two loaders (Chromium today; Firefox per spike)
```

The engine already runs in the panel (S1), so Firefox's non-persistent event page holds no translation state; the
S1 question is re-run to confirm (worker restarts, `storage.session` in Firefox, the snippet hand-over in
`src/shared/snippet.ts:45-54`).

## Related files

- **Create:** `e2e/firewall.spec.ts` (negative firewall test, both targets), `e2e/firefox.config.ts` (or a Firefox project in `e2e/playwright.config.ts`, per spike),
  `e2e/loaders.ts` (Chromium and Firefox launch and seed), a Firefox section in `docs/decisions/S1-engine-host.md`
  (addendum).
- **Modify:** `wxt.config.ts` (per-browser manifest via WXT's `manifest` function form), `src/shared/panel.ts`,
  `src/entrypoints/sidepanel/toggle.ts`, `src/entrypoints/background.ts` (only if the spike shows event-page
  differences), `scripts/check-manifest.mjs` (a `--target firefox` expectation set), `scripts/check-bundle.mjs`
  (build directory from an argument, a budget per target), `scripts/bundle-budget.json` (or a sibling
  `scripts/bundle-budget.firefox.json`), `e2e/fixtures.ts`, `e2e/pages.spec.ts` (target-aware list),
  `package.json` (`build:firefox`, `zip:firefox`, `e2e:firefox`), `.github/workflows/ci.yml` (a Firefox check step
  and an `e2e-firefox` job), `README.md` (Firefox install line), `docs/store/` (AMO notes, only if the user wants them).

## Steps

1. **Spike A, WXT output (no repo changes).** Run `pnpm exec wxt build -b firefox` and `-b firefox --mv3` in a
   scratch worktree. Record: output directory, whether `sidebar_action` is emitted for the `sidepanel` entrypoint,
   the background shape, how `permissions`/`optional_host_permissions`/`commands`/`minimum_chrome_version` come out,
   and the gecko id handling. Decide MV3 (preferred: same permission model) or MV2.
2. **Spike B, Playwright Firefox (no repo changes).** Check whether Playwright 1.64's Firefox can load an unpacked
   extension. Candidates: Firefox's remote debugging `installTemporaryAddon` over RDP (the approach the
   `playwright-webextext` package uses) with `firefoxUserPrefs` pinning the extension's moz-extension UUID
   (`extensions.webextensions.uuids`), or `web-ext run` plus a WebDriver BiDi connection. Pick one that runs headless
   on `ubuntu-latest`. Record the choice and its limits (no service-worker handle, so seeding goes through an
   extension page's `evaluate`).
<!-- Red Team: Firefox request firewall passes everything -->
   Spike B must also prove the request firewall works on Firefox, with a negative test: an extension page fetches
   `https://off-list.example/` and the harness must report it. Today the firewall only treats a request as the
   extension's when it comes from a service worker or a `chrome-extension://` frame (`e2e/fixtures.ts:151-156`), and
   the fixture waits on `waitForEvent('serviceworker')` (`:159-160`); on Firefox (event page, `moz-extension://`) every
   extension request would be answered and never reported. If Playwright cannot intercept requests from
   `moz-extension` contexts, the phase records BLOCKED for this guarantee instead of claiming it.
3. Write `docs/plans/M9-firefox.md` (M9 §3) from this file and both spike results. Re-run the S1 question against
   Firefox's event page and record the answer as an addendum to `docs/decisions/S1-engine-host.md`.
4. `wxt.config.ts`: switch `manifest` to the function form keyed on the browser; keep the Chrome object identical
   (assert with `check:manifest` before and after). Add `browser_specific_settings` and drop `sidePanel` and
   `minimum_chrome_version` for Firefox.
5. `src/shared/panel.ts` and `toggle.ts`: a two-function port (`openPanel(tab)`, `closePanel()`) chosen by API
   presence (`sidePanel` vs `sidebarAction`), keeping "first call, no await before it".
6. `check-manifest.mjs`: take `--target chrome|firefox`; the Firefox set asserts `sidebar_action.default_panel`,
   the background scripts, the same permission list minus `sidePanel`, the same optional hosts, no
   `host_permissions`, no `content_scripts`, the locales. `check-bundle.mjs`: take the build directory and budget file
   from arguments; default to today's Chrome values so `pnpm run check:bundle` is unchanged.
7. E2E: move launch and seed into `e2e/loaders.ts`; the fixture API (`seed`, `open`, `panel`, `options`,
   `translate`) stays the same for specs. Firefox `translate` triggers injection from an extension page instead of
   the worker.
<!-- Red Team: Firefox request firewall passes everything -->
   The request firewall (`fixtures.ts:151-156`) classifies any `*-extension://` frame, and on Firefox the event page,
   as the extension; it no longer depends on a service-worker handle, and the Chromium path keeps its worker check.
   Waiting for a service worker moves into the Chromium loader. The Spike B negative test becomes a permanent spec on
   both targets (`e2e/firewall.spec.ts`).
8. `package.json`: `build:firefox` (`wxt build -b firefox --mv3` or as decided), `zip:firefox`, `e2e:firefox`.
9. CI: in `check`, add `build:firefox`, `check:manifest -- --target firefox` and the Firefox bundle check; add an
   `e2e-firefox` job installing Playwright's Firefox.
10. Manual: load the zip as a temporary add-on in Firefox stable, open the sidebar with the icon and Alt+T on an
    article, translate with a real provider, check the options page and the context menu. Record in the report.

## Todo

- [ ] Spike A recorded (WXT Firefox output, MV2/MV3 decision)
- [ ] Spike B recorded (Firefox extension loader for Playwright)
- [ ] One-page track plan; S1 addendum for Firefox
- [ ] Per-browser manifest; Chrome manifest unchanged
- [ ] Panel open/close port
- [ ] Manifest and bundle checks per target
- [ ] E2E loaders; article and docs fixtures green on Firefox
- [ ] Firewall classifies `*-extension://` and the Firefox event page; negative firewall spec green on both targets
- [ ] Scripts and CI job
- [ ] Manual Firefox check recorded

## Success criteria

- M9 §2.2 done when: the M6 e2e suite passes on Firefox for the article and docs fixtures. Read as: `pnpm run
  e2e:firefox` runs the 18 `sites/*` and `spa/*` cases of `pages.spec.ts` green with zero console errors, locally and
  in the CI `e2e-firefox` job.
- `pnpm run check:manifest` on the Chrome build is unchanged; the Firefox check passes.

## Guarantee to keep

Same minimal permissions: the Firefox manifest adds nothing beyond what Firefox needs to express the same features
(no `<all_urls>`, no required host permissions, no `tabs`). The S1 question is re-run and recorded.

## Verification

```
pnpm run build && pnpm run check:manifest && pnpm run check:bundle
pnpm run build:firefox && node scripts/check-manifest.mjs .output/firefox-mv3/manifest.json --target firefox
pnpm check
pnpm run e2e
pnpm run e2e:firefox
```

(The Firefox output directory follows Spike A.)

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| Playwright cannot load Firefox extensions headless | High × High | Spike B before any harness work; if no headless loader works on CI, the CI job runs headed under `xvfb-run`, and the phase stops with BLOCKED rather than dropping the done criterion |
| WXT does not map `sidepanel` to `sidebar_action` | Medium × Medium | Spike A; fallback is a Firefox-only `sidebar_action` in the manifest function pointing at `sidepanel.html` |
| Firefox MV3 host permissions are user-revocable and not granted at install | Medium × Medium | The app already requests per origin at runtime (`wxt.config.ts:20-21`); the e2e grants test hosts through the loader |
| `activeTab` and `scripting.executeScript` behave differently on Firefox gestures | Medium × High | Manual step 10 plus the e2e translate path; any difference recorded in the S1/S5 addenda |
| The request firewall silently passes Firefox extension requests | High × High | Generalised classifier; the negative firewall spec on both targets; BLOCKED if Firefox requests cannot be intercepted |
| Chrome manifest drifts through the function form | Low × High | `check:manifest` (Chrome) runs before and after, unchanged expectations |

## Security

No new permissions or origins. <!-- Red Team: Firefox request firewall passes everything --> The Firefox e2e has the
same request firewall as Chromium, which fails any extension request to a host the user did not choose
(`e2e/fixtures.ts:151-156`, generalised in step 7). This claim holds only once the negative firewall spec passes on
Firefox; until then the phase is not accepted. The gecko id is public by nature; nothing secret goes in the
manifest.

## Rollback

The Firefox target is additive: remove the Firefox scripts, CI job and the manifest function's Firefox branch.
Chrome output is untouched by construction and by `check:manifest`.
