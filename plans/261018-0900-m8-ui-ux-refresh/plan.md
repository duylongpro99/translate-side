---
title: "M8 — UI/UX refresh"
description: "One hand-built design system for the side panel, options and onboarding: a reading-first 'Paper' panel, reading settings, script-correct system fonts, and no AI look."
status: in-progress
priority: P2
effort: 14d
branch: m8
tags: [frontend, ui, ux, a11y, i18n]
blockedBy: []
blocks: [261013-0345-m9-beyond-v1]
created: 2026-10-18
---

# M8 — UI/UX refresh

## Overview

The source spec is `docs/plans/M8-ui-ux-refresh.md`. The contract is in
`plans/reports/brainstorm-261018-0900-ui-ux-refresh.md`, and the chosen design is direction A in
`plans/reports/mockup-261018-0828-panel-directions.html`. This directory is the execution plan.

Surface facts come from a scout pass on 2026-10-18, re-checked against the working tree:

- **The header is crowded.** It has three native `<select>`s for target, style and quality
  (`HeaderControls.tsx:80, 89, 98`), a model `<select>` (`ModelSwitcher.tsx:58`), and
  text-glyph icons ⇅ ? ⚙ ✕ (`App.tsx:331-341`).
- **Two stylesheets each define their own tokens.** `sidepanel/style.css:1-25` and
  `options/style.css:1-18` do not share a file. Onboarding has no tokens and no dark theme
  (`onboarding/style.css`, 21 lines, loaded after the options CSS by `onboarding/main.tsx:5-6`).
- **The likely cause of the large block gaps** is that every translated block keeps an
  `opacity: 0` actions row (`style.css:470-476`, `SegmentList.tsx:131-137`) on top of the 10px
  `.seg` margin. This is inferred from the CSS and must be measured first.
- **No `dir` is set anywhere and no CSS uses `:lang()`.** Translated text carries
  `lang={target}` (`SegmentList.tsx:65, 223, 281`), and source text carries `lang={source}`
  (`:212`).
- **Unit tests query with `querySelector`** (about 290 calls), using `data-testid` and some
  classes. The e2e suite depends on `.seg[data-*]`, `.state`, `[data-testid=job]` and a few
  ids (`e2e/flows.spec.ts`).
- **The translator's settings key is `JSON.stringify([prefs, glossary, quality])`**
  (`translator.ts:156`). Any new field in `prefs` would translate the page again, so reading
  settings get their own sync item, the same way quality does (`src/shared/quality.ts:1-4`).
  The storage listeners check specific keys (`translator.ts:620-622`, `prefs.ts:108-111`), so a
  new `reading` key triggers nothing.
- **Export and import.** Export is `src/shared/portable.ts:163, 196`. Import is a
  preview-before-apply flow: the gate and note at `:420-421`, `ImportPlan` at `:233`,
  `resolveImport` at `:567`, the report at `:461, 628`, and the preview line in `Transfer.tsx:43`.
- **The bundle budget** is `scripts/bundle-budget.json`. `onboarding.css` has about 59 B of gzip
  headroom, measured on a possibly stale build.

Delivery follows the earlier milestones. A supervisor uses `docs/prompts/implement-plan.md` with
`{{PLAN_FILE}}` set to this file, `{{SPEC_FILE}}` set to `docs/plans/M8-ui-ux-refresh.md` and
`{{LOG_FILE}}` set to `docs/progress/progress-m8.md`. Work happens on branch `m8` in a worktree.
The first phase adds `m8` to the CI push branches (`.github/workflows/ci.yml`).

## Phases

| # | Phase | Depends on | Effort | Model | Status |
|---|---|---|---|---|---|
| 1 | [Foundations: tokens, themes, fonts, components, reading store](./phase-01-foundations.md) | — | 4d | Opus (shared contracts, a11y) | Done |
| 2 | [Panel chrome: control row, popovers, menu, progress](./phase-02-panel-chrome.md) | 1 | 2.5d | Opus (a11y, many tests) | Done |
| 3 | [Reading view: typography, rhythm, block states, scripts](./phase-03-reading-view.md) | 1, 2 | 2.5d | Sonnet | Done |
| 4 | [Options page on the design system](./phase-04-options.md) | 1 | 2.5d | Sonnet | Done |
| 5 | [Onboarding on the design system](./phase-05-onboarding.md) | 1, 4 | 1d | Sonnet | Done |
| 6 | [Verification, screenshots, docs and 1.2.0 RC](./phase-06-verify-and-release.md) | 2, 3, 4, 5 | 1.5d | Sonnet | Agent part done; owner part open |

## Order and file ownership

The phases run in order on `m8`: 1 → 2 → 3 → 4 → 5 → 6. Phases 2 and 3 both edit
`sidepanel/style.css`, `SegmentList.tsx` (phase 2 only for the job bar hook-up, phase 3 for
blocks), and `App.tsx`. Every phase edits `src/locales/en.yml` and `vi.yml`, and phases 1 and 6
edit `scripts/bundle-budget.json`. Running them in parallel would conflict.

| Shared file | Phases |
|---|---|
| `src/ui/**` (new) | 1 creates it; 2 to 5 may add a component only with a test and a line in `docs/design-system.md` |
| `src/entrypoints/sidepanel/style.css` | 1 (tokens import), 2 (header), 3 (blocks) |
| `src/entrypoints/sidepanel/App.tsx` | 1 (theme hook), 2 (header), 3 (secondary views) |
| `src/entrypoints/options/style.css`, `Options.tsx`, `Providers.tsx`, `Memory.tsx`, `Diagnostics.tsx` | 1 (tokens import), 4 |
| `src/entrypoints/options/Transfer.tsx` | 1 (the `reading` preview line), 4 |
| `src/entrypoints/sidepanel/follow.ts`, `blocks-nav.ts` | 2 (sticky offsets, only if needed), 3 (anchor preservation) |
| `e2e/fixtures.ts` | 2 (`jobSettled`) |
| `src/entrypoints/onboarding/**` | 1 (tokens import), 5 |
| `src/shared/portable.ts` | 1 |
| `src/locales/*.yml` | every phase |
| `scripts/bundle-budget.json` | 1 if a line breaks, 6 |
| `docs/design-system.md` (new) | 1 writes it, and 2 to 5 append to it |

## Invariants (all phases)

- **Keep every test hook.** That means every `data-testid`, every `data-*` attribute the e2e
  suite reads (`data-id`, `data-status`, `data-linked`, `data-refined`, `data-kind`), every id
  used by tests (`#route-review`, `#privacy-title`, `#g-term`, `#g-rendering`, `#g-keep`), and
  the classes `.seg` and `.state`. A test changes only when markup really moved, and the commit
  says why.
- **Keep behavior.** No change to `jobs.ts`, `translator.ts` logic, the engine, the providers,
  or the stored `prefs` and `quality` shapes.
- **Colors come only from tokens.** No hex value outside `src/ui/tokens.css`.
- **No new runtime dependency**, and `pnpm run check:engine` stays green.
- **Anti-patterns are banned.** No gradients, glassmorphism, emoji or ✨ icons, large rounded
  shadowed cards, left-border accent cards, pill clutter, shimmer, decorative motion, or more
  than one accent color. Every phase's acceptance includes a visual review against this list.
- **Every new string goes into both locales.** `src/locales/locales.test.ts` checks parity.
- **`prefers-reduced-motion` is honored.** The only motion allowed is a ≤150ms opacity or
  transform on overlays. The progress bar hides without a fade.
- **No system colors** (`Canvas`, `CanvasText`) and no color literals outside `src/ui/tokens.css`.
  `scripts/check-tokens.mjs` enforces this from phase 1.
- **No action is lost.** Every button and state in today's header and job bar keeps a visible
  home (see phase 2).
- **The repo is public.** No keys, absolute home paths or usernames in commits. Commits are
  conventional, with no plan IDs or finding codes.

## Success criteria (spec §3)

- [ ] `docs/design-system.md` holds the tokens, the components and the anti-pattern list, and no hex value exists outside `src/ui/tokens.css` (phase 1, checked in 6).
- [ ] Before and after screenshots exist for the panel, options and onboarding, in light, dark and paper, at 320px and 480px (baseline in phase 1, after in phase 6).
- [ ] The e2e glyph check passes for vi, ja, zh-CN, zh-TW, bare zh, ko, th, ar and he with real script samples: `lang` and block-level `dir` are right, the per-script `font-family` cascade is reached, and the drawn-glyph check passes or records a skip (phases 3 and 6).
- [ ] The e2e rhythm check passes: no gap between neighbouring blocks exceeds the scale maximum on the store fixture (phases 3 and 6).
- [ ] Reading settings sync, apply before first paint without a new job, never move the source page under follow, and round-trip through export and import with a preview line (phases 1 and 3).
- [ ] The header fits on one row at 320px and every control is reachable by keyboard (phase 2).
- [ ] The a11y tests pass, the overlays have keyboard tests, and contrast is at least 4.5:1 in every theme (phases 1, 2 and 6).
- [ ] `pnpm check` and `pnpm run e2e` pass at the end of every phase, and the bundle budget is re-measured with a note (phase 6).

## Non-goals

- Engine, provider, job, cache, licensing or pricing changes.
- Bundled fonts, a UI library or Tailwind.
- Store upload and the git tag. The user publishes, as in M6 and M7.

## Key risks

- **The gap cause is inferred, not measured.** Phase 3 measures the gaps between text boxes
  with Playwright before changing CSS, and the fix follows the measurement.
- **Two-way follow.** A reading change reflows the text. Phase 3 restores the anchor under the
  follow guard and tests that the page does not move.
- **Popover and menu accessibility.** Native selects stay native. Only `Popover` and `Menu` are
  custom, and they ship with keyboard tests in phase 1.
- **Vietnamese coverage of the system serif fonts** [UNVERIFIED] for Charter, Iowan Old Style and
  Georgia on macOS and Windows. Phase 1 checks it on the dev machine, and phase 6 records the
  Windows result or a note when no Windows machine is available. `sans` stays the default.
- **Bundle headroom.** Onboarding inherits the tokens from the options CSS, so they ship once.
  Shared `src/ui/` code may add or rename chunks. Phases 1 and 6 hand-edit only those lines,
  with measured sizes and a note, against the phase 1 chunk map.

## Cross-plan dependencies

| Plan | Relationship |
|---|---|
| `261013-0345-m9-beyond-v1` | Renumbered from M8. Blocked by this plan so its UI tracks (lock prompt, PDF reader, Deep mode, `<ProLock>`) are built on `src/ui/`. |
| `261013-0348-pro-subscription-licensing` | Its locked-state UI (`<ProLock>`, "(Pro)" option suffix) should use `src/ui/` once this lands. No contract change. |

## Unresolved questions

None. The Close placement was settled in Validation Session 1.

## Red Team Review

### Session — 2026-10-18

**Findings:** 15 after removing duplicates from 39 (1 Critical, 8 High, 6 Medium). The user accepted all 15.
**Report:** `reports/red-team-261018-0900-m8.md`

| # | Finding | Severity | Disposition | Applied to |
|---|---|---|---|---|
| 1 | The slimmed JobBar drops actions, the live region and e2e visibility | Critical | Accept | Phase 2 (job bar, live region, `jobSettled`); plan invariants |
| 2 | Forced themes vs `color-scheme`, `Canvas`, on-accent contrast and first-paint flash | High | Accept | Phase 1 req. 1–3, 9; plan invariants |
| 3 | `:lang()` overrides cannot pass through a resolved variable | High | Accept | Phase 1 req. 1 (per-script tokens); phase 3 req. 3 |
| 4 | The popover hides notices and alerts; title claim; wrong e2e list | High | Accept | Phase 2 layout, notice strip, steps |
| 5 | Incomplete `reading` import contract; unclean listeners | High | Accept | Phase 1 req. 4–5; plan overview and ownership |
| 6 | Style as a radiogroup breaks spec §5 and arrows start paid jobs | High | Accept | Phase 1 `Segmented`; phase 2 style `Select`; phase 4 theme field |
| 7 | Privacy disclosures could be folded | High | Accept | Phase 4 req. 2 never-fold list and test |
| 8 | The rhythm threshold contradicts the `em` margins | High | Accept | Phase 3 req. 1, 5, step 2 |
| 9 | Reading changes move the page through follow | High | Accept | Phase 3 req. 4; plan key risks |
| 10 | Ordered lists, `list-style` and pending-state claims were wrong | Medium | Accept | Phase 3 req. 5–6 |
| 11 | The toolbar covers text and ignores RTL; `dir` on inline spans; `coveredBy` | Medium | Accept | Phase 3 req. 2, 7, 9; phase 2 sticky offsets |
| 12 | Overlay focus, Escape, stacking, Tab, privacy prominence | Medium | Accept | Phase 1 `Popover`/`Menu`; phase 2 focus and stacking; phase 3 req. 8; phase 5 req. 3 |
| 13 | The glyph check uses the wrong codes, Latin samples and a cascade-only assertion | Medium | Accept | Phase 3 req. 3; phase 6 req. 1 |
| 14 | Onboarding token duplication; renamed chunks | Medium | Accept | Phase 1 req. 8, step 8; phase 5 step 3; phase 6 req. 8 |
| 15 | Screenshot gating, matrix size, one token check, fade, typeahead, estimate | Medium | Accept | Phase 1 steps 2, 7, req. 9, effort 4d; phase 6 req. 4–5 |

### Whole-plan consistency sweep

- `zh-Hans` now appears only as a CSS `:lang()` alias. The tests use `zh-CN`, `zh-TW` and bare
  `zh`.
- `style-mode` is a `Select` everywhere, and `Segmented` is used only for reading settings and
  the theme field.
- `check-tokens.mjs` is created in phase 1 only. Phase 6 just runs it.
- `--reading-font` is no longer used. Phase 3 uses `data-typeface` with direct `font-family`
  rules.
- No phase moves bytes into `base.css` to meet the budget.
- Typeahead and the progress fade are gone.

## Validation Log

### Session 1 — 2026-10-18

| # | Question | Answer | Propagated to |
|---|---|---|---|
| 1 | Apply the red team findings? | Apply all 15 | All phases (see the table above) |
| 2 | Where do reading settings live? | Synced with the account (`storage.sync`), included in export | Phase 1 req. 4–5; spec §5 |
| 3 | Where does the Close button go? | Inside the "More" menu | Phase 2 layout item 7; spec §5 |
| 4 | Where is the page cost shown? | In the Translation popover only. Notices appear only for errors, actions or limits. | Phase 2 layout item 2 and job bar; spec §5 |

### Verification results

- **Claims checked by the four red team reviewers:** about 60 `file:line` citations. The main
  ones were confirmed:
  - `translator.ts:156`, the `quality.ts` precedent, the `SegmentList` lines;
  - `App.tsx:236, 331-341`, `HeaderControls.tsx:80, 89, 98`;
  - `blocks-nav.ts:44`, `portable.ts:87-88`;
  - `Onboarding.tsx:43, 112-118, 305`, `Providers.tsx:941, 1152`;
  - `store-screenshots.spec.ts:142`.
- **Failed and corrected:**
  - `portable.ts:163, 196` are export-only (the import lines were added);
  - `coveredBy` measures `.panel__header, .job`, not `--panel-header-h`;
  - the e2e `nav a[href*=…]` is on the fixture page, not options;
  - no e2e uses `style-mode`; the real one is `quality-mode`.
- **Tier:** Full (6 phases).
