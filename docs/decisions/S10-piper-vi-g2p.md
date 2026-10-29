# S10 — Piper Vietnamese (and English) without espeak-ng

Status: **GO on the measured gates, with two conditions and one licence question for the owner** (below). The human
listening score is **pending the owner**; an automatic intelligibility proxy stands in for it. · Date: 2026-10-26 ·
Measured on an Apple M1 Pro (10 cores, 16 GB), macOS 26.6.2, Playwright's Chrome for Testing 156.0.8078.4 (headless),
`onnxruntime-web` 1.30.0 · Spike code: `spikes/s10/` · Plan:
`plans/261026-1433-text-to-speech/phase-01-spike-piper-vi-g2p.md` · Background:
`plans/reports/brainstorm-261026-2114-text-to-speech-options.md`

## Question

Can the extension run Piper `vi_VN-vais1000-medium` and an English voice in an extension page, with our own MIT G2P
instead of espeak-ng (GPL-3.0), at acceptable quality and speed?

| Gate (phase 1) | Threshold | Measured | Verdict |
|---|---|---|---|
| Syllables matching the oracle | ≥ 98 % | **99.81 %** held-out, 99.73 % tuning set (99.95–99.98 % of Vietnamese syllables) | **Pass** |
| Listening score vs oracle | ≤ 0.3 below | Human score **pending the owner**. ASR proxy: vi WER 0.4 % (ours) vs 0 % (oracle), tone accuracy 100 % both; en WER 0 % vs 0 % | **Proxy pass**, human pending |
| First audio, ~200-character block | ≤ 1.5 s | 0.26–0.90 s with the voice loaded; 1.24–1.36 s cold with 4 threads; **~2.0 s cold single-threaded** | **Pass with a condition** (preload or threads) |
| WASM + JS added (gzip) | ≤ 6 MB | **4.70 MB** (ORT 3.70 MB + English lexicon 0.99 MB + the rest) | **Pass** |

## Pinned voice files

Source: Hugging Face `rhasspy/piper-voices` (repo licence MIT), revision
**`5041a7a49ae5b3a0f30e6837769eb03fdbb231bd`** (last modified 2026-10-20). URL pattern:
`https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/<path>`. The LFS SHA-256
from the Hub API matches the downloaded files.

| Path | Bytes | SHA-256 |
|---|---|---|
| `vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx` | 63,201,294 | `ec7c89e2c85f4d1edc24b6120c18aaf1bda614f06b511567eb9c7c0de15e2dab` |
| `vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json` | 4,860 | `fafb9da1354ed4b77c31af228ed41fb41cd825c14cffa105454b25e6ae751ee0` |
| `en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx` | 63,531,379 | `6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22` |
| `en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json` | 4,972 | `141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860` |

What the vi config says:

- `espeak.voice` = **`vi`**; `piper_version` 1.0.0; 22,050 Hz; one speaker; inference `noise_scale` 0.667,
  `length_scale` 1, `noise_w` 0.8.
- `phoneme_id_map` has 154 symbols (`num_symbols` 256): Piper's standard espeak map. Pad `_`=0, BOS `^`=1, EOS `$`=2,
  space 3, punctuation `! ' ( ) , - . : ; ?`, IPA letters, `ˈ`=120, `ˌ`=121, `ː`=122, the combining marks (e.g. `̪`
  U+032A = 142), and the digits `0`–`9` = 130–139, which carry the Vietnamese tones.
- The English map is the same with three extra symbols (`g`, `ʦ`, `X`); no id differs, so one encoder serves both.
- Every symbol our G2P emitted on the 420 test sentences is in the map (none dropped).

## Method

- **Oracle** (dev time only, never shipped): `piper_phonemize` **1.1.0**, the phonemizer the voices were trained with
  (espeak-ng inside, GPL). It has only an x86_64 wheel on macOS, so it runs under Rosetta in `.cache/s10/old-venv`.
  Cross-check: `piper-tts` 1.8.0 (`espeakbridge`, the current Piper runtime) gives **identical** output on all
  420 sentences. Homebrew's espeak-ng 1.52.0 CLI does **not** (it prints `1` on level tones and other digits the voice
  never saw), so it is not a valid oracle.
- **Corpus**: 300 sentences written by Gemini in 5 groups of 50–70 (tones incl. minimal pairs and checked syllables;
  vowel clusters; every onset and final incl. `gi`, `qu`, `ngh`, `khuỷu`; everyday prose; numbers as digits), then
  **120 held-out sentences** (news with names and places; web prose) generated after the rules were final. Numbers are
  expanded to words by our expander before the oracle runs (`spikes/s10/oracle*.json` keep text, expanded text and
  phonemes).
- **Metric**: our syllables and the oracle's (space-split, punctuation removed) are aligned by edit distance; a
  syllable counts only if the whole string matches, stress mark and tone digit included.
- **Inference**: an unpacked MV3 extension page (`spikes/s10/ext/`), CSP
  `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`, `onnxruntime-web/wasm` bundled with the page and its WASM
  copied into the extension (no remote code). The `.onnx` is fetched once from a local server standing in for Hugging
  Face, stored in the Cache API, and every session is created from the Cache API copy. Playwright drives it.
- **200-character blocks**: vi 178 characters, 2 sentences; en 195 characters, 2 sentences (typical article prose,
  `scripts/bench.mjs`). Time to first audio = from the call to the start of playback of the first chunk (G2P + first
  inference + `AudioBufferSourceNode.start`). Five warm runs, median. RTF = inference time / audio duration.

## G2P approach (`spikes/s10/g2p-vi.ts`)

Pure TypeScript, no dependencies, 4.8 KB minified (2.3 KB gzip). Written from Vietnamese spelling rules; espeak-ng was
consulted only as a black box (its outputs for probe words and the corpus), and no espeak-ng code or data file was
read or copied.

1. **Normalise**: NFC; numbers → words (Northern: `nghìn`, `linh`, `mốt`, `tư`, `lăm`; `2.500.000` thousands, `3,14` →
   `phẩy`, `1.5` → `chấm`; `%` → `phần trăm`).
2. **Syllable parse**: strip the tone mark (NFD: grave, acute, hook, tilde, dot below) → onset (longest match: `ngh ng gh
   kh nh ph th tr ch` …, `gi`+vowel = `z`, `qu` = `k`+glide) → glide (`o` before `a ă e`, `u` before `ê y â ơ`) →
   nucleus (diphthongs `iê/yê/ia/ya`, `uô/ua`, `ươ/ưa` first) → coda (`m n ng nh p t c ch i y o u`, and `k` in place
   names like Đắk Lắk).
3. **Emit espeak-ng's conventions**: onset + `w` + stress + nucleus + tone + coda. Tones: huyền `2`, sắc `ɜ`, hỏi `4`,
   ngã `5`, nặng `6`, ngang nothing. Quirks reproduced because the voice was trained on them: `ây` is one unit `əɪ`
   with the tone after it; level-tone `âu`/`êu` carry `1`; `anh/ach` → `e-ɲ`/`e-c`; final `c` → `k` after `o/ô`, else
   `c`; `ưu` → `iw`; `quô` → `k`+`uə`; `t` → `t̪`, `d/gi/r` → `z`, `x` → `s`, `tr/ch` → `tʃ`.
4. **Stress**: `ˈ` before the nucleus; `ˌ` for 39 function words that espeak-ng reads unstressed (`và là của các những
   được cho với không đã sẽ đang thì mà để từ khi như nhưng vì nên bị đến mọi nếu chưa mỗi phải dù hoặc bởi tới vẫn còn
   lúc con cái khoảng chẳng`).
5. **Sentences**: split after `. ? !`; `, : ;` are kept and followed by a space, as Piper's phonemizer does.
6. **Non-Vietnamese words** (`internet`, `vitamin`): espeak-ng switches to English for them. `phonemize(text, {
   foreign })` takes the English G2P for that; without it a rough built-in reading splits the word into Vietnamese-like
   syllables.

API for phase 8 (moves unchanged to `src/tts/piper/g2p-vi.ts`):

```ts
phonemize(text: string, opts?: { foreign?: (word: string) => string | null }): string[] // one IPA string per sentence
phonemeIds(ipa: string, idMap: Record<string, number[]>): number[] // ^ _ (id _)* $, codepoints after NFD
expandNumbers(text: string): string
syllableToIpa(syllable: string): string | null
phonemizeWords(text, opts?): Token[] // per-word detail
```

## Match rate (`spikes/s10/results/g2p-match*.json`)

| Set | Syllables | Exact match | Vietnamese syllables only | Tone digit right | Whole sentence identical |
|---|---|---|---|---|---|
| Tuning (300 sentences) | 4,090 | **99.73 %** | 99.98 % (4,080) | 99.95 % | 96.3 % |
| Held-out (120 sentences) | 2,160 | **99.81 %** | 99.95 % (2,157) | 100 % | 97.5 % |
| Tuning, English words through `g2p-en.ts` | 4,090 | 99.88 % | 99.98 % | — | — |
| Held-out, English words through `g2p-en.ts` | 2,160 | 99.86 % | 99.95 % | — | — |

Every remaining miss on Vietnamese words is an espeak-ng oddity we chose not to copy: `họa` (old-style tone placement)
→ `hˈoaː6` instead of `hwˈaː6`, and `Đoòng` → `ɗwˈɔ2ŋ`. The rest are loanwords and units (`kilomet`, `picnic`,
`vitamin`, `yoga`, `kg`), which espeak-ng reads with its English voice. Units like `kg` belong to the speakable-text
step (phase 3/7), not the G2P.

## English voice and English G2P

**Voice: `en_US-ljspeech-medium`** — dataset LJ Speech, **public domain**; trained **from scratch** (model card); the
repo is MIT. No NC/SA terms. Candidates reviewed (model cards at the pinned revision):

| Licence | Voices |
|---|---|
| Rejected, NC/SA | `hfc_female`, `hfc_male`, `ryan` (CC BY-NC-SA 4.0), `l2arctic` (CC BY-NC 4.0) |
| Unclear ("see URL"/"see LICENSE") | `amy`, `kusal`, `arctic` |
| Lessac research licence (Blizzard 2013) | `lessac` |
| PD / CC0 / CC-BY / Apache, but **fine-tuned from `lessac`** | `joe`, `mike`, `reza_ibrahim` (CC0), `libritts_r` (CC BY 4.0), `sam` (Apache-2.0) |
| PD, not from `lessac` | **`ljspeech`**, `kristin`, `norman` (from scratch), `john` (from `kristin`), `bryce` |

Its config says `espeak.voice` = **`en`** (espeak's British English phoneme set, non-rhotic), not `en-us`, so the English
G2P must emit that set.

**English G2P: `piper-plus` is rejected.** `@piper-plus/g2p` 0.4.2 (MIT) emits espeak-style IPA, but it is a small
built-in dictionary with letter-by-letter fallback: phoneme error rate (PER) against espeak-ng is **45.6 %** (`canoe`
→ `kˈænˈɑˈɛ`, `photosynthesis` → `fˈɑtˈɑsjnθˈɛsˈɪs`), and it drops digits.

**Chosen: `phonemize` 2.0.1 (npm, MIT, github.com/hans00/phonemize)** + our adapter `spikes/s10/g2p-en.ts` (MIT). It has a
125k-word lexicon, rules for unknown words, and number reading; deps `number-to-words` (MIT) and `pinyin-pro` (MIT, not
bundled for English). The adapter rewrites its dictionary-style IPA into espeak-ng conventions (stress before the
vowel, `ɫ`→`l`, `oʊ`→`əʊ`, `æ`→`a`, non-rhotic `ɑː ɔː eə ɪə ʊə`, `ɪŋk`, `-ɪz`, stressed monosyllables, `ðɪ` before vowels).

| English G2P vs espeak-ng (130 sentences, `results/en-g2p.json`) | PER, target `en` | PER, target `en-us` |
|---|---|---|
| `@piper-plus/g2p` 0.4.2, raw | 45.6 % | 42.4 % |
| `phonemize` 2.0.1 + `g2p-en.ts` | **13.1 %** | 16.9 % |

The remaining 13 % is mostly lexicon and accent differences (`ˈamfɪθˌiːeɪtə` vs `əmfɪðˈiːtə`), not broken words.
Phase 8 API: `phonemizeEn(text: string, variant: 'en' | 'en-us' = 'en'): string[]` (one IPA string per sentence, then
`phonemeIds`). Bundling: alias `phonemize`'s `anyascii.json` (870 KB, only for its opt-in transliteration) to `{}` and
emit UTF-8 (`charset: 'utf8'`), as `spikes/s10/build.mjs` does.

## Intelligibility (ASR proxy)

The owner has not listened yet: **the human 1–5 score is pending the owner** (files and score sheet below). As a stand-in,
each listening sentence was synthesized from our phonemes and from the oracle's, and every WAV was transcribed twice by
Gemini (`gemini-3-flash-preview`, audio input, batched per system so two readings of one sentence never share a
request). Lower is better; tone accuracy = of the syllables heard with the right letters, the share with the right tone.

| Set (`results/asr-proxy.json`) | System | Transcriptions | WER | CER | Tone accuracy |
|---|---|---|---|---|---|
| vi, 15 sentences | **our G2P** | 30 | **0.4 %** | 0.07 % | **100 %** |
| vi, 15 sentences | espeak-ng oracle | 30 | 0 % | 0 % | 100 % |
| en, 10 Harvard sentences | **our G2P (`phonemize` + adapter)** | 20 | **0 %** | 0 % | — |
| en, 10 Harvard sentences | espeak-ng oracle | 20 | 0 % | 0 % | — |
| en, 10 Harvard sentences | `piper-plus` raw | 20 | 11.3 % | 4.4 % | — |

- The only vi error is one word on both runs of `vi-15`: `gam` heard as `gram`, a spelling variant of the same unit,
  not a mispronounced syllable. In effect our vi audio and the oracle's transcribe identically.
- `piper-plus` raw loses words the ASR can still hear on 4 of 20 transcriptions, which confirms its rejection.
- Limits of the proxy: a strong ASR with a language model repairs mild mispronunciations, so it measures
  intelligibility, not naturalness or tone quality. It cannot replace the owner's 1–5 score.

## Speed (`spikes/s10/results/bench.json`)

| | vi, 1 thread | en, 1 thread | vi, 4 threads | en, 4 threads |
|---|---|---|---|---|
| Session create from the Cache API (63 MB) | 0.99 s | 1.02 s | 0.92 s | 1.00 s |
| First audio, voice already loaded (median of 5) | **0.78 s** | **0.90 s** | **0.26 s** | **0.29 s** |
| … with clause-sized first chunk (cut at `, ; :`) | 0.42 s | 0.89 s | 0.14 s | 0.29 s |
| First audio, cold (fresh page: session + first block) | **~2.05 s** | **~1.98 s** | 1.24 s | 1.36 s |
| Real-time factor | 0.164 | 0.155 | 0.053 | 0.049 |
| G2P time for the block | 0.3 ms | 1.5 ms (9 ms first call) | 0.2 ms | 1.6 ms |

- Threads need `crossOriginIsolated`; the bench page sets COOP `same-origin` + COEP `require-corp` in the manifest.
  Without them ORT runs one thread (the 1-thread column).
- Reading the 63 MB model from the Cache API takes 30–80 ms; creating the session is the cold cost (~1 s).

## Size (`spikes/s10/results/bundle-size.json`)

| Shipped file | Raw | gzip -9 |
|---|---|---|
| `ort-wasm-simd-threaded.wasm` (ORT 1.30.0) | 14.24 MB | 3.69 MB |
| `ort-wasm-simd-threaded.mjs` (loader) | 24 KB | 9 KB |
| Page bundle (ORT JS 50 KB + `g2p-vi` 5 KB + `g2p-en`/`phonemize` 3.05 MB + harness) | 3.11 MB | 1.01 MB |
| **Total added** | **17.37 MB** | **4.70 MB** |

## Go / no-go

**Go**, on these conditions for phase 8:

1. **First audio**: create the ORT session before the first play (when the Piper voice is selected or the panel
   opens, or on hover of the play control), and synthesize the first clause first. Then first audio is 0.4–0.9 s on one
   thread. A cold single-threaded start is ~2.0 s, over the 1.5 s gate. Optionally add COOP/COEP to the extension
   pages for 4 threads (cold 1.2–1.4 s); check first that nothing the panel embeds breaks under `require-corp`.
2. **Human listening check**: the owner scores the blind WAVs. The gate (≤ 0.3 below the oracle) is open until then.

**Owner decision needed: the vi voice's lineage.** The `vais1000` model card says the dataset is CC BY 4.0 and the
voice was **fine-tuned from the U.S. English `lessac` medium voice**, whose data is under the Blizzard 2013 Lessac
**research licence**. The repo marks every voice MIT, but whether a fine-tune inherits the research-only terms is a
legal question this spike cannot settle. There is no other Vietnamese medium voice (`25hours_single` is low, `vivos`
x_low). The English choice (`ljspeech`, trained from scratch on public-domain data) avoids the question.

Not done: the WASM is not split per language and the English lexicon (0.99 MB gzip) ships in the package; it is data,
not code, so phase 8 could instead download it with the English voice if the package size matters.

## Listening files (owner)

`node scripts/run.mjs scripts/listen.ts --reuse` (run in `spikes/s10/`) writes them to
`.cache/s10/listen/` (git-ignored): `vi-01-A.wav` … `vi-15-B.wav` (ours vs oracle, letters shuffled per sentence),
`en-01-A.wav` … `en-10-C.wav` (our English G2P, the oracle, `piper-plus` raw), `key.json` (open after scoring) and
`scores.csv` (intelligibility 1–5, tones 1–5 for vi). Texts: `spikes/s10/listen-set.json`.
