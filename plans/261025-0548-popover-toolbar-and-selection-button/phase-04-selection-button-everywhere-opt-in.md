---
title: "Phase 4: Selection button on every site (opt-in)"
status: done
---

# Phase 4: Selection button on every site (opt-in)

## Overview

Priority P2, depends on phases 1 and 3. This is tier B: a settings option, "Show the translate button when I
select text on any site", off by default. Turning it on requests the optional host permissions that the
manifest already declares (`https://*/*`, `http://*/*`). It then registers a small standalone script that runs
only the selection button from phase 3. The install-time permissions don't change.

## Key insights

- `optional_host_permissions` already lists both broad patterns (`wxt.config.ts`), so no manifest change is
  needed and updating the extension shows no new warning.
- `permissions.request` must be the first await in the click handler. `requestSitePermission` in
  `src/shared/sites.ts:166` shows the pattern.
- `scripting.registerContentScripts` with `persistAcrossSessions: true` survives restarts. The worker still
  reconciles on startup and on `permissions.onRemoved`, because the user can revoke in `chrome://extensions`.
- Phase 1 decides three branches: whether the click can open a closed panel (Q1), whether turning off can revoke
  safely (Q2), and whether the S5 navigation path needs a guard (Q3).

## Requirements

- Settings: a switch in the Sites section of `src/entrypoints/options/Options.tsx`, with a hint stating what it
  grants and that nothing is read or sent until a click. Turning it on requests the permission and then
  registers. If the user refuses, the switch stays off with a short status. Turning it off unregisters, and
  revokes only if Q2 allows it.
- Storage: one boolean in `storage.sync` next to the site lists (`src/shared/sites.ts`), included in
  export/import if the site lists are (`src/shared/portable.ts`).
- Registration: id `selection-button`, a new WXT runtime-registered entrypoint, `matches` set to the broad
  patterns, `allFrames: false`, `runAt: 'document_idle'`. `excludeMatches` covers the built-in denylist hosts that
  can be written as match patterns. The script itself checks `classifyUrl` and the never-translate list on
  start, so a host the patterns miss stays clean.
- Worker reconcile (`background.ts`, top level): on startup, `onInstalled` and `permissions.onAdded/onRemoved`,
  registered must equal setting on AND permission held. Fix whichever side is off.
- Standalone script: start `watchSelection` with the click going to the phase 3 message. When the panel is
  closed, the worker either opens it (Q1 pass) or the handover happens and the button shows the "Press
  <shortcut> to open the panel" tip in its shadow root (Q1 fail).
- Pages where the full content script is also injected: the phase 3 guard means only one button shows.
- If Q3 showed re-injection on every navigation, the navigation re-injection in `listenForTabLifecycle` must
  depend on the tab's access record (the panel in use) and not on URL visibility alone.

## Related code files

- Create `src/entrypoints/selection.content.ts` (WXT `registration: 'runtime'`).
- Create `src/shared/selection-button.ts` + test: the setting, `registerSelectionScript` and `reconcileSelectionScript`.
- Modify `src/entrypoints/background.ts`, `src/entrypoints/options/Options.tsx` (+ test), `src/shared/sites.ts`,
  `src/shared/portable.ts` (if site lists export), `src/shared/panel.ts` (Q3 guard, if needed) and both locale files.
- Modify `e2e/flows.spec.ts`: turn the option on, then on a fresh tab with no panel, select text and click.

## Implementation steps

1. Add the setting and the reconcile and register helpers, with unit tests (a fake `scripting` and `permissions` API,
   like `src/shared/testing.ts`).
2. Add the standalone entrypoint, which reuses `src/extract/selection-button.ts`.
3. Add the worker reconcile listeners.
4. Add the options switch with request-first click handling and the refusal status.
5. Apply the Q1, Q2 and Q3 branches from `docs/decisions/S9-selection-button-gesture.md`.
6. Add an e2e test for the opt-in flow. Grant permissions through the Playwright context the way the existing
   allowlist test does.

## Todo

- [x] Setting + register and reconcile helpers + tests
- [x] `selection.content.ts` entrypoint (6.5 kB gzip; never-translate via `excludeMatches` kept current by the worker, not read by the script)
- [x] Worker reconcile on start, permission changes, option and never-list changes (serialized)
- [x] Options switch, hint, refusal status
- [x] Q1, Q2 and Q3 branches applied (open the panel; no revoke; navigation follows the granted origin or the allowlist)
- [x] E2E opt-in flow (`e2e/selection-everywhere.spec.ts`, fixture option `broadAccess`)

## Review outcome (2026-10-25)

- Fixed: records without an origin (a gesture on an unreadable page, an unfinished injection) let a navigation be
  read under the broad access; every record now carries its grant's origin, and one without follows only the
  allowlist. Also: the worker caps the handed-over text, a stale copy's click no longer throws, an unchanged
  registration is not rewritten.
- Accepted, documented: a page already open when its site joins the never-translate list keeps the button until it
  reloads (its click sends nothing).
- PR review (2026-10-25, owner decisions): the option moved to `storage.local`, per device like Chrome's access,
  and out of the settings export; a synced option was wrong on a device that never granted the access. The
  button's click asks for the selection only (`selection` trigger): the panel reads the page and offers it
  instead of translating it, as the context menu does. An e2e check asserts only the selection is sent.
- Report: `plans/reports/code-reviewer-261025-1416-selection-button-review.md` (in the main checkout).

## Success criteria

Plan acceptance criteria 4, 5, 6 and 7 pass (docs in phase 5). With the option off, the extension's behavior
and permissions match today's.

## Risks

- Chrome Web Store review: using a broad optional host permission for a selection button needs a justification
  in the store listing's permission notes (`docs/store/`).
- Script cost on every page: keep the standalone bundle tiny, with no Preact and no engine imports. Check its size
  in the build output and add it to `e2e/budgets.json` if bundles are budgeted there.

## Security considerations

- Turning it on is a deliberate, documented trade: the extension can then read every page, but it reads only the
  selection, only after a click. The hint and `docs/privacy.md` must say exactly that.
- Never-translate and the built-in denylist apply both at registration and at runtime.
