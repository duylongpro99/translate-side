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
- S5 manual checklist (spikes/s5/manual-ext/README.md in ../translate-side-B): Alt+T and context-menu activeTab grant — 2 min, user. Combine with Q-U2 Alt+T check.
- Collect eval passages for M2 (M2-E8) — plan says start now. Status: not started, not blocking M0.
- Demo script §7 in real Chrome 138+ if testers can't drive Chrome — TBD.

## Sessions
| Name | Role | Pane | Phase | Status | ctx% |
|---|---|---|---|---|---|
| scout | Scout | wC:p2Q | all | CLOSED (run complete; Q1–Q7 answered) | - |
| impl-A | Implementer | wC:p2R | A | CLOSED (phase accepted) | - |
| test-A | Tester | wC:p2T | A | CLOSED | - |
| test-B | Tester | wC:p2W | B | CLOSED (phase accepted) | - |
| review-B | Reviewer | wC:p2X | B | CLOSED | - |
| review-A | Reviewer | wC:p2V | A | CLOSED | - |
| impl-B | Implementer | wC:p2S | B | CLOSED | - |
| impl-C | Implementer | wC:p2Z | C | CLOSED (phase accepted) | - |
| test-C | Tester | wC:p31 | C | CLOSED | - |
| review-C | Reviewer | wC:p32 | C | CLOSED | - |

## Scout facts (Q1, iter 1)
- Not a git repo ("fatal: not a git repository"). No M0 code exists: no package.json, tsconfig, eslint, vitest, CI, engine/, entrypoints, docs/decisions/, fixtures.
- ROADMAP.md exists: §2 = ROADMAP.md:49 (Spikes), §8 = ROADMAP.md:422 (Gaps in DESIGN), M0 = ROADMAP.md:67.
- Tools: node v24.18.0, npm 11.16.0, pnpm 10.6.2, Chrome 154.0.8037.93. `ollama` CLI not found, no /Applications/Ollama.app (~/.ollama dir exists).

## Phase status
- A: ✅ ACCEPTED (iter 1) at 64b41da — tester all PASS, reviewer 0 blocking, user D6/D8, scout Q4: master = origin/master = 64b41da, CI run 37324343930 success, clean tree. Carry-overs to Phase C / M1: S5 deviation (a) action.onClicked flow + http://*/* (pending user decision, implement in M0-E3); N7 jsdom, N9 snapshot tests (E5/E7/E8), N10 LLMClient shapes (M1); FP-1..4 + H-1/H-2 header wording; DESIGN §8 store justification (spec change). Sessions impl-A, test-A, review-A closed.
  - History: 4 review rounds; boundary escalated after 3 failed rounds → user D6 (accidental-coupling scope). Full round-by-round detail in git history of this file (commit 144f871 and later local edits).
- B: ✅ ACCEPTED (iter 9) at dd4d447 (master = origin/master; CI 37404728736 success). Tester all PASS on fresh clone (records 5/5 merged = #5; engine host side panel final = #6), reviewer 0 blocking, user D9–D22, scout Q6 confirmed. History rewritten (D22). Sessions impl-B, test-B, review-B CLOSED; local backups deleted; worktree translate-side-B detached at dd4d447 (kept for S5 checklist path). Residual: GitHub still serves pre-rewrite SHAs (e.g. 805ae64, 64b41da) and old CI runs 37324343930/37321990614/37320777869 link them → user (gh run delete + GitHub Support purge).
  - History (was IN PROGRESS) — scout Q2 confirmed 6fef96a = only commit, HEAD of master. impl-B goal sent (worktree ~/personal/agent/translate-side-B, branch phase-b-spikes). Order: S1, S5, S3 first; S2/S4 wait on Q-U1 (human resources). Human deps: S2 needs Anthropic key + a 7–8B local model; S4 needs Ollama (not installed).
  - S1 (impl-B, 0c7d34e on phase-b-spikes): docs/decisions/S1-engine-host.md. Decision = side panel page (plan default). Evidence: idle Port killed ~30 s (6/7); timer/heartbeat keepalives survive 90 s & 400 s; chunk-driven keepalive dies with 45 s first-byte delay; fetch in page 90/90 while worker died. Consequences: closing panel cancels job; one engine per window; no storage.session job state in M1; DESIGN §4.1 "Port keeps worker alive" is wrong → SPEC CHANGE proposal (user). Round 1 test/review started.
  - S1 review round 1 (review-B): decision sound, plan default, no deviation. BLOCKING: B1 spike files fail master lint (spikes/ not ignored) → deferred to final Phase B step (rebase on accepted master + ignore spikes/ + pnpm check green); B2 S1 cites uncommitted spikes/s5/results → impl-B to verify in 921fee0 and fix refs. NON-BLOCKING N1 (E2 global side_panel, E3 who injects, E4 Port topology content→panel), N2 per-window concurrency, N3 DESIGN edits → impl-B lists proposed spec changes (user decides), N4 hidden-window timer throttling, N5 soften wording, N6 Chrome 154 only, N7 empty .out files → all sent to impl-B. test-B S1 pending.
  - S1 round 2 (impl-B, 182d488): B2 depends-on S5 cited; N1–N7 addressed; "Proposed spec changes" section (4 DESIGN edits, not applied). Sent to review-B.
  - S3 (impl-B, 793156a): docs/decisions/S3-extraction-policy.md + fixtures/sites/ (10 pages, ~3 MB) + spikes/s3/. Readability headings kept: Docusaurus 6/19, Substack 0/11, Wikipedia 9/19; drops intro on MDN/GitBook and hidden tab panels. Walk: 100% headings + visible pre, 0 nav/footer leak on 10/10. Text-ratio 0.89–1.00 can't detect losses. MDN code only in open shadow roots → extraction must compose shadow trees. DEVIATION (b): walk first (≥500 chars, link density ≤0.35) → Readability → selection hint; alt: keep default + heading-loss signal. Flag: third-party pages committed (licensing before public). Sent to test-B + review-B.
  - S5 (impl-B, 921fee0): docs/decisions/S5-activetab-navigation.md. activeTab survives same-origin/hash/pushState/reload, revoked cross-origin; host perm allows no-gesture injection; sidePanel.open needs gesture; panel click = gesture but not activeTab grant; undeclared origin can't be requested. DEVIATION (a) from M0-E2: openPanelOnActionClick:false + action.onClicked → sidePanel.open({tabId}) → inject (setPanelBehavior path grants no activeTab). Recommendation: add http://*/* to optional_host_permissions. Plan defaults kept: allowlist=optional host perm; auto-open→auto-translate-when-open; min chrome 138. UNVERIFIED (needs human): Alt+T and context-menu grant activeTab — checklist spikes/s5/manual-ext/README.md. Queued to test-B/review-B after S1.
  - S5 review round 1 (review-B): evidence supports onClicked flow + http://*/*. BLOCKING: B1 unflagged deviation — toolbar/Alt+T no longer toggle panel closed (ROADMAP:292 "Alt+T toggle"); B2 unclear whether same-origin nav on non-allowlisted site auto-translates (DESIGN §8 "Never auto-translate by default"). NON-BLOCKING N1 manual checklist before E2 (user), N2 name master code changes (panel.ts:14, panel.test.ts:11, wxt.config.ts:17, check-manifest.mjs:16), N3 E3/E4 idempotent injection, per-tab access state, panel-ready handshake, N4 ROADMAP:285 M5-E3, N5 auto-translate across tabs, N6 runtime grant unverified + Allow clicks, N7 DESIGN:731/:717, N8 lint. Sent to impl-B (queued after S1 amendments).
  - S5 round 2 (impl-B, e699e85): B1 → Deviation (c) no toggle (options: open-only in M0, or sidePanel.close emulation 141+); B2 → extract-only on same-origin nav (not a deviation; "Translate this page" works while grant lives); N2–N7 amended; 7 proposed spec edits (DESIGN 716/727/731; ROADMAP 285/292/M0-E2/§8 item 6); manual checklist "What to report" (rows 1,3,5,6 decisive; 7,8 toggle). Sent to review-B.
  - S1 round 2 review: ALL RESOLVED (B1 lint deferred).
  - S1 test (test-B, fresh clone): decision PASS; all claims reproduced except port-idle count (re-run 4/7 aborted vs record 6/7 → survival understated; strengthens nondeterminism) → impl-B to reword finding 1/Limits + r1 log note. Remaining for S1: that rewording, then accept with Phase B.
  - S3 review round 1 (review-B): BLOCKING B1 — noise metric circular (truth & leak use walk's own exclusions); real walk output has in-content UI noise (Wikipedia [edit]×19, Substack paywall notice, GitBook "Was this helpful?", Medium reading time + promo heading, Guardian "Share") → criterion #1 unproven; redo honest trade-off. NON-BLOCKING N1 unexplained Substack/Wikipedia losses, N2 untested thresholds, N3 E5/E6 consequences (shadow-aware domPath, hidden tab panels, CSS-hidden), N4 shadow DOM VERIFIED, N5 criterion #2 vacuous on 3 fixtures, N6 licensing (all-rights-reserved Guardian/Medium/Substack/GitBook; CC BY-SA Wikipedia/MDN need attribution) → user, N7 tracking IDs in GitHub/Guardian fixtures (visitor_id, region) → scrub, N8 spike package.json isolation. Sent to impl-B.
  - S5 round 2 review: B1, B2, N2–N7 RESOLVED; N4 impl-B correction accepted. OPEN: N1 manual checklist (user) or "accepted unverified". New NON-BLOCKING R1 active-tab-only jobs rule = product choice → user decision for M1; R2 spec change 7 conditional on checklist; R3 duplicate bullets → impl-B.
  - BRANCH REWRITE (impl-B filter-branch, licensing D7): S1 0c7d34e, S5 921fee0 unchanged; S3 793156a→f361bc1; S1 amend 182d488→7eb87b9; S5 amend e699e85→f17a635; old fixtures not in branch history (unreachable blobs in shared store until gc — not pushed; gc not run).
  - S3 round 2 (impl-B, 094daf6): licensed fixtures (Docusaurus CC-BY-4.0, MkDocs MIT, mdBook Rust book MIT/Apache, MDN CC-BY-SA-2.5, docs.rs MIT, GitHub bat README MIT/Apache, Wikipedia CC-BY-SA-4.0, Go blog CC-BY-4.0, TWiR CC-BY-SA-4.0, Global Voices CC-BY-3.0) + ATTRIBUTION.md. Honest noise (hand list noise.json): 0-noise sites R 7/10, W 4/10, W+generic 4/10, W+generic+per-generator 9/10 (overfit), R+G+S 10/10; W noise 0–5.3% of chars. Readability corrupts code on 2/8 (Docusaurus tab panels; Go blog deletes 54/55 <pre> comments, undetectable by counts) + loses headings on 3. Criterion #1 reported NOT met by walk alone. Deviation (b) kept on criterion #2. N2: link-density guard misfired on TWiR (0.58) → tie-breaker. scrub.mjs recursive. Sent to review-B + test-B.
  - S3 round 2 review (review-B): B1, N1–N8 RESOLVED; 0 blocking. History clean (never pushed; local reflog only). Scrub + licensing verified. NON-BLOCKING C1 circular content-recall for +G/+S, C2 noise counter undercounts, C3 Gravatar/nonces/analytics comment in Global Voices, C4 Go blog license version → impl-B; C5 repo has NO LICENSE file (user), C6 noted.
  - S3 round 2 test (test-B, fresh clone 094daf6): regen identical PASS; Go blog (all 54 comments deleted) PASS; scrub/offline PASS; history PASS (old blobs reflog-reachable locally only, not pushable). FAIL noise.json completeness: Global Voices misses ~26 visible items (W noise ≈14.1% not 5.3%), Wikipedia 3 hidden items. → impl-B to complete list + re-score + wording. S3 round 3 needed after.
  - Fix batch ded4417 (impl-B): S3 C1 (content vs truth minus noise.json only → W/W+G/W+G+S 100% blocks+pre 10/10), C2 substring upper bound (R 6, W 4, W+G+S 8, R+G+S 9 /10), C3 scrub, C4 Go = CC BY 4.0 text/BSD code; noise.json completed; zero-visible-noise R 7/W 4/W+G+S 9; W noise 0–14.5%. S5: Allow attributed to user; step 24 panel-click inject on C after grant loss FAIL (verifies Decision 3); behavior re-run reproduces; R2 conditional; R3 merged. S1 counts reworded. → review-B + test-B (S3 r3 / final S1, S5).
  - Review of ded4417 (review-B, numbers re-run byte-identical): 0 BLOCKING. S3 C1–C4 + noise gaps RESOLVED; S5 Allow/step 24/behavior re-run/R2/R3 RESOLVED; S1 wording RESOLVED. NON-BLOCKING: D1 "100% content" overclaims — walk drops aria-hidden tabpanel (GV Bangla original quote; Readability too) → reword + E5 rule; D2 g-diagnose no-op filter; S1 tester figures not in repo → label. Queued to impl-B behind S2/S4. Awaiting test-B ded4417.
  - USER DECISIONS PENDING for Phase B bundle: (iii) repo LICENSE (public repo has none; fixtures/ excluded + ATTRIBUTION.md). (i) github.com page markup around bat README — keep or cut to README article; (ii) criterion #1 approach: per-generator noise selectors in M0, or accept #1 unmet / reword to "judged against noise.json" (spec change 4).
  - S3 test (test-B, 793156a): all 5 claims PASS (byte-identical regen; negative controls; text-ratio; MDN shadow roots in real Chrome — cloneNode drops 18 hosts; offline content OK). Errors → impl-B: MDN wholepage 99% not 100%; text-ratio citation; stale Wikipedia char count; heading-loss alt triggers on 5 fixtures not 3; MDN nested-template iframe not stripped (README FAIL); third-party prefetch/images offline caveats; peek.mjs false negatives.
  - S5 test (test-B, headful 154): 4/5 claims PASS (activeTab table, behavior-mode no grant + toggle, onClicked→open→inject, panel click gesture-not-grant, undeclared origin). "Prompt resolved true" NOT reproduced (nobody clicked) → explained by user's manual Allow (D7). Gaps → impl-B: panel-click inject on C after grant lost in onclicked mode (add driver step), stale behavior-optional.jsonl driver, README nits a–c.
  - Incoming deviations (heads-up from impl-B): (a) S5: setPanelBehavior({openPanelOnActionClick:true}) does NOT grant activeTab and doesn't fire action.onClicked → injection fails; propose action.onClicked → sidePanel.open({tabId}) + inject. Affects Phase A's M0-E2 (setPanelBehavior is in E2) and E3. (b) S3: Readability drops headings on docs sites (Docusaurus 6/19, Substack 0/11, Wikipedia 9/19); propose walk-first instead of Readability-first. Both need user decision when records land.
  - S3: 10 fixtures captured in fixtures/sites/.
- C: BLOCKED on A and B.

## Decisions from user
- D1 (iter 1, re Q-U3): user set up a GitHub remote — "you can commit and push". Delegate push to impl-A after scout confirms remote and .env ignored.
- D2 (iter 1, re Q-U1): Ollama API key is in .env as OLLAMA_API_KEY; local model for S2/S4 = qwen3.5:9b. Anthropic key for S2 Haiku not mentioned yet.

- D3 (iter 1, re Q-U1/Q-U4/Q-U5): "test ollama only, use ollama cloud with api key, we will not use ollama local". → S2 runs on qwen3.5:9b via Ollama cloud only (Haiku 4.5 half dropped — deviation approved by user). S4 tests Ollama cloud from an extension; local OLLAMA_ORIGINS/CORS path not tested (user decision). Forwarded to impl-B.

- D4 (iter 1, re Q-U6): "keep .claude/skills/managed-session outside git" → impl-A to untrack + gitignore it (local symlink kept).

- D5 (iter 1, re Q-U9): S2/S4 model = gpt-oss:20b on Ollama cloud (qwen3.5:9b 404 on cloud). Forwarded to impl-B.

- D6 (iter 1, Phase A escalation): user chose "Accidental-coupling scope": fix A (llm/types.ts types-only), D-lib (validate engine tsconfig), B (ban ts-expect-error/ignore/nocheck + top/frames/parent/opener); plus NB-2, NB-4 (NB-3 optional); record O-21, C, NB-1, D-alias, E as accepted residuals; one final test round, then accept.

- D7 (iter 1, re Q-U8/Q-U7): "repo is public" → impl-B replaces all-rights-reserved fixtures (Guardian, Medium, Substack, GitBook) with permissively licensed equivalents, adds CC BY-SA attribution for Wikipedia/MDN, license field per fixture + ATTRIBUTION file, purges removed pages from phase-b-spikes history before any push. "i clicked allow before" → S5 Allow clicks explained.

- D8 (iter 1): accept Phase A once scout confirms commit; Alt+T physical press moved to S5 manual checklist / M0 demo.

- D9 (iter 2): S1 APPROVED — engine host = side panel page (plan default) + DESIGN §4/§4.1 edits (apply in Phase B final step).
- D10 (iter 2): S5 deviation (a) APPROVED — action.onClicked → sidePanel.open({tabId}) → inject, openPanelOnActionClick:false; add http://*/* to optional_host_permissions. Implement in Phase C M0-E3 (changes panel.ts:14/:33, panel.test.ts:11, wxt.config.ts:17, check-manifest.mjs:16).
- D11 (iter 2): S5 deviation (c) — open-only in M0 (close via panel X); toggle revisited M5.
- D12 (iter 2): S3 deviation (b) APPROVED — walk first, Readability fallback, then selection hint.
- D13 (iter 2): criterion #1 — ship generic + per-site cleanup selectors in M0-E5; #1 judged against hand-labelled noise list (currently 9/10).
- D14 (iter 2): S5 R1 — pause on tab switch (only active tab's job schedules chunks); formalize in M1.
- D15 (iter 2): GitHub fixture cut to README article markup (re-score S3).
- D16 (iter 2): repo LICENSE = MIT, fixtures/ excluded (own ATTRIBUTION.md).

- D17 (iter 5): S4 (d) APPROVED — cors + cause permission|origin.
- D18 (iter 5): S4 (e) APPROVED — new LLMError kind `quota`.
- D19 (iter 5): S2 (f) option C — v1 everywhere + v2/nonce only on chunks with literal tags detected pre-send.
- D21 (iter 9): LICENSE copyright holder = "Translate Peer".
- D22 (iter 9): Q-U11 answered — REWRITE master history to remove the username, force-push approved by the user. Plan pending scout Q5 (all occurrences, refs, PRs, filter-repo).
- D23 (iter 10): denylist banking DEFERRED — no bank list in M0; spec edit DESIGN §8: banking → user-editable denylist in settings (M4+); password fields never read.
- D24 (iter 10): editable regions (contenteditable / role=textbox) never extracted; code editors still shown as do-not-translate code; DESIGN §8 line.
- D20 (iter 5): ALL proposed spec edits approved (S1/S3/S5/S2/S4), applied in final Phase B step; S5 change 7 conditional on manual checklist.

## Open questions to user
- Q-U1 (iter 1): Ollama isn't installed. S4 (Ollama from an extension) and the local-model half of S2 need it. Will you install Ollama and pull a 7–8B model (e.g. qwen3:8b), and provide an Anthropic API key for the S2 Haiku runs? Or should those spikes record "unknown, chose default because" (plan §8 risk mitigation)?
- Q-U2 → moved to S5 manual checklist (D8). (old) Phase A — please press Alt+T on a normal page with the build loaded (.output/chrome-mv3) to confirm the panel opens; sessions can't send a real keypress.
- Q-U3 ANSWERED (D1).
- Q-U6 ANSWERED (D4). (old) Q-U6: .claude/skills/managed-session is tracked as a symlink to an absolute path outside the repo — dangling on GitHub/other clones. Keep, or untrack?
- Q-U4/Q-U5 ANSWERED (D3).
- (old) Q-U4 (iter 1): S2 needs an Anthropic key for the Haiku 4.5 half — none in .env or env (scout Q3). Provide one, or run S2 on qwen3.5:9b only?
- Q-U5 (iter 1): no local Ollama (port 11434 closed, no CLI) — S4 local CORS/OLLAMA_ORIGINS path can only be tested against hosted Ollama; local parts recorded unverified unless user installs Ollama.
- (old) Q-U3 (iter 1): Criterion #7 says "CI … green". No git remote, so GitHub Actions can't run. Push to a remote so Actions runs, or accept the local `pnpm check` (same steps) as evidence for M0?

- Q-U7 (iter 1): impl-B asks — in headful S5 runs a chrome.permissions.request prompt was answered "Allow" 8–18 s after appearing, 3 times; no automation clicks it. Did the user click Allow in the test Chrome window?

- Q-U8 (iter 1): S3 commits 10 third-party web pages (~3 MB) as test fixtures in the repo. Is the GitHub repo public or will it be? (licensing/privacy of saved pages)

- Q-U9 UPDATE: confirmed POST https://ollama.com/api/chat model qwen3.5:9b → HTTP 404 {"error": "model 'qwen3.5:9b' not found"}. Small options on cloud: gpt-oss:20b, nemotron-3-nano:30b, gemma4:31b. S2 model runs BLOCKED on user.
- (orig) Q-U9 (iter 1): impl-B found NO qwen model in Ollama cloud's model list (has gemma4:31b, gpt-oss:120b, kimi-k2.7-code, glm-5.3-flash…). qwen3.5:9b may not exist on cloud. Which cloud model for S2/S4?

- Q-U10 (iter 1): while compacting test-B I found unsent text in its input box: "expire the reflog and gc the old fixture blobs" (cleared it). Most likely Claude Code's grey prompt-suggestion text, not user input — NOT raised with user. If the user ever wants the old fixture blobs purged locally, delegate `git reflog expire --expire=now --all && git gc --prune=now` to impl-B.

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
- review-A round 2: 0 blocking; N-new1 queued to impl-A. test-A round 2 pending.
- impl-A pushed master; first GH Actions run success. impl-A doing N-new1 + action bumps.
- User D3: Ollama cloud only for S2/S4. Forwarded to impl-B.
- test-A round 2: boundary FAIL (4 new bypass classes); B3 verified. Sent to impl-A for round 3 (allowlist).
- User D4: untrack skills symlink → impl-A. User didn't understand Q-U2 (Alt+T); re-explained with steps.
- impl-B S1 record 0c7d34e (panel host). Started test-B (wC:p2W), review-B (wC:p2X). Heads-up of S5/S3 deviations.
- impl-B S5 record 921fee0 (deviation a). Queued to test-B/review-B.
- impl-A round 3 pushed 805ae64 (CI success). Round 3 test/review started. Plan: S5 deviation (a) (action.onClicked flow) → propose to user to implement in Phase C's M0-E3, not reopen Phase A.
- review-B S1: 2 blocking/7 non-blocking → impl-B. ctx: sup 16%, scout 5%, impl-A 21% (warned, idle), impl-B 20% (warned, busy), test-A 10%, review-A 11%, test-B 9%, review-B 8%.
- review-B S5: 2 blocking (unflagged deviations) → impl-B. review-A round 3: 0 blocking, NB-1..5. impl-B 22%.
- impl-B: S1 amendments 182d488, S3 793156a. Queued to review-B/test-B.
- impl-B S5 amendments e699e85 → review-B. impl-B 24% → checkpoint requested (before S2/S4). ctx: sup 18%, test-A 12%, test-B 10%, review-B 14%.
- impl-B checkpoint report: S1/S5/S3 committed; spikes/s4 probe uncommitted; no qwen on Ollama cloud. Compaction #1 of impl-B: /compact sent.
- impl-B compacted (#1) and resumed. review-B: S1 R2 all resolved; S3 1 blocking; S5 R2 resolved except manual checklist.
- User D5 gpt-oss:20b → impl-B. test-A round 3: boundary FAIL again (3rd) → escalating to user.
- User D6 (accidental-coupling scope). impl-A compacted (#1) and resumed with final-round list.
- User D7: repo public; user clicked Allow. Forwarded to impl-B.
- test-B S1: PASS (count rewording) → impl-B.
- test-B S5: 4/5 PASS; fixes → impl-B.
- test-B S3: PASS with corrections → impl-B.
- impl-A final round 64b41da (CI green). Final test/review sent.
- review-A final: accept, 0 blocking. Waiting test-A final.
- test-A final: all PASS. Asked scout Q4 (commit/push confirm).
- User D8: accept A pending scout Q4.
- Scout Q4: committed & pushed (64b41da, CI success). PHASE A ACCEPTED. Closed impl-A, test-A, review-A.
- impl-B S3 round 2 094daf6 (history rewritten). Sent to review-B/test-B.
- review-B S3 R2: 0 blocking; C1–C4 → impl-B; C5 → user.
- test-B S3 R2: noise list incomplete → impl-B.
- Compacted test-B and review-B (idle). impl-B 23% warned. Supervisor 25%.
- impl-B ded4417 fix batch; compacted (#2) and resumed on S2/S4. ded4417 → review-B, test-B.
- review-B ded4417: 0 blocking; D1/D2/S1-label queued to impl-B.
### Iter 2 (wakeup ~21:55)
- ctx: sup 27%, scout 6%, impl-B 10% (busy S2/S4), test-B 8% (busy ded4417 re-test), review-B 10% (idle).
- Consolidation, Phase B vs criteria #5/#6:
  - S1: tester PASS + reviewer resolved (ded4417 wording; tester-reported label queued) → ready, pending user sign-off on decision + spec changes. #6 engine host = side panel (plan default).
  - S5: tester 4/5 + step 24 + reviewer resolved → pending user: deviations (a) onClicked flow, (c) toggle, R1 active-tab-only jobs, http://*/*; manual checklist (rows 1,3,5,6 + Alt+T).
  - S3: round 3 review 0 blocking (D1/D2 queued); test-B re-test of ded4417 pending → then user: deviation (b), criterion #1 approach, GitHub page chrome, repo LICENSE.
  - S2, S4: in progress (impl-B, gpt-oss:20b).
  - Final Phase B step: rebase on master 64b41da + spikes/ lint ignore + pnpm check green + push/merge; scout confirm.
- No drift. Compacted Phase A history in this log.
- test-B ded4417: S3 r3 ALL PASS (regen identical, noise.json coverage, content recall non-circular), S5 step 24 + behavior re-run PASS. 3 S3 nits queued to impl-B. S1/S5/S3 now tester+reviewer clean (pending queued wording batch + user decisions).
- User decisions D9–D16 (S1/S3/S5 deviations, criterion #1, tab switch, GitHub fixture, MIT). Remaining user items: S5 manual checklist (incl. Alt+T); S2/S4 decisions when done.
- S4 (impl-B, 598e916): Ollama cloud only. ollama.com no CORS (preflight 405) → without host perm all fetches TypeError, no status, never 403. With perm (panel = worker): 401 bad/missing key; 404 model-not-found (JSON as text/html) / path-not-found; 400 bad body; 402 non-free plan; 429 at ~6 concurrent + Retry-After 11–20 s; /v1/models & /api/tags public 200 → key test needs 1-token chat. Plan default 403+none+localhost→cors KEPT untested. DEVIATIONS for user: (d) TypeError + missing host perm → `cors` ("No access" + Grant access); (e) new LLMError kind `plan` for 402. Also 404 non-model → bad_request "wrong base URL". 4 proposed spec changes. Leak check 0. → test-B + review-B.
- S2 in progress: 3/8 arms; early: 0/1612 segments lost, strict ~96%, lenient fix = unclosed final </seg>; literal "<seg" in source breaks unescaped parse (escaped arm OK); gpt-oss wraps `x` as <code>x</code>.
- review-B S4: 0 blocking (K1 resolved = D5). K2–K11 → impl-B after S2 (pre-network TypeError row, cors cause discriminator, `quota` instead of `plan`, max_tokens:1 check, SDK maxRetries, /Users path in key.mjs). User later: (d) cors+cause vs permission kind, (e) quota kind, S4 spec changes 1–4.
### Iter 3 (wakeup ~22:21)
- ctx: sup 30%, scout 6%, impl-B 18% (busy S2), test-B 13% (busy S4 repro), review-B 14% (idle, waits S2).
- No new reports since S4 review. Remaining for Phase B: S2 record + test/review; S4 test-B result + K2–K11 batch; queued wording batch (D1/D2/S1-label/S3 nits/user decisions/GitHub fixture cut); user: S5 manual checklist, S4 (d)/(e), S2 decisions; final step (rebase on 64b41da, spikes lint ignore, DESIGN/ROADMAP edits D9–D16, LICENSE MIT, pnpm check, push, merge).
### Iter 4 (wakeup ~22:37)
- ctx: sup 31%, impl-B 18% (S2 final arm cut-2.0 running, record drafting), test-B 15% (S4 driver), review-B 14% idle, scout 6%. No new reports; no action.
- test-B S4: all reproduced claims PASS (34-row diff 0, 402 6/6, 429 at N=8 clean, classifier mapping, leak 0). Gaps → impl-B: row 2 offline/DNS evidence + permissions.contains branch, deepseek 402 run, concurrency timing note; row 6/8 = K6. S2: impl-B waiting on last 2 cut arms; parser deviation (</seg> closes only before <seg or EOF); reasoning budget (low effort ~1.5× out; medium ~5×, ~50 s/chunk).
- S2 (impl-B, 85ee78d): gpt-oss:20b, 432 calls, 4,576 segs (49 real chunks + 5 adversarial; vi/de/ja; effort low/medium; escaped vs raw; cuts 1.0×/2.0×). Real: 0 lost /2,705 low effort; strict 240/245 (only missing final </seg>). Literal <seg> in source: v1 lenient wrong text 6/8; v2 close-by-lookahead 8/8; identical on 392 real. No escaping (model decoded entities 3/13). Cut repair → 0 lost /1,654. Reasoning separate field, counts against max_tokens (medium ~5.2×, 54 s, one chunk empty); effort 'none' not honored. Budget 2.0×src+12×segs+256 covers 270/270 (flat 2.5× cuts 35). Markers = quality risk (ja 4.8%) → M2. DEVIATION (f): v2 context-sensitive lenient grammar. Spec changes 1–5. → review-B + test-B. All 5 spikes now committed.
### Iter 5 (wakeup)
- ctx: sup 32%, scout 6%, impl-B 24% → CHECKPOINT REQUESTED (busy S4 K-fixes), test-B 20% WARNED (busy S2 test), review-B 16% (busy S2 review).
- impl-B checkpoint: bce2048 S4 evidence (K11 key.mjs env-only; K3/row-2 probes: non-Latin-1 key → distinct pre-network TypeError; bad URL/DNS/closed port/offline → "Failed to fetch"; permissions.contains works incl. base URL with path; K8 max_tokens 1 → 200 empty; K2 deepseek 402). Old /Users path in 598e916/85ee78d history → rewrite approved at final rebase (unpushed branch). COMPACTED #3 (24%→0%), resumed.
- review-B S2: BLOCKING B1 chunk size ~450 tok vs DESIGN 800–1,500 (unflagged) → small arm at spec size, then confirm or deviation (g). NON-BLOCKING N1 context tail format, N2 v2 grammar gaps (stray text, bad ids, final-event timing, replace event, stale header), N3 literal tags not safe (cases A/C/D) → pre-send detection + nonce, N4 v2 hurts weak models → hybrid (v2 only when literal tags), N5 Haiku replay in M1, N6 provider-neutral reasoning quirk + progress event, N7 budget formula provisional. All → impl-B.
- test-B S2: all tables reproduce (independent recompute), live 13 calls match, leak 0. Overclaims: medium 4096 reserve, literal-tag safety (B/C = N3). Silent edge: non-numeric id open tag swallowed. Notes: text between segs → merge+re-request; partial '</se' leak; empty segs strict=true; reasoning-effort probe log uncommitted. → impl-B (nudged; pane was idle after resume).
- Compacted test-B #2 (22%→0%). Supervisor 34% — self-compact planned before 40%.
- impl-B S4 r2 023b494 (K1–K10 text; 0a/0b pre-fetch rows; cors cause; plan→quota; quirk flip on 400 only) + S2 r2 568f49e (B1: DESIGN-size arms 17/20 strict, 0/766 lost, 0 cuts → no deviation (g), keep 800–1,500; formula provisional, holdout ≥892 headroom; v2 rules 1–7; L-end now re-requested; per-chunk grammar = recommended option of (f); N1/N5/N6; tester fixes; effort probe committed). Process slip: committed before leak check; post-check 0 hits. → review-B + test-B. impl-B now on step 3 (wording batch).
- review-B S4 r2 + S2 r2: 0 blocking, all K*/B1/N* RESOLVED. Nits → impl-B step 3: 0b trim key, S2 token-range numbers, WS/trim grammar, (f) as options A/B/C (C recommended), R1 revision vs repair (attempt counter), R4 reasoning lowest 'off'. Waiting test-B r2.
- test-B r2: S4 PASS, S2 PASS (offline regen identical, large arms, 32 corpus, 22+ edge cases, 2 live), key leak 0. Nits → impl-B. `<username> FAIL: (1) 598e916 key.mjs path in B history → fixed by approved rewrite at rebase; (2) .claude/skills symlink tracked in B tree (from 6fef96a) → gone after rebase on master. NOTE: master's public history already contains the username (6fef96a symlink target, progress.md commits) → Q-U11 to user (low): force-push rewrite of master or accept.
- S1–S5 all tested + reviewed with 0 blocking. Remaining Phase B: step 3 wording batch, user decisions (d)(e)(f) + spec changes, S5 manual checklist, final rebase/merge/push + scout confirm.
- User D17–D20 → impl-B. Remaining user items: S5 manual checklist; Q-U11 username in public master history (low).
### Iter 7 (after supervisor self-compaction)
- ctx: sup 5%, scout 6%, impl-B 24%, test-B 13%, review-B 5%.
- impl-B step 3 DONE: 165d735 S1, cb52d13 S5, c1af939 S3 (GitHub cut via cut-github.mjs; only GitHub scores changed; GV 50 noise / 14.6%; D1 caveat, D2 filter), 50f4b49 S4, d91f4ee S2 (option C decision). Leak 0, <username> empty. Side finding: scrub.mjs + attribution.mjs not idempotent → Phase C carry-over.
- Sent step 3 to test-B + review-B. Compacted impl-B #4 (24%→0%). Sent GO for FINAL with D9–D20 → record mapping; push/merge held until step-3 test+review pass.
### Iter 8 (wakeup ~23:52)
- ctx: sup 8%, scout 6%, impl-B 9%, test-B 16% (working, step-3 re-test), review-B 9%.
- impl-B (FINAL) and review-B (step-3 review) were both cut off by "computer went to sleep" at 23:49 with no report. Nudged both to re-read their state files and continue.
### Iter 9 (~02:00, user said "continue")
- ctx: sup 9%, scout 6%, impl-B 9%, test-B 16%, review-B 9%.
- Computer sleep cut off all three again (impl-B and review-B at 1:51, test-B at 12:57). impl-B FINAL progress: rebased branch has b10a1c0 S1 spec commit, ffe1c4e spikes/ lint ignore + s3 package private, 4ca2ffb S2 record; it was starting the S5 changes 1–6. test-B interim: scrub non-idempotence "one newline, toggled, not cumulative" (corrects impl-B's claim). Nudged all three. Asked the user to keep the machine awake.
- review-B step 3: 0 BLOCKING; everything resolved and regenerations byte-identical (S3 outputs, S2 chunks, corpus 32/32, v1 vs v2 470/0 diff). NB1–5 + side finding (scrub note) → impl-B, folded into FINAL. NB3: supervisor ruled D19 includes the nonce (per the recorded decision); add the "isolation if M1-E3 shows models don't copy it" qualifier. Waiting: test-B step 3, impl-B FINAL local.
- test-B step 3: ALL PASS (S3 regen clean, GitHub numbers, GV 50/14.56%, cut fixture byte-identical article, D1/D2, S2 chunks identical, option C checks, S4/S1/S5, key leak 0) except scrub claim wording (pair converges; re-adds one newline to 9 fixtures committed without it) → wording to impl-B; fixture newline consistency → Phase C M0-E8. <username> FAILs (598e916 key.mjs, tracked symlink) → FINAL. Nits: manifest "bytes" = string length; tab/DEL in key rejected (fine).
- STEP 3 ACCEPTED (test + review). impl-B told: finish FINAL locally, push the BRANCH (no master merge), report; then final test-B/review-B on the pushed branch → merge → CI → scout confirm → accept B.
- impl-B FINAL pushed: origin/phase-b-spikes b24fdb8 (26 commits on 64b41da; spikes rebased 4816a05..4ca2ffb, key.mjs path rewritten; ffe1c4e lint ignore; spec commits b10a1c0 S1, 0ccbf24 S5 1–6, 1802f7f S3 + plan #1, f200166 LICENSE, b8c5ddf S4, e8e784f record fixes, b24fdb8 S2). pnpm check exit 0 (254 tests); <username> 0 in branch diff; .claude untracked; leak 0. Not merged. No branch CI (PR triggers CI).
- Rulings: http://*/* code → Phase C M0-E3; M0 plan §5 extraction row → update (doc commit); S2 "also consider" → M1, not applied; "Applied in <commit>" notes → add; LICENSE holder "the Translate Side authors" → ask user (Q-U12); backup/phase-b-pre-final (local, old path) → delete after acceptance.
- Final test-B + review-B sent on b24fdb8 (+ the coming doc commit). Next: merge via PR (CI) or ff → CI green → scout confirm → accept B.
- impl-B doc commit 65b6b79 pushed (plan §5 row, Applied-in notes). Sent to test-B + review-B. impl-B idle.
- test-B FINAL at 65b6b79: ALL PASS (<username> 0 over 307 objects; key leak 0 all refs; pnpm check exit 0, 254/254; rebase content-identical d91f4ee↔4ca2ffb; LICENSE excludes fixtures; Applied-in notes correct). Note: check-manifest.mjs:16 + wxt.config.ts → Phase C (D10). Waiting review-B final.
- review-B FINAL (65b6b79): spec edits match records verbatim; rebase clean; secrets 0; lint ignore needed and works. BLOCKING L1: LICENSE must also exclude fixture-derived text/translations under spikes/ (s2 chunks/runs/results, s3 data). Consistency C1–C8 (plan M0-E2/E4/E5 + §5 rows, ROADMAP M0-E4/§8 1–2/:391, DESIGN :34/:251/:425 cors bullet, criterion #1 noise.json path note, S1 :178 stale, package.json license). All → impl-B (supervisor: within D16/D20 intent). Then quick re-check by review-B + test-B → PR merge.
- ctx: sup 12%, scout 6%, impl-B 13% (busy L1/C1–C8), test-B 18% idle, review-B 16% idle.
- User D21 (LICENSE holder "Translate Peer") → impl-B; D22 rewrite master + force-push approved → scout Q5 sent to inventory occurrences. Removed the username from this log (paths now ~/...) so it won't be reintroduced.
- impl-B fixes pushed: d9715f3 (L1 license scope, D21 "Translate Peer", package.json license) + b8b9e06 (C1–C8 docs). pnpm check 0, leak 0, username 0. → review-B + test-B re-check. impl-B idle awaiting D22 plan (scout Q5 pending).
- review-B re-check d9715f3+b8b9e06: L1 resolved, C1–C8 OK, 0 BLOCKING. Phase B review COMPLETE. Waiting: test-B quick re-check, scout Q5 → D22 plan → merge (ff, no PR) + rewrite + force-push + CI → scout confirm → accept B.
- Scout Q5: username in progress.md (33 commits, all refs) + .claude/skills symlink target (24 commits, master 6fef96a..40f5f36) + key.mjs (backup branch only); none in messages/metadata; filter-repo not installed; repo public; branches master, phase-b-spikes; 0 PRs; git grep misses symlink targets.
- D22 plan sent to impl-B (waits for GO after test-B): ff master to phase-b-spikes (no PR); commit this log; rewrite all commits (drop symlink, replace path/username in blobs); verify (blobs, symlinks, metadata, leak, pnpm check); force-with-lease push master, delete remote phase-b-spikes; CI; fix both worktrees; report. Supervisor must NOT edit progress.md until impl-B reports (it is being committed/rewritten).
- test-B b8b9e06: PASS; LICENSE missed spikes/s3/walk-extra.json (+structure.md) → robust wording "all non-code files under spikes/s2 and spikes/s3" (03e027c).
- D22 DONE (impl-B): filter-branch on master after ff to the branch + "Supervisor log: Phase B" commit. Old master 64b41da → new ec2ecbb (39 commits, messages/authors/dates unchanged by md5). Verified 0 username in blobs, symlinks, commit objects; no .claude entries; tip tree identical; key leak 0; pnpm check 0 (254/254). Force-with-lease push OK; remote phase-b-spikes deleted; ls-remote = master ec2ecbb only; CI 37404599022 success. Both worktrees clean. New spec SHAs: S1 b2c7c89, S5 708be37, S3 f8f64a4, S4 d20ca29, S2 a1d8969 → impl-B fixing stale "Applied in" SHAs (ff commit). Local backups backup/master-pre-d22 + backup/phase-b-pre-final → delete at acceptance. GitHub may serve old SHAs for a while (support request to purge).
- Next: SHA-fix commit + CI → test-B final verify of master → scout confirm → ACCEPT B → delete backups, close impl-B/test-B/review-B → start Phase C.
- impl-B dd4d447 (ff): Applied-in SHAs fixed (+ S1 :3/:75 → 8a9cbf9); CI 37404728736 success; ls-remote master dd4d447 only. → test-B final verify + scout Q6 confirm.
- Scout Q6: local master = origin/master = dd4d447 (only remote branch); 5 decision records, LICENSE, spikes/ (168), fixtures/sites/ (13) in tree; CI 37404728736 success on dd4d447; tip tree 0 username, 0 symlinks; main worktree only M progress.md, B clean. Waiting test-B final verify → accept B.
- test-B final (fresh clone dd4d447): 8/8 PASS (username 0 over 414 objects incl. metadata/paths; no symlinks; no .claude; key 0; pnpm check 0; SHAs resolve; content intact; both CI success). Residual: GitHub serves old SHAs + old CI runs → user.
- PHASE B ACCEPTED. Closed test-B, review-B, impl-B. impl-B deleted backup branches + local phase-b-spikes; refs = master/origin only; worktree B detached at dd4d447.
- Starting Phase C (deps A+B accepted).
- PHASE C STARTED: impl-C (wC:p2Z) /goal sent (goal text in scratchpad goal-impl-C.txt; note: send-text of a long goal needed an extra Enter). Batches: E3+E4, E5+E6, E7+E8. test-C/review-C start on first batch.
### Iter 10 (wakeup ~09:49)
- ctx: sup 17%, scout 7%, impl-C 17% (working ~11 min on the goal). No report yet.
- impl-C batch 1 28000d4 (E3+E4): test-C PASS (live Chrome 154 via CDP: injection/idempotency/re-inject/lost, #4 on chrome://, Web Store, about:/data:/view-source, denylist, protocol, tab routing, worker restart, ext reload); review-C 0 BLOCKING, NB1–NB5 → impl-C. Not CDP-verifiable: Alt+T + context menu gesture → user manual. Rulings: Segment extra fields OK; dev view dev-build-only (demo step 4 uses dev build); snapshots under fixtures/snapshots/; "Always translate on this site" deferred (settings out of M0); MkDocs .tabbed-block selector accepted (D13); LICENSE example edit OK.
- PR blocked: gh account longduydao99 has READ only on duylongpro99/translate-side; push via SSH works; CI triggers only on PR or master push → CI for #7 at merge push; user told.
- impl-C batch 2 f32b9e3 (E5+E6): claims #1 9/10 (goblog "The Go Blog"), #2 10/10, #3 100% in jsdom + real Chrome; form controls never copied; noise.json → fixtures/. → test-C + review-C.
- User D23 (defer banking) → impl-C.
- ctx: sup 20%, scout 7%, impl-C 30% → CHECKPOINT REQUESTED, test-C 13%, review-C 11%.
- impl-C checkpoint: batch 3 13ad698 (E7 panel by kind + states + dev-only view compiled out of prod, pnpm build:dev; E8 snapshots fixtures/snapshots/; fixture newline + real manifest bytes; NB3 content side, NB4; MDN CodeMirror → code (13/13); symbol-only cells kept translate:false). Criteria #1 9/10, #2 10/10, #3 10/10. NB1 closed in f32b9e3. Compacted impl-C #1 (31%→0%) and resumed. Batch 3 → test-C + review-C (after batch 2).
- review-C batch 2: 1 BLOCKING B1 (MDN interactive example split into translatable p; #2 truth reuses LANDMARK_NOISE → circular; real #2 = 9/10 at f32b9e3; 13ad698 may partly fix). NB1 MDN shadow UI noise missing from noise.json (supervisor: add to list, stricter, + rule), NB2 GV byline language link, NB3 Readability drops hidden tabpanels, NB4 paywall G rule too broad, NB5 groupId lost for lists in cells, NB6 marker escaping (M1 note); empty state needs selection hint. #1 measure judged honest (matches S3 scorer). → impl-C.
- review-C batch 3 (13ad698): 0 BLOCKING; B1 fixed (MDN 13/13); text-only rendering verified (XSS strings literal); dev view absent in prod; snapshot mutation tests catch regressions; fixture carry-overs done. NB1 #2 truth still extractor-derived → hand-checked counts in manifest (ruled: do); NB2 adjacent tables merge (cheap fix); NB3 empty-state wording acceptable for M0 (ruled). → impl-C.
- test-C batch 2 (own scorer, jsdom + Chrome): #1 9/10, #2 9/10 (MDN editor), #3 10/10 incl. reload; kinds/groupId/codeLang/hidden verified; denylist re-check; tab routing proven. Findings: translate=no/notranslate ignored; contenteditable text (incl typed) extracted → user D24 skip; docs.rs badges + MkDocs version badge noise missing; Wikipedia 1/301 domPath round-trip mismatch; 3 fixtures have empty noise lists. → impl-C.
- impl-C final: bbebf2b (panel NB2/NB3/NB5 + lost copy), 595e43b (D23 spec), 9b8f485 (B1 truth with hand counts in manifest, MDN rules + noise items, data-ts-box spacing, Readability hidden panels, paywall scope, groupId in cells, tables apart). #1 9/10, #2 10/10, #3 10/10; demo step 4 dev build OK. → test-C + review-C. One more commit pending: D24 + test-C findings.
- review-C follow-up 13ad698..9b8f485: 0 BLOCKING; #2 truth now independent (hand counts = S3 results.md). Residuals R1 GV spacing Chrome-only (test-C to confirm), R2 per-paragraph paywall class (note), R3 Readability table paths (cheap fix). D24 heads-up: plain drop breaks #2 (MDN/Docusaurus editors) → ruling: exempt CODE_BLOCK surfaces per D24 wording; translate=no only for block-level segments, inline stays (M1 note). → impl-C.
- impl-C aaab32c (D24 spec) + 388226d (editable regions skipped, CODE_BLOCK exempt; block-level translate=no → translate:false, natural kind kept (accepted); docs.rs badge rule; MkDocs standalone badge rule + "8.3.0" in noise.json; Wikipedia round-trip = inline <style>, no bug; R2 noted, R3 fixed). 401 tests; #1 9/10, #2 10/10, #3 10/10. Empty-noise fixtures sampled: authored content only. → review-C + test-C (final pass at 388226d).
- review-C D24 batch: 0 BLOCKING; no open blocking items for Phase C. NB1 page-wide translate=no on html/body (ruled: ignore outside content root), NB2 editable body/designMode (no-content), NB3 DESIGN §8 note: code-comment translation must keep editor surfaces excluded → impl-C, one small commit.
- impl-C d102545: NB1 opt-out only inside content root; NB2 designMode/editable body → no-content; NB3 DESIGN §8 line. 404 tests; criteria unchanged. → review-C final verdict + test-C final pass at d102545.
- review-C FINAL VERDICT at d102545: open BLOCKING = NO. E3–E8 to plan; D10/D11/S1/S3/S5/D23/D24 conformant; constraints hold. Residuals non-gating. Waiting test-C final pass.
- test-C FINAL at d102545: #1 PASS 9/10 (jsdom + Chrome, noise list only grew), #2 PASS 10/10 (own truth, all pre incl hidden), #3 PASS 10/10 (incl reload + demo step 4 dev view), #4 PASS live (chrome://extensions, Web Store, etc.), #7 PASS locally (404 tests). D24 live: 0/20 probes leak; translate=no rules; editable body → empty; GV spacing OK; panel kinds/states all screenshotted; dev view absent in prod. Open minor: literal marker chars in page text render as markup → M1 carry-over (with NB6). Needs human: Alt+T + context menu (CDP can't), demo step 2 with real Alt+T.
- GO merge: impl-C to ff origin master to d102545 (no force), CI, delete remote phase-c. Then scout confirm → accept C (pending user's Alt+T demo note).
- impl-C merged: origin master ff dd4d447..d102545, CI 37410218073 success, remote phase-c deleted; ls-remote = master d102545 only. Local worktree ../translate-side-C + local phase-c remain. → scout Q7 confirm.
- Scout Q7: origin only master d102545 (9 Phase C commits), required paths present, CI success. PHASE C ACCEPTED.
- ALL PHASES (A, B, C) ACCEPTED. M0 success criteria: #1 9/10 ✓, #2 10/10 ✓, #3 100% ✓, #4 ✓, #5 5/5 ✓, #6 ✓ (side panel), #7 green ✓.
- Wrap-up: impl-C to ff the main worktree, commit this log, push; remove worktrees B/C; then close all sessions and stop the loop.
- impl-C wrap-up: worktrees translate-side-B and -C removed (clean, all work in origin/master); local phase-c deleted. It declined the main-worktree ff + log commit (its goal forbade editing the main worktree). Main worktree: master behind origin by 9, progress.md modified (this final log, 0 username hits) → user to ff + commit. All sessions closed; loop stopped.

## FINAL STATE (M0 complete)
- origin/master = d102545. All phases accepted. Local main worktree is 9 commits behind with this log uncommitted: run `git merge --ff-only origin/master`, then commit progress.md and push.
- Open with user: (1) S5 manual checklist incl. Alt+T + context menu (spikes/s5/manual-ext/README.md) — decides S5 spec change 7; (2) optional: delete old CI runs / ask GitHub Support to purge pre-rewrite SHAs (username residue); (3) gh account longduydao99 is read-only on the repo (no PRs); (4) M2 eval passages (human-owned, not started).

## RESUME SNAPSHOT (written before supervisor self-compaction, iter 6)
- Phase A: ACCEPTED at 64b41da (master = origin/master). Sessions closed.
- Phase B: all 5 spikes tested + reviewed, 0 blocking. User decisions D1–D20 recorded above.
  - impl-B (wC:p2S, worktree ~/personal/agent/translate-side-B, branch phase-b-spikes, unpushed) is doing STEP 3 = wording/fix batch: record user decisions D9–D20 in S1–S5 records; S3 GitHub fixture cut to README + re-score (may change S2 chunk files); S3 D1/D2/nits; S1 tester-reported label; S4 trim-key + worker offline wording; S2 nits (token range, WS/trim, options A/B/C with C decided, attempt counter vs revision, reasoning lowest 'off', entity-escape limit, cut column, effort probe note).
  - After step 3 report: (1) send batch to test-B (wC:p2W) + review-B (wC:p2X); (2) compact impl-B if ≥20%; (3) send "go" for FINAL step: rebase phase-b-spikes onto master 64b41da, rewrite away /Users/<username> path in branch commits (approved), no tracked .claude/skills symlink, spikes/ eslint ignore + spikes package.json isolation, apply ALL approved spec edits to DESIGN/ROADMAP/M0 plan (#1 wording per D13) one commit per spike (S5 change 7 only if manual checklist rows 5/6 confirm), add MIT LICENSE excluding fixtures/, pnpm check green, push branch + merge to master (fast-forward/PR), CI green.
  - Then final test-B/review-B round on the merged master, scout confirms commit+CI → accept Phase B (criteria #5, #6).
- Open with user: S5 manual checklist (spikes/s5/manual-ext/README.md in worktree B; includes Alt+T from Phase A); Q-U11 answered (D22: rewrite).
- C: ✅ ACCEPTED (iter 10) at d102545 (origin/master; CI 37410218073 success). test-C final: #1 9/10, #2 10/10, #3 10/10, #4 PASS, #7 green; review-C final: no open BLOCKING; user D23/D24; scout Q7 confirmed. Human-only check outstanding (not a criterion): Alt+T + context menu real gesture (S5 manual checklist). M1 carry-overs: literal marker chars in page text render as markup / no marker escaping (test-C, review-C NB6); inline translate=no spans; S2 'also consider' items; S5 change 7 pending checklist; selection mode; 'Always translate on this site' (settings).
- Phase C history: IN PROGRESS (iter 9). impl-C started with /goal (tasks E3–E8, criteria #1–#4 + #7, carry-overs). test-C/review-C to start at impl-C's first batch report.
- Phase C (was not started): needs A+B accepted. Start impl-C/test-C/review-C with /goal per prompt; tasks M0-E3..E8; criteria #1–#4 + #7; carry-overs: D10 onClicked flow + http://*/*, D11 open-only, D12 walk-first, D13 selectors, S1 consequences (global side_panel, panel injects, content⇄panel Port), S3 shadow-aware domPath, hidden tabpanels incl aria-hidden, Phase A N9 snapshot tests, FP-3 llm/types runtime values elsewhere; fixture scrub/attribution: make header newline consistent across all 10 fixtures; manifest 'bytes' is string length.
