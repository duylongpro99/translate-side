---
phase: 6
title: "Cloud TTS adapters"
status: done
priority: P1
effort: "2d"
dependencies: [2, 5]
---

# Phase 6: Cloud TTS adapters

## Goal

Implement one `TtsEngine` per provider that passed S11. Each one plays vi-VN and en-US, can be stopped, and fetches the
next block's audio ahead of time.

## Files to create / modify

- Create:
  - `src/tts/cloud/player.ts`: shared audio playback (`HTMLAudioElement` for mp3, and WebAudio for raw PCM such as
    Gemini's 24 kHz l16), stop, and a small in-memory LRU of `text + voice → audio`.
  - Adapters, one per provider that S11 cleared (drop the file of any provider S11 dropped):
    - `src/tts/cloud/gemini.ts`
    - `src/tts/cloud/openai.ts`
    - `src/tts/cloud/azure.ts`
    - `src/tts/cloud/elevenlabs.ts`
    - `src/tts/cloud/gcloud.ts`
    - `src/tts/cloud/vbee.ts`
    - `src/tts/cloud/fpt.ts`
  - Tests beside each file, against recorded responses from the S11 spike, in the style of `src/llm/adapters.test.ts`.
- Modify: `src/tts/presets.ts` (final endpoints and limits from S11)

## Tasks and steps

1. Each adapter maps `speak(text, { voice, lang, note? })` to its request. Text longer than the provider's limit is
   split at clause boundaries with `speakable.ts`.
2. Map errors to the same kinds as `src/llm/errors.ts` (`auth`, `quota`, `rate_limit`, `network`, `bad_request`, `overloaded`), so the
   panel and settings show the same messages.
3. Prefetch: while block N plays, request block N+1, with at most one request in flight. Stop cancels both with an
   `AbortController`.
4. Load each adapter lazily (a dynamic import), so the panel chunk does not grow with providers the user does not use.

## Verification

- `pnpm vitest run src/tts/cloud`
- `pnpm run build && pnpm run check:bundle`, with the new chunks added to `scripts/bundle-budget.json` with a note.
- Manual, with real keys, for each shipped provider: the Settings test button plays vi and en; in the panel, play,
  then stop mid-block, then read on to the next block. Record the evidence (provider, voice, result) in the phase
  notes.
