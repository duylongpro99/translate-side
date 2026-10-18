---
phase: 1
title: "Foundations: tokens, themes, fonts, components, reading store"
status: completed
priority: P1
effort: "4d"
dependencies: []
---

# Phase 1: Foundations

## Goal

Build one design system that every page imports:
- tokens and themes (system, light, paper, dark) with the correct `color-scheme`, applied
  before the first paint;
- system font stacks per script;
- an SVG icon set;
- a small set of accessible Preact components;
- a stored, synced reading-settings item that goes through the full import preview.

This phase also captures the "before" screenshots, adds the single token check and writes
`docs/design-system.md`.

## Context

- Spec: `docs/plans/M8-ui-ux-refresh.md` §2 and §5. Contract and anti-patterns are in
  `plans/reports/brainstorm-261018-0900-ui-ux-refresh.md`. The values come from direction A in
  `plans/reports/mockup-261018-0828-panel-directions.html` (`.a-light`, `.a-dark`). Red team
  findings 2, 5, 6, 12, 13, 14 and 15 are in `reports/red-team-261018-0900-m8.md`.
- **Today's tokens.**
  - `sidepanel/style.css:1-25`: `--fg --muted --line --surface --code-bg --accent --hidden
    --danger`, plus `color-scheme: light dark`, `font-size: 14px` and the font family on
    `:root`.
  - `options/style.css:1-18`: the same three root settings plus its own `--muted --line --warn
    --ok --code-bg`.
  - Onboarding hard-codes `#8884`, `#4a7bd8`, `#c9a227` and `#666` (`onboarding/style.css:3-21`).
- **System colors and stray colors.** The panel uses the system color `Canvas` at
  `style.css:37, 293, 465` (the privacy button text on accent) and `:562`. It also has a hex
  fallback at `:519` and an `rgba()` left-border `box-shadow` at `:578-579`, which is a banned
  pattern.
- **Theme timing.** `<html lang>` is set to the UI language at runtime
  (`sidepanel/main.tsx:16`, `options/main.tsx:9`, `onboarding/main.tsx:10`). Nothing runs
  synchronously before render.
- **CSS loading.** Onboarding loads `options/style.css` and then its own CSS
  (`onboarding/main.tsx:5-6`).
- **Storage precedent.** `src/shared/quality.ts` is its own sync item with `hasKnownQuality`
  (`:46-51`) and a raw-record patch merge (`:75-89`).
- **Import and export.**
  - The export side is `portable.ts:163, 196`.
  - The import side is the gate and skip note (`:420-421`), `ImportPlan` (`:233`), `resolveImport`
    (`:567`) and the `ImportReport` flag (`:461, 628`).
  - Transfer shows the preview line in `Transfer.tsx:43`.
  - The `portable.ts` header promises that nothing is applied unseen and nothing is dropped
    silently (`:8-12`).
- **Listeners.** The translator's settings listener (`translator.ts:620-622`) and the prefs
  listener (`prefs.ts:108-111`) check specific keys, so a new `reading` key does not trigger a
  retranslation.

## Requirements

1. **`src/ui/tokens.css`** is the single source of colors, spacing, radii, type sizes and font
   stacks.
   - **Themes:**
     - `:root` holds light.
     - `[data-theme="paper"]` and `[data-theme="dark"]` override it.
     - "System" means no `data-theme` attribute plus `@media (prefers-color-scheme: dark)`
       scoped to `:root:not([data-theme])`.
   - **`color-scheme` per theme:**
     - `light` on `:root[data-theme=light]` and `[data-theme=paper]`;
     - `dark` on `[data-theme=dark]`;
     - `light dark` only on `:root:not([data-theme])`.
   - **Color tokens:**
     - `--ground`, `--ink`, `--muted`, `--line`;
     - `--tint` (hover or linked block), `--pressed`, `--raised` (overlays);
     - one `--accent`, plus `--on-accent` for text on accent;
     - `--danger`, `--warn`, `--ok`, `--code-bg`, `--hidden`, `--quote`.
   - **Spacing scale:** `--space-1` to `--space-6` (4, 8, 12, 16, 24, 32 px).
   - **Radii:** `--radius-s` 5px and `--radius-m` 8px. Nothing larger.
   - **Font stacks:**
     - `--font-ui`: `system-ui, -apple-system, 'Segoe UI', sans-serif`.
     - `--font-sans`: the same stack, used for reading.
     - `--font-serif`: `'Iowan Old Style', Charter, Georgia, 'Noto Serif', serif`. The order is
       confirmed in step 3.
     - `--font-mono`.
   - **Per-script stacks.** These are published as plain tokens, not overrides:
     - `--font-ja-sans`, `--font-ja-serif`
     - `--font-zh-hans-sans`, `--font-zh-hans-serif`
     - `--font-zh-hant-*`, `--font-ko-*`, `--font-th`, `--font-ar`, `--font-he`, `--font-hi`

     They are platform fonts with a `Noto` fallback, as in the mockup's specimen. Phase 3 applies
     them with `font-family` rules on the lang-bearing elements. A `:lang()` override of a
     variable cannot reach text through a variable already resolved on an ancestor.
   - **System colors are banned.** No `Canvas`, `CanvasText` or `Field` in any page CSS. Every
     current use is replaced with `--ground`, `--ink` or `--on-accent`.
2. **`src/ui/base.css`** holds:
   - the reset and the base `font-size: 14px` and `font-family: var(--font-ui)` (moved from the
     deleted `:root` blocks);
   - `body { background: var(--ground); color: var(--ink) }`;
   - the focus ring;
   - `.sr-only`;
   - `prefers-reduced-motion` handling.
3. **The theme applies before the first paint on every page.**
   - `src/ui/theme.ts` exports `applyThemeSync()`. It reads a mirrored copy of the reading item
     from `localStorage` (`ts.reading`), which is synchronous on extension pages, and sets
     `document.documentElement.dataset.theme`. It removes the attribute for "system".
   - It also exports `followTheme(api)`. That reads `storage.sync`, reconciles, writes the
     mirror and follows `storage.sync.onChanged` for the `reading` key.
   - Each page's `main.tsx` calls `applyThemeSync()` as its first statement, before `render`,
     then `followTheme`.
   - Every value passes through `cleanReading` before it touches the DOM.
4. **The reading-settings store** is `src/shared/reading.ts`. It is its own `storage.sync` item
   `reading`, which follows the user across devices (validation decision).
   - **Shape:** `{ theme: 'system'|'light'|'paper'|'dark', typeface: 'sans'|'serif', size:
     number, width: 'narrow'|'medium'|'full' }`.
   - **Defaults:** system, sans, 16, medium. Size is an integer clamped to 13–24.
   - **API:** `READING_KEY`, `defaultReading`, `cleanReading`, `hasKnownReading`, `readReading`
     and `updateReading`.
   - `updateReading` copies `updateQuality`'s raw-record merge, so a newer build's unknown fields
     survive a write.
   - Every read path returns only `cleanReading` output: `readReading`, the `onChanged` handlers
     in `theme.ts`, and the panel's handler in phase 3.
   - It is never a field of `prefs`.
5. **Import and export** follow the quality item, one piece at a time:
   - `buildExport` writes `reading`;
   - `ImportPlan.reading` and the `hasKnownReading` gate are added;
   - a `options.portable.skipReading` note appears when an unknown value is skipped;
   - `ImportReport.reading` is added, and `resolveImport` and `applyImport` write it;
   - a `options.transfer.reading` preview line in `Transfer.tsx`;
   - the strings go into both locales.

   A file without `reading` keeps the current value. Phase 1 owns `Transfer.tsx` for this one
   line.
6. **Icons.** `src/ui/icons.tsx` exports inline stroke SVG components at 16px with a 1.5 stroke
   and `currentColor`, always `aria-hidden`.
   - The set: chevron-down, arrow-right, follow, refresh, stop, more, settings, close, copy,
     edit, explain, check and alert.
   - The paths come from the mockup.
7. **Components.** Each lives in `src/ui/` with a test file next to it.
   - **`Button`.** Variants `primary` (accent fill with `--on-accent` text, at most once per
     view), `default` (hairline) and `quiet`.
   - **`IconButton`.** A 32×32 hit area, a required `label` (sets `aria-label` and `title`),
     and an optional `pressed`.
   - **`Select`.** A native `<select>` restyled with `appearance: none`, a chevron icon and a
     `quiet` variant. All props pass through. Every single-choice list (language, style,
     quality, model) uses this component.
   - **`Segmented`.** A `<fieldset>` of native `<input type="radio">` elements styled as
     segments, with a `<legend>`. Native arrow-key behavior stays as it is. Spec §5 limits
     custom controls, so it is used only for free settings: reading settings, and the theme
     field in options. It is never bound to `prefs` or `quality`, where each change starts a
     paid job.
   - **`Popover`.**
     - The trigger carries `aria-expanded` and `aria-controls`. The popover is `role="dialog"`
       with a label, and its content stays mounted while closed (`hidden`).
     - Opening moves focus to the first control.
     - Escape closes it and stops propagation. So do an outside click and a second click on
       the trigger.
     - Tab past the last control or Shift+Tab before the first closes it and moves focus on.
     - On close, focus returns to the trigger.
     - It stays inside the panel width at 320px.
   - **`Menu`.**
     - The trigger has `aria-haspopup="menu"`. The menu is `role="menu"` with `menuitem`
       entries.
     - Arrow keys and Home/End move through the items. Enter or Space activates.
     - Escape closes it, stops propagation and returns focus to the trigger. Tab closes it.
     - There is no typeahead.
   - **`Field`.** A label, a control slot and help text linked with `aria-describedby`.
   - **`Notice`.** Tones `info`, `warn` and `danger`. `info` uses `role="status"`; `warn` and
     `danger` use `role="alert"`. It is a flat tinted block with no shadow and no left border.
8. **Stylesheets.**
   - `sidepanel/style.css` and `options/style.css` import `@/ui/tokens.css` and `@/ui/base.css`.
   - `onboarding/style.css` imports neither. It inherits them from the options stylesheet that
     loads first, so the tokens ship once.
   - The page files' own `:root` blocks are deleted and their variables renamed: `--fg` becomes
     `--ink`, `--surface` becomes `--tint`.
   - Onboarding's hard-coded colors move to tokens in this phase.
9. **One token check.** `scripts/check-tokens.mjs` is added to `pnpm check` from this phase on.
   It fails when either of these appears in any `src/**/*.css` other than `src/ui/tokens.css`,
   or in a `style=` value in `src/**/*.tsx`:
   - a color literal: hex, `rgb()`, `rgba()`, `hsl()` or `hsla()`;
   - a system color keyword: `Canvas`, `CanvasText` or `Field`.

   The `style.css:578-579` left-border shadow is rewritten here into a token-based marker
   without a left border.
10. **`docs/design-system.md`** contains:
    - the token table;
    - the spacing and type scale;
    - the per-script stacks and why `lang` matters (Han unification);
    - the component list with each component's a11y contract;
    - the anti-pattern list;
    - the rule for adding a component: a test plus a line in this file.

    It is linked from `README.md` and `DESIGN.md` §3.

## Steps

1. **Baseline.**
   - Add `m8` to the CI push branches (`.github/workflows/ci.yml:5`).
   - Run `pnpm build` and `pnpm check` on the base.
   - Record the real bundle numbers and the chunk map (file names and which entry imports them)
     in `reports/baseline.md`.
2. **Baseline screenshots.**
   - Add `e2e/ui-screens.spec.ts`. It is skipped unless `UI_SCREENS` is `before` or `after`, as
     `store-screenshots.spec.ts:12` does. A script `pnpm run ui:screens -- before|after`
     refuses to overwrite a folder that already exists.
   - Captures:
     - the panel with the translated store fixture;
     - the top of the options page;
     - onboarding step 1.
   - Each capture runs at 320px and 480px widths, in light and dark (paper is added when it
     exists).
   - Output goes to `plans/261018-0900-m8-ui-ux-refresh/screens/before/`. Run it once on the
     unchanged UI.
3. **Vietnamese coverage of the serif candidates.**
   - Add a dev-only `scripts/glyph-check.html`. It sits outside `srcDir`, so it is never
     packaged.
   - It renders every Vietnamese tone mark on every vowel, plus Ơ Ư Đ, in Iowan Old Style,
     Charter and Georgia.
   - Inspect it on macOS and fix the `--font-serif` order. Record the result in the baseline
     report, with Windows pending for phase 6.
4. Write `tokens.css`, `base.css` and `theme.ts`, with unit tests:
   - the theme attribute for each value, and "system" removing it;
   - the sync mirror and `localStorage` reconcile, plus a corrupt mirror falling back to
     defaults;
   - following `onChanged`;
   - a contrast test that parses `tokens.css` and computes WCAG ratios for `--ink`, `--muted`,
     `--accent` and `--danger` on `--ground` and `--raised`, and for `--on-accent` on
     `--accent`, in every theme.
5. Write `src/shared/reading.ts` with tests that mirror `quality.test.ts`. Wire the full import
   and export path (requirement 5), with tests for:
   - export;
   - import with a preview line;
   - an unknown value skipped with a note;
   - an old file without `reading`.
6. Write `icons.tsx` and the components, with tests for the keyboard paths, focus return, the
   Escape propagation stop, Tab close and the aria attributes.
7. Import the tokens into the panel and options stylesheets. Remove the `:root` blocks, replace
   `Canvas`, fix the onboarding colors, add `check-tokens.mjs` and fix what it finds.
8. Run `pnpm test`, `pnpm run e2e` and `pnpm run check:bundle`. Where an existing line goes over,
   or a chunk is added or renamed by the shared `src/ui/` code, edit only those lines in
   `scripts/bundle-budget.json` by hand: measured size plus 10%, with a dated note. Never run
   `--update`, which rewrites every line.
9. Write `docs/design-system.md`.

## Files

- Create:
  - `src/ui/tokens.css`, `src/ui/base.css`, `src/ui/theme.ts`, `src/ui/icons.tsx`
  - `src/ui/{Button,IconButton,Select,Segmented,Popover,Menu,Field,Notice}.tsx`, each with a
    `*.test.tsx`
  - `src/shared/reading.ts` and its test
  - `e2e/ui-screens.spec.ts`
  - `scripts/ui-screens.mjs`, `scripts/glyph-check.html`, `scripts/check-tokens.mjs`
  - `docs/design-system.md`
  - `reports/baseline.md`
- Modify:
  - `src/entrypoints/{sidepanel,options,onboarding}/style.css` and `main.tsx`
  - `src/shared/portable.ts` and its test
  - `src/entrypoints/options/Transfer.tsx` and its test (the preview line only)
  - `src/locales/en.yml`, `vi.yml`
  - `package.json` (`check` and `ui:screens`)
  - `scripts/bundle-budget.json` (only lines that changed)
  - `.github/workflows/ci.yml`
  - `README.md`, `DESIGN.md` §3 (links)

## Acceptance

- [x] The components and theme have green unit tests, including the keyboard, Escape and Tab tests for `Popover` and `Menu`.
- [x] The contrast test passes for every theme, including `--on-accent`.
- [x] Reading settings round-trip through export and import with a preview line. An unknown value is skipped with a note, and an old file leaves the settings unchanged.
- [x] The theme is set before the first render (unit test on `applyThemeSync`).
- [x] `check-tokens.mjs` runs in `pnpm check` and passes.
- [x] The "before" screenshots are committed under `screens/before/`.
- [x] `pnpm check` and `pnpm run e2e` are green.
- [x] A visual review against the anti-pattern list is noted in the progress log.

## Risks

- **The palette change shifts existing visuals.** That is expected. The store screenshots are
  regenerated in phase 6.
- **The `localStorage` mirror can go stale.** `followTheme` always reconciles with
  `storage.sync` and rewrites the mirror. The mirror only removes the flash.
