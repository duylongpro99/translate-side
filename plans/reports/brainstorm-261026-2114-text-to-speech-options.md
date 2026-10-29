# Text-to-speech for original and translated text — options

Date: 2026-10-26. Status: exploration; no decision taken yet.

## Contract

- **Outcome:** the reader can have the original text or its translation read aloud, in Vietnamese and English at least, from the side panel (and later the selection popover).
- **Constraints:** MV3 extension, Chrome ≥ 138. There is no hosted backend; users bring their own keys (BYOK). Text leaves the device only as `docs/privacy.md` describes. No shipped v1 feature moves behind Pro. The bundle is checked by `check:bundle`, and the manifest by `check:manifest`.
- **Non-goals:** voice cloning, exporting audio files, speech-to-text, and a hosted TTS proxy.
- **Acceptance criteria:** a block (original or translated) plays in vi-VN and en-US. The reader can stop it, and it shows which block is playing. With no key at all, it falls back to a voice on the device. The privacy page names any new destination for text.

## Evidence

- The repo has no TTS code today. Providers are OpenAI-compatible endpoints, Gemini (through its OpenAI endpoint), and Anthropic (`src/llm/presets.ts`).
- This Mac already has a Vietnamese system voice, `Linh (vi_VN)`, as `say -v '?'` shows. Chrome on macOS exposes system voices to `speechSynthesis` and `chrome.tts`.
- `chrome.tts` needs the `tts` permission. `getVoices()` returns `lang` and `remote`, and word-boundary events (`charIndex`) are available, which allows highlighting the word being read.
- Chrome's own "Google …" network voices on desktop do not appear to include Vietnamese. This is not confirmed; on Windows a vi-VN voice exists only when the language pack is installed. Coverage varies by OS.
- Gemini TTS (`gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`) lists Vietnamese as supported. It returns 24 kHz PCM/WAV and is billed per token (about $0.50 per 1M input tokens and $9 per 1M output audio tokens until 2026-12-31, per a third-party source; check the official pricing page). It can reuse a Gemini key the user already has.
- Azure Neural TTS has `vi-VN-HoaiMyNeural` and `vi-VN-NamMinhNeural`, with 0.5M free characters a month. The paid rate is about $15 per 1M characters (third-party figure). It needs a separate Azure key and region.
- Google Cloud TTS has vi-VN Standard, WaveNet, Neural2 and Chirp 3 HD voices. The prices in this report come from memory and are not verified.
- OpenAI `gpt-4o-mini-tts` costs about $0.015 a minute. Vietnamese is not documented; its Vietnamese would need a listening test.
- On-device neural: Piper `vi_VN-vais1000-medium` is about 63 MB, MIT licensed, and runs in the browser through `piper-tts-web` (ONNX Runtime WASM). Kokoro has no Vietnamese.

## Options

1. **System voices through `chrome.tts` / `speechSynthesis`.** Free, works offline, needs no key, sends no text anywhere, and supports word highlighting.
   - Depends most on: the user's OS having a vi-VN voice.
   - Fails first: on Windows without the Vietnamese language pack, and on some Linux setups. The voice quality is "robotic but clear".
2. **Built-in plus BYOK cloud voice (Gemini TTS first, Azure as an option).** Natural Vietnamese and English. Gemini reuses an existing key and its existing optional host permission.
   - Depends most on: the user having a key, and Gemini's TTS models staying stable. Model names have changed several times, and a preview is due to retire.
   - Fails first: cost and latency on long pages (the audio is fetched per block), plus a new privacy line. There are no word-boundary events, so highlighting works only per block.
3. **Bundled or downloaded Piper voice (on device).** Better than most system voices, offline, and no key.
   - Depends most on: a one-time download of about 63 MB per voice, and WASM performance in the side panel.
   - Fails first: the download size, voice quality below cloud voices, one voice per language, and an English voice adds another download.

## Recommendation

Start with **option 1** as the zero-setup default. It matches the project's "Chrome built-in, zero setup" direction, costs nothing, and is quick to build. Then add **Gemini TTS as an opt-in "natural voice"** for users who have a Gemini key, with Azure as a second adapter only if users ask for it. Leave Piper out unless real users report missing vi-VN system voices. It is the most expensive option to build and to abandon.

Better approaches: none. The recommended direction stays within the requested scope (vi and en voices). The layering mirrors the existing on-device → provider fallback in `src/llm/on-device.ts`.

## Revision 2026-10-26 21:23 — the requirement is natural intonation and context, not just a voice

The user clarified that reading aloud is not enough: the voice must use the right intonation (Vietnamese tones, sentence
melody, emphasis) and fit the context (a question, a joke, a warning, a quote, a code term inside Vietnamese prose).
That changes the recommendation above.

- **System voices drop to a fallback only.** They read word by word with fixed prosody. They know nothing about the
  passage, and macOS `Linh` is the older concatenative kind. They stay only as the "no key, offline" path.
- **Context needs an LLM-based voice that can be told about the passage.** The candidates are:
  - **Gemini TTS:** style, pace, tone and emotion are steered with natural-language prompts. A prompt can carry scene
    and director's notes, and inline tags can change tone mid-sentence. Vietnamese is listed as supported. One source
    warns that some voice and language pairs sound accented.
  - **OpenAI `gpt-4o-mini-tts`:** has an `instructions` field for tone. Its Vietnamese is undocumented.
  - **Azure DragonHD and HD Omni:** use a language model to infer context and emotion from the text itself. Whether
    there is a Vietnamese HD voice is not confirmed.
  - **ElevenLabs v3 and v4:** inline audio tags such as `[whispers]` and over 70 languages. Vietnamese is not confirmed.
    v3 is high latency and v4 is now recommended.
  - **Vietnamese vendors (Vbee, FPT.AI):** strong regional accents and adjustable intonation, but the claims come from
    the vendors. They do not take a context prompt.
- **The extension already has the context.** The translation job knows the page, the neighbouring blocks and the tone
  (`natural` style). A small LLM step before the voice can do two things:
  1. Make the text speakable: numbers, dates, units and abbreviations; English terms inside Vietnamese text; heteronyms
     in English.
  2. Write a short delivery note for the voice, such as "a technical blog, calm and explanatory; the last sentence is a
     dry joke".
- **No independent Vietnamese prosody benchmark was found.** The choice therefore has to rest on our own blind listening
  test, the same way translation quality rests on the eval set. Use a fixed set of about 15 passages: tonal minimal
  pairs, questions, dialogue, humour, technical text with English terms, numbers and dates, and long-form text. Run each
  passage through each candidate, with and without the context note. Score naturalness, tones, emphasis and
  pronunciation of terms on a 1–5 scale, blind.

**Revised recommendation:** make **Gemini TTS with a context note** the leading candidate. It reuses the user's Gemini
key, accepts a context prompt, and lists Vietnamese. Do not commit until a blind listening bake-off against Azure HD,
OpenAI `gpt-4o-mini-tts`, ElevenLabs and one Vietnamese vendor confirms it on Vietnamese. Keep the system voice as the
no-key fallback.

## User decision 2026-10-26 21:30 — the natural voice is free, and the user brings the provider

The natural (cloud) voice is a **free** feature, not Pro. The user configures their own TTS provider and key, as they do
for translation. Consequences:

- The TTS provider is its own setting, separate from the translation provider. It can default to the translation
  connection when that connection can speak (for example, a Gemini key).
- No single vendor is "the" choice. The bake-off decides the recommended default and the order of presets. Every
  supported adapter stays selectable.
- Suggested adapters, smallest set first:
  1. Gemini TTS, which takes the context note.
  2. OpenAI-compatible `/v1/audio/speech`, which covers OpenAI `gpt-4o-mini-tts` (`instructions` field) and the gateways
     that copy its shape.
  3. Azure Speech (key and region; SSML).
  4. ElevenLabs.
  - Vietnamese vendors (Vbee, FPT.AI) only if the bake-off shows they win on Vietnamese.
- The system voice remains the default when no TTS provider is set.

## User decision 2026-10-26 21:35 — many providers; the user picks one and adds a key

We ship a range of TTS providers. The user picks one, adds their key, and picks a voice. The blind listening test no
longer gates delivery. It is optional and only orders the presets or chooses a recommended badge.

Final contract:

- **Outcome:** the reader can play the original or the translated text aloud, in vi-VN and en-US. The default is the
  system voice. A configured TTS provider gives a natural voice that receives a context note and text made speakable.
- **Provider set:**
  - Gemini TTS
  - OpenAI-compatible `/v1/audio/speech` (OpenAI and the gateways that copy it)
  - Azure Speech
  - ElevenLabs
  - Google Cloud TTS
  - Vbee and FPT.AI (Vietnamese vendors)
  - The system voice (`chrome.tts`) as the no-key default
- **Per provider:** a key field (Azure also needs a region), a voice picker filtered by language, and a test button.
  Optional host permission is asked for that provider's origin only.
- **Constraints:** free (never gated by `featureAvailable`), BYOK, and no backend. The privacy page names each TTS
  destination. The TTS setting is independent of the translation provider.
- **Non-goals:** voice cloning, exporting audio files, speech-to-text, and a hosted proxy.
- **Acceptance criteria:**
  - Each provider plays a vi-VN passage and an en-US passage, checked through its test button with a real key.
  - Playback can be stopped, and the block being read is shown.
  - With no provider configured, the system voice plays.
  - Providers that accept a context note (Gemini, OpenAI `instructions`) receive it.
  - The `check` gate passes.

## Can the default be free, need no setup, and sound natural? (2026-10-26 21:40)

Short answer: free and no setup, yes. Free, no setup and context-aware all at once, not within "no backend".

| Candidate | Free · no setup | Natural · context | Verdict |
|---|---|---|---|
| System voice (`chrome.tts`) | Yes | No: fixed prosody. vi-VN only where the OS has it (macOS `Linh`; Windows with the language pack) | **Default** |
| Chrome's built-in AI | Yes | There is no speech-output API. Nano returns text only | Can only prepare the text |
| On-device Piper `vi_VN-vais1000` (MIT, about 63 MB, ONNX WASM) | Free, one-click download, no key | Better than the system voice. No context note | Optional "offline natural voice" |
| VieNeu-TTS (Apache 2.0 per third parties, CPU via GGUF/ONNX) | Free | Natural Vietnamese | No browser build; about 7 s per generation on CPU. Not now |
| Edge's online voices from Chrome (`edge-tts`) | Free | Natural, vi-VN HoaiMy and NamMinh | **Rejected:** an unofficial, reverse-engineered endpoint. It breaks without notice and puts the store listing at risk |
| A hosted free tier that we pay for | Free for the user | Natural | **Rejected:** contradicts "no backend", and the cost grows with use |

Proposal: the system voice stays the zero-setup default. Make it read better with what Chrome already has:

- Split the text by sentence and clause, with short pauses.
- Pick the vi or en voice per block.
- Use Chrome's on-device Prompt API, where present, to make numbers, abbreviations and English terms speakable.
- Optionally, offer the Piper voice as a one-click download. Context-aware intonation stays with the BYOK providers.

## User decision 2026-10-26 21:30 — ship the Piper offline voice in the first release

The Piper on-device voice is in scope. It is a one-click download, needs no key, and covers vi-VN and en-US. Three
constraints were found that the plan must handle first:

1. **Licence (highest risk).** The voice models are MIT (vi `vais1000`; check the English voice chosen, since Piper
   voices vary and some are CC BY-NC-SA). But the browser runtime `piper-tts-web` phonemizes with **espeak-ng, which is
   GPL-3.0**. This repo is MIT. Shipping a GPL WASM inside the extension is a licensing conflict.
   - `piper-plus` claims to be all-MIT with no espeak-ng, but it lists no Vietnamese support.
   - Options to decide in a spike:
     a. Write our own rule-based Vietnamese G2P that emits the espeak-ng phoneme IDs the `vais1000` model expects.
        Vietnamese spelling is close to phonemic, so this is feasible. Use the MIT `piper-plus` G2P for English.
     b. Accept GPL for the voice module. This needs the owner's licensing decision.
2. **MV3 remote-code rule.** The WASM and JS (onnxruntime-web, the phonemizer) must ship inside the extension. Only the
   model weights (`.onnx` plus `.json`) may be downloaded, then cached in IndexedDB or the Cache API. The manifest needs
   `wasm-unsafe-eval` in the extension pages' CSP.
3. **Bundle budget.** The onnxruntime-web WASM (a few MB) grows `scripts/bundle-budget.json`. Load it lazily, only when
   the Piper voice is chosen. The download source for the model (Hugging Face `rhasspy/piper-voices`, pinned by revision
   and checked against a SHA-256) goes on the privacy page as a destination.

## User decision 2026-10-26 21:35 — licence option (a)

The repo stays MIT. No espeak-ng (GPL) is shipped. We write our own rule-based Vietnamese G2P that emits the phoneme
IDs the `vais1000` model expects, and use the MIT `piper-plus` G2P for English. The English voice must have an MIT or
other commercial-friendly licence. A spike must first prove that our G2P output matches espeak-ng's phonemes for the
model, and that it sounds right on a test set. If the spike fails, return to the owner; do not fall back to GPL
silently.

## Unresolved questions

1. ~~Free or Pro?~~ Settled: free, with the user's own provider (see the user decision above).
2. Read per block, or a continuous "read the whole page" mode with auto-scroll?
3. Should the text be read from the side panel only, or also from the selection popover in the first cut?
4. On Windows, the vi-VN voice should be checked with `speechSynthesis.getVoices()` before relying on option 1 there.
