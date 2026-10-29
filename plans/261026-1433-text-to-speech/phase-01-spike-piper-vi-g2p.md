---
phase: 1
title: "Spike S10: Piper Vietnamese without espeak-ng"
status: pending
priority: P1
effort: "2d"
dependencies: []
---

# Phase 1: Spike S10 — Piper Vietnamese without espeak-ng

## Goal

Prove that we can run Piper `vi_VN-vais1000-medium` and an MIT-licensed English voice inside an extension page, with
our own MIT G2P instead of espeak-ng (GPL), at acceptable quality and speed.

## Files to create / modify

- Create: `spikes/s10/` (a throwaway extension page and scripts; never imported by `src/`)
- Create: `docs/decisions/S10-piper-vi-g2p.md` (the result and the go/no-go)

## Tasks and steps

1. Pin the voice files:
   - `rhasspy/piper-voices` at a fixed revision: `vi/vi_VN/vais1000/medium/*.onnx` and `.onnx.json`.
   - Record the SHA-256 and the size of each file.
   - Read `phoneme_id_map` and `espeak.voice` from the JSON to learn the exact phoneme inventory the model expects.
2. Choose the English voice:
   - List the `en_US` medium voices with an MIT or CC-BY licence in their model card. Reject any NC or SA licence.
   - Check whether `piper-plus` English G2P emits that voice's phoneme map.
3. Build the oracle at dev time only. Run espeak-ng locally (never shipped) on about 300 Vietnamese sentences:
   - tones, vowel clusters, final consonants, and the regional spelling the model was trained on;
   - numbers expanded to words.

   Save text → phoneme strings as `spikes/s10/oracle.json`.
4. Write a rule-based Vietnamese G2P in `spikes/s10/g2p-vi.ts`: syllable parse (onset, glide, nucleus, coda, tone) →
   the IPA symbols in `phoneme_id_map`. Measure the exact-match rate per syllable against the oracle.
5. Run inference in an extension page:
   - `onnxruntime-web` bundled locally, CSP `script-src 'self' 'wasm-unsafe-eval'`, with the model loaded from the
     Cache API.
   - Measure: time to first audio for a 200-character block, and the real-time factor on this Mac.
   - Measure the WASM size after gzip.
6. Run a blind listening check:
   - 15 vi sentences and 10 en sentences, each read by our G2P and by the espeak-ng oracle.
   - Score intelligibility and tones from 1 to 5.

## Go / no-go

- **Go:** at least 98 % of syllables match the oracle; listening scores are no more than 0.3 below the oracle; the
  first audio arrives in 1.5 s or less; the WASM and JS add 6 MB or less (gzip).
- **No-go:** record the gap in S10 and ask the owner. Do not ship espeak-ng, and do not fall back to GPL silently.

## Verification

- `docs/decisions/S10-piper-vi-g2p.md` holds the measured numbers, the pinned revision and hashes, the English voice
  and its licence, and the go/no-go.
