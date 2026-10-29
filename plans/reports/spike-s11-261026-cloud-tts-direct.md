# Spike S11 report: cloud TTS called straight from the extension (2026-10-26)

Phase: `plans/261026-1433-text-to-speech/phase-02-spike-cloud-tts-direct-calls.md` · Record:
`docs/decisions/S11-cloud-tts-direct.md` · Code: `spikes/s11/` (README has files and rerun steps)

## Outcome

No provider needs a backend, so none is dropped. The whole route was proven twice: in Node and from an MV3 extension
page that has only host permissions, run in Playwright Chromium 156. On that page every provider's server answered
with its own status and body, and there was no CORS failure, even from Vbee, which sends no CORS headers.

| Provider | Verdict | Evidence |
|---|---|---|
| Gemini TTS | **go** | Played vi and en on `gemini-3.8-flash-tts` and `-lite-tts` through Interactions and generateContent. Chromium decoded the audio. |
| OpenAI-compatible `/audio/speech` | **go** | Played vi and en on OpenRouter's free speech model from the extension page. `api.openai.com` returns 401 with this request shape. OpenAI itself is pending a key. |
| Azure Speech | go-pending-key | 401 on the key header and the Bearer token; `issueToken` works but is not needed. |
| ElevenLabs | go-pending-key | 401 `invalid_api_key`. `eleven_flash_v2_5` and `eleven_v4` support vi. |
| Google Cloud TTS | go-pending-key (at risk) | 400 `API_KEY_INVALID`. Our new-format Gemini key (`AQ.`) is refused with "API keys are not supported". A standard `AIza…` key is unproven. |
| Vbee | go-pending-key, **vi only** | The Realtime sync API has a 300-character limit and 5 vi voices. English is only on Batch, which needs a webhook. |
| FPT.AI | go-pending-key, **vi only** | `callback_url` is optional. The `async` link can be polled by loading it in `<audio>` with retries. |

## Key findings

- **Model ids are current.** ListModels on 2026-10-26 lists `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`
  (8,192 input tokens). The older models still listed are `gemini-3.1-flash-tts-preview` and `gemini-2.5-*-preview-tts`.
- **Gemini 3.8 output format.** It returns WAV by default (24 kHz mono s16le with a RIFF header), not raw PCM. Ask
  for `mime_type: audio/l16` to get headerless PCM.
- **Gemini style placement.** The style goes in `text.annotations[{type:"speech_metadata", style}]`. Gemini rejects
  `speech_metadata` placed directly on the item.
- **Gemini Vietnamese voices.** There are 40 vi-VN library voices (`GET /v1beta/voices?language_code=vi-VN`), and
  their ids work as `voice`.
- **Gemini free-tier quota.** The free tier allows 10 TTS requests a day per model. The 11th request got a 429 with
  `retry-after` of about 16 h. Phase 6 must batch blocks into one request and map a per-day 429 to `quota`.
- **Gemini invalid-key error shape.** On Interactions, the body for an invalid key is a JSON array
  (`[{"error":…}]`), so the classifier must unwrap it.
- **AIBOX.** It is an OpenAI-compatible "new-api" gateway (`https://api.ai-box.vn/v1`). It serves the
  `/v1/audio/speech` route, but our token can use only 3 chat models (403 for TTS models), so it is not a TTS source.
- **OpenRouter.** Its account has 0 credits, so paid speech models return 402. Its speech catalogue has no OpenAI
  TTS model but includes the ElevenLabs and Gemini TTS models. The free model `fish-audio/s2.1-pro-free:free` accepts
  only `mp3` and `pcm`.

## Request shapes for the adapters

Request shapes, the error-to-kind mapping and the voice-list endpoints are in the decision record. The recorded
samples are in `spikes/s11/recorded/` (15 files, 100 KB, with header names only and audio cut to 300 bytes).

## Unresolved questions (owner)

1. Add keys for OpenAI, Azure, ElevenLabs, Google Cloud (a standard key), Vbee and FPT.AI, using the `.env` names in
   `spikes/s11/README.md`, then rerun each probe to get real playback and the `*-ok.json` fixtures.
2. If a standard Google Cloud key also gets `CREDENTIALS_MISSING`, choose one: defer Google Cloud TTS, or accept a
   service-account JWT signed in the extension.
3. Should Gemini default to Flash Lite to make the free tier last longer? Both models have the same 10-a-day
   free-tier cap per model.
