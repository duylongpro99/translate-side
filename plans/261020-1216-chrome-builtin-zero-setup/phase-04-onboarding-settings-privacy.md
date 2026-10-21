---
phase: 4
title: "Onboarding, settings override, privacy wording, labels"
status: done
priority: P2
effort: 2d
dependencies: [2, 3]
---

# Phase 4: Onboarding, settings override, privacy wording, labels

## Goal

The user-facing surfaces match the new route:
- The onboarding card works.
- Settings offer the engine choice.
- Privacy acknowledgment is required only for routes that send text off the device, and this is enforced on the resolved route.
- The header and blocks name the engine.

<!-- Red team 2026-10-20: updated for findings 4, 5, 14. -->

## Key insights

- **Onboarding.** `type Path = 'key' | 'local' | 'builtin'` (`src/entrypoints/onboarding/Onboarding.tsx:32`). The builtin
  card is disabled at `:193-196`, with copy at `src/locales/en.yml:925-926`. The sample's notice text, `onboarding.privacy`
  (`en.yml:931`), says text goes "to the provider you chose".
- **The privacy gate.** `PrivacyGate` is global and version-based (`src/entrypoints/sidepanel/privacy.ts:12-18`). The panel checks
  it before the route resolves, at three sites: page (`src/entrypoints/sidepanel/translator.ts:330`), snippet (`:294`) and
  switch (`:490`). Onboarding checks it at `Onboarding.tsx:298`. A UI-level exemption would be a time-of-check/time-of-use bug:
  if a key is added mid-session, the job would resolve to the cloud with no acknowledgment.
- **The switcher.** `offerSetup` reads `switcherState.currentUsable` (`src/entrypoints/sidepanel/App.tsx:293`), which comes from
  `isUsable` on the routed connection (`src/entrypoints/sidepanel/switcher.ts:46-52`). For a keyless user it stays `false`, and
  the switcher keeps naming APIBOX Qwen.
- **Labels.** The basic badge is in `SegmentList.tsx:409-422`. Nano blocks carry `producedBy.model = 'gemini-nano'` (`src/llm/chrome-builtin.ts:11`).
- **Settings.** The routing selects are in `src/entrypoints/options/Providers.tsx:380`, using `Select` from `@/ui/Select` (`:9`).

## Requirements

1. **Privacy enforced on the resolved route.**
   - Add a `privacy` dependency to `Jobs`: `{ acknowledged(): boolean; whenAcknowledged(key, run) }`.
   - In `Jobs.start`, after `translateClient` resolves: an `onDevice` route runs at once. Any other route runs only if the
     gate is acknowledged; otherwise the job waits on `whenAcknowledged` and the notice shows.
   - The panel-level checks at `translator.ts:294`, `:330` and `:490`, and at `Onboarding.tsx:298`, are replaced by this single check, so the route is resolved once and the gate reads that result.
   - Fallback links that go to the cloud count as cloud: a Nano or Translator route has none.
   - Do not bump `PRIVACY_NOTICE_VERSION`, so existing acknowledgments stay.
2. **Notice wording.** For a cloud route, the notice is today's. On-device routes show no notice. The header's "where text goes"
   line reads "Stays on this device (Chrome)". Change the onboarding sample notice (`onboarding.privacy`) to depend on the route.
3. **Onboarding.**
   - Enable the builtin card, with the copy "Translate on this device with Chrome. No key needed; text stays on your computer."
   - Choosing it skips the key step and runs the sample on the device, using phase 3's button when a click is needed.
   - If on-device AI is unavailable, the card is disabled and shows the reason.
   - The default path is `builtin` when on-device AI is available, otherwise `key`.
4. **Settings.**
   - Next to the translate route in Providers, add the select "On-device engine": Auto (recommended) / Gemini Nano / Chrome Translator.
   - Its hint says that Nano supports only some target languages, and that removing "basic translation" from the fallback list turns Chrome Translator off.
   - Options the device can't run are disabled, with the reason.
5. **The switcher and the setup offer.**
   - Add `onDevice?: 'nano' | 'translator'` to `SwitcherState`, from the same resolution `translateClient` uses.
   - When it is set, the switcher shows "Chrome on-device" as the current entry.
   - The setup offer becomes a soft hint: "Using Chrome's on-device translation. Set up a provider for better quality." (en and vi).
6. **Labels.** Nano blocks show "Gemini Nano (on device)". Translator blocks keep "basic translation".

## Related code files

- Modify:
  - Panel: `src/entrypoints/sidepanel/jobs.ts` (the privacy dependency), `src/entrypoints/sidepanel/translator.ts` (remove the
    pre-route gate checks, pass the gate), `src/entrypoints/sidepanel/privacy.ts`, `src/entrypoints/sidepanel/PrivacyNotice.tsx`,
    `src/entrypoints/sidepanel/switcher.ts`, `src/entrypoints/sidepanel/ModelSwitcher.tsx`, `src/entrypoints/sidepanel/App.tsx`,
    `src/entrypoints/sidepanel/SegmentList.tsx`.
  - Onboarding and options: `src/entrypoints/onboarding/Onboarding.tsx`, `src/entrypoints/options/Providers.tsx`.
  - Locales: `src/locales/en.yml`, `src/locales/vi.yml`.
- Tests: `privacy.test.tsx`, `switcher.test.tsx`, `offer.test.tsx`, `translator.test.ts`, `Onboarding.test.tsx`, the Providers test, `blocks.test.tsx`.

## Implementation steps

1. Write the tests first:
   - **Privacy:** with no acknowledgment, an on-device job runs. A cloud job waits. When a key is added between the panel check and `Jobs.start`, the job waits (it does not send).
   - **Onboarding:** the builtin card's three states.
   - **Providers:** the select saves, and unrunnable options are disabled.
   - **Switcher:** a keyless user sees "Chrome on-device".
   - **Badges.**
2. Move the gate into `Jobs.start`, and remove the pre-route checks.
3. Implement the surfaces with M8's `src/ui/` components and tokens.
4. Run `pnpm ui:screens` to refresh the screenshots, and review them.
5. Run `pnpm test`, `pnpm lint`, `pnpm check:tokens` and `pnpm check:bundle`.

## Success criteria

- The tests above pass. Existing privacy, onboarding and switcher tests still pass, or change only where the copy or the gate location changed on purpose.
- en and vi stay in parity (`src/locales/locales.test.ts`).
- No path sends page text to a non-on-device route without an acknowledged notice.

## Risks

- **Bundle budget.** `onboarding.css` has very little headroom. Reuse existing classes.
- **Moving the gate changes when the notice appears.** It now appears after route resolution, which is milliseconds later. The tests pin the new behavior.

## Todo

- [x] Privacy gate enforced in `Jobs.start` on the resolved route; pre-route checks removed
- [x] Route-aware notice wording (panel and onboarding)
- [x] Onboarding builtin card live
- [x] "On-device engine" select in Providers
- [x] `SwitcherState.onDevice`, switcher entry, soft setup hint
- [x] Block labels
- [x] Screens refreshed (taken in phase 5, after the e2e build they need)
