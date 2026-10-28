---
title: Cook text-to-speech (system voice, BYOK cloud voices, voice prep)
date: 2026-10-27
summary: Delivered phases 2-7 and 9 of the TTS plan on feat/text-to-speech; review found key and privacy holes, fixed; Piper deferred by the owner over voice licence lineage
---

# Cook text-to-speech

## What happened

The plan ran in a separate worktree (`../translate-side-tts`, branch `feat/text-to-speech`), because the main worktree
held uncommitted selection-popup work. Two spikes ran in parallel with the core work.

- S11: no cloud provider needs a backend. An extension page with a host permission is not bound by CORS, and even
  Vbee, which sends no CORS headers, answered. Gemini and an OpenAI-compatible route played real vi and en audio.
- S10: a rule-based Vietnamese G2P matched the reference on 99.81 % of held-out syllables, and the speed and size
  gates passed. The only medium Vietnamese voice, `vais1000`, is fine-tuned from `lessac`, whose data is research-only.

## Decisions

- The owner deferred the offline Piper voice (phase 8) over that licence lineage.
- Voice prep timeout: 1.5 s for the block the reader waits on, 8 s ahead. A live run took 30 s with thinking on and
  2–4 s with it off, so the plan's flat 1.5 s would always fall back.
- The prep drift check compares with the rule-based speakable text, because writing numbers as words can triple a
  Vietnamese block.
- A cloud voice is not used on never-translate or local-only pages; the system voice reads.

## What the review caught

- Voice keys shared the `secret:<id>` namespace, so an imported translation connection named `tts-gemini` could
  send the voice key anywhere. They now live under `ttsSecret:<id>`.
- Read-on reused a block prepared early after another block's translation arrived in between, so the highlight and
  the audio disagreed.
- The panel's engine cache ignored a re-saved provider, so a new key went to the old address.
- The hook read settings through a ref updated only on render, so a play right after load saw the defaults.

## Open

Real-key playback for Azure, ElevenLabs, Google Cloud, Vbee and FPT.AI; listening checks; Gemini batching for its
free tier; whether the privacy notice version should rise for the new voice destinations.
