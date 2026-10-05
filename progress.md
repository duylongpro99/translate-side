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
| scout | Scout | wC:p2Q (tab wC:t1W) | all | goal acked; Q1 (git/existing work/tools) pending | ~0% |

## Decisions from user
(none yet)

## Open questions to user
(none yet)

## Iteration log
### Iter 1 (2026-10-05)
- Supervisor ctx 7%. Read plan/spec, created this log. Starting scout.
