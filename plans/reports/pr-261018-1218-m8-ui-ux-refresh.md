## Summary

M8, the UI/UX refresh, and the 1.2.0 release candidate.

- **Design system** (`src/ui/`, `docs/design-system.md`): tokens, four themes (system, light, paper, dark) applied before the first paint, system font stacks per script, and shared components (Button, IconButton, Select, Segmented, Popover, Menu, Field, Notice, icons). `scripts/check-tokens.mjs` runs in `pnpm check` and fails on any color outside the tokens.
- **Panel header**: one control row. It holds the language pair, a Translation popover (style, quality, model and the page's cost), Aa for the reading settings, scroll follow, Retranslate or Stop, and More. A 2px progress bar replaces the progress sentence. Notices that need attention stay in view, and screen readers still hear progress.
- **Reading view**: serif or sans, a text size, a line width and a theme, synced as their own setting and carried by export and import. A change starts no job and keeps the page where it is. The text sits on one spacing scale (the hidden per-block toolbar used to cause the uneven gaps), and the toolbar never covers text. Blocks waiting for text show their original muted, and streaming text ends in a still caret. Japanese and Chinese Han characters take their own forms, and Arabic and Hebrew run right to left.
- **Settings and onboarding** use the same parts: a section index, a field grid, hairline lists, folded long explanations (privacy and data-flow text never folds), and a Theme field.
- **Release**: version 1.2.0, store screenshots regenerated, `docs/store/submission.md` updated with size, SHA-256 and what's new.

Every phase was reviewed by a subagent and its findings were fixed. Decisions and deviations from the plan are in `docs/progress/progress-m8.md`.

## Test plan

- [x] `pnpm check` is green: lint, token check, typecheck, engine boundary, unit tests with coverage, build, bundle budget, manifest.
- [x] `pnpm run e2e` has 49 passed. New e2e checks: the header fits 320px, block gaps stay on the scale, reading settings send nothing and keep the page still, per-script fonts and right-to-left blocks, J/K focus below the header, and Han glyph forms.
- [x] The 100-screen heap and long-task budgets pass. The budget was not raised.
- [ ] The Windows glyph check (`scripts/glyph-check.html`). No Windows machine was available.
- [ ] By hand in a real browser: the settings index marks the section you scroll to.

## Notes

- The main checkout's uncommitted README and ROADMAP edits (renumbering the old M8 to M9) are included here.
- The bundle budget lines M8 changed, and the total, are measured again with notes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
