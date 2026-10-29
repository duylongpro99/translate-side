---
title: "Text-to-speech: read the original or the translation aloud"
description: "Read any block, original or translated, aloud in vi-VN or en-US. The system voice is the zero-setup default, the Piper voice is an offline one-click download, and natural voices come from the user's own TTS provider, which gets a context note."
status: in-review
priority: P2
effort: 12d
branch: feat/text-to-speech
tags: [tts, frontend, providers, on-device, privacy]
blockedBy: []
blocks: []
created: 2026-10-26
---

# Text-to-speech: read the original or the translation aloud

## Overview

The reader can play any block, original or translated, aloud in Vietnamese or English. There are three tiers of voice,
all free:

1. **System voice** (`chrome.tts`). The zero-setup default. Text is split by sentence and clause (rule-based normalisation, no LLM), the voice is picked
   per block's language, and the text is made speakable before it is read.
2. **Piper offline voice.** A one-click download that needs no key and works offline. For Vietnamese it uses our own
   rule-based G2P (no espeak-ng, so no GPL code).
3. **The user's own TTS provider (BYOK):**
   - Gemini TTS
   - OpenAI-compatible `/v1/audio/speech`
   - Azure Speech
   - ElevenLabs
   - Google Cloud TTS
   - Vbee and FPT.AI

   Providers that accept instructions (Gemini, OpenAI) also get a context note written by an LLM.

The decision record is
[brainstorm-261026-2114-text-to-speech-options.md](../reports/brainstorm-261026-2114-text-to-speech-options.md).

## Contract

- **Outcome:** a play control on each block reads the original or the translation aloud. A stop control and the
  "now reading" block are always visible.
- **Constraints:**
  - The feature is free: it is never gated by `featureAvailable`.
  - Users bring their own keys, and there is no backend.
  - MV3 forbids remote code: all WASM and JS ship in the package, and only voice weights are downloaded.
  - The repo stays MIT: no espeak-ng and no GPL code.
  - The TTS setting is independent of the translation provider.
  - Each new destination for text is named in `docs/privacy.md`.
  - Bundle and manifest checks stay green.
- **Non-goals:** voice cloning, exporting audio files, speech-to-text, a hosted proxy, and a read-aloud button in the
  selection popup (later, after `feat/selection-popup` merges).
- **Acceptance criteria:**
  - Each shipped provider plays a vi-VN passage and an en-US passage through its test button with a real key.
  - With no provider set, the system voice plays.
  - Playback can be stopped, and the block being read is shown.
  - The Piper voice plays vi-VN and en-US offline after its download.
  - Gemini and OpenAI requests carry the context note.
  - `pnpm run check` passes.

## Phases

| # | Phase | Depends on | Effort | Status |
|---|---|---|---|---|
| 1 | [Spike S10: Piper Vietnamese without espeak-ng](./phase-01-spike-piper-vi-g2p.md) | none | 2d | Done (go, licence open) |
| 2 | [Spike S11: cloud TTS called straight from the extension](./phase-02-spike-cloud-tts-direct-calls.md) | none | 1d | Done |
| 3 | [TTS core and the system voice](./phase-03-tts-core-and-system-voice.md) | none | 2d | Done |
| 4 | [Read-aloud controls in the panel](./phase-04-panel-read-aloud-controls.md) | 3 | 1.5d | Done |
| 5 | [Voice settings and provider storage](./phase-05-voice-settings-and-storage.md) | 3 | 1.5d | Done |
| 6 | [Cloud TTS adapters](./phase-06-cloud-tts-adapters.md) | 2, 5 | 2d | Done (5 providers pending real keys) |
| 7 | [Context note and speakable text](./phase-07-context-note-and-speakable-text.md) | 6 | 1d | Done |
| 8 | [Piper offline voice](./phase-08-piper-offline-voice.md) | 1, 3, 5 | 2.5d | Deferred (owner, 2026-10-27) |
| 9 | [Docs, privacy and release checks](./phase-09-docs-privacy-and-checks.md) | 4–8 | 0.5d | Done |

Phases 1, 2 and 3 can start together. The spikes are gates:

- If phase 1 fails, phase 8 stops and the owner is asked. There is no silent fallback to GPL.
- A provider that phase 2 shows cannot be called without a backend is dropped from phase 6, and the drop is recorded.

## Architecture

```text
SegmentList block toolbar ──► ReadAloud controller (queue, stop, now-reading) ──► TtsEngine
                                        │                                      ├─ system   (chrome.tts)
                                        ▼                                      ├─ piper    (onnxruntime-web, own vi G2P)
                              speakable text + context note                    └─ cloud    (gemini | openai | azure |
                              (translation connection or Nano)                              elevenlabs | gcloud | vbee | fpt)
```

New code lives in `src/tts/`, with one file per engine and adapter. Settings follow the existing connection pattern:
the config goes in `storage.sync` under `ttsConn:<id>`, and the key in `storage.local` under the same `secret:<id>`
scheme (`src/shared/settings.ts:206`).

## Success criteria

- [ ] All acceptance criteria above, each with evidence recorded in the phase files.
- [ ] Spike reports `docs/decisions/S10-piper-vi-g2p.md` and `docs/decisions/S11-cloud-tts-direct.md` exist.
- [ ] `pnpm run check` is green, and the bundle budget note records each new chunk.

## Validation Log

### Verification results

- Claims checked: 14.
- Verified: 14. Failed: 0 after the fixes below.
- Tier: Full (9 phases).
- Fixes: the key writer is `saveApiKey` (not `writeApiKey`). The error kinds are named as in `src/llm/errors.ts`. Prompts
  are registered in `src/engine/prompts/registry.ts`.

### Owner answers (2026-10-26)

1. When a block finishes, playback reads on to the following blocks by default; a setting switches this off.
2. The selection popup gets no read-aloud button in this plan. It comes later.
3. The LLM text-preparation step (context note) runs only for cloud voices. The system voice and Piper use the
   rule-based `speakable.ts` only.

## Delivery state (2026-10-27)

Branch `feat/text-to-speech` (worktree `../translate-side-tts`), not pushed. `pnpm run check` passes (2,484 tests).

| Acceptance criterion | State | Evidence |
|---|---|---|
| Each shipped provider plays vi and en through its test button with a real key | Partly | Gemini and OpenAI-compatible (OpenRouter) played vi and en from an extension page in S11; Azure, ElevenLabs, Google Cloud, Vbee (vi), FPT.AI (vi) verified by request shape only, waiting on the owner's keys (`spikes/s11/README.md`) |
| With no provider set, the system voice plays | Code and tests done; listening is the owner's | `src/tts/system.test.ts`; manual check in Chrome pending |
| Playback can be stopped, and the block being read is shown | Done | `src/entrypoints/sidepanel/read-aloud.test.tsx`, `src/tts/controller.test.ts` |
| The Piper voice plays vi and en offline | Deferred | S10 go on measured gates; owner deferred phase 8 over the `vais1000` licence lineage |
| Gemini and OpenAI requests carry the context note | Done | `src/tts/cloud/adapters.test.ts` (style annotation, `instructions`), live prep run on qwen3.8-flash and gpt-oss:20b |
| `pnpm run check` passes | Done | 2026-10-27 run |

Changes from the phase files, with reasons:
- Voice prep timeout: 1.5 s for the block the reader waits on, 8 s for a block prepared ahead (real routes take 2–4 s).
- The 30 % drift check compares with the rule-based speakable text, not the raw block (written-out numbers triple
  Vietnamese length).
- "Read original" is a toolbar button shown while the block shows its original, not a per-block menu (node budget).
- Voice keys live under `ttsSecret:<id>`, not `secret:<id>` (code review H1: a translation connection id could
  collide). Cloud voices are not used on never-translate or local-only pages (review H2).
- Gemini batching (S11's advice for the free tier's 10 requests a day) is not built; Settings › Voice warns instead.
- Picked voices are not carried by settings import (they are per computer).

Open for the owner: real-key playback for five providers; the human listening checks; the `tts` permission's install
warning on the unpacked build (expected none); the Gemini batching question; whether the privacy notice version
should be raised for the new voice destinations.
