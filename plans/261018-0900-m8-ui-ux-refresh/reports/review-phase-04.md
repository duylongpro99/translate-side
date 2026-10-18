# Review: phase 4 (settings page on the design system), uncommitted work on `m8`

Date: 2026-10-18. Worktree: `translate-side-m8`. Scope: `git diff` plus the untracked `More.tsx`, `OptionsNav.tsx(+test)`
and `src/ui/use-reading.ts`. This was a read-only review: I did not run e2e or a build.

Checks run: `pnpm run typecheck` clean, `pnpm run lint` clean (0 warnings), `node scripts/check-tokens.mjs` clean,
`vitest run src/entrypoints/options src/entrypoints/onboarding ReadingPopover.test.tsx src/ui src/locales`: 16 files and
157 tests pass.

Out of scope, noted only: `scripts/bundle-budget.json` changed in the working tree during the review (`assets/style.css`
3530 -> 4112, `chunks/toggle-shortcut.js` 812 -> 941). The other process made that change; I did not review it.

## Verdict

There is no blocking defect, and no button changed type by mistake. Every old implicit `type="button"` became a `Button`,
which defaults to `button`. Every old `type="submit"` (glossary, the two site forms, the site-rule form, the model form,
save-connection) still has `type="submit"`. `class` merges with the variant classes and is never overwritten. In Preact 11
`ref` passes through to the native button: `Transfer.test` checks focus on `keys-confirm-no`. All hooks in the hook list
are still present. The section ids are unique; `#shortcuts` does not clash with the panel's `ShortcutList`, which is not
rendered on the settings page. The Theme field writes the same `reading.theme` through `updateReading`.

The Should-fix items: the index marks the wrong section when the user picks one at the end of the page; one visual layout
break; two test gaps that let the guarantees break without a failing test; and departures from the spec's button-variant
rules.

## Blocking

None.

## Should-fix

1. **The index marks the wrong section after a click on one of the last sections.** `OptionsNav.tsx:30-40,53`.
   - `onClick` sets `current`, then the hash scroll fires the IntersectionObserver. The callback marks the first section
     in page order that crosses the top 40% band (`rootMargin: '0px 0px -60% 0px'`).
   - Diagnostics, and probably Transfer, are too short to reach that band. At the end of the scroll, their top edge stays
     below 40% of the window height.
   - Failure scenario: the user clicks "Diagnostics", the page scrolls to the bottom, and the IO callback then sets
     `aria-current` back to Transfer or Memory. A screen-reader user hears that the wrong section is current. The unit
     test "marks a section at once when its link is followed" passes because its fake IO never fires after the click.
   - This may also be what the progress log saw as "the current mark stays on Providers after a script scroll".
   - Fix: when the page is scrolled to the end (`innerHeight + scrollY >= scrollHeight - 1`), mark the last section that
     is visible. Or ignore IO updates until the next user scroll after a link click. Add a test that fires the IO after
     the click.

2. **The Memory file button overflows its grid cell.** `Memory.tsx:190` with `style.css:75-84`.
   - The row's first child is `label[for]`, so the 160px grid applies. The `label.ui-button` stretches to exactly 160px,
     and `.ui-button` has `white-space: nowrap`.
   - "Import a translation memory file" is about 230px wide, so its text runs out of the button's border into the empty
     second column (the input in that column is 1px and absolutely positioned).
   - "Settings file" (Transfer) fits, which is why only the Memory row breaks.
   - Fix: lay out file rows as a flowing line, e.g. `.opt__row:has(> .opt__file-label) { display: flex; }`, or give
     `.opt__file-label` `grid-column: 1 / -1; justify-self: start`.

3. **The never-fold test only proves the default render state.** `Options.test.tsx:659-675`.
   - `transfer.keyKept`, `transfer.confirmWarning` and `providers.unencrypted` render only in a state (a key kept on
     import, the export confirmation, an `http://` address).
   - For those keys, the test checks "not inside `details.opt__more`" against a page where the strings are not rendered
     at all. Wrapping `keyKept` in `<More>` would still pass.
   - `memory.replaceHint`, one of the three folded texts, is also missing from `FOLDED` because it renders only with a
     pending import. The hook report says a test asserts that none of these strings renders inside a `<details>`; that
     holds only for the default view.
   - The test also checks `details.opt__more` only, while the plan says "inside a `<details>` element". See Nit 6.
   - Fix (cheapest): add a static check that reads the five option sources and asserts that no `<More>…</More>` span
     references a NEVER_FOLD key, and that exactly the three FOLDED keys appear inside `<More>`. Or drive the three
     states in the test.

4. **The OptionsNav test cannot catch a missing or renamed section id.** `OptionsNav.test.tsx:23-27,41-42`.
   - The test creates its own `<section id>` for every SECTIONS entry, then asserts that they exist.
   - Nothing renders the real `<Options>` and checks that each SECTIONS id is on the page exactly once. If a section id is
     renamed, or a section is removed, the index link points at nothing and the tests stay green.
   - Fix: in `Options.test.tsx`, render `<Options>` and assert
     `SECTIONS.every(([id]) => root.querySelectorAll('#' + id).length === 1)`. The cache stub must return stats.

5. **Index links can point at a section that is not rendered.** `OptionsNav.tsx:5-18` against `Options.tsx:633`
   (`CacheSection` returns null when `!cache` or `stats === null`) and `Memory.tsx:64` (`if (!memory) return null`).
   - Failure scenarios: IndexedDB is unavailable, the cache stats read fails, or a failed "Clear cache" calls
     `setStats(null)`. In each case, "Cache" and/or "Memory" stay in the index as dead links.
   - Fix: at mount, filter SECTIONS to the ids found by `document.getElementById`, and re-check when the observer runs.
     Or let those sections render their heading with a short "not available" line.

6. **Button variants depart from the spec ("Add is `default`", "Remove is `quiet` with danger text", "Save is `primary`
   once per form") and from Button's own contract ("`primary` at most once per view").**
   - Add submits made `primary`: glossary `Options.tsx:406`, allowed sites `:553`, never-translate sites `:571`, site
     rule `Providers.tsx:517`. The default page shows at least five accent-filled buttons at once: those four plus
     `spend-limit-save`. Two of them are in the same section (Sites).
   - Remove buttons left `default`: models `Providers.tsx:330`, site rules `:496`, the fallback `×` `:569`. Connection
     Remove (`:249`) is `quiet` and red, so the page now shows two kinds of Remove.
   - Fix: make the Add submits `default` (or `primary` only where the form is the only one in its view). Make the three
     Remove buttons `variant="quiet" class="opt__danger"`.

## Nit

1. **The spend-limit row stacks its buttons.** `Options.tsx:771-791`. In the row label, input, Save, Remove, the rule
   `> :nth-child(n + 3) { grid-column: 2 }` puts Save and Remove each on its own row under the input. Fix: wrap the two
   buttons in a single `<span>`, or use flex when the row has a button.
2. **Whitespace-only lines left by the conversion** (`<Button` followed by a blank line): `Diagnostics.tsx:62,73,97`,
   `Transfer.tsx:234`, `Providers.tsx:1125`. In `Options.tsx:833-857`, the `<OptionsNav />` and `<main>` under the new
   `.opt__page` div are not indented.
3. **A failed Theme write leaves the radio showing a value that was never stored.** `Options.tsx:824` (and the panel,
   which has the same pattern): `.catch(() => undefined)`. The native radio stays checked on the new value. Because
   `reading` state did not change, Preact does not re-render to undo it, for example after a `storage.sync`
   write-quota error. Fix: on failure, re-read and set the value, or show the save error.
4. **`useReading` re-read (`src/ui/use-reading.ts:14-16`).** It behaves the same as before, at the cost of one extra
   async step. The panel popover test needed an extra `settle()`, and the size stepper's `size` ref still keeps quick
   clicks correct.
   - One small difference: if `storage.sync.get` fails on a change event, `readReading` returns the defaults. The
     popover and the Theme field would then show "system" while `followTheme` (which still uses `newValue`) keeps the
     real theme on the page.
   - Fix: skip the update when the read fails, or use `cleanReading(changes[READING_KEY].newValue)` as `theme.ts` does.
5. **The connection status dot uses `--warn` for failed** (`style.css:291-294`), where the spec says `--danger`. The
   text is always present, so this is a color choice only.
6. **A data-flow disclosure sits inside a folded `details`.** `options.providers.advancedSync` ("Extra headers and query
   params sync to your other devices … don't put a key or other secret here") is inside the existing
   `details.prov__advanced` (`Providers.tsx:941-944`). It sits next to the fields it describes, so it is visible
   whenever they are, which is acceptable. Record it in the never-fold report as a deliberate exception, so the list
   matches the plan's "inside a `<details>`" wording.
7. **Repeated "More about this" summaries.** Every folded explanation's summary has the same accessible name. In a
   screen reader's list of controls they cannot be told apart. Optional: add an `aria-label` that combines the text
   with the field ("More about Token budget").
8. **Theme field layout.** The Theme `Segmented` (`.opt__field`) does not use the 160px label column, so its legend is
   small and muted while the other labels sit in the column. The hint is not linked by `aria-describedby`. This is
   cosmetic.
9. **Onboarding (phase 5) inherits the grid.** `Onboarding.tsx:124`: label plus a native `<select>` now lands in the
   160px grid. The native select stretches across the second column because `justify-self: start` applies only to
   `.ui-select`. The `.opt input[type=checkbox]` accent rule does not reach the ConnectionForm checkboxes inside `.onb`.
   Onboarding's own buttons stay native next to the `ui-button` buttons of ConnectionForm. The `.onb__steps` pills and
   `.onb__card` borders still break the anti-pattern rules. All of this belongs to phase 5; nothing is broken today.
10. **`.prov__switch select { font: inherit }` was dropped.** `base.css` now sets `font: inherit` on every select, so
    nothing is lost.

## Controller decisions, not challenged

- The CSS grid on the existing `.opt__row` instead of `Field`. The grid's edge cases are covered above (Should-fix 2,
  Nit 1, Nit 9).
- The preset picker stays as buttons.
- Only three explanations are folded.
- The style section's id is `#translation-style`.

## Checklist

- Hooks: every id, test id, `data-preset`, aria-label and class in `reports/phase-04-hooks.md` is still present. The
  `Select` wrapper keeps `id`, `value` and `aria-label` on the native select. `setInputFiles` still works on the
  visually hidden file inputs.
- Accessibility:
  - The nav is labelled ("Settings sections" / "Các mục cài đặt") and uses `aria-current="true"` as specified.
  - The file inputs are 1px with opacity 0, still focusable, and get a focus ring on the label through
    `:has(:focus-visible)`.
  - Folded text keeps its id. Content referenced by `aria-describedby` inside a closed `details` still counts toward the
    description.
  - The connection-form groups are `h4` headings under the form's `h3`.
- Deep links: `#sites` and `#memory` are unchanged. `scroll-margin-top` is set.
- Duplicate ids: none.
- Tokens: no literals. Anti-patterns on the settings page: none (hairline rows, tags as muted words, no shadows).
- Plan ids in new code: none (only the "Phase 4 log" heading in the progress doc).

## Unresolved questions

- Is Should-fix 6 (the Add submits as `primary`) an intentional reading of "Save is primary once per form", with each
  Add treated as its form's Save? If so, update the spec line and Button's "once per view" comment so they match.

Status: DONE_WITH_CONCERNS
Summary: No blocking defects; buttons kept their types and all hooks are present, so behavior is unchanged. Six
should-fix items: the index marks the wrong section after a click on one of the last sections; the Memory file button
overflows its grid cell; two tests can pass without proving their guarantee (state-only never-fold strings, real section
ids); dead index links when Cache or Memory is absent; and button variants that depart from the spec.
Concerns/Blockers: Should-fix 1 needs a check by hand in a real window (already an open item in the progress log).
