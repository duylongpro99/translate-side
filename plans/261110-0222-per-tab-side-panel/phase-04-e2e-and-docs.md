---
phase: 4
title: "E2E and docs"
status: done
priority: P2
effort: "4h"
dependencies: [2, 3]
---

# Phase 4: E2E and docs

## Goal

The e2e harness drives a bound panel, an e2e test covers the per-tab behaviour, and the docs match the new design.

## Files to Create / Modify

- Modify: `e2e/fixtures.ts` (`panel(page?)` opens `sidepanel.html?tab=<id>`; update the header comment)
- Modify: e2e specs that call `panel()` before `open()` (order them so the page's tab id is known)
- Create: `e2e/per-tab-panel.spec.ts`
- Modify: `docs/decisions/S1-engine-host.md` (the M0-E2 consequence), `DESIGN.md` §4 (panel per tab), `README.md:75`
  ("Allow a site and each page you open there is translated while the panel is open" becomes: pages of an allowed site
  are translated in a tab whose panel is open)
<!-- Updated: Validation Session 1 - README line named; auto-read change accepted -->
- Note: about 35 `panel()` calls across the e2e specs need the page passed in.
- Modify: `docs/privacy.md` only if what is read changes. It should not: the panel reads less.

## Tasks & Steps

1. In `fixtures.ts`, `panel(page)` resolves the page's tab id through the worker (`chrome.tabs.query({ url })`), then
   opens `chrome-extension://<id>/sidepanel.html?tab=<tabId>`. Remove the "never bring it to the front" note: a bound
   panel does not rebind to itself.
2. Update the existing specs' `panel()` calls to pass the page. Run the full suite and fix any order assumptions.
3. In `per-tab-panel.spec.ts`:
   - The panel bound to A translates A. Activating a second page B leaves the panel showing A, and A's job still
     completes while B is active.
   - The toggle's close request for B does not close A's panel. The request for A does.
4. The real side-panel visibility (no panel on B, A's panel back on return) cannot be driven by Playwright. It is
   covered by S12 and by a manual check, which is listed for the owner.
5. Docs: in S1, replace the "do not give the panel a per-tab path" consequence with a pointer to S12. In DESIGN §4,
   say the panel is per tab and bound by `?tab=`. Record the M5-E3 auto-read change under the behaviour notes.

## Verification

- `pnpm test`, `pnpm typecheck`, eslint on `src`, the build, `check:bundle`, `check:manifest`
- The e2e suite, including `e2e/per-tab-panel.spec.ts`
- Manual check for the owner, in Chrome stable: open on A, switch to B (no panel), return to A (panel open, page
  translated); Alt+T on A closes only A's panel.
