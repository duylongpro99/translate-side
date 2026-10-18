# M8 — UI/UX refresh (v1.2)

Size: M · Depends on: M6 (e2e suite, bundle budget, store screenshots), M7 (the panel features it restyles)

## 1. Goal

**Make the panel read like a page: the translation leads, the controls stay quiet, and every
script renders correctly. The options page and onboarding are built from the same parts.**

Until v1.1 every surface was made of the browser's default controls laid out as plainly as
possible. That was the right call while the engine was proving itself. People now read in the
panel for long stretches, and a crowded header, small text and uneven spacing get in the way.
The brainstorm (`plans/reports/brainstorm-261018-0900-ui-ux-refresh.md`) chose direction A,
"Paper", from two mockups (`plans/reports/mockup-261018-0828-panel-directions.html`).

## 2. Done looks like

- **One control row in the panel.** It holds the language pair, a translation button (style,
  quality, model and the page cost) and four icons: reading settings (`Aa`), scroll follow,
  retranslate or stop, and a "more" menu. A muted title line and a 2px progress bar sit under
  the row. The job bar only appears when it has something to say: an error, an action such as
  retry or translate the rest, a skip or a limit. Every action it has today stays available.
- **The translation reads like a book page.** The reader picks serif or sans, a size, a line
  width and a theme (system, light, paper or dark). A change applies at once and never
  translates the page again.
- **Even rhythm.** Paragraphs, list items and headings sit on one spacing scale. Per-block
  actions float over the block on hover or focus and take no space when hidden.
- **Blocks that are not ready stay readable.** A pending block shows its source text, muted.
  A streaming block ends in a static caret.
- **Correct fonts for every script.** Text uses system font stacks chosen per script through
  `:lang()`. Japanese and Chinese Han characters take their own forms. Arabic and Hebrew
  translations run right to left.
- **Options and onboarding share the panel's look.** Options has a section index and grouped,
  scannable fields. Onboarding follows the same theme.
- **No AI look.** The anti-pattern list in `docs/design-system.md` holds everywhere.

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | Design tokens, the component list and the anti-pattern list are written | `docs/design-system.md` exists and every CSS color comes from a token |
| 2 | Before and after screenshots of the panel, options and onboarding | light, dark and paper, at panel widths of 320px and 480px |
| 3 | Glyph check for vi, ja, zh-CN, zh-TW, zh, ko, th, ar and he with real script samples | Each block carries the right `lang` and `dir`, the per-script font rule is reached, and a drawn-glyph check passes or records a skip |
| 4 | Vertical rhythm on the store fixture | No block gap is larger than the spacing scale allows, measured in e2e |
| 5 | Reading settings | Persist across sessions, apply without a new translation job, survive export and import |
| 6 | Header at a 320px panel width | One row, nothing clipped, every control reachable by keyboard |
| 7 | Accessibility | The existing a11y tests pass; new menus and popovers support Escape, focus return and arrow keys; text contrast is at least 4.5:1 in every theme |
| 8 | Release gate | `pnpm check` and `pnpm run e2e` are green, and the bundle budget is re-measured with a note |

## 4. Out of scope

- Engine, provider, job, cache or pricing changes.
- New features beyond the reading settings.
- Bundled web fonts. Fonts are system fonts only.
- A third-party UI library or Tailwind.
- The Firefox build and the other M9 tracks.

## 5. Decisions

| Decision | Recommended default (accepted unless validation says otherwise) |
|---|---|
| Visual direction | A, "Paper" (brainstorm) |
| Component approach | Hand-built Preact components and CSS tokens in `src/ui/`, with no new runtime dependency |
| Single-choice lists (language, style, quality, model) | Native `<select>` restyled with `appearance: none`. This keeps native keyboard and screen-reader behavior and needs no custom listbox. |
| Custom overlays | Only two: a popover (reading settings, translation settings) and a menu ("more"), both with Escape, focus return and outside-click close |
| Where reading settings live | Their own `storage.sync` item `reading`, never a field of `prefs`. The translator's settings key includes `prefs` (`translator.ts:156`), so a field there would translate the page again. The quality item set the same precedent (`src/shared/quality.ts:1-4`). |
| Theme scope | The theme applies to the panel, options and onboarding. Typeface, size and line width apply to the panel only. |
| Reading settings sync | Synced with the account and included in export, with an import preview line (validation) |
| Close button | Inside the "more" menu, because Chrome draws its own close (validation) |
| Page cost | In the Translation popover only. Notices appear only for errors, actions or limits (validation) |
| Free settings vs paid ones | `Segmented` (native radios) only for free settings. Style and quality stay `<select>`, because each change starts a paid job. |
| Version | 1.2.0 |

## 6. Work plan

- **M8-E1 Foundations.** Tokens, themes, font stacks, icons, components, the reading-settings
  store, `docs/design-system.md` and baseline screenshots.
- **M8-E2 Panel chrome.** The control row, the popovers, the "more" menu, the progress bar and a
  quieter job bar.
- **M8-E3 Reading view.** Typography, rhythm, block states, per-block actions, `lang` and
  `dir`, and the secondary panel views.
- **M8-E4 Options.** The section index, grouped fields and the components.
- **M8-E5 Onboarding.** The same components and theme.
- **M8-E6 Verification and release.** The glyph and rhythm checks, the screenshots, the docs,
  the bundle budget and the 1.2.0 release candidate.

The execution plan is `plans/261018-0900-m8-ui-ux-refresh/plan.md`.

## 7. Demo script

1. Open the store fixture at a 320px panel width and show the header on one row.
2. Translate it and watch the progress bar, the pending source text and the caret.
3. Open `Aa`, switch to serif at 18px with the paper theme, and show that no new job starts.
4. Hover a paragraph to show the floating actions and the linked source block.
5. Translate into Japanese, then Chinese, and compare 直 and 骨. Translate into Arabic and show
   right-to-left text.
6. Open options, jump through the section index, and switch the theme to dark.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Tests couple to classes and DOM shape | Keep every `data-testid`, `data-*` hook, id and the `.seg` and `.state` classes. Change a test only where markup really moved, and record why in the commit. |
| Popover and menu accessibility bugs | Native selects wherever a list will do. The two custom overlays get their own keyboard tests. |
| System serif fonts lack Vietnamese marks on some platforms | The glyph check runs on macOS and Windows. Each stack ends in a font known to cover Vietnamese, and `sans` stays the default if a gap shows. |
| The bundle grows | Re-measure in E6 and hand-edit only the changed budget lines, with a note. |
| A redesign drifts into an "AI look" | Anti-pattern review in every phase's acceptance checklist. |

## 9. Handoff to M9

- Every M9 track that adds UI (passphrase lock, PDF reader, Deep mode, the Pro lock note) uses
  the `src/ui/` components and tokens instead of new ad hoc CSS.
