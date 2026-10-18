---
title: "M8 UI/UX refresh planned, Beyond v1 becomes M9"
date: 2026-10-18
summary: "Direction A Paper chosen from a local mockup; 6-phase plan red-teamed (15 findings, all accepted) and validated"
---

# M8 UI/UX refresh planned, Beyond v1 becomes M9

## What happened

The next milestone is now a UI/UX refresh. The brainstorm compared two side panel directions in a local HTML mockup (`plans/reports/mockup-261018-0828-panel-directions.html`), and the user picked direction A, "Paper". It has one thin control row, book-like reading text, and chrome that lives in menus and popovers. The old M8 "Beyond v1" was renumbered to M9 in the ROADMAP, the README, `docs/plans/` and the two pending plans (beyond-v1 and licensing). M9 is now blocked by M8.

## Decisions

- The UI is built from hand-made Preact components and CSS tokens in `src/ui/`. No UI library and no Tailwind.
- Fonts are system fonts only. Per-script stacks are applied by `:lang()` rules on the elements that carry the language, not through an inherited CSS variable.
- Reading settings get their own `storage.sync` item `reading`. They sync and go through the import preview. They are never part of `prefs`, because `translator.ts:156` keys retranslation on `prefs`.
- Style and quality stay native selects, because every change starts a paid job. Native-radio segmented controls are used only for free settings.
- The Close button moves into the More menu. The page cost moves into the Translation popover.

## Red team

Four reviewers raised 39 findings, which merged into 15. All 15 were accepted. The critical one: "JobBar renders nothing" would have dropped `translate-rest`, `retry-failed` and the skipped state's "Translate anyway", and broken `jobSettled` and three e2e text checks. Other notable findings:
- forced themes needed a `color-scheme` per theme and the `Canvas` system color removed;
- `:lang()` overrides cannot reach text through a variable resolved on the parent;
- the rhythm threshold contradicted the `em` heading margins;
- reading changes would scroll the source page through two-way follow;
- privacy text must never be folded;
- the glyph check needed codes users can actually pick (`zh-CN`, `zh-TW`, bare `zh`) and real script samples.

## Next steps

Run `/ak:cook plans/261018-0900-m8-ui-ux-refresh/plan.md` on branch `m8`. Phase 1 starts with the baseline bundle and chunk map, the "before" screenshots, and the Vietnamese coverage check for the serif fonts.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
