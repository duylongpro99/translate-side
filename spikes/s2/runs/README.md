# S2 run logs

One JSON line per chunk per arm (`<arm>.jsonl`), written by `run.mjs`; `<arm>.repair-*.jsonl` and `<arm>.repair.json`
by `repair.mjs`; `_log.txt` is the progress log. Each line holds the raw model `content`, the parse at run time, usage,
timings and the first 160 chars of the reasoning. `analyze.mjs` re-parses `content` offline (both grammars), so the
parse fields stored here are informational only.

The `content` fields are machine translations (gpt-oss:20b, Ollama cloud, 2026-10-05) of text from the fixtures in
`fixtures/sites/`. They are derivative works of those pages and are under the same licenses; see
`fixtures/sites/ATTRIBUTION.md` for authors, sources and licenses. Chunks `adv#*` are synthetic text written for this spike. Arms `large-*`
use the DESIGN-size chunks in `../chunks-large.json` (ids `L:…`).
