---
title: "Phase 3: Selection button while the panel is open"
status: done
---

# Phase 3: Selection button while the panel is open

## Overview

Priority P1, depends on phase 1. This is tier A: while a panel is connected to the tab, selecting page text
shows the extension's button. Clicking it translates the selection in the panel through the same handover as
the context menu. It needs no new permission: the content script is already there under activeTab or an
allowlisted site's grant.

## Key insights

- `handOverSelection(api, tab, info)` (`src/shared/panel.ts:121`) already checks the built-in denylist and the
  never-translate list, then writes the snippet record. The open panel reacts to `storage.session` changes
  (`App.tsx:102`). Reuse it; don't add a second path.
- Content scripts cannot write `storage.session` by default, so the content script sends a runtime message and
  the worker runs `handOverSelection` with `sender.tab`, `sender.url` and `sender.frameId`.
- The content script lives on after the panel closes. Tier A ties the button to the panel port's lifetime
  (`port.onDisconnect` in `content.ts`), so a closed panel never leaves a button that can't open it. Tier B
  (phase 4) widens that.
- The same module must run standalone in phase 4, so it cannot depend on the port.

## Requirements

- Show the button after a mouse or keyboard selection settles (`selectionchange` debounced about 200 ms, plus
  `mouseup` and `keyup`). The selection must be non-collapsed, contain at least one letter, and sit in the top frame.
- Never show it when the selection's anchor or focus is inside `input`, `textarea`, `[contenteditable]`,
  `[role="textbox"]` or a password field, or when the document is editable (`designMode`). These are the
  same exclusions as the extractor (decision D24): export and reuse `isEditable` from
  `src/extract/compose.ts:99` and `isEditableDocument` from `src/extract/index.ts:192`. Don't copy them.
- Position it at the end of the selection's last client rect, flipped to stay inside the viewport. It is 28px,
  uses the brand icon from `public/`, and has `aria-label` "Translate selection" and a tooltip.
- Render it inside a closed Shadow DOM on a fixed-position host with `all: initial` and the highest sane
  z-index, so page CSS can't restyle it and its CSS can't leak out.
- Hide it on: click elsewhere, Esc, scroll or resize, the selection collapsing, and the port disconnecting.
- On a trusted click (`event.isTrusted`), send `{ type: 'translate-selection', text }`. Use `mousedown`
  `preventDefault` so the click doesn't clear the selection first. Then hide the button.
- Worker: register an `onMessage` listener synchronously at the top level. Accept the message only from this
  extension's content script with a `sender.tab`. Build `info` from the message and the sender, then call
  `handOverSelection`. If phase 1 Q1 passed, call `sidePanel.open` first with no await before it, as the
  context-menu handler does. In tier A the panel is already open, so this is a no-op.
- Text cap: `MAX_SELECTION_CHARS` in `src/shared/snippet.ts` already applies in the panel. Truncate in the
  content script too, so a huge selection isn't messaged in full.

## Architecture

- New `src/extract/selection-button.ts`: `watchSelection(win, onClick): { stop() }`. It holds the DOM listeners,
  the eligibility check and the shadow-root button. It is pure DOM and unit-testable under happy-dom/jsdom, like
  `src/extract/link.ts`.
- `src/entrypoints/content.ts`: start `watchSelection` when the panel port connects, and stop it on
  disconnect, next to `watchHover`. A page-level guard (`globalThis.__translateSideSelection`) stops a second
  copy, for example the standalone script of phase 4, from drawing a second button.
- `src/shared/protocol.ts` or `src/shared/panel.ts`: the message type and a `listenForSelectionButton(api)`
  that the worker registers in `background.ts`.
- Locales: `panel.selectionButton.label` and `panel.selectionButton.tip` in `src/locales/en.yml` and `vi.yml`.

## Related code files

- Create `src/extract/selection-button.ts` and `src/extract/selection-button.test.ts`.
- Modify `src/entrypoints/content.ts`, `src/entrypoints/background.ts`, `src/shared/panel.ts` (+ `panel.test.ts`),
  `src/locales/en.yml` and `src/locales/vi.yml`.
- Modify `e2e/flows.spec.ts`, or the spec that covers the context-menu selection, and add the button flow.

## Implementation steps

1. Write `selection-button.ts` with its unit tests: eligibility (editable regions, password, collapsed, empty
   or punctuation-only), placement and flipping, hide triggers, and the trusted-click-only rule.
2. Add the worker listener and message validation, with unit tests next to the existing `handOverSelection` tests.
3. Wire `content.ts` to the port lifetime, with the double-copy guard.
4. Add locale strings.
5. E2E: open the panel on a fixture page, select a paragraph, click the button, and expect the panel's
   selection view to show the translation. Selecting inside a textarea shows no button.

## Todo

- [x] `selection-button.ts` + unit tests (editable checks moved to `src/extract/editable.ts`, shared with the extractor)
- [x] Worker message listener + tests (message type in `protocol.ts`)
- [x] `content.ts` wiring with the port lifetime and a ref-counted guard
- [x] Locale strings (en, vi)
- [x] E2E button flow and textarea negative case (`e2e/flows.spec.ts`)

## Success criteria

Plan acceptance criteria 3 and 5 pass with the panel open. The context-menu flow and its tests are unchanged.

## Security considerations

- The page can't reach the isolated world, but it can dispatch synthetic events, so only `isTrusted` clicks act.
- The worker trusts the text as user-selected page content, the same trust level as `info.selectionText`. It
  still applies the denylist and never-translate checks, based on `sender.url` and not on a URL in the message.
- The button host carries no page data, and the closed shadow root keeps page scripts from reading its state.
