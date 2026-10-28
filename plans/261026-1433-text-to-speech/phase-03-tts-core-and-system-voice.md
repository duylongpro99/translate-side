---
phase: 3
title: "TTS core and the system voice"
status: done
priority: P1
effort: "2d"
dependencies: []
---

# Phase 3: TTS core and the system voice

## Goal

Add a `src/tts/` module with one engine interface, a playback controller and the `chrome.tts` engine. Any block can
then be read aloud with no setup, with the voice picked per language and the text split for pauses.

## Files to create / modify

- Create:
  - `src/tts/types.ts`: `TtsEngine { id; voices(lang): Promise<Voice[]>; speak(text, opts): Playback }`, `Playback`
    (`done`, `stop()`, `onProgress`), `Voice { id; name; lang; engine; remote }`
  - `src/tts/speakable.ts`: sentence and clause splitting, plus rule-based normalisation for vi and en (numbers, dates,
    percentages, common abbreviations, URLs skipped). Pure and dependency-free.
  - `src/tts/system.ts`: the `chrome.tts` engine. `getVoices` filtered by `normalizeLang` (`src/shared/language.ts:53`),
    speaking one clause at a time with a short pause, `word` events mapped to `onProgress`.
  - `src/tts/controller.ts`: the queue of blocks, stop, the "now reading" block id, and stop when the panel's page
    changes.
  - Tests beside each file (`*.test.ts`).
- Modify:
  - `wxt.config.ts`: add the `tts` permission.
  - `scripts/check-manifest.mjs:16`: the expected permissions now include `tts`.

## Tasks and steps

1. Write the types and `speakable.ts`, test first, with a table of vi and en cases (`1.250.000 đ`, `25/10/2026`,
   `3,5 %`, `TP.HCM`, `e.g.`, `Dr.`, the dotted quote edge cases).
2. Write `system.ts`:
   - If no voice matches the block's language, return a typed `no-voice` result. The UI uses it to suggest the Piper
     download or a provider.
   - Never fall back to a voice in another language.
3. Write `controller.ts`: one active playback; `play(blocks, from)` reads on through the following blocks when "read
   on" is enabled (on by default; switched off in Settings › Voice); `stop()` is idempotent.
4. Check that the `tts` permission adds no install warning. Confirm in Chrome on the unpacked build, and record the
   result in the phase notes.

## Verification

- `pnpm vitest run src/tts`
- `pnpm run typecheck && pnpm run check:manifest`
- Manual: on macOS the unpacked build reads a vi block with `Linh` and an en block with an en-US voice; stop halts at
  once.
