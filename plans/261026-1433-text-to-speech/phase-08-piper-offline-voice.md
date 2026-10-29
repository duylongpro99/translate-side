---
phase: 8
title: "Piper offline voice"
status: pending
priority: P2
effort: "2.5d"
dependencies: [1, 3, 5]
---

# Phase 8: Piper offline voice

## Goal

Ship the S10 result as an engine. Under Settings › Voice, a "Download offline voice" control fetches the pinned vi and
en voice weights, checks their SHA-256, and caches them. Piper then reads any block offline, with no key.

This phase runs only if S10 was a go.

## Files to create / modify

- Create:
  - `src/tts/piper/g2p-vi.ts`, with tests (moved from the spike and hardened)
  - `src/tts/piper/g2p-en.ts`: a wrapper over the MIT `piper-plus` English G2P, or the dependency S10 chose
  - `src/tts/piper/worker.ts`: a Web Worker running `onnxruntime-web` from the extension's own files
  - `src/tts/piper/engine.ts`: the `TtsEngine` that talks to the worker
  - `src/tts/piper/download.ts`: pinned URLs and hashes, the Cache API, progress, resume after a failure, and
    "Remove offline voice"
- Modify:
  - `wxt.config.ts`:
    - `content_security_policy.extension_pages`: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`.
    - The ORT `.wasm` files copied into `public/`.
    - The origin `https://huggingface.co/*`, requested on the download click, so it stays in the optional host
      permissions.
  - `scripts/check-manifest.mjs`: expect the CSP.
  - `scripts/bundle-budget.json`: add the worker and WASM files, with a note.
  - `src/entrypoints/options/Voice.tsx`: download, progress, size, and remove.
  - `package.json`: `onnxruntime-web` and `piper-plus`, both MIT; versions pinned and licences checked.

## Tasks and steps

1. Downloads run only on the user's click. Show the size first (about 63 MB per voice). A hash mismatch deletes the
   file and reports an error.
2. The ORT WASM and the worker load only when the Piper engine is chosen, so the panel's first paint is unchanged.
3. Add a licence check: a test or script that fails when any dependency in the shipped build carries a GPL or AGPL
   licence.

## Verification

- `pnpm vitest run src/tts/piper`
- `pnpm run build && pnpm run check:bundle && pnpm run check:manifest`
- Manual: download both voices, go offline (DevTools), and read a vi block and an en block. "Remove offline voice"
  frees the cache.
