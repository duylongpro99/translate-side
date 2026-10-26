---
title: "Phase 1: Spike: page-click gesture and broad-permission revoke"
status: done
---

# Phase 1: Spike: page-click gesture and broad-permission revoke

## Overview

Priority P1, blocks phases 3 and 4. Two Chrome behaviors decide the design, and decision S5 never measured
them. Answer both on real Chrome stable (min 138), the same way `spikes/s5` did.

## Questions

- **Q1. Gesture.** A content script handles a trusted `click` on its button and calls
  `runtime.sendMessage`. Can the worker's `onMessage` handler then call `sidePanel.open({ tabId })` while the
  panel is closed? Measure this on a plain page after the extension was granted the page by a host permission
  and not by activeTab. Also measure it on a tab where activeTab was granted earlier.
- **Q2. Revoke.** The extension holds `https://*/*` and `http://*/*`, and it was also granted a provider origin
  (`https://api.example.com/*`) and an allowlisted site separately. Does
  `permissions.remove({ origins: ['https://*/*', 'http://*/*'] })` also remove those narrower grants? Check
  `permissions.getAll()` afterwards.
- **Q3. S5 side effects.** With the broad grant held, is `tab.url` visible after every navigation? The S5 logic
  in `src/shared/inject.ts` treats a hidden URL as "grant lost", and `listenForTabLifecycle` re-injects
  `content.js` on `complete`. Record whether the broad grant makes the extension re-inject on every
  navigation of a tab it once injected into.

## Implementation steps

1. Copy the `spikes/s5` harness (`drive.mjs`, `server.mjs`, `ext/`) to `spikes/s9` and cut it down to: a
   content script with one button, a worker that logs `sidePanel.open` results, and an options button that
   requests or removes the broad pattern.
2. Run Q1–Q3 and save the logs under `spikes/s9/results/`.
3. Write `docs/decisions/S9-selection-button-gesture.md` in the S5 format: the question, the setup, a results
   table, and the decision.

## Decisions the results drive

- Q1 passes: the button opens the panel. Q1 fails: phase 3 and 4 keep the handover, and the button turns into a
  short "Press Alt+T to open the panel" tip. The tip names the user's real shortcut via
  `src/shared/toggle-shortcut.ts`.
- Q2 removes narrower grants: turning tier B off unregisters the script but does not revoke. The option's hint
  then links to `chrome://extensions` for revoking. Q2 keeps them: revoke on turn-off.
- Q3 shows re-injection on every navigation: phase 4 must make the navigation path ignore the broad grant. It
  should re-inject only where the access record says the panel is in use, so S5 behavior stays the same.

## Todo

- [x] Spike harness in `spikes/s9`
- [x] Q1 and Q3 measured on Chrome stable 155, logs saved; Q2 not measurable by script (no prompt auto-accept; `developerPrivate` grants nothing optional), manual `perm.html` mode left for the owner, safe no-revoke branch taken
- [x] `docs/decisions/S9-selection-button-gesture.md` written

## Success criteria

Each question has a measured yes or no with its Chrome version and log, and the decision record names the
branch that phases 3 and 4 take.

## Risks

- Chrome behavior can differ between stable and Canary. Record both versions if they disagree, and design for
  the stable result.
