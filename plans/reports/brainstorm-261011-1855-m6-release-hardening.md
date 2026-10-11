# M6 brainstorm contract — Release hardening → v1.0

Source plan: `docs/plans/M6-release-hardening.md` (accepted; reused, not restated). Starting point: master @ ae9f9fb,
M5 FINAL STATE and M6 handoff in `docs/progress/progress-m5.md`.

## Outcome

v1.0 is ready to publish on the Chrome Web Store. Quality cannot silently regress: an eval gate runs in CI on changes
to prompts, strategies or the default model. Upgrades keep settings and cache. Large glossaries and many site rules
do not break sync storage. The store package, docs and privacy policy match what the code actually does.

## Constraints

- The repo is public. Never commit keys or the local username. `gh` is read-only, so the user adds CI secrets.
- No telemetry. Diagnostics stay local and the user exports them.
- The judge is advisory against human scores (M2-D23). The gate compares judge scores with judge scores on the
  same passages, with a margin taken from measured judge variance.
- `minimum_chrome_version` stays 138. Features are gated by availability checks.
- No new features. Anything not needed to ship goes to M7.

## Decisions taken in this brainstorm (2026-10-11)

| # | Decision | Choice |
|---|---|---|
| 1 | Where the eval gate runs | A CI job using a GitHub Actions secret (`AIBOX_API_KEY`, which the user adds). It runs only when `engine/prompts`, `engine/strategies` or the default model change. On fork PRs, which get no secret, it skips with a notice. |
| 2 | Haiku 4.5 cost (§3 #4) | Measured live through the existing OpenRouter key (`anthropic/claude-haiku-4.5`). This needs a few cents of credit. |
| 3 | Store and beta | M6 delivers a submission-ready package. The user uploads it, runs the unlisted beta and switches to listed. The agent keeps the beta fix list. |
| 4 | UI locale | The `_locales` scaffold ships English and Vietnamese. |

The plan §5 defaults stand for the rest: margin of 2× the observed standard deviation per dimension, sync overflow
moved to `local` with a sync pointer or chunked items, the host-permission justification as written, `Alt+T` kept
and documented as rebindable, and coverage targets for `engine/` and `llm/` only.

## Non-goals

- New features, telemetry, and full UI translation beyond English and Vietnamese.
- The agent uploading to the store or recruiting beta users.
- Fixing the M2 accepted gap (contextual ≥ single-pass), which is M7.

## Acceptance criteria

Plan §3 applies, with these readings:

- **#1 v1.0 published:** the agent's part is done when the zip, listing text, screenshots, privacy policy and
  permission justifications are complete. Publishing is a user step and is tracked as open until the user confirms.
- **#2 E2E:** 20 of 20 fixture pages pass with no console errors. The repo has about 18 today (13 site pages, 3 SPA
  pages, 2 long pages), so at least 2 more are needed.
- **#3 Eval gate:** green in CI on the current default, within the margin of the M2 baseline. The demo shows a
  deliberately worse prompt failing the gate.
- **#4 Haiku cost:** measured on long articles through OpenRouter and documented next to DESIGN §6's ≈ $0.04.
- **#5–#8:** as the plan states.
- **#9 Closed beta:** the fix list exists and stays open until the user runs the beta.
- **UI locale:** the English and Vietnamese UI strings both load.
- **Open human items carried from M5:** each is either covered by e2e or added to the beta checklist. They are the
  permission prompt, rapid `Alt+T` presses and the toolbar toggle, the Chrome 138–140 toggle fallback, screen-reader
  speech, and dark-mode contrast.

## Trade-offs

- **CI gate with a secret (chosen).** It relies on the user adding the secret and on judge variance being small
  enough that the margin still catches real drops. It fails first if the judge model behind APIBOX changes or is
  retired, which would turn the gate flaky or red without any change in quality. Mitigations: re-run once before
  failing, and record the judge version in the baseline.
- **Local-only gate (rejected).** It relies on someone remembering to run it, and it fails on the first prompt
  tweak merged without running it.
- **OpenRouter for the Haiku measurement (chosen).** It relies on OpenRouter passing Anthropic usage and prices
  through faithfully. It fails first if OpenRouter's routing adds overhead or caching differs from the native API.
  Record the raw token counts, so the cost can be recomputed at Anthropic list prices.

Better approaches: none. Each recommended direction is the plan's own default, and the repo already has the eval
harness (`scripts/eval*`), the migration harness (`scripts/eval/migration.ts`) and a basic glossary quota guard
(`src/shared/settings.ts:322-380`) to build on.

## Risks to carry into the plan

- The M2 baseline (qwen3.8-flash, `translate@2`) predates M3–M5. Confirm the current default prompt and strategy
  still match it before using it as the gate reference. Otherwise re-baseline once, and record why.
- Playwright cannot open Chrome's side panel directly. E2E drives `sidepanel.html` as a tab, plus content-script
  checks on the fixture pages. The real docked panel stays a beta checklist item.
- Store review of the wildcard `optional_host_permissions` is the main schedule risk outside the agent's control.

## Handoff

Next: `ak:plan`, to turn plan §6 sub-goals A–D into phases with this contract attached. Then run the supervised
implementation as in M5 (`docs/prompts/implement-plan.md`, log in `docs/progress/progress-m6.md`). M6-E1 and M6-E8
(store assets and docs) can run in parallel with A and B, as plan §6 allows.
