# Review: M8 phase 2 (panel chrome), uncommitted work on branch m8

Worktree `translate-side-m8`, base `ab98e57`. Read-only review of `git diff` plus the four untracked files. I checked
the work against the phase-02 spec, the plan invariants, the hook list and the controller decisions.

## Verification run

- `pnpm run typecheck`: green. `pnpm run lint`: green (0 warnings). `node scripts/check-tokens.mjs`: green.
- `pnpm exec vitest run src/entrypoints/sidepanel src/ui src/locales`: 41 files, 517 tests, all pass.
- I did not run e2e, Playwright or the build, as instructed. The `chunks/sidepanel.js` value of 29250 matches
  26590 × 1.1, but I did not measure the 26590 myself.
- `git diff --check`: clean.

## Blocking

None found. Nothing in the diff breaks a unit test, typecheck, lint or the token check. No hook from the hook list is
lost.

## Should-fix

1. **The Vietnamese e2e test now passes against the wrong button.** (`e2e/flows.spec.ts:228`, a hook the hook list
   missed.)
   - `getByRole('button', { name: 'Cài đặt' })` was the header ⚙ button. Settings is now a `menuitem` inside a hidden
     menu, so it no longer matches.
   - The Aa button has the name "Cài đặt đọc" (`vi.yml` `panel.reading.title`). Playwright matches names by
     case-insensitive substring by default, so the locator now resolves to Aa.
   - Playwright 1.64's role engine does not treat `inert` as hidden. I grepped its library and found no `inert` check
     in the injected script. So the inert Aa button still counts as visible, and the test stays green without proving
     what it was written for.
   - Fix: assert on something that really moved. For example, `getByRole('button', { name: 'Thêm', exact: true })`,
     the More trigger. Or open More after the notice and check `getByRole('menuitem', { name: 'Cài đặt', exact: true })`.
     Add the line to the hook list.

2. **The job bar lost its live region for fallback, review, cancel and backoff-free state changes.**
   (`JobBar.tsx:160-198`, `:171-174`)
   - Before this change, every running and done bar was `<div {...attrs} role="status">`. So the fallback note ("switched
     to X because …"), the review-unavailable note and the kept and edits notes were announced when they appeared.
   - In the `inHeader` branch only the `.sr-only` `<p role=status>` is live. `job-fallback`, `job-review-unavailable`,
     `job-kept` and `job-edits-kept` (all `role="note"`) now appear silently.
   - Also, when running turns into cancelled (header Stop), Preact patches the same `<div>` and adds `role="status"` in
     the same commit as the new text. A role added together with its content is often not announced, so "Cancelled
     N of M" may go unheard. Before, the role was already in place.
   - Fix:
     - Keep `role="status"` on the wrapper in the `inHeader` branch too, and drop the role from `job-live`. The
       sentence stays `.sr-only` inside the region.
     - To avoid "1 failed" being read twice, put `aria-hidden="true"` on the visible `.job__say .job__text` spans
       only, not on the buttons.
     - This keeps `job-live` for the test and makes start, progress, failures, done, fallback and cancel behave as
       before.

3. **The header popovers cover the notice strip they are meant to keep visible.** (`style.css:35-36`, with
   `.panel__bar { position: relative }`)
   - Popovers and the menu are placed at `top: calc(100% - 2px)` of `.panel__bar`. So they cover the title line, the
     progress bar and `.panel__notices`.
   - Scenario: the user picks a model in the Translation popover and the switch fails. `switcher-error` appears in the
     strip under the open popover, and a sighted user does not see it until the popover closes. The same happens with
     the site-rule notice: the popover's Model field shows only `rule.model` (reason in a `title` tooltip), and the
     reason sits under the popover.
   - This defeats the "always visible, never inside a popover" rule for the case that matters most: an error caused by
     an action inside the popover.
   - This is new evidence against the `.panel__bar` anchoring decision. Fix: anchor the overlays to `.panel__header`'s
     bottom instead:
     - make `.panel__header` the containing block;
     - use `top: 100%`, with `left`/`right: var(--space-4)` so they still line up with the content edges at 320px;
     - set `width: min(280px, calc(100% - 2 * var(--space-4)))`.
   - The strip then stays visible above any open popover. Extend the e2e header test with an `elementFromPoint` check on
     a strip notice while the popover is open.

4. **The size stepper drops keyboard focus at the limits.** (`ReadingPopover.tsx:56,62`)
   - Pressing A+ at 23 makes the focused button `disabled`. Chrome's focus fixup then moves focus to `<body>`.
   - From there:
     - Escape no longer reaches the popover's `onKeyDown`, so the popover stays open.
     - Escape does not reach `<main>` either, so an open help does not close.
     - Tab starts from the top of the document, and the popover's Tab-close check never runs.
   - Scenario: a keyboard user raises the size to 24 and the popover can no longer be dismissed from the keyboard.
   - This is the same disabled-while-focused trap noted for the phase 1 overlays.
   - Fix: use `aria-disabled="true"` and make `onClick` a no-op at the limit, which keeps the button focusable. Or move
     focus to the other stepper button when the limit is reached. Add a unit test that asserts `document.activeElement`
     is still inside the dialog after reaching 24.

5. **The notice strip adds an empty 8px band in the normal reading state.** (`style.css:138-143`, `ModelSwitcher.tsx:111-116`)
   - `.panel__notices:empty { display: none }` never matches when the user has two or more model profiles. In that case
     `switcher-live` (an `.sr-only` span) is always rendered in the strip.
   - The strip's `padding-bottom: var(--space-2)` then draws an empty 8px band under the header on every page. That
     contradicts the phase's stated risk mitigation ("the strip is empty in the normal reading state").
   - Fix: use the same pattern as `.job`: `.panel__notices:not(:has(> :not(.sr-only))) { padding: 0 }`, with the
     `:empty` rule kept or dropped. `:has` is safe because the minimum Chrome is 138.

## Nit

1. **`aria-expanded` on More while the help is open.** (`App.tsx:357`)
   - The override forces `aria-expanded=true` on a trigger that also carries `aria-haspopup="menu"`. A screen reader
     says "More, menu, expanded" while no menu is open.
   - While the help and the menu are both open, `aria-controls` points at `#shortcuts`, not at the menu.
   - The spec asks for this behaviour. Consider applying the override only while the menu is closed, or making
     "Keyboard shortcuts" a `menuitemcheckbox` with `checked: help`, which also says the toggle state.

2. **Two independent `useBestAvailable()` calls.** (`HeaderControls.tsx:102,190`)
   - Each call runs its own `featureAvailable('best-mode')` check. With `BEST_MODE_RELEASED` on, that means two license
     checks per header mount.
   - The calls can resolve in different renders, so for one frame neither copy of `quality-lock-note` shows. It never
     shows twice, so the `aria-describedby` target is briefly missing rather than duplicated.
   - Fix: compute `locked` once (in `App`, or a shared hook result) and pass it to both components.

3. **Size writes and errors.** (`ReadingPopover.tsx:38`)
   - Size writes are absolute, built from `reading.size` before `onChanged` arrives. Two quick A+ clicks both write
     size+1, so one step is lost.
   - Write errors are swallowed with no feedback. A failed `storage.sync` write, for example because of the per-minute
     write quota, silently does nothing.
   - Consider a functional patch (an "increment" passed to `updateReading`) and the same "couldn't save" notice that
     prefs use.

4. **The live region is created with its first text.** `job-live` mounts together with its first sentence, so the
   "start" announcement depends on the screen reader. The behaviour is not new, but the acceptance criterion says
   start must be heard. A region that is always mounted (an empty status in the header) would make it reliable.

5. **Dead leftovers.**
   - `.panel__error` (`style.css:618-622`) has no user left.
   - `panel.header.close` (`en.yml:19`, and `vi.yml`) is no longer referenced.
   - `.panel__controls` was kept as the left group. That is fine, but the spec's step 2 said to retire it, so note it
     in the commit.

6. **Legacy plan ids in rewritten comments.** The rewritten comment lines keep legacy plan ids: `HeaderControls.tsx`
   header comment (M3-E6, M4-E11), `ModelSwitcher.tsx` header comment (M4-E11), `style.css` "Translation job (plan
   M1-E10)". These lines are new in the diff, so the no-plan-id rule applies to them. Drop the ids from the edited
   lines.

7. **`OfferBar` is not a `Notice`.** The spec says `OfferBar` becomes a `Notice` with `Button`s. It is still a
   `<section class="offer">` with `Button`s (restyled, with the left-border accent removed). This is functionally fine;
   either convert it or record the deviation.

8. **No max-height on the popovers.** The Translation popover with the tab-only row is about 320px tall, measured
   from the row. In a short side panel the bottom (the page line and cost) is cut off and cannot be scrolled to,
   because the popover is inside the sticky header. Add `max-height: calc(100vh - var(--panel-header-h) - 16px);
   overflow: auto` to `.panel__bar .ui-popover`, or to the header-anchored rule from Should-fix 3.

9. **The dev segment view hides the cost.** With `dev` on, `showControls` is false, so the Translation popover (and
   with it the only place the cost lives) is not rendered, while `JobBar inHeader` still hides it. This affects dev
   builds only.

10. **No test for Escape in the More menu while the help is open.** The Escape-scoping test covers the Translation
    popover but not the More menu with the help open (`Menu` also stops propagation, so it works today). One more
    case in `App.test.tsx` would pin it.

## Checked and fine

- **Hook list.**
  - Every id it lists exists after the change: `scroll-follow`, `shortcuts-button`, `menu-settings`/`menu-dev`/
    `menu-close`, `header-controls`, `lang-pair`, `source-lang`, `target-lang`, `style-mode`, `quality-control`,
    `quality-mode`, `quality-lock-note`, `header-model`, `model-switcher`, `switcher-tab-only`, `make-default`,
    `switcher-site-rule`, `switcher-live`, `switcher-error`, `prefs-error`, `page-cancel`/`page-retranslate`.
  - The job attributes are unchanged (`attrs`).
  - `retry-failed`, `translate-rest`, `job-kept`, `job-edits-kept`, `job-cost` (page line) and the offer and setup ids
    are all there.
- **The first `[data-testid=job] button`.** It is unchanged per state, because Cancel was already absent on the page
  view.
- **e2e text checks.**
  - "N failed" and "the rest as you read" stay in `textContent`: they are visible in `.job__say`, and "N failed" is
    also in the sr-only sentence.
  - `translateRest` starts with `all` (`lazy: false`), so `not.toContainText('the rest as you read')` in
    `pages.spec.ts:47` and `perf.spec.ts:37` still resolves.
  - `upgrade.spec.ts:276` uses `toHaveValue`, which works while hidden.
  - `fixtures.ts:219` and `upgrade.spec.ts:99,202` use `toBeVisible()` on the job bar. The bar's 1px `min-height` box
    satisfies them.
- **Stacking.** Header `z-index: 3` (sticky, a stacking context), `.job` 2, overlays 20 inside the header. `.seg__actions`
  is not positioned. The e2e `elementFromPoint` check proves that a popover over the job bar receives the click.
- **`coveredBy` and `coveredTop`.** All new rows are inside `.panel__header`, so `blocks-nav.ts:44` and `follow.ts:64`
  need no change. The `--panel-header-h` `ResizeObserver` picks up the taller header.
- **Escape scoping.** `Popover` and `Menu` call `stopPropagation` and `preventDefault`. `main` also checks
  `!e.defaultPrevented`, which also respects the editor and confirm Escape handlers in `SegmentList`.
- **Focus.** Focus returns to More on Escape and on `shortcuts-close`.
- **`inert`.** It is applied to exactly the three triggers, and a test covers it.
- **The 320px row.**
  - `.ui-select` and its `select` have `min-width: 0`, and the Translation label has `overflow: hidden` inside a
    `min-width: 0` button, so both can shrink.
  - The fixed part is about 160px: four 32px icons plus the source and the arrow.
  - The new e2e asserts `scrollWidth <= clientWidth` and a row height under 48px. It has not been run here.
- **`quality-lock-note`.** Exactly one element whichever way it is rendered, and the `aria-describedby` target always
  exists.
- **Reused vnode.** The module-level `lockNote` vnode is safe to reuse: Preact clones a used vnode.
- **Progress bar.** It has no transition, so it hides at once. It uses `role=progressbar` with min, now, max and a
  label.
- **Anti-patterns.** No hex or system colors (`check-tokens` is green). The offer's left-border accent is removed. No
  gradients or shimmer. There is one accent.
- **Vietnamese.** All new keys are present in `vi.yml`, and the wording is natural ("Thêm", "Bản dịch: $1",
  "$1 trên $2 khối", "Toàn bảng"). The parity test passes.

## Plan follow-ups (for the lead)

- Steps 1 to 7 appear implemented.
- Step 8 is still open: `pnpm check`, `pnpm run e2e` and the visual review at 320px and 480px. Re-run e2e after
  Should-fix 1 and 3.
- Add `flows.spec.ts:228` to the hook list.

Status: DONE_WITH_CONCERNS
Summary: No blockers. Unit tests, typecheck, lint and the token check are green, and every hook in the hook list is
kept. Five should-fixes: a Vietnamese e2e assertion that now passes against the Aa button, lost live-region coverage
for fallback, review and cancel, popovers covering the notice strip, focus lost at the stepper limits, and an empty
8px strip band.
Concerns/Blockers: e2e and the bundle measurement were not run, per instructions.
