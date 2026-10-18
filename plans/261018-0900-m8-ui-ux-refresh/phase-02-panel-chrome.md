---
phase: 2
title: "Panel chrome: control row, popovers, menu, progress"
status: completed
priority: P1
effort: "2.5d"
dependencies: [1]
---

# Phase 2: Panel chrome

## Goal

The panel header becomes direction A's single control row. Below it sits a strip for notices
that need attention, and a 2px progress bar replaces the progress sentence. Every header and job
bar action stays reachable, and every test hook is kept or moved on purpose. Screen readers
still hear progress.

## Context

- **Today's header** (`App.tsx:311-345`):
  - an `h1` with the page title (`:313`, with a `title` tooltip);
  - icons: `{ }` (dev), ⇅ follow (`scroll-follow`), ? shortcuts (`shortcuts-button`, a
    `helpButton` ref with `aria-expanded` and `aria-controls`, `:305-312, 334`), ⚙ settings and
    ✕ close;
  - `<main onKeyDown>` closes the help on any Escape (`:314`).
- **`HeaderControls`** (`HeaderControls.tsx:75-136`):
  - source code and target `<select data-testid="target-lang">`;
  - `ModelSwitcher`, with the site-rule notice (`ModelSwitcher.tsx:34-43`), select (`:58`),
    make default (`:86`), live region and `switcher-error` (`:93-102`);
  - `style-mode` and `quality-mode` selects, and `quality-lock-note` (`:118-122`);
  - `page-cancel` and `page-retranslate`;
  - `prefs-error` (`:133-137`).
- **`JobBar`** (`JobBar.tsx:119-226`):
  - running (`:158-176`): a `role=status` progress sentence, "N failed", cost, the "rest as you
    read" text, `translate-rest`, Cancel;
  - done (`:178-197`): `retry-failed`, `translate-rest`, the edits and kept notes;
  - cancelled (`:199-211`): `translate-rest`;
  - skipped (`:213-226`): `job-skipped` and "Translate anyway";
  - errors, backoff, fallback, review and limit states;
  - `data-started` and `data-first-visible` (`:126-129`).
- **Header and job bar stacking.** `.panel__header` is sticky with `z-index: 1`
  (`style.css:33-40`). `.job` is also sticky with `z-index: 1` and comes later in the DOM
  (`:284-297`). `coveredBy` and `coveredTop` measure `.panel__header, .job`
  (`blocks-nav.ts:44`, `follow.ts:62-65`).
- **e2e dependencies:**
  - `jobSettled` calls `toBeVisible()` on `[data-testid=job]` (`e2e/fixtures.ts:261-263`);
  - text checks at `flows.spec.ts:94`, `pages.spec.ts:41` and `perf.spec.ts:35-37`;
  - `quality-mode` in the Best flow (`flows.spec.ts:296-310`);
  - `header-model` at `upgrade.spec.ts:276`;
  - the title check at `flows.spec.ts:50`.
- **`PrivacyNotice`** is `aria-modal` and focuses its button on mount
  (`PrivacyNotice.tsx:10-12`). It renders under the header (`App.tsx:355`).
- **Mockup:** the `.bar`, `.progress` and `.pop` parts of direction A.

## Layout

Three rows, top to bottom:

1. **The control row.**
2. **A muted title line.** This is the page title (`view.result.title`), truncated with a
   tooltip, and it stays the visible `h1`.
3. **The progress bar.**

The notice strip (see below) sits under them.

The control row, left to right:

1. **Language.** The source code (muted, the same title as today), an arrow icon, then the target
   as a quiet `Select`. It keeps `target-lang`, `source-lang` and `lang-pair`.
2. **Translation button.** A quiet button labeled with the current style plus a chevron. It
   opens the "Translation" `Popover`, whose content stays mounted while closed. The popover
   holds:
   - **Style:** a `Select` that keeps `data-testid="style-mode"` and its `.value` and `.options`
     contract. Only the container moves.
   - **Quality:** a `Select` that keeps `quality-mode`, `quality-control` and the Best rules.
   - **Model:** the `ModelSwitcher` select, "This tab only" and "Make default", restyled. All of
     its test ids are kept, including `header-model`.
   - **Page:** a muted line with the model name, segment count, time and the cost when a price
     is set. Cost lives only here (validation decision).
3. A spacer.
4. **`Aa`.** Opens the "Reading" `Popover`: a size stepper from 13 to 24, plus `Segmented` for
   typeface, line width and theme. It writes through `updateReading`. Applying the settings to
   the text is phase 3.
5. **Follow.** An `IconButton` with `pressed`. It keeps `scroll-follow` and its labels.
6. **Retranslate or Stop.** One `IconButton`: `page-cancel` while running, `page-retranslate`
   otherwise. It has today's labels and is hidden when there is no job.
7. **More.** A `Menu` with:
   - Keyboard shortcuts (`shortcuts-button` on the item);
   - Settings;
   - Segment view (dev builds only);
   - Close panel (validation decision).

**Always visible, never inside a popover.** These render in the notice strip under the
progress bar:
- the site-rule notice (`switcher-site-rule`);
- `switcher-error`;
- `quality-lock-note` when Best is locked and was picked;
- `prefs-error`.

The `switcher-live` region moves with them and stays `.sr-only`.

**Focus and stacking:**
- `closeHelp` returns focus to the More trigger (a ref on it).
- `aria-expanded` and `aria-controls` move to the More trigger while the help is open.
- `main`'s Escape handler runs only when no overlay is open. Overlays stop Escape from
  propagating.
- The header's `z-index` is raised above `.job` and `.seg__actions`.
- The header never gets `overflow: hidden`, so popovers are never clipped.
- While the privacy notice is pending, the header's Translation, `Aa` and More triggers are
  `inert`, so no popover can cover the modal notice.

## Progress bar, notice strip and job bar

- **Progress bar.** 2px high, with `role="progressbar"`, `aria-valuenow` (done segments) and
  `aria-valuemax` (total). It is visible only while running and hidden at once on completion,
  with no fade.
- **Live region.** An `.sr-only` `role="status"` region announces job start, done, and the
  failed count. It reuses today's progress strings, so screen readers still hear progress.
- **What `JobBar` hides and shows.** It drops only the plain progress sentence while running or
  done, because the bar and the popover's page line carry it. Everything else is "something to
  say" and stays visible as a `Notice` with `Button`s, with its test ids and its exact text:
  - "N failed" with `retry-failed`;
  - "the rest as you read" with `translate-rest`;
  - Cancel while running, which keeps its job-bar test id next to the header Stop;
  - the cancelled state with `translate-rest`;
  - the skipped state, with `job-skipped` and "Translate anyway";
  - the edits and kept notes;
  - errors with `role="alert"`, the backoff list, fallback and review notes, the limit and
    budget stop, `fix-key` and grant access.
- **The `[data-testid=job]` wrapper.**
  - It keeps `data-status`, `data-started` and `data-first-visible`.
  - It always has a box: a 1px hairline at minimum, so `toBeVisible()` in `jobSettled` holds.
  - `e2e/fixtures.ts` `jobSettled` is changed to also accept `toHaveAttribute('data-status',
    …)`, and the commit explains why.
- **Other notices.** `OfferBar` and the setup offer become `Notice` with `Button`s, and keep
  their test ids.
- **Sticky offsets.** If the notice strip or the progress bar is sticky and outside
  `.panel__header` or `.job`, it is added to both `coveredBy` (`blocks-nav.ts:44`) and
  `coveredTop` (`follow.ts:62-65`), with a test.

## Steps

1. **Write the hook list into the phase report before editing.** It covers every `data-testid`,
   `data-*`, id and text assertion in:
   - `header.test.tsx`, `switcher.test.tsx`, `App.test.tsx`, `jobs.errors.test.tsx`,
     `offer.test.tsx`, `limit.test.tsx`, `follow.test.tsx`, `privacy.test.tsx`;
   - `e2e/fixtures.ts`, `flows.spec.ts`, `pages.spec.ts`, `perf.spec.ts`, `upgrade.spec.ts`.

   Give each hook its new home.
2. Build the row and the title line in `HeaderControls.tsx` and `App.tsx` with the phase 1
   components. Retire `.panel__select`, `.panel__action`, `.panel__icon` and `.panel__controls`.
3. Move `ModelSwitcher`'s select and buttons into the Translation popover. Move its notice and
   alert into the strip.
4. Add the progress bar and the live region, and change `JobBar` as described.
5. Add the More menu. Fix the help focus return, the Escape scoping, the z-index and the `inert`
   rule for the privacy notice.
6. Add the strings to `en.yml` and `vi.yml`: `panel.header.more`, `panel.header.translation`,
   `panel.header.reading` and the reading labels.
7. Update the tests whose markup moved:
   - `header.test.tsx:122-127` opens the popover first;
   - the e2e Best flow and `upgrade.spec.ts:276` open the Translation popover before selecting
     `quality-mode` or `header-model`;
   - `shortcuts-button` is clicked after opening More.

   Add tests for:
   - the row at 320px (an e2e that checks `scrollWidth <= clientWidth` on the row);
   - an Escape inside a popover while the help is open, which closes only the popover;
   - focus returning from the help to More;
   - opening the Translation popover while a job-cost or error notice shows, and checking that a
     click reaches `quality-mode`;
   - the triggers being inert while the privacy notice is pending;
   - the live region announcing done.
8. Run `pnpm check` and `pnpm run e2e`, then do a visual review at 320px and 480px against the
   anti-pattern list.

## Files

- Modify:
  - `src/entrypoints/sidepanel/App.tsx`, `HeaderControls.tsx`, `ModelSwitcher.tsx`,
    `JobBar.tsx`, `OfferBar.tsx`, `ShortcutList.tsx`, `blocks-nav.ts` and `follow.ts` (only if
    a new sticky element), `style.css`
  - the tests named in step 1
  - `e2e/fixtures.ts`, `flows.spec.ts` and `upgrade.spec.ts`, only where markup moved
  - `src/locales/en.yml`, `vi.yml`
  - `docs/design-system.md` (the panel header section)
- Create: `src/entrypoints/sidepanel/ProgressBar.tsx` and `ReadingPopover.tsx`, each with a test.

## Acceptance

- [x] The row fits on one line at 320px and 480px (e2e).
- [x] The step 1 hook list is fully ticked, and no action from today's header or job bar is lost.
- [x] The e2e text checks for "N failed" and "the rest as you read" pass unchanged.
- [x] Overlays close on Escape without closing the help, return focus, and are never covered by `.job`.
- [x] Screen readers still hear start, done and failures.
- [x] `pnpm check` and `pnpm run e2e` are green, and the visual review is noted.

## Risks

- **More rows under the header.** The title line and the notice strip add height. The strip is
  empty in the normal reading state and the title line is one muted line, so the reading area
  still gains space compared with today's two control rows plus the status line.
