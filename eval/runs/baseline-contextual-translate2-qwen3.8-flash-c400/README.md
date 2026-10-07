# Reference run: contextual@2, chunk 400

This is a reference run, not the M2 baseline (M2-D22). The M2 baseline is `../baseline-contextual-translate2-qwen3.8-flash` (chunk 1500).

At chunk 400 the eval passages split into several chunks, so the brief reaches the later chunks and chunk 0 is re-translated with it (M2-D17). This run is kept to show that path; the `*.brief.json` files are the briefs it used. Cost is about 3.6x single-pass and the judge scores it below single-pass, so it is not the shipping configuration.
