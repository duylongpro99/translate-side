# Scout: M6 eval, CI, e2e (2026-10-11, master @ ae9f9fb)

A read-only scout. These are facts with citations.

- **Eval harness.** `scripts/eval*.mjs` bundle the scripts in `scripts/eval/*.ts`, run as eval→run.ts, plus capture, detect, judge, report and sheet. run.ts defaults:
  - provider apibox (:44), strategy single-pass (:49), set fixtures (:48), chunk 1500 (:53), concurrency 2 (:54), apibox model qwen3.8-flash (:147);
  - keys come from .env (:97, :131-132).

  To reproduce the baseline, run `--set eval --strategy contextual`. The baseline run is 23 passages and 25 calls, 25.5k input and 9.8k output tokens, about 185 s of summed document time, about $0.002.
- **Judge.** The model is `ds/deepseek-v4-pro` (judge-core.ts:15) with prompt `judge@1` (:16), temperature 0 (:65), through apibox (judge.ts:43-47). judge.json records judgeModel, prompt, at, scores, failed, usage and costUsd. It does not hash the rubric text.
  - Variance has been measured once: `eval/runs/baseline-.../judge-rerun.json` re-judged the same outputs. The paired per-passage SD (n=23) is fidelity 0.60, naturalness 0.48, tone 0.46, terminology 0.55. Rerun variance of the translation itself has never been measured.
- **Baseline vs default.** The baseline is contextual v2 with translate@2 and analyze@1, promptHash 848336fde86c, at gitCommit 8bc7484. The extension default is the same: `PANEL_STRATEGY = contextual` (sidepanel/jobs.ts:80), and contextual uses translate@2 (strategies/contextual.ts:47).
  - The prompt files are unchanged since 8bc7484.
  - 8 commits after it touch contextual.ts or single-pass.ts.
  - Prompts live in src/engine/prompts/ and strategies in src/engine/strategies/.
- **Report.** report-core.ts already computes per-dimension means (:24-29), the delta against the first run (:18-21), and judge-vs-human MAE, bias and within-1 (:102-107). There is no threshold and no pass/fail.
- **CI.** `.github/workflows/ci.yml` has one job, `check`, on pushes to master/main and on pull requests. It runs lint, typecheck, check:engine, test, build and check:manifest, with no path filters and no secrets.
- **Mock provider.** None that the built extension can use. The test doubles are `src/llm/testing.ts:30` (mockFetch) and `src/engine/testing.ts:62`; the eval `--mock` echo lives only inside the harness.
  - To use a localhost endpoint, choose the preset `custom-openai` (presets.ts:165).
  - `scripts/eval/ext-run.mjs:86-87` seeds a connection through storage.
  - `ext-run.mjs:53` writes host_permissions into a copied manifest, and :122-124 sets the session `access:<tab>` flag. Together these get around the permission grant, which otherwise needs a gesture (Providers.tsx:796, translator.ts:523/:549, sites.ts:169).
- **Fixtures.** There are 17 HTML pages: fixtures/sites 12, fixtures/spa 3, fixtures/long 2. fixtures/sites/manifest.json holds 12 entries of metadata, read by tests/fixtures/load.ts:10-25.
- **Browser tooling.** Neither playwright nor puppeteer is a dependency. ext-run.mjs:29 loads `playwright-core` from the env var PLAYWRIGHT_CORE and a CHROME binary, headed, on .output/chrome-mv3. The spikes use raw CDP (spikes/s3/cdp.mjs, s4/s5 drive.mjs). M5 drove the docked panel over CDP (progress-m5.md:355-359, :505).
- **Coverage.** vitest.config.ts has no coverage block (projects engine and shell), and @vitest/coverage-v8 is not installed.
- **Entry points.** background.ts, content.ts, onboarding/, options/ and sidepanel/. The build writes .output/chrome-mv3/sidepanel.html. check-manifest.mjs asserts the exact permissions and optional_host_permissions, no host_permissions or content_scripts, min Chrome 138, Alt+T, the panel and worker paths, and no dev-view in chunks.
