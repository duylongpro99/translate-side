# Spike S10 report: Piper vi/en without espeak-ng

Record: `docs/decisions/S10-piper-vi-g2p.md` · Code: `spikes/s10/` · Date: 2026-10-26

## Verdict

**GO on every measured gate.** It holds on two conditions, and the owner has one licence question to settle.

| Gate | Result |
|---|---|
| ≥ 98 % syllables match the oracle | 99.81 % on held-out text, 99.73 % on the tuning set. Vietnamese syllables alone: 99.95–99.98 %. Tone digit correct: 99.95–100 %. |
| Listening ≤ 0.3 below the oracle | **The owner still has to score it.** As a stand-in, Gemini transcribed the audio (ASR proxy). vi word error rate 0.4 % for ours vs 0 % for the oracle, tone accuracy 100 % for both. en 0 % vs 0 %. |
| First audio ≤ 1.5 s | Pass when the voice is already loaded: 0.78 s vi / 0.90 s en on 1 thread, 0.26 / 0.29 s on 4 threads. **Cold start on 1 thread is about 2.0 s, which fails.** Cold start on 4 threads is 1.24–1.36 s. |
| WASM + JS ≤ 6 MB gzip | 4.70 MB: ORT WASM 3.69 MB, English lexicon 0.99 MB, the rest. |

Real-time factor: 0.16 on 1 thread, 0.05 on 4 threads (M1 Pro, Chrome for Testing 156, extension page with CSP `'self' 'wasm-unsafe-eval'`, voice loaded from the Cache API).

## Pinned

- `rhasspy/piper-voices` @ `5041a7a49ae5b3a0f30e6837769eb03fdbb231bd`.
- vi `.onnx`: 63,201,294 B, sha256 `ec7c89e2…2dab`. Its config has `espeak.voice` = `vi` and 154 symbols, with tones written as digits.
- en: `en_US-ljspeech-medium`. Public-domain data, trained from scratch, no NC/SA terms. `.onnx` is 63,531,379 B, sha256 `6f52a751…7f22`. Its `espeak.voice` is `en`, not `en-us`. Full hashes are in the record.

## Decisions for phase 8

- **vi G2P:** move `spikes/s10/g2p-vi.ts` unchanged to `src/tts/piper/g2p-vi.ts`. It is pure TypeScript with no dependencies. Call `phonemize(text, { foreign: (w) => phonemizeEn(w, 'en').join(' ') })` to get one IPA string per sentence, then `phonemeIds(ipa, config.phoneme_id_map)` for each.
- **en G2P:** `phonemize` **2.0.1** (npm, MIT) with our adapter `spikes/s10/g2p-en.ts`. Call `phonemizeEn(text, 'en'): string[]`.
  - Bundle it with `anyascii.json` stubbed and `charset: 'utf8'`.
  - `@piper-plus/g2p` 0.4.2 is **rejected**. Its phoneme error rate is 45.6 %, against 13.1 % for ours, and it drops digits.
- **ORT:** `onnxruntime-web/wasm` 1.30.0, with `ort-wasm-simd-threaded.{wasm,mjs}` shipped in the package.
- **Conditions:**
  1. Create the session ahead of time (when the voice is selected or the panel opens) and synthesize the first clause first. Optionally set COOP/COEP to get 4 threads.
  2. The owner listens and scores the blind WAVs in `.cache/s10/listen/` (`scores.csv`, `key.json`).

## Open questions for the owner

1. **Licence:** the vi `vais1000` model card says it was fine-tuned from `lessac`, whose data is under the Blizzard 2013 research licence. Is that acceptable? No other medium vi voice exists.
2. **Listening:** a human 1–5 score is pending. Regenerate the files with the commands in the README.

## Notes

- Use `piper_phonemize` 1.1.0 as the oracle. It is the phonemizer the voices were trained with, and it matches `piper-tts` 1.8.0 on all 420 sentences. Homebrew's espeak-ng CLI is the wrong oracle: it adds tone digits the voice never saw.
- The Gemini free tier allows about 20 requests per model per day, so ASR requests are batched per system. `gemini-3.5-transcribe` returned empty text, so `gemini-3-flash-preview` did the transcription.
- espeak-ng is used only inside `.cache/s10` virtualenvs. Nothing GPL is in `spikes/s10`, any `package.json`, or the page. The generated `ext/bench.js` and `ext/ort/` are git-ignored (`spikes/s10/.gitignore`).

Status: DONE_WITH_CONCERNS
