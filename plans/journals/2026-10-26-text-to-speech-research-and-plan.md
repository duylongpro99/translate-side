---
title: Text-to-speech research and plan
date: 2026-10-26
summary: Chose free BYOK multi-provider TTS with system voice default and MIT Piper offline voice; 9-phase plan with two spike gates
---

# Text-to-speech research and plan

## What happened

The user asked for TTS that reads the original or the translated text, in Vietnamese and English. The requirement
sharpened over the session from "a voice" to "correct intonation and context".

The research found:

- Chrome's system voices (macOS has `Linh` for vi_VN) are free but context-blind.
- Gemini TTS and OpenAI `gpt-4o-mini-tts` accept style or context instructions.
- No independent benchmark of Vietnamese prosody was found.
- Chrome has no built-in AI API that outputs speech.
- The Piper browser runtime depends on espeak-ng, which is GPL-3.0. This repo is MIT.

## Decisions

- TTS is free, never Pro. Users bring their own key and choose from many providers: Gemini, OpenAI-compatible,
  Azure, ElevenLabs, Google Cloud, Vbee and FPT.AI.
- The default with no key is the system voice (`chrome.tts`). A one-click Piper offline voice is the free natural
  option.
- Licence option (a): write our own rule-based Vietnamese G2P and use MIT `piper-plus` for English. No espeak-ng is
  shipped.
- The LLM context note and speakable text run only for cloud voices. Reading continues to the next block by default.
  The selection popup is deferred.

## Next steps

Run `/ak:cook plans/261026-1433-text-to-speech/plan.md`. The spikes come first:

- S10: Piper Vietnamese G2P compared against an espeak-ng oracle used at dev time only.
- S11: each cloud provider called directly from the extension. A provider that needs a backend is dropped.

The record is in `plans/reports/brainstorm-261026-2114-text-to-speech-options.md`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
