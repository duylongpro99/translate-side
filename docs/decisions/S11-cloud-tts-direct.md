# S11 — Cloud TTS called straight from the extension → provider list and request shapes for phase 6

Status: **Decided 2026-10-26.** Gemini and the OpenAI-compatible route are proven end to end from an extension page;
the five keyless providers are verified by request shape and are pending a real-key playback by the owner. No
provider is dropped. · Spike code: `spikes/s11/` · Plan:
`plans/261026-1433-text-to-speech/phase-02-spike-cloud-tts-direct-calls.md` · Research:
`plans/reports/brainstorm-261026-2114-text-to-speech-options.md` · Environment: macOS 26 (arm64), Node, Playwright
Chromium 156.0.8078.4 headless.

## Question

Can an extension page synthesize vi-VN and en-US speech with only the user's key and a host permission, with no
backend? For each provider: endpoint, auth, audio format, limits, streaming, voices, host permission, style prompt,
and any blocker (a key that can't be used from a client, an async job that needs a callback server, terms against
client-side keys).

## Method

- One probe script per provider (`spikes/s11/probe-*.mjs`) sends the documented request from Node. With a key in
  `.env` it synthesizes the same vi and en passage, saves the audio in `.cache/s11/` and checks it with `afinfo`.
  Without a key it sends an obviously invalid key and records the status and body: this proves the endpoint, the
  auth header name and the error shape.
- `spikes/s11/ext/` is an MV3 extension with `host_permissions` for every provider origin and nothing else.
  `probe-extension.mjs` loads it in Playwright's Chromium (as `e2e/fixtures.ts` does) and runs every request with
  `fetch` from `chrome-extension://<id>/probe.html`; the audio is decoded with `AudioContext.decodeAudioData` and
  loaded in an `<audio>` element (`spikes/s11/results/extension.json`).
- Model names were checked against `GET /v1beta/models` (Gemini), `GET /api/v1/models?output_modalities=speech`
  (OpenRouter) and the providers' current docs.
- Request/response samples for the adapter tests: `spikes/s11/recorded/` (header names only, audio cut to 300 real
  bytes). Files and rerun steps: `spikes/s11/README.md`.

## Evidence

**Real keys.**

| Run | Result |
|---|---|
| Gemini `gemini-3.8-flash-tts`, Interactions, vi / en (Node) | 200, `audio/wav` 24 kHz mono s16, 7.76 s / 9.32 s |
| Gemini `gemini-3.8-flash-lite-tts`, Interactions, vi / en (Node) | 200, same format, 8.60 s / 10.16 s |
| Gemini `gemini-3.8-flash-tts`, generateContent, vi / en (Node) | 200, `inlineData` `audio/wav` 24 kHz, 12.44 s / 12.68 s |
| Gemini Interactions `mime_type: audio/l16` | 200, `audio/l16; rate=24000; channels=1`, headerless PCM |
| Gemini library voice `vi-vn-tutor-1` (Flash Lite, vi) | 200, 6.56 s |
| Gemini, extension page, Flash Lite Interactions vi / en, generateContent vi | 200 ×3; Chromium decodes all three; `<audio>` loads them (8.24 / 9.68 / 6.88 s) |
| OpenRouter `/api/v1/audio/speech`, `fish-audio/s2.1-pro-free:free`, vi / en (Node and extension page) | 200 `audio/mpeg` 44.1 kHz mono; decoded and loaded in Chromium (8.4 / 9.3 s) |
| Gemini, 11th request of the day on `gemini-3.8-flash-tts` | **429** `too_many_requests`, "limit: 10 requests per day on Free Tier", `retry-after: 57846` |
| AIBOX (`api.ai-box.vn/v1`, a "new-api" gateway) `/audio/speech` | 403 "Token này không có quyền truy cập model gpt-4o-mini-tts": the route exists; this token serves only `qwen3.8-flash`, `ds/deepseek-flash`, `ds/deepseek-v4-pro`. AIBOX is not a TTS source for us. |

**Invalid keys, from Node and from the extension page (identical results).** Every keyless provider answered with
its own status and body inside the extension page: no CORS failure on any origin, including Vbee, whose server
returns no CORS headers at all (preflight 404). The host permission is enough.

| Provider | Call | Status | Body |
|---|---|---|---|
| OpenAI | `POST api.openai.com/v1/audio/speech` | 401 | `{"error":{"code":"invalid_api_key","type":"invalid_request_error",…}}`, content-type `text/plain` |
| Azure | `POST eastus.tts.speech.microsoft.com/cognitiveservices/v1` (key header, Bearer) | 401 | empty, no content-type |
| Azure | `POST eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken` | 401 | `{"error":{"code":"401","message":"Access denied due to invalid subscription key or wrong API endpoint…"}}` |
| Azure | unknown region host | — | DNS failure (`ENOTFOUND`): map to `bad_request` "check the region" |
| ElevenLabs | `POST api.elevenlabs.io/v1/text-to-speech/{voice_id}` | 401 | `{"detail":{"type":"authentication_error","status":"invalid_api_key",…}}`; no header → `needs_authorization` |
| Google Cloud | `POST texttospeech.googleapis.com/v1/text:synthesize` (header or `?key=`) | 400 | `INVALID_ARGUMENT`, reason `API_KEY_INVALID` |
| Google Cloud | the Gemini key (new format, prefix `AQ.`) | 401 | `CREDENTIALS_MISSING` "API keys are not supported by this API". Translation v2, which takes standard keys, says the same for this key: it is the key type, not proof about standard `AIza…` keys |
| Vbee | `POST api.vbee.vn/v1/tts`, every route | 401 | nginx HTML page (the gateway checks the token before the app) |
| FPT.AI | `POST api.fpt.ai/hmi/tts/v5` | 401 | `{"message":"Invalid authentication credentials"}`; no key → `"No API key found in request"` |

## Decision

### Provider table

| Provider | Endpoint | Auth | Audio formats (exact) | Limit per request | Streaming | vi voices | en voices | Host permission | Style prompt | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| **Gemini TTS** | `POST https://generativelanguage.googleapis.com/v1beta/interactions` (documented); `…/models/{model}:generateContent` also works | `x-goog-api-key: <key>` | JSON with base64 audio. Default **`audio/wav`** (44-byte RIFF + PCM s16le, 24 kHz, mono). `response_format.mime_type` `audio/l16` → headerless PCM s16le 24 kHz mono; also `audio/mulaw`, `audio/alaw`; `sample_rate` 24000/16000/8000. Older models (`3.1-flash-tts-preview`, 2.5) default to `audio/l16` | 8,192 input tokens (ListModels `inputTokenLimit`); 16,384 output tokens. **Free tier: 10 requests/day per model** | Yes: `"stream": true`, `step.delta` events, raw L16 chunks | 30 prebuilt voices (auto language) + 40 vi-VN library voices (`vi-vn-advisor-1` … `vi-vn-tutor-8`) by id | 30 prebuilt (Kore, Puck, Charon, …) + library en-US voices | `https://generativelanguage.googleapis.com/*` (already the Gemini preset's) | Yes: `annotations: [{type:"speech_metadata", style}]` on the text item; inline `<laugh>`-style tags | **go** (played vi + en from the extension page) |
| **OpenAI-compatible** `/audio/speech` | `POST {base}/audio/speech`: `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, any gateway | `Authorization: Bearer <key>` | Raw audio bytes. OpenAI: `mp3` (default, `audio/mpeg`), `opus`, `aac`, `flac`, `wav`, `pcm` (s16le 24 kHz mono, no header). Gateways vary: OpenRouter's fish model takes only `mp3`/`pcm` | OpenAI 4,096 chars (API reference); gateways vary | OpenAI: chunked body (`stream_format: "audio"`), SSE (`"sse"`, per the API reference; not exercised) | OpenAI: none vi-specific, the 13 voices speak vi (Whisper language list includes vi) | `alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar` (marin/cedar best) | `https://api.openai.com/*`, `https://openrouter.ai/*`; a custom base asks for its origin at save time | `instructions` (gpt-4o-mini-tts only; gateways may ignore it) | **go** (shape played via OpenRouter from the extension page; OpenAI itself pending a key) |
| **Azure Speech** | `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` | `Ocp-Apim-Subscription-Key: <key>` (use this; it works on every endpoint form). Optional `issueToken` → `Authorization: Bearer` (10 min, host-scoped): not needed | Raw bytes per `X-Microsoft-OutputFormat`, e.g. `audio-24khz-48kbitrate-mono-mp3`, `riff-24khz-16bit-mono-pcm`, `raw-24khz-16bit-mono-pcm`, `ogg-24khz-16bit-mono-opus` | Audio ≤ 10 min per request (longer is cut); SSML body | Yes (chunked body for the "streaming" formats) | `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural` (+ multilingual voices) | `en-US-AvaMultilingualNeural`, `en-US-JennyNeural`, `en-US-AndrewMultilingualNeural`, … | `https://*.tts.speech.microsoft.com/*` (region in the host) | SSML `mstts:express-as` styles on voices that have a `StyleList`; no free-text prompt | **go-pending-key** |
| **ElevenLabs** | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`; streaming: `…/{voice_id}/stream` | `xi-api-key: <key>` | Raw bytes. `mp3_44100_128` (default), `mp3_22050_32` …, `pcm_16000`/`pcm_22050`/`pcm_24000` (s16le), `ulaw_8000`, `wav_*`; 44.1 kHz PCM/WAV and 192 kbps MP3 need paid tiers | `eleven_flash_v2_5` 40,000 chars; `eleven_v4` 10,000; `eleven_v3` 5,000 | Yes (`/stream`) | Any voice with a vi-capable model (`eleven_flash_v2_5`, `eleven_v4`, `eleven_v4_turbo`, `eleven_v3`) + `language_code: "vi"`; vi community voices via `/v1/shared-voices?language=vi` | Premade voices (e.g. `JBFqnCBsd6RMkjVDRZzb` George) | `https://api.elevenlabs.io/*` | v3/v4 inline audio tags (`[whispers]`); `previous_text`/`next_text` for continuity | **go-pending-key** |
| **Google Cloud TTS** | `POST https://texttospeech.googleapis.com/v1/text:synthesize` | `x-goog-api-key: <key>` (or `?key=`), a **standard** API key of a project with the API enabled. Not the new AI Studio (`AQ.`) Gemini key | JSON `audioContent` base64. `MP3`, `LINEAR16` (WAV header included), `OGG_OPUS`, `MULAW`, `ALAW`, `PCM` | 5,000 bytes of text (vi diacritics are 2–3 bytes each, so ~2,000 vi characters); Gemini-TTS: 4,000 B text + 4,000 B prompt | Yes, via `streamingSynthesize` (gRPC/stream); the REST adapter uses unary | `vi-VN-Chirp3-HD-*` (30), `vi-VN-Neural2-A/D`, `vi-VN-Wavenet-A…D`, `vi-VN-Standard-A…D` | `en-US-Chirp3-HD-*`, `en-US-Neural2-*`, `en-US-Studio-O`, … | `https://texttospeech.googleapis.com/*` | Only through Gemini-TTS models (`input.prompt` + `voice.model_name`); Chirp 3 HD has none | **go-pending-key** (at risk: a standard-key 200 is unproven; see Risks) |
| **Vbee** | Realtime: `POST https://api.vbee.vn/v1/tts` with `mode: "sync"` | `Authorization: Bearer <token>` **and** `App-Id: <app id>` (both from the Vbee console app; the token is a JWT whose expiry the user picks: 7–90 days, custom or never) | Streamed raw bytes: `mp3` (default), `wav`, `pcm`; `sampleRate` 8000–48000; `bitrate` 8–128 | Realtime **300 chars**; Batch 100,000 chars | Yes (Realtime streams chunks, TTFB ~0.5 s) | Realtime: 5 voices (HN Ngọc Huyền, SG Tường Vy, HN Mai Phương, SG Lan Trinh, SG Thảo Trinh), e.g. `hn_female_ngochuyen_full_48k-fhg` | None in Realtime. en-US voices exist only through Batch, whose `webhookUrl` is required | `https://api.vbee.vn/*` | No (speed, emphasis, pauses only) | **go-pending-key, vi only** (Realtime; en not offered) |
| **FPT.AI** | `POST https://api.fpt.ai/hmi/tts/v5`, text as the raw body; options in headers `voice`, `speed` (-3…3), `format` (`mp3`/`wav`) | `api_key: <key>` header | JSON `{"async": "<mp3 url>", "error": 0, "request_id"}`; the file appears at that URL after ~5 s–2 min | 5,000 chars (min 3) | No | `banmai`, `thuminh` (north, F), `leminh` (north, M), `myan` (central, F), `giahuy` (central, M), `lannhi`, `linhsan` (south, F) | None | `https://api.fpt.ai/*`; the `async` link's host is not documented (docs sample: an S3 bucket) | No | **go-pending-key, vi only** (poll the `async` link; `callback_url` is optional) |

No provider is dropped:

- **FPT.AI's async link is pollable.** `callback_url` is optional. Without it the response still carries the `async`
  URL, and the docs say the file appears there after a delay. The adapter retries loading it, so no callback server
  is needed. The link's host is undocumented, so load it in an `<audio>` element (a media load needs neither a host
  permission nor CORS) and retry on `error` with backoff up to ~2 min; don't `fetch` it.
- **Vbee needs no server for Vietnamese.** Realtime is synchronous. English would need Batch, whose `webhookUrl` is
  required. Polling `GET /v1/tts/requests/{id}` would work only with a placeholder webhook, which is unverified and
  not something to ship. So Vbee's en is out of scope rather than a drop.
- **No terms found forbidding a user's own key in a client.** The providers advise developers not to embed *their*
  keys in client code; BYOK keeps the user's key in the user's own browser profile. This was not an exhaustive legal
  read of each provider's terms.

### Adapter request shapes (phase 6)

- **Gemini.** `POST /v1beta/interactions`, body
  `{"model":"gemini-3.8-flash-tts","input":[{"type":"user_input","content":[{"type":"text","text":TEXT,"annotations":[{"type":"speech_metadata","style":NOTE}]}]}],"response_format":{"type":"audio"},"generation_config":{"speech_config":[{"voice":"Kore"}]}}`.
  - The audio is the last `steps[type=model_output].content[type=audio]`: `{mime_type, data}`.
  - Models: `gemini-3.8-flash-tts` (default) and `gemini-3.8-flash-lite-tts` (cheaper).
  - The context note goes in `style` and **never** in `text`, which is read verbatim.
  - Use `generateContent` (`contents[].parts[].text`, `generationConfig.responseModalities:["AUDIO"]`,
    `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`, audio at `candidates[0].content.parts[].inlineData`)
    only as a fallback. The guide documents Interactions.
- **OpenAI-compatible.** `POST {base}/audio/speech`, body
  `{"model":"gpt-4o-mini-tts","input":TEXT,"voice":"marin","instructions":NOTE,"response_format":"mp3"}`.
  - The response is raw `audio/mpeg`.
  - Send `instructions` only for `gpt-4o-mini-tts` (or let the user turn it off for gateways that reject unknown
    fields).
  - Default to `mp3`: some gateways reject `wav`.
- **Azure.** `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`.
  - Headers: `Ocp-Apim-Subscription-Key`, `Content-Type: application/ssml+xml`,
    `X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3`, `User-Agent`.
  - Body:
    `<speak version='1.0' xml:lang='vi-VN'><voice name='vi-VN-HoaiMyNeural'>ESCAPED_TEXT</voice></speak>`.
  - XML-escape the text.
- **ElevenLabs.** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`.
  - Header: `xi-api-key`.
  - Body: `{"text":TEXT,"model_id":"eleven_flash_v2_5","language_code":"vi"}`. Use `eleven_v4` for quality.
  - The response is raw MP3.
- **Google Cloud.** `POST https://texttospeech.googleapis.com/v1/text:synthesize`.
  - Header: `x-goog-api-key`.
  - Body:
    `{"input":{"text":TEXT},"voice":{"languageCode":"vi-VN","name":"vi-VN-Chirp3-HD-Kore"},"audioConfig":{"audioEncoding":"MP3"}}`.
  - Decode `audioContent` from base64.
  - Chunk by **bytes** (≤ 5,000 UTF-8 bytes), not by characters.
- **Vbee.** `POST https://api.vbee.vn/v1/tts`.
  - Headers: `Authorization: Bearer`, `App-Id`.
  - Body: `{"text":TEXT,"mode":"sync","voiceCode":"hn_female_ngochuyen_full_48k-fhg","outputFormat":"mp3"}`.
  - The response streams MP3.
  - Chunk text at ≤ 300 characters on sentence boundaries.
- **FPT.AI.** `POST https://api.fpt.ai/hmi/tts/v5`.
  - Headers: `api_key`, `voice: banmai`, `speed: 0`, `format: mp3`.
  - The body is the raw UTF-8 text.
  - Then load `json.async` in an `<audio>` element and retry until it plays.

### Error status → kind

The kinds are those of `src/llm/errors.ts`. Rows marked *(docs)* come from the provider's documentation and were not
observed in this spike.

| Provider | Status / signal | Kind |
|---|---|---|
| Gemini | 400 with `API_KEY_INVALID` / "API key not valid". On Interactions the body is a **JSON array** `[{"error":…}]`: unwrap `[0]` before reading `error.message` | auth |
| Gemini | 401 / 403 (`PERMISSION_DENIED`, `CREDENTIALS_MISSING`) | auth |
| Gemini | 429 whose message says "per day" (free tier, `retry-after` ≈ hours) | quota |
| Gemini | other 429 (`too_many_requests` / `RESOURCE_EXHAUSTED`) | rate_limit (`retry-after`) |
| Gemini | 400 `invalid_request` (unknown voice, unknown field) | bad_request |
| Gemini | 500 / 503 *(docs)* | overloaded |
| OpenAI-compatible | 401 (`invalid_api_key`, OpenRouter "Missing Authentication header"); 403 gateway "no access to model" (AIBOX) | auth |
| OpenAI-compatible | 402 (OpenRouter no credits); 429 `insufficient_quota` *(docs)* | quota |
| OpenAI-compatible | 429 otherwise *(docs)* | rate_limit |
| OpenAI-compatible | 400 unknown model, bad format, or input > 4,096 *(docs)* | bad_request |
| OpenAI-compatible | 404 unknown route (wrong base URL) | bad_request |
| OpenAI-compatible | 5xx | overloaded |
| OpenAI-compatible | Note: OpenAI's 401 is labelled `text/plain` but the body is JSON | — |
| Azure | 401 with an **empty body** (key or region wrong) | auth |
| Azure | 400 / 415 *(docs)* | bad_request |
| Azure | 429 *(docs: "exceeded the quota or rate")* | rate_limit; quota when the free tier's monthly allowance is used up, which needs a real key to tell apart (unverified) |
| Azure | 502 / 503 *(docs)* | overloaded |
| Azure | DNS failure of `{region}.tts…` | bad_request "check the region" (fetch rejects; treat it as `network` only when the browser is offline) |
| ElevenLabs | 401 `invalid_api_key` / `needs_authorization` | auth |
| ElevenLabs | 401 / 402 / 403 with `quota_exceeded` or similar *(docs)* | quota (match `detail.status` before falling back to auth) |
| ElevenLabs | 422 / 400 *(docs)* | bad_request |
| ElevenLabs | 429 `too_many_concurrent_requests` *(docs)* | rate_limit |
| ElevenLabs | 5xx | overloaded |
| Google Cloud | 400 `API_KEY_INVALID`; 401 `CREDENTIALS_MISSING` (wrong key type); 403 `SERVICE_DISABLED` / `PERMISSION_DENIED` *(docs)* | auth (tell the user to enable the API / use a standard key) |
| Google Cloud | 429 `RESOURCE_EXHAUSTED` *(docs)* | rate_limit |
| Google Cloud | 400 `INVALID_ARGUMENT` otherwise (input > 5,000 bytes, unknown voice) | bad_request |
| Google Cloud | 5xx | overloaded |
| Vbee | 401 (nginx HTML, or `UNAUTHORIZED` JSON; an expired JWT gives the same) | auth |
| Vbee | 400 `BAD_REQUEST` whose message mentions credit *(docs)* | quota |
| Vbee | other 400 (over 300 chars, unknown `voiceCode`) *(docs)* | bad_request |
| Vbee | 429 `TTS_CCR_MAX_LIMIT_REACHED` *(docs)* | rate_limit |
| Vbee | 500 `TTS_SPEND_CREDITS_FAILED` *(docs)* | quota |
| Vbee | other 500 *(docs)* | overloaded |
| FPT.AI | 401 "Invalid authentication credentials" / "No API key found in request" | auth |
| FPT.AI | 200 with `error != 0` | bad_request, or quota if the message mentions balance or limit *(docs: the codes are not listed)* |
| FPT.AI | 429 *(gateway; docs)* | rate_limit |
| FPT.AI | `async` link still failing after ~2 min of retries | network |
| All | `fetch` rejects (offline, DNS) | network |

### Voices-list endpoint per provider

| Provider | Endpoint | Notes |
|---|---|---|
| Gemini | `GET https://generativelanguage.googleapis.com/v1beta/voices?language_code=vi-VN&page_size=50` (`x-goog-api-key`) | Returns `{voices:[{id, display_name, language_code, gender, pitch, persona, description}]}`. `language_code` must be the full tag (`vi` returns `{}`). Ids are usable as `speech_config[].voice`. |
| OpenAI | none | Fixed list (above). OpenRouter: `GET /api/v1/models?output_modalities=speech` lists speech models (no auth needed). |
| Azure | `GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list` (key header) | Filter `Locale` = `vi-VN` / `en-US`; `ShortName` is the SSML voice name; `StyleList` gives the styles. |
| ElevenLabs | `GET https://api.elevenlabs.io/v2/voices` (the account's voices); `GET /v1/shared-voices?language=vi` (the library); `GET /v1/models` (models with `languages`) | All need `xi-api-key`. |
| Google Cloud | `GET https://texttospeech.googleapis.com/v1/voices?languageCode=vi-VN` | `voices[].name`, `ssmlGender`, `naturalSampleRateHertz`. |
| Vbee | `GET https://api.vbee.vn/v1/voices?language_code=vi-VN&limit=100` (`Authorization` + `App-Id`) | The path isn't printed in the docs (the URL field is empty); it answered 401, not 404, so the route exists. `result.voices[].code` is the `voiceCode`. Realtime accepts only the 5 voices above. |
| FPT.AI | none | Fixed list (above). |

## Risks and open items

- **Gemini's free tier allows 10 TTS requests a day per model.** This is the one that matters most for the
  feature. A reader that sends one request per block runs out within one page.
  - Phase 6 must send several blocks per request, up to the 8k-token input. A long section then becomes one audio
    file, played and highlighted per block from the order and offsets of the text.
  - Phase 6 must map the per-day 429 to `quota` with a clear "free tier used up, try tomorrow or add billing"
    message.
  - The status as a "go" is unchanged: paid keys have normal limits.
- **Google Cloud standard API keys are unproven.** The new AI Studio key (`AQ.`) is rejected (401
  `CREDENTIALS_MISSING`). So Cloud TTS needs its own standard key from a project with billing and the API enabled.
  - If the owner's real standard key also gets `CREDENTIALS_MISSING`, Cloud TTS would need a service-account JWT
    signed in the extension (WebCrypto RS256 → `oauth2.googleapis.com/token`). That is possible without a backend,
    but it is heavy and means storing a private key.
  - In that case, ship Google Cloud last or defer it. Gemini TTS already covers the same Chirp 3 HD voice names.
- **Real-key playback is pending** for OpenAI, Azure, ElevenLabs, Google Cloud, Vbee and FPT.AI. The owner adds the
  keys named in `spikes/s11/README.md` and reruns each probe.
- **Language coverage.** Vietnamese quality on OpenAI and ElevenLabs is unverified, which needs a listening test.
  Vbee and FPT.AI read vi only. The UI should offer them for vi-VN only.
- **FPT.AI's `async` host is undocumented.** Loading it in `<audio>` avoids the need for a host permission. Confirm
  this with a real key.
- **Sample rates.** The decoded `sampleRate` in `results/extension.json` (48000) is the AudioContext's output rate.
  The source rates are those in the table.

## Consequences for phase 6

- Ship adapters for all seven providers, in this order: Gemini, OpenAI-compatible (covers OpenAI, OpenRouter and
  other gateways), Azure, ElevenLabs, Google Cloud, Vbee (vi), FPT.AI (vi).
- The host permissions to request are listed in the table. Request them as optional permissions when the provider is
  saved. A custom OpenAI-compatible base asks for its own origin.
- The adapter tests use `spikes/s11/recorded/*.json` as their fixtures.
