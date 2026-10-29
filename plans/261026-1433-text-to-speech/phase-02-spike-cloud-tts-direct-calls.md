---
phase: 2
title: "Spike S11: cloud TTS called straight from the extension"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 2: Spike S11 — cloud TTS called straight from the extension

## Goal

For each candidate provider, prove whether an extension page can synthesize vi-VN and en-US audio with only the user's
key and an optional host permission, with no backend. Record each provider's request shape, voices list, audio format
and limits.

An extension page that holds host permission for an origin is not bound by CORS. The real risks are therefore auth
flows (token exchange, signed requests, accounts that need a server), the response format, and terms of service.

## Files to create / modify

- Create: `spikes/s11/` (a probe page, plus a probe script per provider)
- Create: `docs/decisions/S11-cloud-tts-direct.md`

## Tasks and steps

For each of these providers:

- Gemini TTS: `gemini-3.8-flash-tts` and `-lite`; check `generateContent` with an AUDIO modality against the
  `interactions` endpoint.
- OpenAI `/v1/audio/speech`: `gpt-4o-mini-tts` and its `instructions` field.
- Azure Speech: SSML by key and region; an `issueToken` exchange or the key header.
- ElevenLabs: `eleven_flash_v2_5`, and v3 or v4 if they support vi.
- Google Cloud TTS: the API key on `texttospeech.googleapis.com`.
- Vbee
- FPT.AI

Do the following:

1. Find the documented endpoint, auth scheme, voices endpoint, the vi-VN and en-US voices, the audio format (mp3, wav,
   pcm), the character limit per request, and whether it streams.
2. From the probe page, with a real key and the host permission granted, synthesize the same vi and en passage, then
   save the audio and play it.
3. Record any blocker:
   - a key that cannot be used from a client;
   - an async job or callback URL that needs a server (check FPT.AI's async callback in particular);
   - terms that forbid client-side keys.

## Go / no-go per provider

- **Go:** plays vi and en from the probe page using the key plus the host permission only.
- **Drop:** a blocker needs a backend. Record the reason in S11 and remove the provider from phase 6.

## Verification

- `docs/decisions/S11-cloud-tts-direct.md` holds a table: provider · endpoint · auth · formats · limits · vi voices ·
  en voices · result (go / drop and why).
- Keys used in the spike are never written to the repo. The probes read them from `.env` (`.env` is git-ignored).
