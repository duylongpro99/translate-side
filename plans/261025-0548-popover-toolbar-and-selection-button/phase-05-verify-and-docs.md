---
title: "Phase 5: Verification and docs"
status: in-progress
---

# Phase 5: Verification and docs

## Overview

Priority P1, depends on phases 2–4. Run the full gates, check the features by hand on real Chrome, and
update the docs whose claims changed.

## Requirements

- Gates: `pnpm test`, lint, typecheck, `pnpm build`, and the e2e specs touched in phases 2–4. Use the scripts in
  `package.json`; don't invent commands.
- Manual check on Chrome stable:
  - Hover through a long article in the panel at 320px and at full width, in LTR and RTL.
  - Use the selection button with the panel open and closed (tier B), on a never-translate site, and inside a
    textarea.
  - Turn tier B on and off, then confirm in `chrome://extensions` that the permissions match S9's decision.
- Docs, updating only the owning surfaces:
  - `DESIGN.md` §3 (UX: the popover toolbar and the selection button) and §8 (the opt-in permission and what it reads).
  - `docs/privacy.md` (the opt-in broad permission, read only on click).
  - `docs/decisions/S9-selection-button-gesture.md` (from phase 1, final decision filled in).
  - Store listing permission notes under `docs/store/`, if they list host permission use.
  - `README.md` feature list if it lists the context menu. The working tree already has a user edit to
    `README.md`, so merge with it and don't overwrite it.

## Todo

- [x] All gates pass, except the panel perf spec (fails the same on master on this machine) and one long-page test that is flaky under full-suite load (passes alone 4/4)
- [ ] Manual Chrome check done and noted in the PR
- [x] DESIGN §3 and §8, privacy, S9, store notes, README updated where affected
- [x] PR opened from `feat/popover-toolbar-selection-button` (#4); the toolbar shipped as #3 from `fix/popover-block-toolbar`

## Success criteria

Every plan acceptance criterion has evidence: a test name, an e2e spec, or the manual check note in the PR.
