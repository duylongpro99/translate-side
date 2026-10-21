---
phase: 1
title: "Spike S8: built-in AI on real Chrome"
status: in-progress
priority: P1
effort: 1d
dependencies: []
---

# Phase 1: Spike S8 — built-in AI on real Chrome

## Goal

Answer, with measurements from real Chrome stable, the questions that decide phases 2 and 3. Record the
answers in `docs/decisions/S8-chrome-builtin.md`.

## Context

- Research: `research/researcher-01-chrome-builtin-ai.md`. Several facts come from Chromium source and are not
  documented: service-worker exposure, the activation exemption in extension workers, and the sticky-activation relaxation.
- S8 was planned in `ROADMAP.md:64` and never run (`docs/progress/progress-m4.md:298`).
- Existing spike layout: `spikes/s1` to `spikes/s5`, each with an `ext/` folder loaded unpacked. Decisions: `docs/decisions/S1-…S5-…`.

## Questions to answer

1. **Pair persistence.** Does a pair created once in the side panel stay `available` for later panel sessions, and
   after a browser restart? This decides how often users see the turn-on click. (The service-worker zero-click path is
   out of scope: it is undocumented, conflicts with decision S1, and gets around Chrome's download consent. Record
   whether it works, for information only.)
   <!-- Red team 2026-10-20: finding 10, the background proxy was dropped. -->
2. **Side-panel activation.** In the side panel, does `Translator.create()` fail without a click, and succeed when
   called synchronously in a click handler? Does `LanguageModel.create()` succeed after any earlier click (sticky)?
3. **Nano output format.** Run the existing single-pass prompt (`src/engine/prompts`, segment markers parsed by
   `src/engine/parsing`) on Nano with target `en` and `es`, on 3 fixture pages (`fixtures/sites`). Measure the
   parse-failure rate. Then repeat with `responseConstraint` set to a JSON array schema of N strings. Pick the format with fewer failures.
4. **Nano limits.** Read `contextWindow` (or `inputQuota` on older builds) at runtime. Measure tokens per second and
   time to first token for a 1,200-token chunk, and find the largest chunk that avoids `QuotaExceededError` with the system prompt.
5. **Timings.** First download time for one Translator pair, for a pivoted pair (`ja→vi`), and for Nano if the device starts from `downloadable`.
6. **Unavailable reasons.** Can the extension tell apart "unsupported hardware", "policy or user setting off", and
   "unsupported language"? Research says all of them surface as `unavailable`. Confirm, and note any console signal.
7. **e2e fake injection.** In the repo's Playwright setup (`e2e/fixtures.ts`), does `context.addInitScript` run on
   `chrome-extension://…/sidepanel.html` before the bundle, so a fake `Translator`/`LanguageModel` can replace Chrome
   for Testing's real `Translator`? Phase 5 depends on this.
   <!-- Red team 2026-10-20: finding 15. -->

## Files to Create / Modify

- Create: `spikes/s8/ext/manifest.json`, `spikes/s8/ext/sidepanel.html`, `spikes/s8/ext/sidepanel.js`, `spikes/s8/ext/background.js`, `spikes/s8/README.md` (how to run).
- Create: `docs/decisions/S8-chrome-builtin.md` (answers with numbers, Chrome version, OS, hardware).

## Tasks & Steps

1. Build a minimal unpacked extension with a side panel. Add buttons: "availability (all)", "create Translator (in click)",
   "create Translator (deferred 10 s)", "create Nano", and "ask background to create Translator" (for information only).
2. Log availability states and `downloadprogress` events with timestamps to the panel.
3. Add a Nano prompt harness. It loads the real system prompt and three fixture blocks, then calls `promptStreaming`
   with and without `responseConstraint`, and counts parse failures with the project's parser (copied in or imported via a build step).
4. Run on Chrome stable on macOS (the owner's machine). Repeat question 1 on a second profile, so that nothing is pre-created.
5. Answer question 7 with a throwaway Playwright test against the built extension.
6. Write the decision record. It must name a decision for each of: how long a created pair persists,
   the Nano output format (markers or JSON), the Nano chunk size, the reason codes the UI can show, and the e2e injection mechanism.

## Verification

- `docs/decisions/S8-chrome-builtin.md` exists and answers all seven questions with numbers and the Chrome version.
- The owner confirms the measurements came from Chrome stable, not Chrome for Testing.

## Risks

- **The machine can't run Nano.** Record that fact, then run questions 3 and 4 on another machine, or accept that
  Nano stays behind the Translator default and is tested only with fakes.
- **`addInitScript` may not reach extension pages.** Fall back to a preview-only build flag whose output goes to the
  e2e outDir only, with the bundle check from phase 5 guarding release builds.

## Todo

- [x] Spike extension in `spikes/s8/ext/`
- [ ] Questions 1–7 measured on Chrome stable (Q7 done with Chrome for Testing; Q1–Q6 wait for the owner)
- [x] `docs/decisions/S8-chrome-builtin.md` written with the five decisions (provisional until Q1–Q6 are measured)
