# Eval gate: worse-prompt demo

The regression gate turns red on a deliberately worse translate prompt.

- Branch: `demo-worse-prompt`, from `m6-p1` at 4846c8e, in its own worktree. The branch and the worktree were deleted after the run.
- Command: `pnpm run eval:gate` (2026-10-11, 21:47 Asia/Saigon).
- Baseline: `eval/gate.json` at 4846c8e.

## The change

Only translate@2's goal and its first two rules were replaced. The rules on output format, kept text, glossary and markers are unchanged, so no segment is lost.

```diff
-Goal: a reader of the translation should understand exactly what the author meant,
-feel the same tone, and never sense it was translated.
+Goal: a word-for-word rendering that mirrors the English exactly.

 Rules:
-- Translate meaning and intent, not words. Restructure sentences to sound natural
-  in {TARGET_LANG}. Replace idioms with natural equivalents; if none exists, convey
-  the meaning plainly.
-- Preserve the author's tone, register, humor, emphasis, and stance (hedging,
-  certainty, sarcasm, irony). Do not make it more formal or more polite than the
-  original. The document brief says what the tone is: keep it in every segment.
+- Translate word by word, in the English word order. Do not restructure sentences,
+  even when the result reads awkwardly in {TARGET_LANG}. Translate idioms literally.
+- Use a flat, formal register in every segment, whatever the source's tone; drop
+  humor, sarcasm and irony.
```

## Result: red

Pass 1 was valid and red on three dimensions:

```
pass 1: RED (896 s)
| dimension | baseline | margin | floor | score | vs baseline | |
|---|---|---|---|---|---|---|
| fidelity | 4.23 | 0.26 | 3.96 | 3.87 | −0.36 | FAIL |
| naturalness | 3.90 | 0.19 | 3.72 | 3.52 | −0.38 | FAIL |
| tone | 4.60 | 0.26 | 4.34 | 4.35 | −0.25 | ok |
| terminology | 4.48 | 0.14 | 4.34 | 3.83 | −0.65 | FAIL |
passages scored 23/23, briefed chunks 11, revised segments 50, lost 0/149
spend: translate $0.0056 + judge $0.1476 = $0.1532
- fidelity 3.87 < floor 3.96 (baseline 4.23 − margin 0.26)
- naturalness 3.52 < floor 3.72 (baseline 3.90 − margin 0.19)
- terminology 3.83 < floor 4.34 (baseline 4.48 − margin 0.14)
```

Pass 2, the gate's re-run, did not produce a result. APIBOX did not answer two calls, for `so-regex-html` and `swift-modest-proposal`, and translation hit the 25-minute timeout. It spent $0.0027. The gate exited 1 (RED, 2 passes, $0.1559 at nominal prices; the APIBOX prices are unverified).
