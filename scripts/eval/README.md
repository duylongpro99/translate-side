# Eval harness (M1-E11)

Runs the real engine (`single-pass` or `contextual`) in Node over fixture documents with a real model, and writes what it cost.

```
pnpm run eval:capture [slug …]       # fixtures/sites/*.html → fixtures/docs/<slug>.json (Segment[], as the content script extracts them)
pnpm run eval -- [options]           # fixtures/docs/*.json → eval-results/<stamp>_<model>/
```

Options: `--reasoning low --reasoning-reserve 8000` sets one thinking level for every translate call (a trial). `--provider apibox|gemini|anthropic` (default apibox, M2-D11: the APIBOX gateway with `qwen3.8-flash` (M2-D16): chunk 1 thinking off, later chunks `minimal` with a 6000-token reserve on their cap only, repairs and analyze off, `max_completion_tokens` as the cap; `--model ds/deepseek-v4-pro` (M2-D14) or `--model ds/deepseek-flash` (M2-D13) run thinking off; summary.json `thinking` records the policy, calls.jsonl each call's chunk and reasoning tokens (from the call's own usage), summary.md flags reasoning outliers; `gemini` reproduces the historical Gemini baseline; key from `.env`: `AIBOX_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`), `--model id`,
`--docs a,b` (default: the five in `scripts/eval/docs.ts`), `--set fixtures|eval` (`eval`: the M2-E8 passages in `eval/passages`, see `eval/README.md`; also adds `eval:sheet`, `eval:judge`, `eval:report`), `--strategy single-pass|contextual` (default single-pass; `contextual` adds the brief call, M2-E1), `--mock` (offline echo model, no key), `--probe-nonce`
(sends every chunk as a nonce chunk and counts echoed nonces, M1-D11), `--chunk-tokens n` (1500), `--concurrency n` (2),
`--target vi`, `--price in,cached,out` (USD per million tokens; otherwise `pricing.ts`; the APIBOX entries are the gateway's nominal USD, unverified),
`--out dir`, `--prompt translate@1|translate@2` (contextual's translate prompt, default translate@2; `translate@1` is Phase B's contextual; single-pass is always translate@1, the frozen baseline),
`--style natural|faithful|simplified`, `--gloss first|off`, `--glossary "deploy,executor=bộ thực thi"` (the job options the panel takes from the settings; a bare term is kept as is, and a rendering is everything after the first `=`), `--pause ms` (wait between documents, for a free tier's per-minute limit).

A run folder holds `<slug>.output.json` (source and translation per segment), `<slug>.brief.json` (contextual: the parsed brief, or null), `calls.jsonl` (every request and answer, tagged with its role),
`summary.json` (with `strategy`, `strategyVersion`, `prompts` (the prompt versions by role) and `promptHash` (12 hex of SHA-256 over the translate system prompt rendered with no context, so a rule edited in place shows)) and `summary.md` (per doc: segment loss, repairs, chunks and how many carried the brief, calls, tokens, wall time, time to first final, cost; the brief's parse result, time and tokens; chars per token; S2 thresholds; nonce copy).
`eval-results/` and `.cache/` are git-ignored. The exit code is 1 when any translatable segment has no final text.

The scripts bundle with esbuild (`.cache/eval/`) because the extractor and tests use the `@/` alias.

`contextual` makes no brief call for a document that fits one chunk (M2-D9): summary.md counts those as skipped, and the "chunks (briefed)" column comes from the engine's per-chunk `chunk` event. Use `--chunk-tokens 400` to split the eval passages into several chunks, so the brief reaches the later ones. On a document of two chunks or more, once the brief lands chunk 0 is translated again with it and replaced as revision 2 (M2-D17): `<slug>.output.json` gives the final `text` (the one scored) with `revision: 2` and the replaced `draft`; the run line and summary.json count `revised` segments, and `reviseKept`: segments the second pass translated but left at revision 1 because its text lost inline markers (backtick spans, links or emphasis) that revision 1 had.

`eval:judge` scores with the pinned judge `ds/deepseek-v4-pro` on APIBOX (M2-D13; `--provider gemini --model gemini-3.7-flash` is the old judge). `--docs a,b` scores only those passages, e.g. a one-passage smoke test.

## Visible first in the built extension (M3 §3 #1, dogfood B4)

`scripts/eval/ext-run.mjs <provider> --scroll F [--screen-only] [--url https://… | --fixture slug] [--throttle]` (header of the script for the setup) opens the page in a fresh tab scrolled to F of its height, then opens the panel and starts the job the way the toolbar icon does. It reports, from that gesture: `visibleFirstMs` and `visibleAllMs` (when the first and the last paragraph fully on the page's screen became final in the panel, matched by opening text) and `screenDoneMs` (the job's own stamp, `JobView.screenDoneAt`: every block on screen final; a failed block keeps it unset). `--screen-only` cancels the job once the screen is done, to keep spend small. `--throttle` keeps Chrome's background-tab timer throttling (the panel runs as a tab here; the real side panel is not a background tab).

Measurement notes (2026-10-10, Gemini `gemini-3.5-flash-lite`, fresh tab per run, no throttling):
- The QA run in docs/progress/dogfood-m3.md (screen stamped at ~2.1 s, visible paragraphs final at 7.6–9.7 s) navigated in the tab it had already injected into: the worker injected again on load, so the job started at the top of the page before the scroll, and the stamp measured the top screen (dogfood B5). A fresh tab does not show it.
- Wikipedia (Movable type, scrolled 0.4): first visible paragraph final at 2.1–2.8 s, all visible at 2.4–5.6 s. ACX (scrolled 0.3): 3.5 / 4.2 / 4.6 s; first request 1.3 s after the gesture.
- Gemini sometimes stalls mid-stream (CDP `Network.dataReceived`: no bytes for ~16 s, then the rest; once ~52 s, until the 60 s idle guard). A screen chunk caught in a stall finishes late. No hedging in M3: recorded under the accepted speed gap M3-D11.
