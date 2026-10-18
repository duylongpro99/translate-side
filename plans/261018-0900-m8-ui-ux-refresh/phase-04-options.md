---
phase: 4
title: "Options page on the design system"
status: completed
priority: P2
effort: "2.5d"
dependencies: [1]
---

# Phase 4: Options page

## Goal

The options page can be scanned and configured quickly. A section index lets the user jump to
any section, fields line up in a consistent grid, long explanations no longer bury the controls,
and every control uses the phase 1 components and the shared theme. Behavior and stored data do
not change.

## Context

- **`Options.tsx:802-826`:** one `<main class="opt">`, a single scroll, `max-width` 640px
  (`options/style.css:23-26`). The sections are Providers, Language (`:87`), Style (`:138`),
  Quality (`:219`), Glossary (`:294`), Sites (`:425`), Shortcuts (`:579`), Cache (`:615`) and
  Spend (`:647`), then Memory (`Memory.tsx:19`), Transfer (`Transfer.tsx:94`) and Diagnostics
  (`Diagnostics.tsx:14`). Each is a `section.opt__section` with an `h2` and an id used as a link
  target (`#sites`, `#memory` and so on).
- **`Providers.tsx`** (1,173 lines) holds the connections list, models, routing, per-site rules,
  the connection form with `details.prov__advanced` (`:941`), the CORS guide with `role="tab"`
  (`:1152`) and the preset picker.
- **Controls:** selects (Options 114, 120, 154, 167; Providers 317, 378, 384, 891, 903),
  checkboxes, radios (Providers 244, 987) and file inputs (Memory 189, Transfer 255).
- **Tests:** `Options.test.tsx` (94 `querySelector` calls), `Providers.test.tsx` (41),
  `Memory.test.tsx`, `Transfer.test.tsx`, `Diagnostics.test.tsx`. The e2e suite uses
  `#route-review`, `#g-term`, `#g-rendering` and `#g-keep`.
- **Screenshot 03** (`docs/store/assets/03-options-providers.png`) shows bordered buttons, small
  native selects and long paragraphs between controls.

## Requirements

1. **Layout.**
   - Wider than 900px: a two-column grid with a sticky section index on the left (`nav` with
     `aria-label`, links to the existing section ids, current section marked with
     `aria-current="true"` from an IntersectionObserver) and content up to 720px on the right.
   - Narrower than 900px: the index becomes a horizontal, wrapping list at the top. It is not
     sticky.
   - The index uses the existing section ids, so the `#sites` and `#memory` deep links keep
     working.
2. **Section anatomy.**
   - An `h2` in the UI font at 1.05rem, weight 650, then an optional one-line lede.
   - Fields use `Field`: label column 160px and control column, stacked under 560px.
   - Help text sits under the control in `--muted` at 0.85rem.
   - Explanations longer than about two lines go behind a `<details>` "More about this" below
     the field. The full text is kept, only folded. The `id`s and `aria-describedby` links are
     kept.
   - **Never fold** privacy and data-flow disclosures. The explicit list of locale keys is:
     - `options.providers.honest` (`Providers.tsx:168-169`);
     - the fallback hint (`Providers.tsx:524`) and the site-rules and local-only hint (`:590`);
     - `style.mediaHint` (`Options.tsx:201`);
     - `memory.acrossSitesHint` (`Memory.tsx:164`);
     - `transfer.keyKept`, `confirmWarning` and `unencrypted` (`Transfer.tsx:66-68`).

     The implementer adds any other text that says where data goes or how keys are stored, and
     records the final list in the phase report. A unit test asserts that none of these strings
     renders inside a `<details>` element.
3. **Controls.**
   - Selects become `Select`. Buttons become `Button`: "Add" is `default`, "Remove" is `quiet`
     with danger text, and Save is `primary` once per form.
   - Checkboxes and radios are restyled natively with `accent-color: var(--accent)` and aligned
     labels. File inputs get a `Button` label with the native input kept for accessibility.
4. **Lists** (connections, models, glossary rows, site rules, memory entries) are hairline-separated
   rows, not bordered cards. A status dot plus text (connected, failed) uses `--ok` or `--danger`
   with the text always present, never color alone.
5. **The Providers connection form** is grouped into Connection, Authentication and Advanced
   (the existing `details`). The preset picker uses `Segmented` when it has 5 entries or fewer
   and a `Select` otherwise. The CORS guide's tabs keep their roles.
6. **Theme.** The page follows the reading item's theme via `theme.ts` (wired in phase 1). A
   "Theme" field in the Style section edits the same `reading.theme` with a `Segmented`, so
   options and panel stay in step. Theme is a free setting, so `Segmented` is allowed here.
7. **Strings.** New strings (index label, "More about this", the theme field) go into both
   locales. Existing help strings are reused unchanged. Folding needs no rewrite.

## Steps

1. Write the hook list (ids, test ids, classes used by `Options.test.tsx`, `Providers.test.tsx`,
   the other options tests and `e2e/flows.spec.ts`) into the phase report.
2. Add the layout and section index (`OptionsNav.tsx`, with a test for the links and
   `aria-current`).
3. Move each section to `Field`, `Select`, `Button` and `Notice`, one section per commit, running
   the options tests after each.
4. Rework `Providers.tsx` lists and the form grouping.
5. Add the Theme field.
6. Update tests only where markup moved. Run `pnpm check` and `pnpm run e2e`, then do a visual
   review at 1280px and 600px in light, paper and dark.

## Files

- Modify:
  - `src/entrypoints/options/Options.tsx`, `Providers.tsx`, `Memory.tsx`, `Transfer.tsx`,
    `Diagnostics.tsx`, `style.css`
  - their tests where markup moved
  - `src/locales/en.yml`, `vi.yml`
  - `docs/design-system.md` (forms section)
- Create: `src/entrypoints/options/OptionsNav.tsx` with a test.

## Acceptance

- [x] Every section is reachable from the index, and existing deep links (`#sites`, `#memory`) still scroll to their section.
- [x] Every control from before is present with the same behavior. The step 1 hook list is fully ticked.
- [x] The Theme field and the panel's reading popover change the same stored value.
- [x] No bordered card lists, no pills, and the help text is folded but complete.
- [x] `pnpm check` and `pnpm run e2e` are green, and the visual review is noted.

## Risks

- **`Providers.tsx` is large and densely tested.** Restyle it section by section with tests
  between steps. Do not refactor logic.
- **Folding help text could hide privacy-relevant wording.** The never-fold list and its test
  guard it.
