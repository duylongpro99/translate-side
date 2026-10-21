# Spike S8: Chrome built-in AI on real Chrome

Answers the questions in `plans/261020-1216-chrome-builtin-zero-setup/phase-01-spike-s8.md`. The record is
`docs/decisions/S8-chrome-builtin.md`. Q7 (e2e fake injection) is answered by `probe-q7.mjs` and needs no
owner run. Q1–Q6 need **Chrome stable** on the owner's machine: in Playwright's headless Chrome for
Testing 156, `LanguageModel` and `LanguageDetector` report `unavailable` and Translator `en→es` reports
`downloadable` (`results/q7.json`), so nothing measured there would count.

## Files

| File | What it is |
|---|---|
| `ext/manifest.json` | MV3, side panel `sidepanel.html`, permissions `sidePanel` and `storage` only. The toolbar icon opens the panel. |
| `ext/sidepanel.html`, `ext/sidepanel.js` | The panel: buttons, harness, log. Plain JS. |
| `ext/probe.js` | The panel's first script: records `typeof Translator` / `LanguageModel` at load (`__s8AtLoad`). |
| `ext/background.js` | Service worker: opens the panel; answers "ask background to create Translator" (information only). |
| `ext/engine.js` | **Generated.** The product's `translate@2` system prompt, `<seg>` wire format, segment parser and repair plan, bundled from `src/engine` by `build.mjs`. |
| `ext/fixtures.json` | **Generated.** Translatable blocks of `mdn-promise-then`, `goblog-pipelines` and `globalvoices-bangladesh-protests` (fixtures/sites), read by the product's real extractor in jsdom. |
| `build.mjs`, `entries/` | The esbuild step that makes the two generated files. |
| `probe-q7.mjs` | The Q7 probe (Playwright, Chrome for Testing). Writes `results/q7.json`. |

## Build

From the repository root, after `pnpm install`:

```sh
node spikes/s8/build.mjs
```

Re-run it whenever `src/engine/prompts`, `src/engine/parsing` or the extractor change, so the harness keeps
testing the real prompt and parser.

## Load it in Chrome stable

1. Check the version at `chrome://version` (note it, the OS and the hardware: CPU, RAM, GPU/VRAM, free disk).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the `spikes/s8/ext` folder.
3. Pin the extension and click its toolbar icon: the side panel opens.
4. Open DevTools for the panel (right-click inside it, **Inspect**). Keep the **Console** open: Chrome's own
   warnings (for example "On-device AI is disabled in Chrome settings") appear only there (Q6).
5. Useful pages: `chrome://on-device-internals` (model status, size, the device's performance class) and
   `chrome://settings/ai` (the on-device AI toggle, if your version has it).

Every action writes a timestamped line to the panel log. **copy log as JSON** puts the whole log, with the
environment (user agent, full version list, cores, memory), on the clipboard. Save one JSON per step below as
`spikes/s8/results/<question>-<step>.json` and paste the numbers into the decision record.

## Running each question

**Q1, pair persistence.** Use a **second, fresh Chrome profile** (profile menu → Add), so that no language
pack or model was created before. Load the extension there.

1. Open the panel. "availability at panel load" runs on its own: note the state of `en→vi` and `ja→vi`
   (expected `downloadable`).
2. Set source `en`, target `vi`, click **create Translator (in click)**. Wait for `Translator.create.ok`
   (the download progress lines give Q5's timing). Then `ja`→`vi` the same way (pivot through English).
3. Close the panel, open it again: the load-time availability should now say `available` for both pairs.
4. Quit Chrome completely (Cmd+Q), start it again, open the panel: check the states again.
5. Optional, information only: in yet another fresh profile, click **ask background to create Translator**
   for a pair not yet created. It shows whether the worker can create with no click (`background.result`).
   The product does not use this path.

**Q2, side-panel activation.** In a profile where a pair or Nano is still `downloadable`:

1. Tick **create Translator + Nano at panel load (no click)**, close and reopen the panel. The panel calls
   both `create()`s with no click at all: note the errors (expected `NotAllowedError` while `downloadable`).
   Untick it afterwards.
2. **create Translator (deferred 10 s)**: the call happens 10 s after the click, without transient
   activation. **create Translator (in click)**: the call is synchronous in the handler. Compare.
3. **create Nano (deferred 10 s)**: tests whether Nano accepts the earlier click (sticky activation).
   Each `.called` line records `navigator.userActivation` at the call.

**Q3, Nano output format.** Needs Nano `available` for the target (press **create Nano** first and wait).

1. Nano target `es`, chunk tokens 1000, chunks per fixture 3. Click **Q3 markers vs JSON**. Each chunk runs
   twice: the product's single-pass prompt with `<seg>` markers (parsed by the product's parser, a failed
   segment = one the repair plan would re-request), and the same prompt asking for a JSON array, with
   `responseConstraint` = an array of exactly N strings (failure = invalid JSON, wrong count, empty item).
   `q3.summary` gives the failure rate per format.
2. Then Nano target `en` and run it again. The fixtures are English, so `es→en` translates back the Spanish
   the first run produced (run `es` first in the same panel session).

**Q4, Nano limits.** **Q4 limits** reads `contextWindow` (or `inputQuota` on older builds) and the system
prompt's size. **Q4 speed** translates a ~1,200-token chunk and logs time to first token, tokens per second
and the output/input token ratio. **Q4 largest chunk** finds, by measuring, the largest chunk that fits with
the system prompt, confirms it with real prompts (the next size up should throw `QuotaExceededError`), then
translates a chunk that leaves half the room for the output and logs whether it parsed.

**Q5, timings.** Read from the logs of Q1 and Q3: the time from `create.called` to `create.ok` and the
`downloadprogress` lines, for one direct pair (`en→vi`), a pivoted pair (`ja→vi`) and Nano (if it started
`downloadable`; the model download can take many minutes).

**Q6, unavailable reasons.** Run **availability (all)** in each state you can produce, and note the state
and any console warning: normal; `chrome://settings/ai` on-device AI turned off (if present); a pair that is
not supported (the `en→vi` Nano line is one); and, if possible, a managed profile with
`GenAILocalFoundationalModelSettings` = 1 or `TranslatorAPIAllowed` = false.

**Stop** ends a running harness after its current prompt.

## Q7 probe (no owner run needed)

```sh
node spikes/s8/build.mjs && node spikes/s8/probe-q7.mjs
```

It launches Playwright's Chrome for Testing headless, as `e2e/fixtures.ts` does, installs a fake
`Translator` / `LanguageModel` with `context.addInitScript`, and checks what `ext/probe.js` saw at load on
pages opened by `page.goto`, by `chrome.tabs.create` from the worker, and by `window.open`. With the fake in
place it also clicks through every harness button, as a smoke test of this spike's code.
