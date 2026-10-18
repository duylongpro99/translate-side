---
phase: 6
title: "Verification, screenshots, docs and 1.2.0 RC"
status: in-progress
priority: P1
effort: "1.5d"
dependencies: [2, 3, 4, 5]
---

# Phase 6: Verification and release candidate

## Goal

Prove the spec §3 criteria with checks that stay in the repo, refresh every screenshot and doc
that shows the old UI, re-measure the bundle and prepare 1.2.0 for the user to publish.

## Context

- **`e2e/ui-screens.spec.ts`** (phase 1) writes the screenshots, gated by `UI_SCREENS` and run
  through `pnpm run ui:screens`. Its "before" set is under
  `plans/261018-0900-m8-ui-ux-refresh/screens/before/`.
- **Store screenshots:** `pnpm run store:screenshots` runs `e2e/store-screenshots.spec.ts`
  (1280×800 composites `01` to `05`, the 440×280 tile and the 128px icon) into
  `docs/store/assets/`. It relies on `.seg[data-linked]` and `html[lang]` (`:142`).
- **Release docs:** `docs/store/submission.md` (package size and SHA-256 per version), the
  README screenshots and `DESIGN.md` §3 (the header description and the ASCII panel sketch).
- **Bundle budget:** `scripts/bundle-budget.json`. Hand-edit only the lines that changed.
  `--update` rewrites every line.

## Requirements

1. **Glyph check.** Add `e2e/scripts.spec.ts`.
   - **Inputs.** The mock provider's `answerWith` (`e2e/servers.ts:71`) returns real script
     samples per target. Today every target gets `vi:` plus the English text (`:171`), which
     contains no Han, Hangul, Thai or Arabic characters.
   - **Codes tested.** The codes users actually have: `vi`, `ja`, `zh-CN`, `zh-TW`, `ko`, `th`
     and `ar` from the language list (`settings.ts:380-401`), plus bare `zh` and `he` written
     through storage, which is how a Chinese or Hebrew UI default arrives.
   - **Assertions:**
     - the translated blocks carry the right `lang`;
     - `ar` and `he` blocks and the region carry `dir="rtl"`;
     - the computed `font-family` differs between ja, zh-CN and ko, and between ar and vi. This
       proves the cascade, not the drawn font.
   - **Drawn-glyph check.** A canvas measure of 直 and 骨 in the ja font against the zh-CN font,
     in the panel's page context, asserts that the widths or ink bounds differ when both
     platform fonts exist. Otherwise the test records a skip with the reason, and the screenshot
     is reviewed by hand.
   - The spec phase 3 added already covers the cascade. This spec adds real samples and the
     drawn-glyph check.
2. **Rhythm, reading-settings and follow-anchor checks** from phase 3 run in the full e2e suite.
3. **Contrast.** The phase 1 unit test runs for every theme. No new tokens are left unchecked.
4. **Token discipline.** `scripts/check-tokens.mjs` (added in phase 1) passes on the final tree.
   No new checker is added.
5. **Screenshots.**
   - Run `pnpm run ui:screens -- after`, now including paper.
   - Write `screens/README.md` listing the before and after pairs.
   - Optionally capture extra panel states (translating, hover-linked, the Reading popover) by
     hand into `screens/after/extra/`.
   - Regenerate the store screenshots (`pnpm run store:screenshots`) and replace
     `docs/store/assets/01` to `05`.
6. **Windows check.** Open `scripts/glyph-check.html` and the panel's serif mode on Windows (or
   a Windows VM). If no Windows machine is available, record that explicitly in the progress log
   and keep sans as the default. Write the result into `docs/design-system.md`.
7. **Docs.**
   - Update `DESIGN.md` §3: the header bullet, the ASCII sketch and a new reading-settings
     bullet.
   - Update the README screenshots and feature list (reading settings, themes).
   - Mark the M8 row done in `ROADMAP.md` and `README.md` when accepted.
   - Write `docs/progress/progress-m8.md` per the supervisor prompt.
8. **Bundle.** Run `pnpm build` and `pnpm run check:bundle`. Hand-edit only the lines that
   changed, were added or were removed (renamed shared chunks from `src/ui/`) plus `total`. Use
   the measured value plus 10% and a dated note naming M8, compared against the phase 1 chunk
   map. Never use `--update`.
9. **Release candidate.**
   - Bump `package.json` to 1.2.0.
   - Run `pnpm zip`.
   - Record the package size and SHA-256 in `docs/store/submission.md` with a "what's new"
     paragraph in en and vi.
   - The store upload and git tag stay with the user.

## Steps

1. Add `scripts.spec.ts` with the `answerWith` samples and fix anything it finds.
2. Do the Windows check, or record that it was not done.
3. Take the after screenshots and regenerate the store screenshots.
4. Update the docs.
5. Re-measure the bundle.
6. Bump the version, zip and update the submission doc.
7. Run `pnpm check` and `pnpm run e2e` on the final tree. Do a last review of the whole UI
   against the anti-pattern list and the spec §2 bullets, and record it in the progress log.

## Files

- Create:
  - `e2e/scripts.spec.ts`
  - `plans/261018-0900-m8-ui-ux-refresh/screens/after/**`, `screens/README.md`
  - `docs/progress/progress-m8.md`
- Modify:
  - `package.json` (version)
  - `e2e/servers.ts` (only if `answerWith` needs a per-target sample helper)
  - `scripts/bundle-budget.json`
  - `docs/store/assets/01..05`, `docs/store/submission.md`
  - `DESIGN.md` §3, `README.md`, `ROADMAP.md`
  - `docs/design-system.md` (Windows result)

## Acceptance

- [ ] Every spec §3 criterion has a passing check or a recorded manual result.
- [ ] The before and after screenshot sets are complete for light, dark and paper at 320px and 480px.
- [ ] The store assets and docs show the new UI.
- [ ] The bundle budget is re-measured with a note, and `check:bundle` is green.
- [ ] Version 1.2.0 is zipped with its size and SHA-256 recorded.
- [ ] `pnpm check` and `pnpm run e2e` are green on the final tree.

## Risks

- **Font stacks on CI Linux differ from the user's machine.** The glyph check asserts `lang`,
  `dir` and the cascade. The drawn-glyph check skips with a recorded reason when the platform
  lacks both CJK fonts. Visual confirmation comes from the screenshots on the dev machine.
