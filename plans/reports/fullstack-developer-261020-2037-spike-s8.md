# Spike S8 (phase 1, minus the Chrome stable run): report

Status: DONE_WITH_CONCERNS. The spike is built and Q7 is answered; Q1–Q6 wait for the owner's run on Chrome stable.

## What was built

- `spikes/s8/ext/`: an MV3 extension with a side panel (`sidepanel.html`, `sidepanel.js`, first-script `probe.js`) and
  a service worker (`background.js`). It has the availability, create (in click, deferred 10 s, at panel load with no
  click), Nano, and background buttons; a Nano harness for Q3 (markers vs `responseConstraint` JSON array of N strings)
  and Q4 (limits, TTFT and tokens/s on ~1,200 tokens, largest chunk before `QuotaExceededError`); a timestamped log of
  every availability state and `downloadprogress` event; and copy-as-JSON.
- `spikes/s8/build.mjs` + `entries/`: an esbuild step. `ext/engine.js` bundles the real `translate@2` system prompt
  (via `renderSystemPromptV2`), the wire format, `SegParser` and `planRepair` from `src/engine`. `ext/fixtures.json`
  holds the blocks of three site fixtures, read by the real extractor in jsdom. Both are generated and committed so the
  folder loads as-is.
- `spikes/s8/probe-q7.mjs` with its output in `spikes/s8/results/q7.json`. `spikes/s8/README.md` covers loading the
  extension, each question, and the second fresh profile for Q1.
- `docs/decisions/S8-chrome-builtin.md`: status Provisional. Q7 is answered with evidence; Q1–Q6 each have their method
  and a provisional decision; there is an environment table for the owner and an empty "Shipped behavior" section.

## Q7 answer

Yes. With Playwright 1.64.0 and Chrome for Testing 156.0.8078.4 (headless, macOS arm64), `context.addInitScript` runs
before the panel's first script on `chrome-extension://<id>/sidepanel.html`, and an assigned fake replaces the real
`Translator` / `LanguageModel`. This holds for pages opened by `page.goto`, by the extension (`chrome.tabs.create`) and
by `window.open`. It does not reach the service worker. Unfaked, Chrome for Testing reports Translator `en→es` =
`downloadable`, and `unavailable` for `LanguageModel` and `LanguageDetector`.

## Checks

- The manifest parses. The extension loads in Chrome for Testing, and the probe clicked every harness button against
  the fake with no page error and no logged error.
- `pnpm lint` passes (`spikes/` is in the eslint ignores).
- No throwaway file was left in `e2e/`. Nothing under `src/` or `e2e/`, and neither `package.json` nor the lockfile,
  was modified.

## Concerns

- The real docked side panel and the product's `pnpm build` were not probed; the panel ran as a tab, as in e2e. Phase
  5's first e2e run confirms the mechanism on the real bundle.
- The Q3 harness counts first-pass failures only (no repair round).
- `ext/engine.js` was built while another agent was editing `src/`. Re-run `node spikes/s8/build.mjs` after those
  edits land if the prompt or parser change.
