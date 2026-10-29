---
phase: 7
title: "Context note and speakable text"
status: pending
priority: P2
effort: "1d"
dependencies: [6]
---

# Phase 7: Context note and speakable text

## Goal

Before a cloud voice reads a block, prepare the text with an LLM:

- **Speakable text:** numbers, abbreviations and foreign terms spelled the way they should be read.
- **A short delivery note:** genre, tone, and what to stress or which questions to mark, based on the block and its
  neighbours.

Gemini receives the note in its prompt, and OpenAI receives it in `instructions`. The other providers receive only the
speakable text.

## Files to create / modify

- Create:
  - `src/tts/prepare.ts`: `prepare(block, neighbours, lang) → { text, note }`. It runs only when the voice is a cloud
    provider (validation answer), using the translation route's connection (`src/llm/client.ts`), or Chrome's
    on-device Prompt API (`src/llm/chrome-builtin.ts`) when no translation provider is set. On any failure or timeout (1.5 s) it falls back to `speakable.ts`.
  - `src/tts/prepare.test.ts`
  - a versioned prompt `tts-prepare@1` registered in `src/engine/prompts/registry.ts`, like `translate@1`.
- Modify:
  - `src/tts/cloud/gemini.ts` and `openai.ts`: send `note`.

## Tasks and steps

1. The prompt returns JSON `{ text, note }`. The note is at most 30 words, and `text` must keep the meaning. The
   output is rejected when its length drifts by more than 30 % from the input, falling back to the rule-based text.
2. Cache the result per block and language in the panel session, so replaying a block does not call the LLM again.
3. The cost shows in the existing spend tracking (`src/shared/spend.ts`) under a "voice prep" label.

## Verification

- `pnpm vitest run src/tts/prepare`
- Manual: a vi passage with a question, a number and an English term reads the term in English and the number in
  words, with a rising question. The OpenAI request body shows `instructions`, and the Gemini prompt shows the note.
