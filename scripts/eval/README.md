# Eval harness (M1-E11)

Runs the real engine (`single-pass`) in Node over fixture documents with a real model, and writes what it cost.

```
pnpm run eval:capture [slug …]       # fixtures/sites/*.html → fixtures/docs/<slug>.json (Segment[], as the content script extracts them)
pnpm run eval -- [options]           # fixtures/docs/*.json → eval-results/<stamp>_<model>/
```

Options: `--provider gemini|anthropic` (default gemini; key from `.env`: `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`), `--model id`,
`--docs a,b` (default: the five in `scripts/eval/docs.ts`), `--mock` (offline echo model, no key), `--probe-nonce`
(sends every chunk as a nonce chunk and counts echoed nonces, M1-D11), `--chunk-tokens n` (1500), `--concurrency n` (2),
`--target vi`, `--price in,cached,out` (USD per million tokens; otherwise `pricing.ts`; the Gemini entry is an unverified placeholder),
`--out dir`.

A run folder holds `<slug>.output.json` (source and translation per segment), `calls.jsonl` (every request and answer),
`summary.json` and `summary.md` (per doc: segment loss, repairs, calls, tokens, wall time, time to first final, cost; chars per token; S2 thresholds; nonce copy).
`eval-results/` and `.cache/` are git-ignored. The exit code is 1 when any translatable segment has no final text.

The scripts bundle with esbuild (`.cache/eval/`) because the extractor and tests use the `@/` alias.
