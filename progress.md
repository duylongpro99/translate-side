# M0 — Supervisor progress log

Plan: docs/plans/M0-skeleton-and-spikes.md · Spec: DESIGN.md · Prompt: docs/prompts/implement-plan.md
Supervisor pane: wC:p2J (workspace wC)

Note: the /loop input listed `{{PLAN_FILE}}` twice; interpreted the second (DESIGN.md) as `{{SPEC_FILE}}`.

## Phase breakdown (supervisor's grouping of the plan's work)

The plan has no numbered phases; it has sub-goals A/B/C (§6). Each sub-goal is run as one phase.
Milestone success criteria (§3) are mapped to the phase that owns them.

### Phase A — A project you can build on
- Tasks: M0-E1 (WXT, TS strict, UI framework, Vitest, ESLint, CI; `engine/` boundary rule: may not import `chrome`, `wxt/*`, DOM types or `llm/` implementations), M0-E2 (manifest & entrypoints: `sidePanel`, `storage`, `activeTab`, `scripting`, `contextMenus`; `optional_host_permissions`; `Alt+T` command; `setPanelBehavior`).
- Pre-task: project is not under git (env says so) → git init is the first implementer task (to confirm with scout).
- Depends on: nothing.
- Done criteria: §3 #7 "CI runs lint, typecheck, unit/snapshot tests and the `engine/` boundary rule | green". Decision: UI framework (Preact or Svelte; default Preact).
- Spec: DESIGN §4 (intro, 4.1), §5.1 (boundary rules), §8 (permissions).

### Phase B — Retire the architecture risks (spikes, time-boxed 1–2 days each)
- Tasks: S1 worker suspension during streaming → engine host decision; S5 `activeTab` & navigation → permission/allowlist design; S2 `<seg>` robustness on Haiku 4.5 and a 7–8B local model → parser grammar; S3 extraction on 10 docs/article sites → fixtures & fallback thresholds; S4 Ollama from an extension → error classifier rule.
- Depends on: nothing (plan: "in parallel with setup") — needs git for its own worktree, so starts after git init.
- Done criteria: §3 #5 "Decision records S1–S5 merged | 5 of 5"; #6 "\"Where the engine runs\" decision is final | yes". Output in `docs/decisions/`. Decisions table §5 (engine host, `<seg>` grammar, extraction policy, Ollama 403, navigation/permissions, `minimum_chrome_version`).
- Spec: DESIGN §4.1, §4.2.6, §4.3.5–4.3.6, §5.7 step 3, §8.
- Gate: decision records go to the user for sign-off (engine host is final).
- Possible human dependencies: S2 needs an Anthropic key + local 7–8B model; S4 needs Ollama installed — to verify.

### Phase C — Clean segments in the panel
- Tasks: M0-E3 injection under `activeTab` ("already injected"/"cannot inject here"); M0-E4 typed, versioned Port protocol (content⇄worker⇄panel), tab-scoped routing; M0-E5 extraction on cloned DOM with poor-result fallback, denylisted origins never extracted; M0-E6 segmenter (kinds, inline markers `[link]…[/link]`, backticks, `*…*`, `domPath`, stable ids = hash(path+text), `groupId` for table rows); M0-E7 panel renders originals by kind, loading/empty/error states, dev-only segment view; M0-E8 ten fixtures from S3 with snapshot tests.
- Depends on: A (shell) and B (S3 fixtures/thresholds, S5 permission design, S1 host).
- Done criteria: §3 #1 "Fixture sites with no nav/footer noise in segments | ≥ 8 of 10"; #2 "Fixture sites with all code blocks intact and marked do-not-translate | 10 of 10"; #3 "Segment ids stable across two extractions of the same page | 100%"; #4 "Panel opens on `chrome://` / Web Store pages with a clear \"can't read this page\" state, no crash | yes"; plus #7 stays green. Demo script §7.
- Spec: DESIGN §3, §4.1, §8, §9.

### Human-owned work (do not delegate)
- Collect eval passages for M2 (M2-E8) — plan says start now. Status: not started, not blocking M0.
- Demo script §7 in real Chrome 138+ if testers can't drive Chrome — TBD.

## Sessions
| Name | Role | Pane | Phase | Status | ctx% |
|---|---|---|---|---|---|
| scout | Scout | wC:p2Q (tab wC:t1W) | all | idle; Q1 answered | 4% |
| impl-A | Implementer | wC:p2R (tab wC:t1X) | A | idle; round-1 fixes committed (06bd125, 46debd0) | 12% |
| test-A | Tester | wC:p2T (tab wC:t1Z) | A | round 2 testing 46debd0 | 8% |
| review-A | Reviewer | wC:p2V (tab wC:t10) | A | round 2 reviewing 6dab122..46debd0 | 9% |
| impl-B | Implementer | wC:p2S (tab wC:t1Y) | B | 9%; goal sent; worktree ../translate-side-B, branch phase-b-spikes; S1→S5→S3, S2/S4 wait Q-U1 | 0% |

## Scout facts (Q1, iter 1)
- Not a git repo ("fatal: not a git repository"). No M0 code exists: no package.json, tsconfig, eslint, vitest, CI, engine/, entrypoints, docs/decisions/, fixtures.
- ROADMAP.md exists: §2 = ROADMAP.md:49 (Spikes), §8 = ROADMAP.md:422 (Gaps in DESIGN), M0 = ROADMAP.md:67.
- Tools: node v24.18.0, npm 11.16.0, pnpm 10.6.2, Chrome 154.0.8037.93. `ollama` CLI not found, no /Applications/Ollama.app (~/.ollama dir exists).

## Phase status
- A: IN REVIEW (round 2 started on 46debd0; round 1 fixes: 06bd125 reviewer, 46debd0 tester; impl claims pnpm check green, 102 tests, fresh clone OK, check:manifest step added; tsc layer still resolves wxt types — ESLint is the guard) — prior: round 1 — impl-A commit 6dab122 "M0-E1/E2: WXT + Preact skeleton, engine boundary rule, manifest, CI". Self-check: `pnpm check` lint/typecheck/43 tests/build green; boundary rule via ESLint + engine tsconfig (no DOM lib); Chrome 154 load via CDP, panel opens on action trigger.
  - Criterion #7: local `pnpm check` green (implementer claim; tester verifying). GitHub Actions NOT run — no git remote → check couldn't run under required conditions → told user.
  - Review round 1 (review-A): 3 BLOCKING — B1 dynamic import() bypasses boundary; B2 `**/llm` barrel path not blocked; B3 contextMenus.onClicked registered inside onInstalled (MV3 listener must be top-level). 11 NON-BLOCKING N1–N11. Sent to impl-A: fix B1–B3, N1, N3, N4, N5, N6, N8, N11 small points (unhandled rejection, removeAll before create); N2 header note only; N7, N9, N10 recorded, not fixed. N9 → E5/E7 snapshot tests; N10 → M1 settles LLMClient shapes vs DESIGN §4.2.1.
  - Test round 1 (test-A, fresh clone of 6dab122): clean install + CI steps PASS (43 tests, build 16.46 kB); CI workflow covers criterion 7 (static); Chrome 154 PASS (perms exact, ⌥T on _execute_action, openPanelOnActionClick, triggerAction opens panel). Boundary FAIL: dynamic import(), typeof import(), globalThis.chrome / globalThis['document'], declared require() bypass. Not run: GH Actions (no remote), physical Alt+T. Forwarded extra bypasses to impl-A.
  - Owed doc update (not code): ROADMAP §8 item 19 asks for store justification of optional host perms in DESIGN §8 → spec change, needs user.
  - Reviewer open: does _execute_action + openPanelOnActionClick grant activeTab for later injection? → S5 / M0-E3.
  - Open from impl-A: (1) Alt+T never physically pressed (no screen-recording permission) → user to try; (2) no remote for GH Actions; (3) optional_host_permissions omit http://*/* (ROADMAP §8 item 19) → decide with S5; (4) @babel/core pinned 7, DEP0169 noise.
- B: IN PROGRESS — scout Q2 confirmed 6fef96a = only commit, HEAD of master. impl-B goal sent (worktree ~/personal/agent/translate-side-B, branch phase-b-spikes). Order: S1, S5, S3 first; S2/S4 wait on Q-U1 (human resources). Human deps: S2 needs Anthropic key + a 7–8B local model; S4 needs Ollama (not installed).
- C: BLOCKED on A and B.

## Decisions from user
- D1 (iter 1, re Q-U3): user set up a GitHub remote — "you can commit and push". Delegate push to impl-A after scout confirms remote and .env ignored.
- D2 (iter 1, re Q-U1): Ollama API key is in .env as OLLAMA_API_KEY; local model for S2/S4 = qwen3.5:9b. Anthropic key for S2 Haiku not mentioned yet.

## Open questions to user
- Q-U1 (iter 1): Ollama isn't installed. S4 (Ollama from an extension) and the local-model half of S2 need it. Will you install Ollama and pull a 7–8B model (e.g. qwen3:8b), and provide an Anthropic API key for the S2 Haiku runs? Or should those spikes record "unknown, chose default because" (plan §8 risk mitigation)?
- Q-U2 (iter 1): Phase A — please press Alt+T on a normal page with the build loaded (.output/chrome-mv3) to confirm the panel opens; sessions can't send a real keypress.
- Q-U3 ANSWERED (D1).
- Q-U4 (iter 1): S2 needs an Anthropic key for the Haiku 4.5 half — none in .env or env (scout Q3). Provide one, or run S2 on qwen3.5:9b only?
- Q-U5 (iter 1): no local Ollama (port 11434 closed, no CLI) — S4 local CORS/OLLAMA_ORIGINS path can only be tested against hosted Ollama; local parts recorded unverified unless user installs Ollama.
- (old) Q-U3 (iter 1): Criterion #7 says "CI … green". No git remote, so GitHub Actions can't run. Push to a remote so Actions runs, or accept the local `pnpm check` (same steps) as evidence for M0?

## Iteration log
### Iter 1 (2026-10-05)
- Supervisor ctx 7%. Read plan/spec, created this log. Starting scout.
- Scout Q1 answered (see Scout facts). Started impl-A (wC:p2R). ctx: supervisor 8%, scout 4%, impl-A 0%.
- impl-A: initial commit 6fef96a (claimed; scout verifying). Note: progress.md is tracked in git — supervisor edits will show as uncommitted changes; impl-A told nothing yet.
- Scout Q2: 6fef96a confirmed (master, single worktree, progress.md modified). impl-B goal sent.
- impl-A reported Phase A round 1 (6dab122). Started test-A (wC:p2T), review-A (wC:p2V). ctx: sup 10%, scout 5%, impl-A 9%, impl-B 9%.
- review-A round 1: 3 blocking/11 non-blocking; forwarded to impl-A. test-A pending.
- test-A round 1: boundary bypasses (overlaps B1/N3, plus typeof import/require/globalThis[...]); forwarded to impl-A. Next: round 2 test+review after impl-A commits.
- impl-A round-1 fixes committed 06bd125 + 46debd0. Round 2 sent to test-A and review-A. ctx: sup 11%, scout 5%, impl-A 12%, impl-B 12%, test-A 8%, review-A 9%.
- User: GitHub remote ready (commit+push OK); OLLAMA_API_KEY in .env, model qwen3.5:9b. Asked scout Q3 (remote, .env ignored, key names, local Ollama reachable).
- Scout Q3: origin git@cris:duylongpro99/translate-side.git, no upstream; .env ignored, only OLLAMA_API_KEY; no Anthropic key; no local Ollama. impl-A tasked: commit progress.md, push -u origin master, watch GH Actions. impl-B given Ollama key/model; S2 Haiku half blocked (Q-U4); S4 local parts unverified (Q-U5).
