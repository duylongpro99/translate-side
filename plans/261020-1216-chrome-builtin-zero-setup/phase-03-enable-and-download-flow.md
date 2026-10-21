---
phase: 3
title: "Turn-on click, download progress, unavailable states"
status: done
priority: P1
effort: 2d
dependencies: [2]
---

# Phase 3: Turn-on click, download progress, unavailable states

## Goal

When the route stops with `onDeviceSetup`, the panel and the onboarding sample show one button. Its click creates the
engine synchronously, progress shows, and the job runs again. When on-device AI can't run, both surfaces say why and offer
provider setup.

<!-- Red team 2026-10-20: updated for findings 3, 4, 7, 11. -->

## Key insights

- Translator `create()` consumes transient activation for any pair this extension has not created. Call it synchronously
  in the click handler, before any `await`, privacy gate or route call (research §4).
- Nano accepts sticky activation, but phase 2 forbids `create()` on job paths unless the model is `available`. So the
  turn-on click is the only Nano download trigger too.
- `downloadprogress` reports `e.loaded` from 0 to 1, and the 0 and 1 events always fire. A failed download rejects with `NetworkError`.
- No download-button pattern exists. The closest is the `noAccess` action (`src/entrypoints/sidepanel/route.ts:66-68`), with
  reasons in `src/entrypoints/sidepanel/status.ts:10` (the union), rendered by `StateMessage.tsx`.
- The onboarding sample uses its own `Jobs`, with no `mt` (`src/entrypoints/onboarding/Onboarding.tsx:270`). Its click goes
  through `gate.whenAcknowledged` and then an async `jobs.start` (`:295-299`), so any `create()` there would come too late.

## Requirements

- **Reasons.** These come from phase 2, and need messages and actions in en and vi:
  - `onDeviceSetup` `[engine, from, to]`: "Turn on on-device translation ({from} → {to})". The action is a click handler that calls `prepare()`.
  - `onDeviceDownloading`: progress in percent, plus a Cancel action.
  - `onDeviceNoSource`: "The page's language is not known, so Chrome can't translate it on the device", plus "Set up a provider".
  - `onDeviceUnavailable` with sub-reasons: no API ("This device can't run Chrome's on-device AI"); off by setting or policy (from
    S8, if it can be detected; otherwise one combined message); and pair not supported ("Chrome can't translate {from} → {to} on
    this device"). Each has the action "Set up a provider", which opens onboarding.
- **`prepare(from, to, monitor)`** on the MT client and Nano. It calls `create()` with no `await` before it, then stores the
  promise in the `made` cache and replaces any stalled or failed entry for that pair. The job then reuses the created object.
- **Second pairs.** A mixed-language page can hit a second pair mid-job. That pair's blocks stop with
  `needs-activation` (phase 2), and the panel shows the turn-on button for it. Each pair needs its own click.
- **Re-runs.** After a download completes, the job re-runs. The panel also re-checks availability on focus, because the state can change from `downloading` to `available` while the panel is closed.
- **Onboarding sample.**
  - Pass the panel's kind of `chromeTranslator()` instance to the sample's `Jobs` as `mt`.
  - When the route stops with `onDeviceSetup`, the sample shows the same turn-on button. Its handler calls `prepare()` synchronously first, then runs the gate and the job.

## Related code files

- Modify:
  - LLM: `src/llm/chrome-translator.ts` (`prepare`, and replacing stalled entries), `src/llm/on-device.ts` (Nano `prepare`).
  - Panel: `src/entrypoints/sidepanel/status.ts`, `src/entrypoints/sidepanel/StateMessage.tsx`, `src/entrypoints/sidepanel/App.tsx`,
    `src/entrypoints/sidepanel/translator.ts` (re-run on download done, re-check on focus), `src/entrypoints/sidepanel/ProgressBar.tsx` (reuse it if it fits).
  - Onboarding: `src/entrypoints/onboarding/Onboarding.tsx`.
  - Locales: `src/locales/en.yml`, `src/locales/vi.yml`.
- Tests: `StateMessage`, `App`, `translator.test.ts`, `Onboarding.test.tsx`, `src/llm/chrome-builtin.test.ts`.

## Implementation steps

1. Write the tests first. Use a fake `Translator` whose `create` throws `NotAllowedError` unless a test "activation" flag is
   set synchronously, and which emits progress. Assert that `create` is called in the same task as the click, for both the panel and the onboarding sample.
2. Implement `prepare()` for Translator and Nano.
3. Add the reasons, messages and actions, using the `src/ui/` Button and progress components from M8.
4. Wire the onboarding sample: pass `mt`, and call `prepare()` first in its click.
5. Add the focus re-check, Cancel (via `AbortSignal`), and the re-run after the download.
6. Run `pnpm test` and `pnpm lint`.

## Success criteria

- The fake-API tests pass in both the panel and onboarding:
  - The click creates synchronously, progress shows, and the job then completes.
  - Cancel stops the download.
  - A second pair asks for its own click.
- Every unavailable path shows a reason and "Set up a provider". No path ends without a message.
- A `downloadable` state never triggers `create()` without the button (`on-device.test.ts` from phase 2 stays green).

## Risks

- **A long Nano download.** Progress stays visible. If the panel closes, Chrome continues the download, and on reopening the panel shows `downloading`.
- **Activation lost through an `await`.** Covered by the same-task assertion.

## Todo

- [x] Tests with activation-gated fakes (panel here; onboarding with phase 4, where the built-in card reaches the sample)
- [x] `prepare()` for Translator and Nano, replacing stalled entries
- [x] Reasons, messages, actions (en and vi), including `onDeviceNoSource` and second-pair prompts
- [x] Onboarding sample gets `mt` and a synchronous `prepare()`
- [x] Focus re-check, Cancel, re-run after the download
