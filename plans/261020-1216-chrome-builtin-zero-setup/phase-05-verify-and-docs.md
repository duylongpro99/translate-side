---
phase: 5
title: "Verification, e2e and docs"
status: in-progress
priority: P1
effort: 2d
dependencies: [2, 3, 4]
---

# Phase 5: Verification, e2e and docs

## Goal

Prove the acceptance criteria end to end, and update the docs that describe providers, privacy and setup.

<!-- Red team 2026-10-20: updated for finding 15. -->

## Key insights

- `e2e/` has no hook that fakes `Translator` or `LanguageModel`. The only build hook is `WXT_BEST_PREVIEW`
  (`src/shared/quality.ts:17`, `package.json:40`). `seed()` always writes `secret:mock` (`e2e/fixtures.ts:208`), and
  `panel()` opens `sidepanel.html` at once (`:216-219`).
- Chrome for Testing exposes a real `Translator` whose `create()` never settles (`src/llm/chrome-translator.ts:8-9`). A fake must replace it before the panel bundle runs.
- `e2e/upgrade.spec.ts` runs only through `pnpm run e2e:upgrade`, locally, with `UPGRADE_FROM` and `UPGRADE_TO` (`:2`, `:19-20`).

## Verification

1. **The full gate:** `pnpm check`.
2. **e2e with injected fakes.** Use the mechanism verified in phase 1 (question 7): Playwright `context.addInitScript` on
   extension pages. The fakes model activation: `create()` on a non-`available` pair throws unless a click happened in the same task.
   - Add a `keyless` option to `seed()`.
   - In `e2e/flows.spec.ts`, cover these cases:
     - A keyless profile shows the turn-on button. Clicking it shows progress, and the page translates with "basic translation" badges.
     - The fakes report `unavailable`, and the reason plus "Set up a provider" shows.
     - An on-device run shows no privacy notice. A keyed run still does.
   - No test-only identifier or branch is added to `src/`.
   - Add a check to `scripts/check-bundle.mjs` that the release bundle contains no fake-AI identifiers.
3. **Upgrade (a local gate, not CI).** Extend `e2e/upgrade.spec.ts` and run `pnpm run e2e:upgrade`:
   - An existing keyless install upgrades and reaches the on-device route.
   - An install with a key upgrades with its route unchanged.
4. **Manual check on real Chrome stable** (the owner):
   - A fresh profile with target `vi` uses Translator: the turn-on click, then progress, then translation.
   - Target `en` with Nano available uses Nano blocks.
   - With on-device AI turned off, the panel gives the reason and the provider path.
   - With a key, nothing changes.
   - A mixed-language page asks for each new pair once.

   Record the results in `docs/decisions/S8-chrome-builtin.md` under "Shipped behavior".

## Docs to update

- `DESIGN.md` §4.2.6 (`DESIGN.md:291`): Chrome built-in is now the zero-setup route. Also record:
  - the rule that `create()` happens only on a click;
  - the privacy gate that runs on the resolved route;
  - the Nano to Translator switch.
- `docs/privacy.md`: on-device routes send no page text anywhere. The notice is required only for routes that leave the device.
- `docs/provider-matrix.md`: add Chrome Translator and Gemini Nano rows (languages, hardware, the one click per pair, quality notes).
- `README.md`: "Works without an API key on supported Chrome, after one click per language pair."
- `docs/store/` listing and permission justifications: on-device translation; no new permissions (`pnpm check:manifest`).
- `ROADMAP.md:64`: mark S8 done, with a link to the decision.

## Success criteria

- `pnpm check` and `pnpm e2e` pass. `pnpm run e2e:upgrade` passes locally.
- Acceptance criteria 1–8 in `plan.md` each map to a test or a recorded manual check.
- Docs claims match the code.

## Todo

- [x] `pnpm check` green (its parts run one by one: lint, tokens, typecheck, engine boundary, 2,232 unit tests, build, bundle with the fake-AI guard, manifest)
- [x] Fake-AI init script with activation modelling (`e2e/builtin-ai.ts`); `keyless` seed
- [x] e2e: turn-on flow, unavailable path, privacy notice by route (51 passed; the panel perf spec fails at 124–149 ms against 100 ms on this loaded machine, and master fails the same way: 126–149 ms)
- [x] Bundle check for fake-AI identifiers (proven by planting the marker in a built chunk)
- [x] `e2e:upgrade` run locally (2026-10-21: both pass, the keyed upgrade and the keyless one reaching the on-device route)
- [ ] Manual check on real Chrome recorded
- [x] DESIGN, privacy, provider-matrix, README, store docs and ROADMAP updated
