# Brainstorm: UI/UX refresh (new M8)

Date: 2026-10-18. Status: accepted. Mockups: [mockup-261018-0828-panel-directions.html](mockup-261018-0828-panel-directions.html).

## Decisions

- **Direction A "Paper" was chosen.** The side panel has one thin control row. The language pair and the style are text buttons that open menus, not native `<select>`s. The icons are reading settings (`Aa`), scroll follow, retranslate or stop, and a "more" menu that holds the model, timing and secondary actions. Progress is a 2px bar under the row instead of a status line. The translated text reads like a book page.
- **The technical approach is a hand-built design system.** It uses CSS tokens plus a small set of Preact components (Button, Menu/Select, Toggle, Segmented, Field, Icon, Popover, Notice) and inline stroke SVG icons. There are no new runtime UI dependencies.
- **Fonts are system fonts only.** Stacks are chosen per script through `:lang()`, and the reader picks serif or sans. No font is bundled.
- **This becomes the new M8.** The current M8 "Beyond v1" tracks move to M9.

## Contract

**Outcome.** The side panel, the options page and onboarding share one design system. The side panel puts the translation first: clear type, an even vertical rhythm, and quiet chrome. Frequent actions (language, style, retranslate) are one click away and rare ones sit in a menu. The options page is reorganized so it can be scanned and configured easily.

**Constraints**
- Stay on Preact and pass `check:bundle`.
- Keep behavior, accessibility and the meaning of existing tests. Update selectors only where the DOM changes.
- Keep the en/vi UI and light and dark themes, and add a "paper" theme.
- Vietnamese diacritics, CJK (with the correct ja/zh glyphs through `lang`), Thai and Arabic (RTL) must render correctly.

**Non-goals**
- No changes to the engine, the providers, the job logic or pricing.
- No new features beyond the reading controls (font size, serif or sans, line width, theme).
- No Firefox build and no other M9 tracks.

**Acceptance criteria**
- `docs/` holds the design tokens and an anti-pattern list.
- Before and after screenshots exist for every surface, in light, dark and paper, at panel widths of 320px and 480px.
- A glyph check passes for vi, ja, zh-Hans, ko, th and ar.
- Block spacing on the store fixture page is even, with no oversized gaps between list items.
- Reading settings persist and apply without retranslating.
- `pnpm check` and `pnpm e2e` are green.

## Anti-patterns (banned)

- Purple or indigo gradients, gradient text and glassmorphism.
- Emoji or ✨ as icons and "AI-powered" wording.
- Large rounded cards with shadows everywhere, pill and badge clutter, and left-border accent cards.
- Shimmer skeletons and decorative motion.
- More than one accent color.

## Trade-offs

- **A, the hand-built system (chosen).** It relies on keeping the tokens disciplined. It is most likely to fail on menu and popover accessibility, meaning focus trap, Escape and arrow keys.
- **B, a headless library through preact/compat.** It relies on compat working. It fails first on bundle budget and on its shadcn-like defaults.
- **C, Tailwind.** It relies on overriding the defaults. It means rewriting all existing CSS.

Better approaches: none. The requested direction fits, because the code already has CSS variables and plain Preact.

## Evidence

- `src/entrypoints/sidepanel/style.css`: tokens exist but are minimal and use `system-ui` only.
- `docs/store/assets/01..05`: the header is crowded, the controls are native, the translated text is small and the list gaps are uneven.
- `SegmentList.tsx:65` already sets `lang={target}` on translated text.

## Open risks

- Whether the system serif stacks fully cover Vietnamese (Georgia, Charter, Iowan) must be checked on macOS and Windows.
- The cause of the large list-item gaps is unproven. It may be the hidden per-block actions row taking space.
