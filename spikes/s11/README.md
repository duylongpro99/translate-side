# Spike S11: cloud TTS called straight from the extension

Answers `plans/261026-1433-text-to-speech/phase-02-spike-cloud-tts-direct-calls.md`. The record is
`docs/decisions/S11-cloud-tts-direct.md`.

Keys come from the repository's `.env` (git-ignored) and are never printed or written: `writeRecord` refuses to
write a fixture that contains any `.env` value, and request fixtures keep header **names** only. Audio goes to
`.cache/s11/` (git-ignored). No dependency beyond the repository's own `@playwright/test`.

## Files

| File | What it is |
|---|---|
| `lib.mjs` | Shared helpers: `.env` reader, the vi and en passages, `send()` (one request → a fixture record with header names, redacted URL, audio cut to its first 300 bytes), `saveAudio()` (writes `.cache/s11/` and checks it with `afinfo`), `pcmToWav()`. |
| `probe-gemini.mjs` | Gemini TTS, **real key** (`GEMINI_API_KEY`): `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`, vi and en, through `POST /v1beta/interactions` and `:generateContent`; an `audio/l16` request; a Vietnamese library voice; `GET /v1beta/voices`; invalid key and unknown voice. |
| `probe-openai.mjs` | OpenAI-compatible `POST …/audio/speech`. **Real key** on OpenRouter (`OPENROUTER_API_KEY`, free model `fish-audio/s2.1-pro-free:free`, vi and en); OpenRouter 402/400/401; `api.openai.com` with an invalid key; AIBOX (`AIBOX_API_KEY`) whose token has no TTS model (403). |
| `probe-azure.mjs` | Azure Speech, invalid key: SSML on `{region}.tts.speech.microsoft.com/cognitiveservices/v1` with `Ocp-Apim-Subscription-Key`, the `issueToken` exchange, Bearer, voices list, an unknown region. Real run with `AZURE_SPEECH_KEY` (+ `AZURE_SPEECH_REGION`). |
| `probe-elevenlabs.mjs` | ElevenLabs, invalid key: `eleven_flash_v2_5` and `eleven_v4` with `language_code`, no-key, models and voices routes. Real run with `ELEVENLABS_API_KEY`. |
| `probe-google-cloud.mjs` | Google Cloud TTS, invalid key in `x-goog-api-key` and `?key=`, `voices?languageCode=vi-VN`, and the Gemini key against Cloud TTS. Real run with `GOOGLE_CLOUD_TTS_API_KEY`. |
| `probe-vbee.mjs` | Vbee, invalid token: Realtime (`mode: sync`), 301 chars, Batch without `webhookUrl`, Get request, voices, no `App-Id`, a CORS preflight (information). Real run with `VBEE_TOKEN` + `VBEE_APP_ID`. |
| `probe-fpt.mjs` | FPT.AI v5, invalid key, no `callback_url`; with `FPT_API_KEY` it polls the returned `async` link until the MP3 is there. |
| `ext/` | The probe extension: MV3, `host_permissions` for every provider origin and nothing else; `probe.html` + `probe.js` expose `window.s11Call(request)`, which fetches, extracts the audio, decodes it with `AudioContext.decodeAudioData` and loads it in an `<audio>` element. |
| `probe-extension.mjs` | Loads `ext/` in Playwright's Chromium as `e2e/fixtures.ts` does and runs every provider's request from `chrome-extension://<id>/probe.html`. Writes `results/extension.json`. |
| `recorded/<provider>-{ok,error}.json` | Recorded request/response samples for the phase 6 adapter tests (see below). |
| `results/extension.json` | The extension-page run: status, content type, decode result per call. |

## Recorded samples

Each record is `{ recordedAt, request: { url, method, headerNames, contentType, body }, response: { status,
contentType, headers, ms, body } }`. `response.body` is `{ json }` (base64 audio strings cut to 400 characters,
i.e. the first 300 bytes of the real audio), `{ text }`, or `{ base64Head, totalBytes }` for a binary audio body.
Files with several samples hold one record per named key.

| File | Content |
|---|---|
| `gemini-ok.json` | Interactions, `gemini-3.8-flash-tts`, vi, voice Kore, style annotation → 200 JSON, `audio/wav` base64 |
| `gemini-generatecontent-ok.json` | generateContent, AUDIO modality → 200, `inlineData` `audio/wav` |
| `gemini-l16-ok.json` | Interactions with `response_format.mime_type: audio/l16` → `audio/l16; rate=24000; channels=1` |
| `gemini-voices-ok.json` | `GET /v1beta/voices?language_code=vi-VN` → 40 Vietnamese library voices |
| `gemini-error.json` | invalid key (400 `API_KEY_INVALID`, body is a JSON **array**), unknown voice (400 `invalid_request`) |
| `gemini-rate-limit-error.json` | 429 `too_many_requests`, free tier 10 requests/day, `retry-after: 57846` |
| `openai-compatible-openrouter-ok.json` | OpenRouter `/api/v1/audio/speech` → 200 `audio/mpeg` |
| `openai-compatible-openrouter-error.json` | 402 no credits, 400 unknown model, 401 invalid key |
| `openai-compatible-aibox-error.json` | AIBOX: 403 token not allowed the model, 404 unknown route |
| `openai-error.json` | `api.openai.com` invalid key → 401 `invalid_api_key` (content-type `text/plain`, body JSON) |
| `azure-error.json` | 401 empty body (key header and Bearer), issueToken 401 JSON, voices list 401, unknown region DNS failure |
| `elevenlabs-error.json` | 401 `invalid_api_key`, 401 `needs_authorization`, models/voices 401 |
| `google-cloud-error.json` | 400 `API_KEY_INVALID` (header and `?key=`), voices 400, Gemini `AQ.` key → 401 `CREDENTIALS_MISSING` |
| `vbee-error.json` | 401 nginx HTML for every route (token checked at the gateway) |
| `fpt-error.json` | 401 `Invalid authentication credentials`, 401 `No API key found in request` |

## How to rerun

From the repository root, after `pnpm install`:

```sh
node spikes/s11/probe-gemini.mjs        # real key; mind the free tier: 10 requests/day per TTS model
node spikes/s11/probe-openai.mjs        # OpenRouter free model (real), OpenAI + AIBOX error shapes
node spikes/s11/probe-azure.mjs
node spikes/s11/probe-elevenlabs.mjs
node spikes/s11/probe-google-cloud.mjs
node spikes/s11/probe-vbee.mjs
node spikes/s11/probe-fpt.mjs
node spikes/s11/probe-extension.mjs     # the same calls from an extension page in Chromium
```

When the owner has a key for a keyless provider, add it to `.env` and rerun that provider's probe: it then
synthesizes vi and en, saves the audio under `.cache/s11/`, and writes `recorded/<provider>-ok.json`.

| Provider | `.env` names |
|---|---|
| Azure | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (default `eastus`) |
| ElevenLabs | `ELEVENLABS_API_KEY` |
| Google Cloud TTS | `GOOGLE_CLOUD_TTS_API_KEY` (a standard `AIza…` key of a project with the Text-to-Speech API enabled) |
| Vbee | `VBEE_TOKEN`, `VBEE_APP_ID` |
| FPT.AI | `FPT_API_KEY` |

Listen to the files in `.cache/s11/` (`afplay .cache/s11/<file>`) for the Vietnamese quality check.
