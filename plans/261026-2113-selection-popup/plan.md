---
title: "Translate a selection in a popup next to it"
description: "A click on the selection button shows the translation in a small popup on the page instead of opening the side panel."
status: in-progress
priority: P1
effort: 1.5d
branch: feat/selection-popup
tags: [feature, frontend, privacy]
blockedBy: []
blocks: []
created: 2026-10-26
---

# Translate a selection in a popup next to it

## Outcome

The user's request (2026-10-26): when they click the selection button, a popup panel next to the selection shows
the translation, instead of the side panel opening.

**Acceptance criteria**
1. A trusted click on the selection button opens a popup anchored to the selection. The popup shows the
   translation as it streams. It does not open the side panel.
2. The popup uses the same route as the panel's selection mode: the same provider, profile, fallback,
   on-device route (including its turn-on click), spend limit and Fix-key/grant actions. A pending privacy notice is shown in the panel (criterion 5).
3. The worker still checks the denylist and the never-translate list against the sender's address, and a blocked
   selection is never stored or sent.
4. The popup has **Open in side panel**, which opens the panel with the selection as before, and **Close**. Esc, a
   press outside the popup, or a new selection closes it. It follows the selection when the page scrolls.
5. The page can't read or script the popup. It is an extension page in an iframe inside the button's closed shadow
   root, and it talks to the content script only over a MessageChannel port handed to it with the popup's id. A page
   can restyle or cover the host, so nothing in the popup outlasts the one selection: the privacy notice and the spend
   limit's Continue anyway stay in the side panel.
6. The context menu keeps translating in the side panel.
7. Popup records don't pile up: one per tab, dropped when the popup closes or the tab closes. On a page that can't
   frame the popup (`file:`), the click opens the side panel as before.

**Non-goals**: a setting to choose between the popup and the panel, editing in the popup, and a popup for page translation.

## Design

- `src/extract/selection-button.ts`: the click returns a popup id. A second host, `translate-side-popup`
  (closed shadow root, `all: initial`), holds an iframe of `selection-popup.html#<id>` with
  `allow="translator; language-detector; language-model"`. This lets Chrome's on-device APIs run in the frame
  (Permissions Policy delegation). After the frame loads, the content script posts it a MessageChannel port (to the
  extension's origin, with the id), and the popup sends its height and close requests on that port. The popup stays
  hidden until it answers, and closes if the frame loads a second time.
- `src/shared/panel.ts`: when a selection-button message carries `popup`, the worker writes
  `selectionPopup:<id>` (the same checks as `handOverSelection`, plus `tabId`) and does not open the panel. A new
  message, sent by the popup page, injects the content script and hands the stored selection over to the panel. The
  popup page calls `sidePanel.open` itself inside its click, so the gesture is its own.
- `src/entrypoints/selection-popup/`: an extension page (web accessible on http and https pages). It runs
  `createTranslator` and its selection jobs (`snippets.take`), and calls `watch` without the session listener.
  Rendering reuses `SelectionView` and the panel stylesheet.
- Engine host: the popup is an extension page like the panel (decision S1): fetches don't depend on the worker.

## Risks

- Translator/LanguageModel in an embedded extension frame relies on `allow` delegation (documented for the
  Translator API). A page whose own Permissions-Policy header blocks it gets the "no on-device" answer, plus
  Open in side panel.
- Without `use_dynamic_url`, a page can tell whether the extension is installed by probing
  `selection-popup.html` (open question below).

## Review (2026-10-26)

A code review found these issues, and all are fixed: no popup on `file:` pages, popup records left behind, spend writes
from two pages racing (now under a Web Lock), clickjacking of the privacy notice and Continue anyway, a page navigating
the frame through `event.source`, and Open in side panel closing when the panel failed to open. Not fixed: each popup
builds the page `Jobs` too (the cache opens lazily; only the translation memory is warmed).

## Validation

Unit tests for the worker route, the popup host (open, height, close, events from a foreign source ignored) and the
popup page; `pnpm typecheck`, eslint on src, `pnpm test`, build, check:bundle, check:manifest. A manual Chrome check
is the owner's.

## Open questions

- Should the web-accessible entry use `use_dynamic_url`? Chrome's docs don't say whether `runtime.getURL` returns
  the dynamic URL, so it is off for now.
