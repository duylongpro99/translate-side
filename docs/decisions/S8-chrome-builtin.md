# S8 — Chrome built-in AI on real Chrome → zero-setup engine parameters

Status: **Provisional — Q1–Q6 pending the owner's run on Chrome stable.** Q7 answered 2026-10-20 · Date: 2026-10-20 ·
Q7 on Chrome for Testing 156.0.8078.4 (macOS 26.6.2, arm64, headless), Playwright 1.64.0 · Spike code: `spikes/s8/` ·
Plan: `plans/261020-1216-chrome-builtin-zero-setup/phase-01-spike-s8.md` · Research:
`plans/261020-1216-chrome-builtin-zero-setup/research/researcher-01-chrome-builtin-ai.md`

## Question

The zero-setup route uses Chrome's Translator and LanguageDetector by default, and Gemini Nano (`LanguageModel`) when
the target is one of `en, es, ja, de, fr`. Phases 2 and 3 need seven answers:

1. **Pair persistence.** Does a pair created once in the side panel stay `available` for later panel sessions and after
   a browser restart? (The service-worker zero-click path is out of scope; recorded for information only.)
2. **Side-panel activation.** Does `Translator.create()` fail without a click and succeed synchronously in a click
   handler? Does `LanguageModel.create()` succeed after any earlier click (sticky)?
3. **Nano output format.** Segment markers (the single-pass prompt) or a `responseConstraint` JSON array: which fails to
   parse less often?
4. **Nano limits.** `contextWindow` (or `inputQuota`), time to first token and tokens/s on a 1,200-token chunk, the
   largest chunk that avoids `QuotaExceededError` with the system prompt.
5. **Timings.** First download of a direct Translator pair, a pivoted pair (`ja→vi`), and Nano.
6. **Unavailable reasons.** Can the extension tell "unsupported hardware", "policy or setting off" and "unsupported
   language" apart?
7. **e2e fake injection.** Does Playwright's `context.addInitScript` run on `chrome-extension://…/sidepanel.html` before
   the page's scripts, so a fake `Translator` / `LanguageModel` replaces Chrome for Testing's real ones?

## Method

- `spikes/s8/ext/` is an unpacked MV3 extension with a side panel and a service worker. The panel has the buttons
  "availability (all)", "create Translator (in click)", "create Translator (deferred 10 s)", "create Nano", "create Nano
  (deferred 10 s)", "ask background to create Translator", a "create at panel load (no click)" switch, and a Nano
  harness (Q4 limits, Q4 speed, Q4 largest chunk, Q3 markers vs JSON). Every availability state, `downloadprogress`
  event, create result and harness measurement is logged with a timestamp; the log is copied as JSON.
- The harness uses the product's own code, not a copy: `spikes/s8/build.mjs` bundles `translate@2`
  (`src/engine/prompts/translate.ts` through `renderSystemPromptV2`), the `<seg>` wire format, `SegParser` and the
  repair plan into `ext/engine.js`, and runs the product's extractor over three site fixtures (`mdn-promise-then`,
  `goblog-pipelines`, `globalvoices-bangladesh-protests`) into `ext/fixtures.json`. A marker failure is a segment the
  repair plan would re-request. The JSON variant swaps only the two marker output rules of the same prompt (the build
  fails if they are no longer there).
- How the owner runs Q1–Q6, step by step (including a second fresh profile for Q1): `spikes/s8/README.md`.
- Q7: `spikes/s8/probe-q7.mjs` launches Chrome the way `e2e/fixtures.ts` does (`launchPersistentContext`, channel
  `chromium`, `--load-extension`, the `CHROMIUM_ARGS` flags) with `spikes/s8/ext`. `ext/probe.js`, the panel's first
  script, records `typeof Translator` and the fake's marker at load in `__s8AtLoad`. Raw output: `spikes/s8/results/q7.json`.

## Environment (owner fills in for Q1–Q6)

| Field | Value |
|---|---|
| Chrome stable version (`chrome://version`) | _pending_ |
| OS and version | _pending_ |
| CPU, cores, RAM | _pending_ |
| GPU and VRAM | _pending_ |
| Free disk on the profile volume | _pending_ |
| `chrome://on-device-internals`: model state, performance class | _pending_ |
| `chrome://settings/ai` on-device AI toggle present / on | _pending_ |
| Profiles used (main, fresh for Q1) | _pending_ |
| Log files saved under `spikes/s8/results/` | _pending_ |

## Evidence

### Q7: e2e fake injection — answered

Run 2026-10-20, Playwright 1.64.0, its `chromium` channel build `chromium-1248` = **Google Chrome for Testing
156.0.8078.4** (`HeadlessChrome/156.0.0.0`), macOS 26.6.2 arm64.

| Page | `addInitScript` fake | `typeof Translator` at the page's first script | Fake marker seen at load |
|---|---|---|---|
| Panel by `page.goto` | none (baseline) | `function` (the real one) | no |
| Panel by `page.goto` | `context.addInitScript` | `object` (the fake) | **yes**, both `Translator` and `LanguageModel` |
| Panel by `chrome.tabs.create` from the worker (the extension opens it) | `context.addInitScript` | `object` | **yes** |
| Panel by `window.open` from another extension page | `context.addInitScript` | `object` | **yes** (but that page has no `chrome.runtime`, with or without the fake) |
| Service worker | `context.addInitScript` | `function` (real) | no: init scripts are for pages only |

- A plain assignment (`globalThis.Translator = fake`) replaces the real interface object: it is writable.
- Baseline, Chrome for Testing's real APIs: `Translator.availability(en→es)` = `downloadable`,
  `LanguageModel.availability()` = `unavailable`, `LanguageDetector.availability()` = `unavailable`. Unfaked e2e runs
  would therefore see the download path for Translator and "can't run" for Nano and the detector.
- With the fake in place the probe clicked through every harness button (availability, create in click, create Nano,
  Q4 limits/speed/largest chunk, Q3 for `es` and `es→en`) with no page error and no logged error. This smoke-tests the
  spike's code, not Chrome.
- Not covered: the real docked side panel (Playwright cannot open it; e2e uses the panel page in a tab, as
  `e2e/fixtures.ts` already does), and the product's `pnpm build` output (the init script runs per page before any document
  script, so the bundle's shape should not matter; phase 5's first e2e run confirms it on the real build).

### Q1–Q6 — pending the owner's run

| # | Question | How to measure with the spike | Result |
|---|---|---|---|
| 1 | Pair persistence | Fresh second profile. Availability at load (`downloadable`), create `en→vi` and `ja→vi` in click, reopen the panel, quit and restart Chrome, availability at load again. "ask background" in another fresh profile, information only. | _pending_ |
| 2 | Side-panel activation | "create at panel load (no click)" on a `downloadable` pair and Nano; "create Translator (deferred 10 s)" vs "(in click)"; "create Nano (deferred 10 s)" after a click. Each `.called` line logs `navigator.userActivation`. | _pending_ |
| 3 | Nano output format | "Q3 markers vs JSON", target `es`, then `en` (`es→en` on the Spanish output), chunk tokens 1,000, 3 chunks per fixture. `q3.summary` per format: chunks, segments, failed segments, rate. | _pending_ |
| 4 | Nano limits | "Q4 limits" (`contextWindow` / `inputQuota`, system prompt tokens), "Q4 speed" (TTFT, tokens/s, output/input ratio on ~1,200 tokens), "Q4 largest chunk" (measured max, confirmed by `QuotaExceededError` one size up, round trip at half the room). | _pending_ |
| 5 | Timings | From the Q1/Q3 logs: `create.called` → `create.ok` and the `downloadprogress` lines for `en→vi`, `ja→vi`, Nano. | _pending_ |
| 6 | Unavailable reasons | "availability (all)" in each state the owner can produce (normal, on-device AI setting off, policy if possible); the `en→vi` Nano line is the unsupported-language case. Note console warnings. | _pending_ |

## Decision

Provisional for Q1–Q6: the implementation (phases 2–4) uses these until the owner's numbers confirm or replace them.

1. **Pair persistence (Q1), provisional.** A created pair persists across panel sessions and browser restarts. The
   turn-on click is per pair, on first use only. The UI re-checks `availability()` every time anyway, so a pair that
   turns out not to persist shows the turn-on click again instead of failing. The service-worker create path is not used.
2. **Activation (Q2), provisional, from the research.** `Translator.create()` is called synchronously in the turn-on
   click handler, with no `await` before it. `LanguageModel.create()` is called from a click too.
3. **Nano output format (Q3), provisional.** The existing segment markers with the single-pass prompt, unchanged. On a
   parse failure the chunk switches from Nano to Translator (it does not retry Nano).
4. **Nano chunk size (Q4), provisional.** Derived at runtime from `contextWindow` (fallback `inputQuota`). Until
   measured: default `chunkTokens` 1,000, `maxConcurrency` 1.
5. **Reason codes (Q6), provisional, from the research.** Three reasons the UI can show:
   - **"Can't run on this device"**: one combined message for unsupported hardware, policy, and the on-device AI
     setting. They all surface as `unavailable` and cannot be told apart.
   - **"Pair not supported"**: the API exists, but Translator or Nano reports `unavailable` for this specific pair.
   - **"No API"**: the global (`Translator`, `LanguageModel`) is missing.
6. **e2e injection (Q7), decided.** e2e fakes the built-in APIs with `context.addInitScript` installing fake
   `Translator` / `LanguageModel` (and `LanguageDetector` where needed) globals. It reaches the panel page before its
   bundle whether the test opens it with `page.goto` or the extension opens it. No preview-only build flag is needed.
   The fake does not reach the service worker, which is fine while the engine runs in the panel (decision S1).

## Consequences

- Phase 5's e2e flows can drive the zero-setup route with fakes (availability states, download progress, create
  errors) in the existing harness; tests that do not install the fake see Chrome for Testing's real states
  (`downloadable` Translator, `unavailable` Nano and detector).
- The provisional values above are the ones to revisit once Q1–Q6 are measured; any that change go back to the phase
  that owns them (phase 2: engine route and chunking; phase 3: enable and download flow; phase 4: messages).

## Limits of this spike

- Q1–Q6 have no measurements yet; everything for them above is provisional and comes from the research (source reads).
- Q7 ran on Chrome for Testing headless, with the panel as a tab, not the docked side panel.
- The Q3 harness counts first-pass parse failures only; the product's one repair round is not run.

## Shipped behavior

_Pending: the owner's manual check on Chrome stable (load `.output/chrome-mv3` unpacked). Record the Chrome version,
the result and any note for each row._

| Check | Expected | Result |
|---|---|---|
| Fresh profile, no key, target `vi`, an English page | "Turn on" for English → Vietnamese; the click shows the download, then the page translates with "basic translation" badges; no privacy notice | |
| Target `en` on a non-English page, Nano available | Gemini Nano blocks ("Gemini Nano (on device)" badges) | |
| On-device AI turned off (`chrome://flags` or policy), no key | The reason and "Set up a provider" | |
| With a key | Unchanged: the provider translates, the privacy notice comes first | |
| A mixed-language page | Each new pair asks for its own click once; later pages with that pair need none | |
| The onboarding guide on a fresh profile | "Translate on this device with Chrome" is chosen; its sample translates after one click | |

Behavior covered by automated tests (Chrome for Testing with the fake from `e2e/builtin-ai.ts`, and unit tests with
`src/llm/testing.ts` `fakeBuiltinAI`): the turn-on click creates the pair in the click's own task; no job creates a
model or pair that is not `available`; a keyless install translates on the device after an upgrade; Nano is never
asked about a language outside its list (Chrome logs a console error for that, which Chrome for Testing showed on
the onboarding page during the first e2e run).
