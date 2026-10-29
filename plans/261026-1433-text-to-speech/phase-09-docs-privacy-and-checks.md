---
phase: 9
title: "Docs, privacy and release checks"
status: done
priority: P1
effort: "0.5d"
dependencies: [4, 5, 6, 7, 8]
---

# Phase 9: Docs, privacy and release checks

## Goal

Document the feature where its behaviour is visible, name every new destination for text, and pass the full gate.

## Files to create / modify

- Modify:
  - `docs/privacy.md`:
    - The system voice and Piper send nothing.
    - Each cloud TTS provider receives the block's text, plus the delivery note when it accepts one.
    - The text-preparation step sends the block and its neighbours to the translation provider.
    - The Piper download contacts `huggingface.co`.
    - Add code pointers in its evidence list.
  - `DESIGN.md`: a short TTS section covering engines, settings, the playback controller and privacy, linking to the
    S10 and S11 decision docs.
  - `docs/store/`: the justification for the `tts` permission and the listing text, if the store docs list
    permissions.

## Tasks and steps

1. Check each privacy claim against the code (`src/tts/*`) before writing it.
2. Run the full gate, then check the acceptance criteria in `plan.md` one by one, linking the evidence from phases 3–8.

## Verification

- `pnpm run check`
- Every acceptance criterion in `plan.md` is ticked with evidence.
