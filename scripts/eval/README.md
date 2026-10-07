# Eval harness (M1-E11)

Runs the real engine (`single-pass` or `contextual`) in Node over fixture documents with a real model, and writes what it cost.

```
pnpm run eval:capture [slug …]       # fixtures/sites/*.html → fixtures/docs/<slug>.json (Segment[], as the content script extracts them)
pnpm run eval -- [options]           # fixtures/docs/*.json → eval-results/<stamp>_<model>/
```

Options: `--provider apibox|gemini|anthropic` (default apibox, M2-D11: the APIBOX gateway with `ds/deepseek-v4-pro` (M2-D14), thinking off; `--model ds/deepseek-flash` is the M2-D13 translator; `gemini` reproduces the historical Gemini baseline; key from `.env`: `AIBOX_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`), `--model id`,
`--docs a,b` (default: the five in `scripts/eval/docs.ts`), `--set fixtures|eval` (`eval`: the M2-E8 passages in `eval/passages`, see `eval/README.md`; also adds `eval:sheet`, `eval:judge`, `eval:report`), `--strategy single-pass|contextual` (default single-pass; `contextual` adds the brief call, M2-E1), `--mock` (offline echo model, no key), `--probe-nonce`
(sends every chunk as a nonce chunk and counts echoed nonces, M1-D11), `--chunk-tokens n` (1500), `--concurrency n` (2),
`--target vi`, `--price in,cached,out` (USD per million tokens; otherwise `pricing.ts`; the APIBOX entries are the gateway's nominal USD, unverified),
`--out dir`, `--prompt translate@1|translate@2` (contextual's translate prompt, default translate@2; `translate@1` is Phase B's contextual; single-pass is always translate@1, the frozen baseline),
`--style natural|faithful|simplified`, `--gloss first|off`, `--glossary "deploy,executor=bộ thực thi"` (the job options the panel takes from the settings; a bare term is kept as is, and a rendering is everything after the first `=`), `--pause ms` (wait between documents, for a free tier's per-minute limit).

A run folder holds `<slug>.output.json` (source and translation per segment), `<slug>.brief.json` (contextual: the parsed brief, or null), `calls.jsonl` (every request and answer, tagged with its role),
`summary.json` (with `strategy`, `strategyVersion`, `prompts` (the prompt versions by role) and `promptHash` (12 hex of SHA-256 over the translate system prompt rendered with no context, so a rule edited in place shows)) and `summary.md` (per doc: segment loss, repairs, chunks and how many carried the brief, calls, tokens, wall time, time to first final, cost; the brief's parse result, time and tokens; chars per token; S2 thresholds; nonce copy).
`eval-results/` and `.cache/` are git-ignored. The exit code is 1 when any translatable segment has no final text.

The scripts bundle with esbuild (`.cache/eval/`) because the extractor and tests use the `@/` alias.

`contextual` makes no brief call for a document that fits one chunk (M2-D9): summary.md counts those as skipped, and the "chunks (briefed)" column comes from the engine's per-chunk `chunk` event. Use `--chunk-tokens 400` to split the eval passages into several chunks, so the brief reaches the later ones.

`eval:judge` scores with the pinned judge `ds/deepseek-v4-pro` on APIBOX (M2-D13; `--provider gemini --model gemini-3.7-flash` is the old judge). `--docs a,b` scores only those passages, e.g. a one-passage smoke test.
