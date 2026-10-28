# Spike S10: Piper Vietnamese (and English) without espeak-ng

Answers `plans/261026-1433-text-to-speech/phase-01-spike-piper-vi-g2p.md`. The record, numbers and go/no-go are in
`docs/decisions/S10-piper-vi-g2p.md`. Nothing here is imported by `src/`; phase 8 copies `g2p-vi.ts` (and, if
accepted, `g2p-en.ts`) into `src/tts/piper/`.

espeak-ng (GPL-3.0) is used **only at dev time, as a black-box oracle**, from two virtualenvs under `.cache/s10/`
(git-ignored). It is not vendored, not in any `package.json`, and not in the extension page.

## Files

| File | What it is |
|---|---|
| `g2p-vi.ts` | **The deliverable.** Rule-based Vietnamese G2P, pure TS, no deps: `phonemize(text, opts?) → string[]` (one Piper IPA string per sentence), `phonemeIds(ipa, idMap)`, `expandNumbers`, `syllableToIpa`, `phonemizeWords`. |
| `g2p-en.ts` | English G2P for espeak-trained voices: `phonemizeEn(text, 'en' \| 'en-us') → string[]`. Wraps `phonemize@2.0.1` (MIT) and rewrites its IPA into espeak-ng's conventions. |
| `corpus-vi.json` | 300 Vietnamese sentences in 5 groups (tones, vowel clusters, finals/onsets, everyday prose, numbers), written by Gemini (`scripts/make-corpus.mjs`). Used to write and tune the rules. |
| `corpus-vi-heldout.json` | 120 more sentences (news, web prose), generated **after** the rules were tuned: the honest match rate. |
| `corpus-en.json` | 120 English web-prose sentences for the English G2P comparison. |
| `oracle.json`, `oracle-heldout.json` | text → numbers expanded → espeak-ng phonemes, per sentence (Piper's training phonemizer). |
| `listen-set.json` | The listening set: 15 vi (2 per tuning group + 5 held-out) and 10 en (Harvard sentences, list 1). |
| `ext/` | Unpacked MV3 extension page used for every in-browser measurement: `bench.html`, CSP `script-src 'self' 'wasm-unsafe-eval'`, COOP/COEP set so threads are possible. `bench.js` and `ort/` are **generated** by `build.mjs`. |
| `entries/bench.ts` | The page's script: Cache API voice loading, `onnxruntime-web/wasm` session, synthesis, timing. Exposes `window.s10`. |
| `build.mjs` | Bundles the page (esbuild), copies the ORT WASM into `ext/ort/`, writes `results/bundle-size.json`. |
| `scripts/espeak-oracle.py` | The oracle (GPL tool, dev only): `piper_phonemize 1.1.0` or `piper-tts`'s `espeakbridge`. |
| `scripts/oracle-lib.mjs` | Calls the oracle in its virtualenv. |
| `scripts/build-oracle.ts` | Writes `oracle[-heldout].json`; cross-checks the two oracle builds. |
| `scripts/score-g2p.ts` | Per-syllable exact match of `g2p-vi.ts` against the oracle → `results/g2p-match*.json`. |
| `scripts/score-en.ts` | English candidates vs espeak-ng (phoneme error rate) → `results/en-g2p.json`. |
| `scripts/bench.mjs`, `scripts/browser.mjs` | Speed bench in Chromium through Playwright (time to first audio, RTF) → `results/bench.json`. A local server stands in for Hugging Face. |
| `scripts/listen.ts` | Synthesizes the listening set (ours vs oracle phonemes), saves blind WAVs, transcribes them with Gemini, scores WER/CER/tones → `results/asr-proxy.json`. |
| `scripts/gemini.mjs`, `scripts/make-corpus*.mjs` | Gemini REST helper; corpus generators (one-off). |
| `scripts/run.mjs` | Runs a script after bundling it to CJS (Node cannot load `phonemize`'s JSON imports natively). |
| `results/` | Measured numbers (JSON). |

## Rebuild and rerun

From `spikes/s10/` (Node 24, macOS arm64; the root `pnpm install` provides `@playwright/test` and its Chromium):

```sh
npm install                                  # spike-only deps, own node_modules

# Voices, pinned (hashes in the decision record), into the git-ignored cache:
REV=5041a7a49ae5b3a0f30e6837769eb03fdbb231bd
B=https://huggingface.co/rhasspy/piper-voices/resolve/$REV
mkdir -p ../../.cache/s10/voices && cd ../../.cache/s10/voices
for f in vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx{,.json} \
         en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx{,.json}; do curl -sLO $B/$f; done
shasum -a 256 *.onnx *.json
cd -

# Oracle virtualenvs (dev only, GPL inside, never shipped):
cd ../../.cache/s10
uv venv --python cpython-3.11-macos-x86_64-none old-venv          # x86_64 wheel only on macOS: runs under Rosetta
uv pip install --python old-venv/bin/python piper-phonemize==1.1.0
python3 -m venv oracle-venv && oracle-venv/bin/pip install piper-tts==1.8.0
cd -

node scripts/build-oracle.ts && node scripts/build-oracle.ts --heldout
node scripts/score-g2p.ts && node scripts/score-g2p.ts --heldout
node scripts/run.mjs scripts/score-g2p.ts --foreign-en [--heldout]       # English words through g2p-en.ts
node scripts/run.mjs scripts/score-en.ts
node build.mjs && node scripts/bench.mjs
node scripts/run.mjs scripts/listen.ts --reuse                           # needs GEMINI_API_KEY in the repo's .env
```

Do not use Homebrew's `espeak-ng` CLI as the oracle: its 1.52.0 data prints tone `1` on level-tone syllables and other
digits the voice never saw (`Xin chào` → `sˈi1n`), while Piper's own phonemizer prints none (`sˈin`).

## Listening files for the owner

`scripts/listen.ts` writes blind WAVs to `.cache/s10/listen/` (not committed):

- `vi-01-A.wav` … `vi-15-B.wav`: each Vietnamese sentence read from our G2P and from the oracle phonemes (A/B shuffled
  per sentence).
- `en-01-A.wav` … `en-10-C.wav`: each English sentence from our English G2P, the oracle, and `piper-plus` raw.
- `key.json`: which letter is which system (open it only after scoring).
- `scores.csv`: one row per file; fill in intelligibility 1–5 and, for vi, tones 1–5.

The texts are in `listen-set.json` (same order).
