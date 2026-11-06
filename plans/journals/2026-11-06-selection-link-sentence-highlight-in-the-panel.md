---
title: "Selection link: sentence highlight in the panel"
date: 2026-11-06
summary: "Selecting page text highlights the matching translated sentences in the side panel, locally via Intl.Segmenter; uncommitted on feat/selection-sentence-link"
---

# Selection link: sentence highlight in the panel

## What happened
Built the selection link (DESIGN.md §3): when the reader selects text on the page with the panel open, the panel highlights the matching sentences of the translation. Scope was cut from phrase level to sentence level by the owner: no LLM, no network.

- Page side: `selectedBlocks` / `watchSelectionLink` in `src/extract/link.ts` report `{id, first, last, count, from, to}` for each block the selection touches, through a new `selection` event in `src/shared/protocol.ts`.
- Panel side: `src/entrypoints/sidepanel/selection-link.ts` holds the store and the `useSelectionLink` hook. It paints a CSS Custom Highlight over `.seg__text`.
- Sentence pairing: `src/shared/sentences.ts` pairs sentences by index when both sides have the same count, and by share of the text otherwise.

## Review findings fixed
- **Page-scroll echo:** `revealBlock` only marked the follow guard, so the scroll follow sent the panel's new anchor to the page about 270 ms later. Fixed by telling the follow where the panel ended up, the same way `holdAnchor` does. Also added a test that fails without the fix.
- **Wrong sentence breaks:** line breaks in the HTML source counted as sentence ends. Every whitespace character is now flattened to a space, which keeps the length and therefore the offsets.
- **Stale reveal:** a block that got its translation later could still scroll the panel. Now only the first paint after a selection change can scroll.
- **Nested blocks:** an outer block's offsets included the text of blocks nested inside it. They now come from the block's own text only, with a space where a nested block was cut out.
- **Cleared selection not reported:** a selection cleared across a re-read was never reported. Fixed by de-duplicating per connection in `content.ts`.

## Decision
- Added the event without bumping `PROTOCOL_VERSION`: the panel and the content script ship together, and the panel ignores event names it does not know.
- Raised the `chunks/SelectionView.js` bundle budget to 18479 B measured, plus 10%, following the repo's re-measure convention.

## Next steps
- The owner tests it in real Chrome, then decides about the commit and the PR. Nothing is committed yet.
- Two selection-button e2e tests already fail on master (`flows.spec.ts:673`, `selection-everywhere.spec.ts:25`). They still expect the click to translate in the panel, but since the popup change (#7) it translates in a popup.
- Known limits, not fixed:
  - Pairing by share can be off by one sentence.
  - Pressing Ctrl+A on a very long page recomputes every frame while the panel mutates.
  - Selecting in the panel does not highlight the original on the page.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
