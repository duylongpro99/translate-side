# M6 — Release hardening → v1.0

Size: M · Depends on: M3–M5 · Unblocks: M7

## 1. Goal

**Ship v1.0 on the Chrome Web Store, with a gate that stops prompt, model or strategy changes
from silently making translations worse.**

By now the features exist. M6 is about trust: from store reviewers (clear permission
justifications), from users (a privacy policy that matches what the code does, no console
errors, no lost settings on upgrade), and from the developer (an eval regression gate in CI, so
the quality won in M2 can't erode one prompt tweak at a time). Without the gate, M7's stronger
strategies can't be shipped safely.

## 2. Done looks like

- v1.0 is published, first unlisted for a closed beta, then listed.
- The store listing has screenshots, a privacy policy and a justification for every permission,
  including the wildcard `optional_host_permissions`.
- CI runs Playwright e2e tests with the extension loaded against a mock provider over 20
  fixture pages, plus an eval regression job that fails if judge scores drop below the M2
  baseline by more than the set margin.
- Upgrading from any earlier build migrates settings and cache without data loss.
- A large glossary or many site rules don't break sync storage.
- Settings can export a local diagnostic log of the last N jobs (no telemetry).
- README, Ollama/LM Studio setup guide, provider matrix and privacy page are published.

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | v1.0 published | unlisted, then listed |
| 2 | E2E on fixture pages, mock provider | 20 of 20 pass, no console errors |
| 3 | Eval scores vs M2 baseline (default prompt + strategy) | within margin; gate green in CI |
| 4 | Cost per long article on Haiku 4.5, measured and documented | ≈ $0.04 (DESIGN §6) |
| 5 | Memory and responsiveness on a 100-screen page | within the set budget |
| 6 | Bundle size | within the S7 budget |
| 7 | Settings/cache migration from every earlier schema version | tested |
| 8 | Sync storage over quota (synthetic large glossary) | no failure; falls back as designed |
| 9 | Closed beta | a handful of users; fix list closed or scheduled |

## 4. Out of scope

- New features. Anything not needed to ship goes to M7 or later.
- Telemetry of any kind. Diagnostics stay local and user-exported.
- Full UI translation (only the localization scaffold plus English and the assumed user's
  target language).

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| Regression margin | M6-E3 | Set from judge variance measured over repeated runs of the baseline (e.g. 2× the observed standard deviation per dimension). |
| Gate cost in CI | M6-E3 | Run on changes to `engine/prompts`, `engine/strategies` or default model; not on every commit. |
| Sync quota strategy | ROADMAP §8 item 17 | Glossary and site rules move to `local` with a sync pointer (or chunked items) when over quota. |
| `minimum_chrome_version` | §8 item 18 | 138 (from M0), features gated by availability. |
| Host permission justification | §8 item 19 | `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` (and `http://*/*` for LAN gateways), requested only on user action per origin. |
| `Alt+T` on macOS | §8 item 20 | Keep default; document rebinding in onboarding and README. |
| Coverage targets | M6-E2 | Set for `engine/` and `llm/` only (they hold the logic); UI covered by e2e. |

## 6. Work plan

**Sub-goal A — quality can't silently regress**
- M6-E3 Eval regression gate in CI against the stored M2 baseline.
- M6-E2 Playwright e2e with the extension loaded, mock provider, fixture pages; unit coverage
  targets for `engine/` and `llm/`.

**Sub-goal B — robust for real users**
- M6-E4 Performance: large-DOM extraction in idle callbacks, bundle budget, memory check on a
  100-screen page.
- M6-E6 Settings and cache schema versioning with migrations; sync quota guard.
- M6-E5 Diagnostics: local, exportable log of the last N jobs; error boundary in the panel.
- M6-E7 UI localization scaffold.

**Sub-goal C — accepted by the store and understood by users**
- M6-E1 Store assets, privacy policy, permission justifications.
- M6-E8 Docs: README, local model setup, provider matrix (from M4), privacy page.

**Sub-goal D — validated by people other than the developer**
- M6-E9 Closed beta (unlisted listing), fix list, then list publicly.

## 7. Demo script

1. Show the CI run: lint, typecheck, unit, e2e (20 pages), eval gate green.
2. Make a deliberately worse prompt change on a branch; show the eval gate failing.
3. Install an M3-era build with data; upgrade to v1.0; show settings, glossary and cache intact.
4. Load a synthetic 1,000-entry glossary; show it still saves and syncs as designed.
5. Show the store listing (unlisted), privacy policy and permission justifications.
6. Show the documented cost per long article and the beta fix list.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Store review rejects or delays the wildcard host permission | Clear justification, request-on-action only; prepared during M5; unlisted release first. |
| LLM-judge noise makes the gate flaky | Margin from measured variance; fixed judge version; re-run once before failing. |
| Beta users hit sites not in fixtures | Diagnostics log export; add their sites as fixtures. |

## 9. Handoff to M7

- A regression gate that `refine` and new prompts must pass.
- Versioned settings and cache schemas ready for revision-2 segments and translation memory.
- Beta feedback on where quality falls short, to target with `review`.
