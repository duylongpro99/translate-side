---
phase: 5
title: "Voice settings and provider storage"
status: done
priority: P1
effort: "1.5d"
dependencies: [3]
---

# Phase 5: Voice settings and provider storage

## Goal

Add a "Voice" section to Settings. The user picks an engine (System, Piper offline, or a cloud provider), enters a key
where one is needed, picks a voice for vi and for en, and presses a test button. This setting is independent of the
translation provider.

## Files to create / modify

- Create:
  - `src/tts/settings.ts`:
    - `TtsSettings { engine; connectionId?; voices: { vi?; en? }; readOn: boolean }` in `storage.sync` under `tts`.
    - Connections under `ttsConn:<id>`.
    - Keys reuse `saveApiKey` and `readApiKey` with the `secret:` scheme (`src/shared/settings.ts:206`).
    - `clean*` validators following `cleanConnection`.
  - `src/tts/presets.ts`: one preset per provider: id, label, base URL, origin to request, auth style, whether it
    needs a region, and whether it accepts instructions.
  - `src/entrypoints/options/Voice.tsx` and `Voice.test.tsx`
- Modify:
  - `src/entrypoints/options/OptionsNav.tsx`: a new "Voice" entry.
  - `src/entrypoints/options/Options.tsx`: mount the section.
  - `src/shared/portable.ts`: export and import TTS settings, without keys, the same as translation connections.
  - `src/locales/en.yml` and `vi.yml`

## Tasks and steps

1. Request the host permission on the save click, for that preset's origin only. This follows `Providers.tsx:918`,
   since `permissions.request` needs the user gesture.
2. The "Use my translation key" shortcut: when the translation connection is Gemini (`GEMINI_CONNECTION`) or
   OpenAI-compatible with TTS support, offer to reuse that key. The voice section then stores only a reference. It
   never copies the secret.
3. The voice picker lists voices for vi-VN and en-US from the engine's `voices(lang)`. Picking a voice plays a short
   sample.
4. The test button reads one fixed sentence in vi and one in en, and shows the error kind on failure: `auth`, `quota`,
   `network`, `no-voice`.
5. Never gate this feature with `featureAvailable`. Add a test that asserts this.

## Verification

- `pnpm vitest run src/tts/settings src/entrypoints/options/Voice.test.tsx src/shared/portable`
- Manual: save a Gemini key; the permission prompt shows only `generativelanguage.googleapis.com`; a reload keeps the
  voice choices; an export contains no key.
