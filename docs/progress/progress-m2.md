# M2 — Contextual quality: supervisor progress log

Plan: docs/plans/M2-contextual-quality.md · Spec: DESIGN.md · Prompt: docs/prompts/implement-plan.md

## Supervisor

- Session name: `m2` · Pane: `wC:p2J` · Tab: `wC:t1T` · Workspace: `wC` · Model: Opus 5.5
- Peers send reports with `SendMessage` to `m2`; status check `herdr agent get wC:p2J` (`idle` or `done` = free).
- Scratchpad (goal files): the supervisor session's scratchpad directory (local, not in the repo)

## Phases

The plan groups work into sub-goals A–D, then a closing re-run. It defines no per-phase done
criteria, so each phase's criteria below are the plan's own lines (§2 "Done looks like", §3 success
criteria, §6 task text, §7 demo steps), copied word for word and mapped to the phase that delivers
them. The plan allows no parallel work, so phases run in order A → B → C → D → F.

### Phase A — Sub-goal A: a way to measure quality (M2-E8)
- Depends on: M1 (accepted, origin/master @ ca11cf8)
- Tasks: "M2-E8 Eval set: 20–30 passages (tech blogs, docs, opinion, idiom/humor/sarcasm), 1–5 rubric on fidelity, naturalness, tone, terminology; human scoring sheet; LLM-as-judge script; harness comparison report. Score the M1 `single-pass` baseline before changing anything."
- Done criteria:
  - §3 #7 "Eval set size | 20–30 passages, scored"
  - §6 "Score the M1 `single-pass` baseline before changing anything."
  - §2 "The harness prints a markdown table comparing `single-pass` vs `contextual` (and `translate@1` vs `@2`) on fidelity, naturalness, tone, terminology and cost." (A delivers the table format with the single-pass column; the comparison columns come in C/F)
- Human work (user): human scores on the scoring sheet; §8 "calibrate the judge on the human-scored subset before using it as a gate".
- Status: ACCEPTED (conditional, M2-D4) 2026-10-06 — commits a3a85fd, 04f4447, 2e038f5 on m2 (scout-confirmed; baseline dir tracked, 26 files). Tester: all criteria MET except "scored". Reviewer: no open blocking (3 rounds). CARRIED: baseline scoring — live judge two-day resume (M2-D3, after ~2026-10-07 07:00, by m2-A-impl) + user's human sheet; must finish before Phase F.

### Phase B — Sub-goal B: document-level understanding (M2-E1, M2-E5)
- Depends on: A
- Tasks:
  - "M2-E1 `analyze` stage + `analyze@1` (title + first ~1,500 tokens + outline), lenient JSON, `artifact` event, panel "About this document"."
  - "M2-E5 Language detection port, fallback chain, skip-if-same-language, mixed-language flag (per-segment detection behind a flag)."
- Done criteria:
  - §2 "The panel has a collapsible **"About this document"** section showing the brief: genre, audience, purpose, tone and key terms."
  - §2 "A page already in the target language is skipped with a note."
  - §3 #5 "Brief JSON failure (fenced, prose-wrapped or invalid) never fails the job | falls back to "no brief""
  - §3 #6 "Same-language page skipped | yes"
- Status: ACCEPTED 2026-10-06 — commits 7e57a17, 485d700, 08a9cbf, 6558ddf on m2 (scout-confirmed; eval/runs untouched). Tester all 4 criteria MET (3 rounds). Reviewer no open blocking (3 rounds). User decisions M2-D5..D8. CARRIED: LanguageDetector check in user's Chrome (M2-D8); one-chunk-doc brief question → Phase C.

### Phase C — Sub-goal C: carry that understanding into every chunk (M2-E2, M2-E3, M2-E6)
- Depends on: B
- Tasks:
  - "M2-E2 `ContextProvider` interface; `DocumentBriefProvider`, `GlossaryProvider` (personal + auto), `ContextTailProvider` (last 1–2 source paragraphs + translations, marked do-not-translate); token budgeting."
  - "M2-E3 Byte-stable system prompt assembly + `translate@2` (brief, glossary, style mode, gloss rule). A/B against `translate@1` in the harness."
  - "M2-E6 Personal glossary storage (sync, with quota guard) and list editor in options."
- Done criteria:
  - §2 "A sarcastic opinion piece stays sarcastic. A Rust blog post keeps "future" and "executor" consistent from the first chunk to the last, with a gloss only on first use."
  - §2 "Natural / Faithful / Simplified style modes visibly change the output."
  - §7.4 "Add a personal glossary entry ("deploy" → keep as is); retranslate; confirm it applies."
  - §6 E3 "A/B against `translate@1` in the harness."
- Status: IN PROGRESS — implementer m2-C-impl (wC:p30, Opus 5.5) started 2026-10-06.

### Phase D — Sub-goal D: never ship a broken segment (M2-E4, M2-E7)
- Depends on: C
- Tasks:
  - "M2-E4 `check` stage v1: count, marker balance, backtick spans byte-identical, URL/number/code preservation, length-ratio sanity; re-request failing segments once, then `segment.failed`."
  - "M2-E7 Budget v0: per-job token ceiling from settings, checked by stages."
- Done criteria:
  - §2 "Code spans, URLs and numbers come through byte-identical."
  - §3 #3 "Segment loss after repair on the eval set | 0"
  - §3 #4 "Code/marker/URL preservation on code-bearing segments | 100%"
- Status: ACCEPTED 2026-10-08 — closing commit 8bc7484 (93d4d4c..8bc7484, 10 commits, scout-confirmed). Tester: §2/§3 #3/#4 MET on 486a0a2 (full ctx2 c400 lost 0/149, code 25/25, own recount), fault matrix + budget + B1 panel MET, check 3/3 on 8bc7484. Reviewer: 0 open findings after 7 rounds. Extra (M2-D19): neighbour-duplicate + wrong-script checks. Known limitations: number check strict (spelled-out numbers fail after retry); space-grouped "Figure 3 100%" merge; dense length bounds uncalibrated; panel shows CHECK_MESSAGE without reason (M3); budget change needs retry.

### Phase F — Final comparison and M2 baseline
- Depends on: A, B, C, D
- Note (M2-D10): include a contextual run at --chunk-tokens 400.
- Tasks: "Finish by re-running the full comparison and recording the result as the **M2 baseline** that M6's regression gate will defend."
- Done criteria:
  - §3 #1 "`contextual` vs `single-pass` on fidelity, tone, terminology (human score and LLM judge) | ≥ on all three"
  - §3 #2 "Cost of `contextual` relative to `single-pass` | ≤ 1.3×"
  - §2 "The harness prints a markdown table comparing `single-pass` vs `contextual` (and `translate@1` vs `@2`) on fidelity, naturalness, tone, terminology and cost."
  - §9 "`contextual` as the default strategy, with a recorded eval baseline."
- Human work (user): human scores for contextual vs single-pass; §7 demo script run in the browser.
- Gate: user sign-off on human scores and the final table.
- Status: ACCEPTED 2026-10-08 — closing commit d1c3f63 (8945506..d1c3f63, scout-confirmed; eval/runs only). Tester: report/judge/baselines/sheets/§9 MET. Reviewer: 0 open (2 rounds). User: human scores in (6970862); §3 #1 NOT MET on human and judge → accepted as known gap (M2-D23); §3 #2 met at c1500 (×1.17); M2 baseline = contextual@2 c1500 (M2-D22). Outstanding human work: §7 browser demo.

## Decisions (user)

- M2-D1 (2026-10-06): all plan §5 recommended defaults adopted as written (language detection shell port + chain; lenient brief JSON; brief cache key url+contentHash+targetLang+analyze version; gloss on first use, setting; budget split brief/glossary first, tail ≤ ~300 tokens).
- M2-D2 (2026-10-06): judge model is NOT Claude — "skip using anthropic, keep gemini". Supervisor reading: judge = a stronger Gemini model than the translator (gemini-3.5-flash-lite), pinned version; deviation from plan §5 "Judge model" row, approved by user.

- M2-D3 (2026-10-06): judge quota → "Two-day resume" on the free tier (gemini-3.7-flash, 20 req/day): run `pnpm run eval:judge -- eval/runs/baseline-single-pass-translate1-gemini-3.5-flash-lite` after the quota resets (~2026-10-07 07:00), and again the next day for the rest.
- M2-D4 (2026-10-06): Phase B may start now; Phase A accepted conditionally. Scoring the baseline (judge + human sheet) is carried and must finish before Phase F.
- M2-D5 (2026-10-06): panel keeps `contextual` (PANEL_STRATEGY).
- M2-D6 (2026-10-06): plan §8 latency mitigation = run the brief in parallel with the first chunk; the first chunk is translated without the brief, later chunks get it.
- M2-D7 (2026-10-06): wrong <html lang> behaviour left as is (no skip after brief), per the M2-D1 chain order.
- M2-D8 (2026-10-06): the user will check Chrome LanguageDetector in their own Chrome later (human work); Phase B is accepted with the detector link unit-tested.
- M2-D9 (2026-10-07): one-chunk documents skip the analyze call (no brief, no About card on short pages); multi-chunk unchanged.
- M2-D10 (2026-10-07): Phase F adds a contextual run at --chunk-tokens 400 so the brief and tail reach later chunks; no new passages.
- M2-D11 (2026-10-07): switch live model calls from the Gemini free tier to a custom OpenAI-compatible provider "APIBOX": base URL https://api.ai-box.vn/v1, key AIBOX_API_KEY in .env (never print). Supersedes the provider part of M2-D2; model choice pending a /models probe (keep the translator comparable to the frozen baseline if APIBOX serves gemini-3.5-flash-lite).
- M2-D12 (2026-10-07): Phase C accepted conditionally; the live gloss recheck (ad89127 headword rule, Rust glosses) runs once APIBOX is wired. Phase D may start.
- M2-D13 (2026-10-07): APIBOX has no Gemini flash. User: "use ds/deepseek-flash or ds/deepseek-v4-pro instead". Supervisor reading (stated to user, open to correction): translator = ds/deepseek-flash (light, like flash-lite); judge = ds/deepseek-v4-pro (stronger, pinned; replaces gemini-3.7-flash). Because the translator model changes, a new single-pass@1 baseline is run on ds/deepseek-flash and becomes the M2 reference that the user scores; the Gemini baseline stays as a historical run.
- M2-D14 (2026-10-07): first-use gloss unreliable on deepseek-flash → user: "we can change to deepseek pro model". Translator becomes ds/deepseek-v4-pro (app + harness default). Consequences (supervisor): a new single-pass@1 baseline on v4-pro becomes the M2 reference the user scores (flash baseline + its judge 4d70983 stay historical); the judge is the same model as the translator (plan §5 wants a stronger judge) — judge keeps thinking at medium effort while the translator runs thinking off; human scores remain the source of truth (§8). Flagged to user.
- M2-D15 (2026-10-07): user: "use qwen3.8-flash for thinking". Supervisor reading: translator with thinking on, using qwen3.8-flash (a faster model) to keep latency/cost down; availability and endpoint to be confirmed (APIBOX /models earlier listed only two DeepSeek models). Probe gloss hit rate, TTFS and cost before switching defaults.
- M2-D16 (2026-10-07): translator default = qwen3.8-flash on APIBOX; chunk 1 runs with thinking OFF (fast first segment), later chunks at reasoning_effort "minimal". Validate with a full eval + judge before relying on it (catch invented text). Judge stays ds/deepseek-v4-pro thinking medium (now a stronger model than the translator again, per plan §5). New single-pass@1 baseline on qwen3.8-flash becomes the M2 reference the user scores; flash/v4-pro baselines historical.
- M2-D17 (2026-10-07): on multi-chunk pages, keep the fast brief-free chunk 0, and re-translate chunk 0 with the brief once it lands, replacing it in place as revision 2 (one extra call per multi-chunk page).
- M2-D19 (2026-10-07): Phase D check stage also gets a document-level neighbour-duplicate check and a wrong-script leak check (CJK in Vietnamese), beyond the plan's E4 list, same re-request-once-then-failed flow. User: "Add both".
- M2-D20 (2026-10-08): start Phase F runs now (contextual evals + judge) while the user scores the qwen baseline sheet; human scores still required before F sign-off. Relaxes M2-D4's ordering.
- M2-D21 (2026-10-08): §3 #1 judge miss — user scores the 3 human sheets first (single-pass qwen, contextual@2 c1500, contextual@2 c400); decide after, judge calibrated on human scores. No further runs meanwhile.
- M2-D22 (2026-10-08): M2 baseline = contextual@2 c1500 (eval/runs/baseline-contextual-translate2-qwen3.8-flash).
- M2-D23 (2026-10-08): close M2 with §3 #1 NOT MET (human and judge), recorded as a known gap: contextual stays the default (brief, glossary, checks, About); gaps (tone/terminology at c1500, multi-chunk quality at c400, judge mis-calibration on tone/term vs fidelity) carry to a later milestone. Deviation from the plan target, approved by user ("Accept with gap").
- M2-D18 (2026-10-07): DESIGN §8 stays as is ("the chosen provider" covers APIBOX); provider recorded in this log only.

## Sessions

| Name | Role | Phase | Pane | Model | Status |
|---|---|---|---|---|---|
| m2-scout | Scout | all | wC:p3S | Sonnet 5.5 | CLOSED 2026-10-08 (M2 complete) |
| m2-A-impl | Implementer | A | wC:p3T | Sonnet 5.5 (ordinary phase) | CLOSED 2026-10-08 (judge runs moved to m2-F-impl) |
| m2-A-test | Tester | A | wC:p3V | Sonnet 5.5 | CLOSED (A accepted) |
| m2-A-review | Reviewer | A | wC:p3W | Sonnet 5.5 | CLOSED (A accepted) |
| m2-B-impl | Implementer | B | wC:p3X | Opus 5.5 — cuts across engine/shell/settings, sets contextual strategy shape | CLOSED (B accepted) |
| m2-B-test | Tester | B | wC:p3Y | Sonnet 5.5 | CLOSED (B accepted) |
| m2-B-review | Reviewer | B | wC:p3Z | Sonnet 5.5 | CLOSED (B accepted) |
| m2-C-impl | Implementer | C | wC:p30 | Opus 5.5 — three tasks across engine/prompt/settings/options, byte-stable prompt design | CLOSED (C accepted, 5fc1e58) |
| m2-C-review | Reviewer | C | wC:p41 | Sonnet 5.5 | CLOSED (C accepted) |
| m2-C-test | Tester | C | wC:p42 | Sonnet 5.5 | CLOSED (C accepted) |
| m2-D-impl | Implementer | D | wC:p43 | Opus 5.5 — check stage is used by every strategy, crosses engine/parsing/settings/options/harness, and carries threshold design decisions | CLOSED (D accepted, 8bc7484) |
| m2-D-test | Tester | D | wC:p44 | Sonnet 5.5 | CLOSED (D accepted, 8bc7484) |
| m2-D-review | Reviewer | D | wC:p45 | Sonnet 5.5 | CLOSED (D accepted, 8bc7484) |
| m2-F-impl | Implementer | F | wC:p46 | Sonnet 5.5 (runs harness/judge/report, no design work) | CLOSED 2026-10-08 (M2 complete) |
| m2-F-test | Tester | F | wC:p47 | Sonnet 5.5 | CLOSED 2026-10-08 (M2 complete) |
| m2-F-review | Reviewer | F | wC:p48 | Sonnet 5.5 | CLOSED 2026-10-08 (M2 complete) |

## Human work tracker

| Item | Phase | Status |
|---|---|---|
| Human scores, single-pass baseline | A (carried, before F) | not started |
| Judge calibration vs human-scored subset | A | not started |
| Human scores, contextual vs single-pass | F | not started |
| Demo script in browser (§7) | F | not started |
| LanguageDetector check in user's Chrome (M2-D8) | B (carried) | not started |

## Iteration log

### Iteration 1 — 2026-10-06
- Created this log. Supervisor ctx: low (first turn).
- Started scout m2-scout (wC:p3S, Sonnet 5.5); goal in scratchpad/goal-scout.md; awaiting first answers.
- Next: record scout answers; ask user to confirm plan §5 decision defaults + judge-model key; then start Phase A implementer.
- Scout answers (2026-10-06):
  - Git: branch m1 (not detached); HEAD == master == origin/master == ca11cf8. Uncommitted: docs/prompts/tpl.md (user's), this log.
  - Existing M2 work: E8 none (harness scripts/eval/*, single-pass over 5 fixtures/docs, no comparison report); E1 none (ModelRole analyze + artifact event types only; resolveProfile throws for non-translate roles, src/shared/settings.ts:55,63); E5 none; E2 interface only (src/engine/types.ts:193-197); E3 none (only translate@1; only single-pass strategy); E6 none (jobs.ts:343 glossary: []); E4 minimal (single-pass.ts:153-158); E7 engine Budget exists (src/engine/budget.ts) but not fed from settings (jobs.ts:343).
  - M1 carry-overs for M2 (progress-m1.md:10,79): language detection; inline translate=no spans (segmenter + prompt); widen fixtures (Wikipedia, README, CJK) and CJK chars/token; retry on empty `end` answer; jsonMode not mapped on Anthropic. (M3 items: budget-exhausted error kind; first-pass finals not cached.)
  - Keys: OLLAMA_API_KEY, GEMINI_API_KEY present; ANTHROPIC_API_KEY ABSENT → Claude judge can't run. Harness default gemini-3.5-flash-lite.
  - Scripts: check = lint && typecheck && check:engine && test && build && check:manifest; eval = node scripts/eval.mjs.
- Started Phase A implementer m2-A-impl (wC:p3T, Sonnet 5.5). Judge built but not run live until user decides judge model.
- Open to user: §5 defaults; judge model (no Anthropic key); human scoring of baseline (later).
- ctx: supervisor low; scout 8%; A-impl just started.
- User replies: (1) §5 defaults yes → M2-D1; (2) judge on Gemini, no Anthropic → M2-D2. Forwarded to m2-A-impl.
- A-impl round 1 report: commit a3a85fd on m2 (not pushed). 23 passages eval/passages/*.md (tech-blog 5, docs 8, opinion 4, humor 6; 13 code-bearing; 3 Rust async). Rubric scripts/eval/rubric.ts; human sheet eval/runs/baseline-single-pass-translate1-gemini-3.5-flash-lite/human-scores.md (blank); judge scripts/eval/judge.ts (pinned gemini-3.7-flash; resumable; --mock); report `pnpm run eval:report`. Baseline live: 149 segs, 0 lost, 17,650 in / 10,317 out, $0.03109, ~89 s. `pnpm run check` green, 744 tests.
  - OPEN (user): live judge blocked — gemini-3.7-flash free tier 20 req/day/model exhausted (retry ~9.5 h); Pro models 429 (no free allowance). Options: enable billing / two-day resume / other pinned model.
  - Noted: carry-over "widen fixtures (Wikipedia, README, CJK)" not addressed (eval set is EN→vi only); not a plan task.
- Started tester m2-A-test (wC:p3V) and reviewer m2-A-review (wC:p3W), Sonnet 5.5, in parallel.
- ctx: scout 8%, A-impl 19%, tester/reviewer just started.
- A-review round 1 (m2-A-review): 1 BLOCKING, 1 OPEN, 7 NON-BLOCKING.
  - B1 LICENSE:25-31 doesn't exclude eval/passages and eval/runs (CC BY / CC BY-SA text) → must fix.
  - OPEN: baseline unscored (no judge.json, blank human sheet) → blocked on quota/user. Note: docs/prompts/tpl.md uncommitted change (user's file, not a translation prompt — supervisor will confirm with scout if needed).
  - NB3 judge prompt lacks data delimiter / ignore-instructions rule (DESIGN §8); NB4 partial judge scores counted in means; NB5 cachedInput not carried on resume; NB6 "no human scores yet" never prints for blank sheet; NB7 hardcoded `VI |` prefix; NB8 missing tests (judge retry/quota/resume, prompts, sheet→parse round trip); NB9 different-n note.
  - Supervisor ruling: fix B1, NB3–NB8; NB9 optional (a one-line note in the report is enough).
- Compacted m2-A-impl at 19% (idle, before round 2) to avoid a mid-round interruption.
- A-impl round 2: commit 04f4447 on m2 (not pushed); check green, 751 tests. Fixed B1 (LICENSE excludes eval/passages + non-code eval/runs), NB3 (<passage> delimiter + data rule), NB4, NB5, NB6, NB7, NB8 (judge-core.test.ts; resume top-level still untested), NB9 noted. Open 2 unchanged.
- Sent reviewer round-2 re-review of a3a85fd..04f4447. Tester round 1 still running (on a3a85fd) — will be told about 04f4447.
- A-test round 1 (on a3a85fd, via git archive): check green (744). §3#7 MET (23). §6 baseline translated MET, "scored" BLOCKED (blank sheet, no live judge). §2 table MET (1-run and 2-run, no code change needed). §8 tooling MET; calibration BLOCKED on human scores + live judge. Live harness check 2 passages $0.00251. Minor gap: invalid sheet scores skipped silently.
- Round 3 sent: implementer → warn on skipped invalid sheet scores; reviewer → re-review a3a85fd..04f4447; tester → regression on 04f4447.
- Phase A criteria consolidation: MET — eval set size, comparison table, judge/human tooling, baseline run. NOT MET — "scored" (blocked on USER: human scores; and judge quota decision a/b/c). Acceptance also needs scout commit check.
- ctx: scout 8%, A-impl 7% (post-compact), A-test 7%, A-review 9%.
- A-review round 2 (a3a85fd..04f4447): B1, NB3–NB8 CLOSED, NB9 accepted; no new BLOCKING. New NB: (a) judge.ts top-level resume untested — accepted for A; (b) literal `</passage>` in a passage could close the delimiter — n/a for curated set, note for user-supplied text; (c) docs/prompts/tpl.md uncommitted — asked scout whether any code reads it.
- Reviewer verdict: no open blocking findings; only OPEN 2 (baseline unscored), which waits on the user.
- A-impl round 3: commit 2e038f5 on m2 — warning for skipped invalid human scores (scores.ts readHumanSheet issues, report warning); check green, 753 tests. Small diff; tester to include it in the regression pass.
- A-test regression on 04f4447: all pass (751 tests); mock judge resume OK; blank-sheet note OK; 2-run report OK; sheet tag follows target. Extension to 2e038f5 (skipped-score warning) requested.
- Scout: docs/prompts/tpl.md is referenced by nothing in src/, scripts/, tests/ or config (grep cited); its diff only swaps PLAN/LOG paths M1→M2 in the supervisor loop template. Reviewer NB(c) CLOSED — no effect on translation.
- A-test round 3 on 2e038f5: check green (753); skipped-score warning names invalid values, blank lines not named. No problems.
- Phase A state: tester all criteria MET except "scored" (BLOCKED); reviewer no open blocking. Commits a3a85fd, 04f4447, 2e038f5 on m2 (not pushed). GATE: user — judge quota (a/b/c) + human scores. Plan §6 forbids changing anything before the baseline is scored, so Phase B can't start without user sign-off. All peers idle.
- User: judge two-day resume (M2-D3); start Phase B now, A conditional (M2-D4). Asked scout to confirm A commits; Phase B implementer goal written (scratchpad/goal-B-impl.md), Opus 5.5 because B cuts across engine (stage, prompt, strategy), shell (port, panel UI) and settings and sets the contextual strategy's shape.
- Scout confirmed A commits (3 on master..m2), branch m2, tree clean except tpl.md + this log; baseline dir tracked. Phase A ACCEPTED conditionally. Closed A tester/reviewer. Started B implementer (Opus).
- (superseded: reset is ~14:00 +07, see iteration 3) NEXT: after ~2026-10-07 07:00 tell m2-A-impl to run `pnpm run eval:judge -- eval/runs/baseline-single-pass-translate1-gemini-3.5-flash-lite` (commit judge.json); repeat next day.

### Iteration 2 — 2026-10-06 (wake-up)
- ctx: supervisor 17%, scout 9% (done), A-impl 8% (done, waiting for quota reset), B-impl 19% (working).
- Phase B: implementer working; no report yet. B criteria all NOT MET (in progress). No drift visible.
- Next: warn B-impl at ≥20%, checkpoint and compact at ≥25%. Wake in ~10 min.
- B-impl round 1: commit 7e57a17 on m2; check green, 804 tests. analyze@1 + lenient brief parser + analyze stage (artifact brief) + briefCacheKey; contextual = analyze→chunk→translate(@1, brief not in prompt yet)→check; language port src/shared/language.ts (override→LanguageDetector→html lang→brief); skip with note + Translate anyway, no model call; MIXED_LANGUAGE_DETECTION=false; panel About (details, text-only). Harness --strategy. Live: 3 passages contextual $0.00729 vs single-pass $0.00464 (1.57×; brief ≈ $0.0009/doc fixed). Panel TTFS 5.7 s (M1 ~1.5 s); brief call 2.3–3.4 s before first chunk. Screenshots in B-impl scratchpad shots/. Spend ≈ $0.026.
  - FOR USER: (1) panel now runs contextual (PANEL_STRATEGY); (2) LanguageDetector unavailable in automation and the user's Chrome → detector link unit-tested only; a page with a wrong <html lang> is translated (brief-detected language doesn't skip); (3) Translate anyway re-runs the brief (no cache until M3); (4) brief output cost; plan §8 latency mitigation decision.
- Started B tester (wC:p3Y) and reviewer (wC:p3Z), Sonnet 5.5.
- Compacting m2-B-impl at 23% (idle after round 1). Will confirm ctx dropped next turn.
- B-review round 1 (2e038f5..7e57a17): 0 BLOCKING, 5 NB. NB1 analyze.ts ~l.44 raw interpolation inside <document>/<excerpt> — closing tags in page text can break out (§8) → fix + test. NB2 resume re-runs analyze although brief exists → fix (skip analyze when brief present). NB3 PANEL_STRATEGY contextual → user question pending. NB4 brief-detected same language doesn't skip → recorded here: acceptable per M2-D1 chain order. NB5 scripts/eval/run.ts ~l.185 outline now headings for single-pass too; translate@1 ignores the outline, so the baseline stays comparable → recorded here.
- Ruling: NB1, NB2 forwarded to m2-B-impl now; tester findings to follow.
- B-impl round 2 part 1: commit 485d700 — NB1 delimiter neutralisation + test; NB2 JobOptions.brief seeds memory, analyze skipped on resume (also fixed resume losing brief-derived sourceLang); 807 tests green. Reviewer re-review pending (batch with tester round).
- B-test round 1 (7e57a17): all 4 criteria MET. About collapsible, 6 fields (screenshots B-test scratchpad cr/shots/en-*.png); vi skip with note, net-log 0 model calls (control 71); brief-failure matrix (fenced/prose/invalid/truncated/empty/array/error/throw) → no brief, 5/5 final; live harness contextual 4 passages 0 lost, $0.0087; About renders markup as text. LanguageDetector BLOCKED (Chrome 154 `unavailable` even with flags; no model component) → user check. Finding: wrong <html lang> → wrong outcome either way (vi text tagged en is translated vi→vi; en text tagged vi is skipped, Translate anyway works).
- Sent: reviewer re-review 7e57a17..485d700; tester regression on 485d700.
- B-review round 2 (7e57a17..485d700): NB1, NB2 CLOSED; 0 blocking, 0 new. Reviewer: no open blocking. Remaining for B: tester regression on 485d700; USER gates — PANEL_STRATEGY, latency mitigation (a/b/c), wrong-lang-tag behaviour, LanguageDetector check in user's Chrome.
- B-test regression on 485d700: check green (807); brief-failure drive 11/11; resume in Chrome adds only a translate call (net-log 3 POSTs total), About kept; hostile delimiters in title/h1 still give a brief. Phase B: tester all MET, reviewer no blocking → GATE on user (strategy, latency, wrong-lang-tag, detector check). All peers idle.
- User: M2-D5 keep contextual; M2-D6 parallel first chunk; M2-D7 leave wrong-tag; M2-D8 user checks detector later. Sent the D6 implementation to m2-B-impl as round 3.
- B-impl round 3 (M2-D6): commit 08a9cbf — contextual runs analyze lane in parallel with chunk lane; BRIEF_FREE_CHUNKS=1; later chunks wait for brief/failure (abortable); ChunkOutcome.briefed per chunk for Phase C. 811 tests. Panel TTFS 1.45/1.98 s (round 1 5.7 s), About 3.3/4.1 s, whole page 17.2/17.9 s. Side effects: chunk 1 says 'from the source language' when lang unknown; single-chunk job 'done' waits for brief. Sent re-review 485d700..08a9cbf and tester check.
- B-review round 3 (485d700..08a9cbf): 0 BLOCKING, 3 NB. Concurrency/abort/failure-release verified by reading. NB1 add tests (no-route analyze + ≥2 chunks; maxConcurrency=1 multi-chunk) → forwarded. NB2 single-chunk docs: brief never used for translation but costs a call and delays done → CARRY TO PHASE C goal (decide skip-analyze for 1-chunk docs or accept About-only). NB3 CONTEXTUAL_STAGES export removed (unused) — recorded.
- B-impl round 4: commit 6558ddf (tests only) — NB1 regression tests (no-route analyze 4 chunks; maxConcurrency 1 with brief/failed brief), mutation-checked; 813 tests. Test-only diff → reviewer NB1 closed on supervisor reading of the report; tester round 3 still pending.
- B-test round 3 (08a9cbf): all 5 pass. Chrome 2-chunk page TTFS 1658/1912/1364 ms (median 1.66 s); analyze + chunk 1 POST together, chunk 2 ~4 s later; brief-failure drive multi-chunk 10/10 + abort-while-waiting OK; cancel while waiting → 2 POSTs only; About/skip/Translate anyway re-verified. Phase B: tester all MET, reviewer no blocking, user decisions D5–D8 in. Asked scout to confirm commits → then ACCEPT B and start C.
- Scout confirmed B commits (4 on 2e038f5..m2), tree clean except tpl.md + log, eval/runs untouched. Phase B ACCEPTED. Closed B sessions. Started C implementer (Opus).

### Iteration 3 — 2026-10-07 08:16
- ctx: supervisor 22%, scout 9% (done), A-impl 8% (idle), C-impl 19% (idle after Mac sleep).
- C-impl: interrupted by Mac sleep ~06:30 ("API Error: Your computer went to sleep"); no commits yet; state file not updated; E2 providers written, 27 context tests pass; machine load ~19 slowed tests (17 min run). Nudged: update state file, commit coherent parts, continue (settings/style/gloss, glossary storage).
- Judge day 1 (M2-D3): quota reset passed (~07:00) → told m2-A-impl to run eval:judge on the baseline, commit only judge.json on m2.
- Phase C criteria: all NOT MET yet (in progress).
- Judge day 1 NOT run: gemini-3.7-flash still 429; free-tier quota resets at midnight Pacific = ~14:00 +07 on 2026-10-07. Nothing committed. NEXT: after 14:00 +07 2026-10-07 tell m2-A-impl to rerun eval:judge (same command); day 2 after 14:00 +07 2026-10-08.

### Iteration 4 — 2026-10-07 08:28
- ctx: supervisor 24%, scout 9%, A-impl 9% (idle until 14:00 judge go), C-impl 29% → compacting (idle; background live A/B runs + monitor still running).
- C-impl progress (state file): commits incl. 557a448 (E6 settings style/gloss, glossary storage + quota guard, options editor, panel retranslate on change). Live: contextual@1 0/65 lost $0.026; ctx2 and ctx2-c400 runs in progress. Finding: all 23 eval passages are ONE chunk at 1500 tokens → with M2-D6 chunk 1 is brief-free, so contextual never uses the brief on the eval set; implementer plans an extra run at smaller --chunk-tokens. One-chunk brief: +$0.0011–0.0013/passage (+60–75%). → Likely a USER decision at the end of C (affects §3 #1/#2 in Phase F).
- Compacted m2-C-impl 29% → 6%; resumed with SendMessage (re-read goal + state, continue left items).
- C-impl round 1 report: commits 6b06196 (E2/E3 engine: providers brief/glossary/tail, budget 1500 brief→glossary→tail≤300, translate@2 byte-stable system block), 557a448 (E6 glossary storage.sync + quota guard, style/gloss settings, options editor), 99deee4 (harness --prompt/--style/--gloss/--glossary), e546a4f (panel retranslate on settings change when tab active), 02385a2 (harness --pause). check green 852 tests. Live spend ≈ $0.135.
  - A/B on 11 passages (0/65 lost each): baseline sp@1 $0.01498 ×1.00; ctx@1 $0.02614 ×1.74; ctx@2 $0.02797 ×1.87; ctx@2 c400 $0.02849 ×1.90. TTFS ctx@2 1.50 s.
  - Rust terms consistent (c400); DEFECT: "Future (Future)" re-gloss in briefed chunk heading. Styles: 3 visibly different outputs (wodehouse). deploy demo in real panel: 12/12 kept after glossary entry; DEFECT: one "deploy (triển khai)" gloss on keep-as-is term. Sarcasm: no scores yet.
  - USER DECISION (one-chunk brief): all 23 eval passages are one chunk at 1500 → brief never reaches translation on the eval set; analyze ≈ $0.00107/passage (+73%); runs ×1.74–1.87 vs §3 #2 ≤1.3×. Options (a) skip analyze for one-chunk docs (no About on short pages) — impl recommends; (b) wait for brief on one-chunk docs; (c) keep.
  - Ruling now: fix the two re-gloss defects (no gloss for keep-as-is entries; stronger used-terms wording) — they fail §2 "gloss only on first use". Reviewer started on the round 1 diff. Tester after the fix.
- Started C reviewer m2-C-review (wC:p41, Sonnet 5.5). Supervisor ctx 25% (limit 40%).
- User: M2-D9 skip analyze on one-chunk docs; M2-D10 Phase F adds a 400-token contextual run.
- C-review round 1 (6558ddf..02385a2, static): 0 BLOCKING, 7 NB + 2 harness minors. NB1 glossary.ts:238 used-terms not neutralized in <context> (§8); NB2 brief fields/auto glossary unfenced in system block (§8); NB3 Options draftOf/entryOf drops `note`; NB4 translator.ts refresh re-runs detection on every tab activation and restarts cancelled jobs; NB5 mentions() regex per pair; NB6 personal glossary silently truncated past budget share; NB7 indentation; harness: briefedChunks string-sniffing, --glossary split on 2nd '='.
- Ruling: fix NB1–NB7 and both harness minors (NB6: warn in the options editor when the personal glossary exceeds the prompt share, and reserve personal entries first). Forwarded with D9 to m2-C-impl as round 3.
- C-impl rounds 2–3: commits 545568f (re-gloss fixes: keep-as-is never glossed; used terms never re-glossed; translate@1 pinned by hash test), 0a3e7c6 (M2-D9 one-chunk docs skip analyze; About only with a brief; NB7), 5acd3a6 (harness: engine `chunk` event carries briefed; fixed race — prompt built from one memory snapshot; --glossary a=b; c400 mock OK), b4cfd04 (NB1, NB2 fences <brief>/<glossary> + tag neutralization, NB5, NB6 BRIEF_MAX_TOKENS 400 / personal glossary 1100 first), 91d7438 (NB3 note kept, NB6 options warning), 888d5d3 (NB4 refresh compares raw settings, never restarts cancelled job). check green 868 tests.
  - Evidence after round 2: "Future (Future)" → "Future zero-cost"; Rust c400 no parentheses after Future/executor (brief marks them keep-as-is → never glossed); deploy panel kept 11/12, no "deploy (…)" (one paraphrase miss).
  - Overspend: live total ≈ $0.198 vs supervisor cap $0.18 (an accidental live `--set fixtures` run, $0.050). Supervisor cap, not a plan budget; reported to user.
  - Live evidence predates b4cfd04 (translate@2 changed again) → tester re-verifies live.
- Sent reviewer range 02385a2..888d5d3; started C tester on 888d5d3.
- C-review round 2 (02385a2..888d5d3): 0 BLOCKING; round-1 NB1–NB7 + harness minors CLOSED (NB4 partly → N2/N3). D9 correct, race fix sound, system block byte-stable. New NB: N1 glossary.ts used-terms line dropped when glossary fills its share; N2 translator.ts refresh double-restart race (mark key before await); N3 resume of a cancelled job mixes old settings. Ruling: fix N1, N2; N3 → resume re-reads settings. Forward to C-impl after compaction.
- C-impl round 4: 30254fb (N1 reserve for used-terms line, byte-stable), 7df7898 (N2 refresh marks settings before await; N3 resume re-reads settings — unchanged: finish leftovers; changed: fresh run, brief kept if target unchanged; skipped page + Translate anyway still translates). 877 tests. $0 spent. Sent reviewer 888d5d3..7df7898; tester to include 7df7898 in a short regression.
- C-review round 3 (888d5d3..7df7898): 0 BLOCKING; N1–N3 CLOSED. New NB: R1 refresh flip-flop race (A→B→A leaves B job with key A) → check used.get(tabId)===key after await; R2 docFor rejection leaves key marked + unhandled → try/finally unmark. Minor (resume after target change ignores skip) accepted. Forwarded R1, R2 to C-impl (round 5).
- C-impl round 5: 101f457 — prepare() helper (mark, try/catch detection, drop stale/failed) fixes R1, R2; tests fail on old code; 879 tests. Sent reviewer 7df7898..101f457.
- C-review round 4 (7df7898..101f457): R1, R2 CLOSED; only 3 informational minors (accepted, no action). Reviewer: Phase C has no open findings. Waiting on C tester (live, on 888d5d3; needs short regression on 101f457 for panel parts).
- C-test round 1 (888d5d3; Chrome build possibly incl. round 4/5): all 7 checks MET, spend ≈ $0.051. Rust terms consistent, one gloss on first use (primer), executor never glossed; sarcasm survives (Bierce, Swift); 3 styles differ (natural vs faithful modestly); A/B table renders; Chrome: deploy keep-as-is → 27 kept, no gloss; one-chunk page no About/no analyze; style switch retranslates; cancelled job stays cancelled; quota guard warns at 1100 tokens / refuses at 8192 bytes.
  - FINDINGS: (F1) over-glossing — translate@2 glosses every Bierce headword ("KẺ LẮM LỜI (bore)") and common words at 120-token chunks ("(*circumvention*)") — conflicts with M2-D1 gloss rule (glossary terms + terms with no common equivalent only) → fix. (F2) report cost ratio compares 23 baseline docs vs 11 → like-for-like on common passages → fix (was review NB9). (F3) model mistranslation "poll … tiến 0 bước" — model quality, noted. (F4) chunk 1 system block differs from briefed chunks (per D6) — accepted under D6; briefed chunks byte-identical.
- Round 6 to C-impl: F1 + F2. Then tester short live recheck of glossing.
- C-impl round 6: f095209 (translate@2 gloss rule: technical terms only, never ordinary words, headwords bare), 9ba7d7d (F2 report compares common passages; ctx2 vs baseline same-11 ×1.87, pre-D9), ad89127 (headword rule names the "X (bore)" form; NOT verified live). 881 tests. Live: Bierce body-word glosses gone, headword glosses remain (7/7) after f095209.
  - BLOCKER: gemini-3.5-flash-lite free-tier daily quota exhausted (500 requests/day; "retry in 21h38m" at ~09:40 → ~07:20 on 2026-10-08). All live translation is blocked (Phase C recheck, Phase D live, F). Judge model gemini-3.7-flash has its own 20/day quota (resets ~14:00 +07).
- Sent reviewer 101f457..ad89127. Asking user: billing vs wait; whether to accept C conditionally and start D.
- C-review round 5 (101f457..ad89127): 0 BLOCKING; translate@1 untouched, block byte-stable, rules consistent, report math verified. Minors: (1) gloss language unnamed in GLOSS_RULES.first; (2) totalsOn with empty docs → null cost; (3) translate@2 changed in place → record a rendered-prompt hash in summary.json. Ruling: fix all three (with the APIBOX task).
- User: M2-D11 APIBOX provider; M2-D12 accept C conditionally, start D. Plan: scout probes APIBOX /models; C-impl wires APIBOX into harness + app (small infra task, sequential to avoid two implementers in one tree), fixes reviewer minors, runs the gloss recheck; then start Phase D.
- User: no Gemini flash on APIBOX → M2-D13 (deepseek-flash translator, deepseek-v4-pro judge, new single-pass baseline on deepseek-flash).
- Scout: APIBOX /models = ds/deepseek-flash, ds/deepseek-v4-pro only; key present; wiring points cited (run.ts:111-116, openai.ts:16, judge.ts:40-42, judge-core.ts:14, settings.ts:37-48, Options.tsx:40,123, route.ts:19-20; manifest needs no change). Sent C-impl round 7: APIBOX provider in harness/judge/app, quirks probe, pricing, reviewer minors 1–3, new deepseek-flash single-pass baseline (committed), gloss recheck, judge smoke test. Live cap ~300k tokens.
- C-impl round 7: eaf1263 (minors 1–2), f0eb6f1 (APIBOX default in harness/judge/app; presets.ts; DeepSeek quirks reasoning_effort "none", reserve 0; promptHash + strategyVersion in summary.json), 5acabaa (NEW BASELINE eval/runs/baseline-single-pass-translate1-deepseek-flash: 0/149 lost, 23 calls, 17,134 in / 13,831 out, $0.00669 nominal, promptHash 225254ef84c3; blank human sheet). Prices from api.ai-box.vn/api/pricing (verified:false; flash $0.10/$0.40 per M, v4-pro $0.44/$1.32 per M; nominal USD, user to confirm real cost). 883 tests. ~43k live tokens.
  - Gloss recheck (deepseek-flash): Bierce 0 glosses, headwords bare; Rust primer 0 glosses — brief marked Future/runtime/zero-cost as keep-English → never glossed; terms consistent.
  - Judge smoke: ds/deepseek-v4-pro, thinking off, Bierce 5/5/5/5 (looks lenient).
  - Supervisor rulings (round 8): (a) plan §2 "with a gloss only on first use" + M2-D1 ("terms with no common equivalent" get a first-use gloss) → brief-marked keep-English technical terms get ONE short Vietnamese gloss on first use; only the user's personal keep-as-is entries are never glossed. (b) judge runs with thinking on (reasoning reserve) for a less lenient, more careful score; pinned. (c) prices: ask the user to confirm real cost later (non-blocking; ratios exact).
- C-impl round 8: 1fb6af9 + 94718c0 (brief keep-English terms marked gloss-once; personal keep-as-is never; rule covers every technical term kept in English; first prose use), 3bd8d84 (judge v4-pro reasoning_effort medium, reserve 16000; recorded in judge.json). 884 tests. ~37k tokens.
  - (a) NOT MET live on deepseek-flash: Rust primer first-use glosses unreliable — runtime glossed in ~half of 5 runs, Future/zero-cost never; never a re-gloss; terms consistent. Bierce 0 glosses (correct). Options: 1 accept as model limit; 2 deterministic: used-terms line built only from terms actually glossed earlier (a missed gloss gets another chance) — impl recommends; 3 Phase D post-check; 4 gloss pass with thinking (cost).
  - (b) Judge with thinking: Bierce 4/3/4/4 (vs 5/5/5/5 without), 1355 in / 3728 out, $0.0055; full judge est. 115k tokens ≈ $0.13 nominal.
  - → USER decision on (a). Judge on the deepseek baseline started via m2-A-impl.
- A-impl: full judge on deepseek-flash baseline done — 23/23, commit 4d70983; judge overall 4.61 (fidelity 4.65, naturalness 4.22, tone 4.78, terminology 4.78); 36,491 in / 93,337 out, $0.1333. Now historical under M2-D14.
- User: M2-D14 translator → ds/deepseek-v4-pro. Sent C-impl round 9: switch default translator, gloss recheck on v4-pro, then new v4-pro baseline + sheet.
- C-impl round 9: 17131cf v4-pro default (thinking off; flash selectable; judge same model, thinking medium). Gloss recheck v4-pro: Rust 3 runs — only 'poll (thăm dò)' once; async-await/runtime/Future/await/I/O 0/3; Bierce 0 (correct); no re-gloss. Baseline NOT run. ~24k tokens. Options: (a) relax rule, (b) used-terms only from actual glosses, (c) deterministic gloss insertion from brief (analyze@2 gloss field) — impl recommends, (d) translator thinking low. Supervisor: authorized a small (d) probe (~12k tokens) to inform the user decision.
- C-impl (d) probe 4833325 (--reasoning flags, no default change): low thinking on v4-pro → glosses on first use for async-await 2/2, Future 2/2, zero-cost 2/2, runtime 1/1, I/O 1/1; no re-gloss. Cost ~5× (/bin/zsh.012–0.014 vs /bin/zsh.002–0.003), TTFS 39 s vs 1.2–1.6 s. Overspent probe cap (26.7k vs 15k). → user decision (c) code-inserted glosses vs (d) thinking.
- User: M2-D15 qwen3.8-flash for thinking. Asked scout where qwen3.8-flash is served (APIBOX /models again; Ollama cloud).
- Scout: qwen3.8-flash now listed on APIBOX (3 models); not on ollama.com public list. Sent C-impl a qwen3.8-flash thinking probe (quirks, price, Rust ×2 + Bierce ×1, cap 25k tokens).
- C-impl qwen probe run 1 (d607e50 harness reasoningTokens + qwen pricing $0.032/$0.094 per M nominal): qwen3.8-flash low thinking — glosses ≈ v4-pro low (async-await, runtime, zero-cost, lazy, method chaining; Future inline), 1 over-gloss (end-user), poll '(poll model)'; no re-gloss; reasoning not capped by max_tokens; TTFS 39.3 s; cost $0.00074/run (~1/17 of v4-pro low). Authorized remaining runs + qwen off + qwen minimal (cap 50k).
- C-impl qwen probe done (43k tokens): qwen off — half the terms glossed, TTFS 1.35 s, $0.0002; minimal — all glossed once, faithful, TTFS 11.9 s, $0.00046 (1 run); low — run 2 FIDELITY FAILURE (2 segments rewritten/invented; 'lost' 0, only reading/judge catches it); Bierce 0 glosses. Reasoning not bounded by max_tokens. → user choice.
- User: M2-D16 qwen3.8-flash, chunk 1 off, later minimal. Sent C-impl round 11: implement per-chunk thinking policy as default; new qwen baseline + sheet; validation runs contextual@2 at 1500 and 400; then A-impl judges.

### Iteration 5 — 2026-10-07 14:24
- ctx: supervisor 35%, scout 12%, A-impl 9%, C-impl 23% (validation runs in background), C-review 16% idle, C-test 14% idle.
- C-impl round 11 progress (state file): c0a480a per-chunk reasoning policy (Quirks.reasoning.byChunk, NormalizedRequest.chunkIndex; qwen uses max_completion_tokens which IS honoured as a reasoning cap; default qwen profile; summary.json thinking stats/outliers), 891 tests. Found a runaway (5.5 min, no answer) on a probe → cap via max_completion_tokens. c400 validation run in progress (5/23 docs).
- Next: on C-impl's report, compact it (≥25%), have A-impl judge the qwen baseline + validation runs, have C-review review c0a480a.., C-test short check; then accept C, start D. Supervisor to self-compact at 40%.
- C-impl round 11 report: c0a480a (per-chunk thinking policy; qwen max_completion_tokens cap = budget + 3000 reserve; outlier flags), 3c9755f NEW REFERENCE BASELINE eval/runs/baseline-single-pass-translate1-qwen3.8-flash (0/149 lost, 23 calls, 17,980 in / 9,699 out, $0.00149, TTFS median 1.8 s; all one-chunk → no thinking). 891 tests. Validation (eval-results, uncommitted): ctx2 c1500 0/149 lost $0.00183 TTFS 1.66 s, no briefs (D9); ctx2 c400 0/149 lost $0.00457, 11 briefs, chunk-1 reasoning median 1,546 max 3,117 (3 outliers ~37 s, close to 3000 reserve — tight), TTFS median 1.55 s. Glosses at 400: chunk-1 misses (async-await, runtime; executor/task/channel/crate), chunk ≥1 good; no re-/over-gloss; Bierce clean. Round 11 ≈ 184.5k tokens (incl. ~20k runaway probe).
- Dispatch: A-impl judges qwen baseline (commit judge.json) + both validation runs (eval-results); C-review reviews ad89127..3c9755f; C-test live panel check of the qwen default.

## RESUME SNAPSHOT (2026-10-07 ~14:40, supervisor ctx 37%)
- Phases: A ACCEPTED (conditional: scoring). B ACCEPTED. C ACCEPTED conditionally (M2-D12) — remaining before closing C: judge results on qwen runs, C-review of ad89127..3c9755f, C-test live panel check on qwen default; then close C sessions and start D. D NOT STARTED (goal ready: scratchpad/goal-D-impl.md — update it for M2-D16: translator qwen3.8-flash per-chunk thinking, judge v4-pro). F NOT STARTED (include --chunk-tokens 400 run, M2-D10).
- Live sessions: m2-scout wC:p3S (idle); m2-A-impl wC:p3T (judging qwen baseline + 2 validation runs); m2-C-impl wC:p30 Opus (round 11 reported; compact when idle, ~24%); m2-C-review wC:p41 (reviewing ad89127..3c9755f); m2-C-test wC:p42 (live panel check on qwen).
- Reference baseline for user scoring: eval/runs/baseline-single-pass-translate1-qwen3.8-flash/human-scores.md (tell the user it's the one to score). Older baselines (gemini, deepseek-flash) historical.
- Open to user: human scores (qwen sheet); LanguageDetector check (M2-D8); confirm APIBOX real prices.
- Peers report via SendMessage to m2 (pane wC:p2J) when idle/done.
- C-review (ad89127..3c9755f): 0 BLOCKING; boundary/secrets/translate@1/byte-stability OK. NB1 reserve thin for small tail chunks (cap ~3200 vs 3117 reasoning) → floor; NB2 repair resends with thinking → attempt 2 thinking off; NB3 used-terms counts headings/code → exclude; NB4 'unlisted terms once per document' impossible across parallel chunks → limit rule to listed + brief keep-English; NB5 harness reasoningByUser keyed by user text → key by call order; NB6 chunk 0 cap includes unused reserve → per-chunk reserve. Note: default sends page text to api.ai-box.vn (third party) → DESIGN §8 privacy wording; tell user. Ruling: fix NB1–NB6 (round 12).
- C-test live recheck on qwen (3c9755f): TTFS 1.14/1.67 s, About OK, 21/21 final; deploy keep-as-is OK (27, no gloss); style switch retranslates; one-chunk no analyze; net-log only api.ai-box.vn. PARTIAL item 1: brief says deploy→triển khai but chunk 2 flips to bare 'deploy' (7 vs 31), and 'deploy (triển khai)' gloss lands on 3rd use not first; 'rolling update'/'production' rendered inconsistently across runs. → forwarded to C-impl with round 12 as NB7.
- C-impl round 12: ca5107a — NB1+NB6 per-request reserve (6000 for thinking chunks), NB2 repair thinking off, NB3 used-terms scan running text only, NB4 gloss only glossary terms, NB5 usage reasoningOutput, deploy defect fixed ('always write it this way'; used-terms line shows renderings). 896 tests. Live: deploy at 700 — briefed chunks 100% triển khai; chunk 0 (no brief) 13 vs 1. Primer/executor/bierce 0 lost, no cap cuts. OPEN → user: chunk 0 runs before the brief (D6) so its renderings/glosses can differ from briefed chunks; full consistency needs chunk 0 to wait for the brief (latency) or a re-translation of chunk 0.
- A-impl judge (v4-pro) on qwen runs: baseline judge.json committed 3497cc0. Overall A single-pass@1 4.46 | B ctx@2 c1500 4.30 (fid −0.30, term −0.13) | C ctx@2 c400 4.15 (fid −0.61, term −0.43). Cost ratio B ×1.23, C ×3.07. Judge cost ≈ $0.13/run. Fidelity ≤3 list incl. **C rust-book-ownership fidelity 1: segment 4 repeats segment 3 (duplicated text, missing content)** — possible chunk-boundary/repair bug. NOTE: these runs predate ca5107a (round 12). RISK for §3 #1: contextual below single-pass on the judge; at c1500 contextual ≈ translate@2 without brief, so translate@2 itself scores below translate@1 on qwen (single run; judge noise unknown; human scores are the source of truth).
- User: M2-D17 re-translate chunk 0 as revision 2; M2-D18 leave §8.
- Round 13 to C-impl: (1) investigate + fix the rust-book-ownership duplicate segment; (2) M2-D17; (3) diagnose translate@2 vs @1 fidelity drop from judge comments (plan §8 risk mitigation: iterate translate@N), propose/try fixes, A/B on 23 passages with judge.

## RESUME SNAPSHOT 2 (2026-10-07 ~15:00, supervisor ctx ~39%, self-compacting)
- Phases: A ACCEPTED (conditional: user scoring). B ACCEPTED. C ACCEPTED conditionally (M2-D12) but still in rounds: round 13 running on m2-C-impl (dup-segment bug in rust-book-ownership c400; M2-D17 chunk-0 revision 2; translate@2 quality drop vs @1 on the judge — iterate per plan §8; cap 600k tokens incl. ≤3 judged runs). After its report: C-review the range ca5107a..HEAD (last reviewed: ad89127..3c9755f; ca5107a not yet reviewed), C-test short live recheck (deploy consistency, chunk-0 rev 2), then close C and start D (goal scratchpad/goal-D-impl.md — update for M2-D16/D17: translator qwen3.8-flash per-chunk thinking, judge v4-pro; check stage should also consider neighbour-duplicate detection per round-13 finding).
- D NOT STARTED. F NOT STARTED (include c400 run, M2-D10; §3 #1 at risk: contextual < single-pass on the judge so far).
- Live sessions: m2-scout wC:p3S idle; m2-A-impl wC:p3T idle (judge runner; judge ≈ $0.13/run); m2-C-impl wC:p30 Opus (round 13); m2-C-review wC:p41 idle; m2-C-test wC:p42 idle.
- Reference baseline: eval/runs/baseline-single-pass-translate1-qwen3.8-flash (judge.json 3497cc0). User to score its human-scores.md.
- Open to user: human scores (qwen sheet); LanguageDetector check (M2-D8); confirm APIBOX real prices.
- Iteration 15:16: ctx supervisor 39% (self-compact queued), C-impl 28% working → checkpoint request sent; scout 12, A-impl 10, C-review 20, C-test 15 (idle).
- Iteration ~15:20 (supervisor resumed after self-compact, ctx 6%): C-impl checkpoint report — round 13 task 1 dup fix 8790a60 (copied-neighbour guard in translateChunk; only hit across all eval outputs; suggests Phase D check also compares neighbours document-wide), task 2 M2-D17 956ae86 (`revise` stage re-translates chunk 0 as revision 2; skipped when no brief/brought brief/translate@1/one chunk; harness records final text + draft, counts revised; check exit 0, 904 tests). Task 3 in progress, uncommitted (translate.ts, assemble.ts; 5 tests on old rule text): translate@2-only defects found (English "informal", "callback hell" bilingual in 3/3 @2 runs, 麻烦 leak in wp-beans, "Future (Tương lai)", 50 vs 22 added parentheticals); cand1–3 unjudged, 0/149 lost; ~120k/600k used. Compacting C-impl (28%). ctx: scout 12, A-impl 10, C-impl 28, C-review 20, C-test 15.
- ~15:25: C-impl compacted (28% → 0%), resumed on round 13 task 3 (prompt settle, tests, ≤3 judged runs, table vs qwen baseline). Idle notice subscribed. Others idle.
- ~15:50 C-impl round 13 REPORT: commits 8790a60 (copy guard: Dice bigram ≥0.6 vs neighbour translation, sources <0.3, ≥8 words → repair), 956ae86 (M2-D17 revise), 496dafe (translate@2 prompt fixes, promptHash 848336fde86c). check exit 0, 905 tests. Judge (v4-pro, 23 passages, qwen3.8-flash), overall/fid/nat/tone/term/cost×:
  A single-pass@1 baseline 4.46/4.43/4.04/4.65/4.70/1.00
  B ctx@2 c1500 old        4.30/4.13/3.91/4.61/4.57/1.23
  D ctx@2 c1500 new        4.47/4.35/4.04/4.74/4.74/1.14
  C ctx@2 c400 old         4.15/3.83/3.91/4.61/4.26/3.07
  E ctx@2 c400 new+revise  4.27/4.17/3.96/4.65/4.30/3.92
  All 0/149 lost. c1500 now matches @1 (fidelity −0.08); c400 still below (gloss/terminology across chunks, 62 parentheticals). Residuals: "patriotic" dropped (bierce), "callback hell" dup in D. Budget ~486k/600k; stopped at 2 judged runs. Phase D suggestions: document-level neighbour-duplicate check, wrong-script (CJK) leak check. Follow-up: analyze@1 JSON robustness (rust-book-ownership brief invalid at c400).
  Actions: C-review compacted (20%→0) and sent ca5107a^..496dafe; C-test sent live recheck (check, dup, D17 panel, deploy, CJK/informal/麻烦 counts; ≤60k); C-impl told to hold. ctx: sup 8, scout 12, C-impl 9, C-review 0, C-test 15.
  OPEN FOR USER at C close: §3 #1 at c400 still below single-pass (Phase F question).
- ~16:00 C-review ca5107a^..496dafe: 0 BLOCKING, 6 NB. NB1 copy guard runs in single-pass too (behaviour change) → restrict to contextual/@2. NB2 revise lane may overlap chunk 0 rev 1 and is outside the concurrency pool → await chunk 0, count in pool, test. NB3 cast in contextual.ts:62 → typed helper. NB4 boundary tests for duplicate thresholds. NB5 partial flash before repair → no change (cosmetic). NB6 target-language-only rule vs brand/identifiers → one cheap live check; translate@2 version bump before release (open). Forwarded as round 14 to C-impl (≤30k live). C-test still on 496dafe recheck.
- ~16:10 C-test round 13 recheck on 496dafe: ALL PASS. check 905 tests; 0 neighbour repeats in cand3 c400/c1500 + live ownership rerun (4/4, revised 3, $0.00038); M2-D17 in Chrome: chunk 0 replaced in place as rev 2 after brief (6.7 s), one-chunk page no analyze/revise; deploy keep-as-is 26/26 English across chunk 0+1, 0 glosses. Caveat: "deployment" (seg 14) still "triển khai" — entry is bare "deploy"; word-form matching not covered (note for user, not a defect vs §7.4). Spot check: 0 CJK, "informal" translated, no 麻烦. Evidence: tester scratchpad live/runR4, runR2, runR.
- ~16:30 C-impl round 14: 305cc4a (NB1 guard only translate@2; NB2 revise as pool work item after chunk 0, overlap test fails on 496dafe; NB3 typed createTranslateRun; NB4 boundary tests). check 914 tests. NB6 live (~12.6k): no over-translation of identifiers/products/keep-as-is. FINDING: rev 2 (M2-D17) dropped inline code backticks that rev 1 kept (brief glossary renders terms bare) → rev 2 can worsen a segment. Supervisor ruling (implementation guard within D17, no spec change): round 15 = keep rev 1 per segment when rev 2 has fewer inline markers, count reviseKept, tests. Carry to Phase D goal: marker/code check covers revisions + glossary-rendering backtick root cause + document-level neighbour-duplicate + wrong-script leak. Open: translate@2 version bump before release; "lười (lazy)" unlisted gloss.
- ~16:45 C-impl round 15: 5fc1e58 revise marker guard (per-kind counts; rev 1 kept on loss; chunk event revise.kept; harness reviseKept). check 916 tests. Sent C-review re-review 496dafe..5fc1e58. C-impl holding.
- ~17:00 C-review re-review 496dafe..5fc1e58: 0 BLOCKING; round 13 NB1–NB4 CLOSED. 3 new NB → carried to Phase D goal: (1) revise guard compares rev 2 vs rev 1, not vs source (D's check compares to source); (2) revise item holds a pool slot while waiting for the brief, delays chunk 2 at maxConcurrency 2, mixed rev 1/rev 2 renderings in chunk 0 (note in M2 notes); (3) emphasis count includes asterisks inside code spans (strip code first).
  Phase C status: tester all PASS (round 13 recheck, 496dafe); reviewer no blocking (5fc1e58); user sign-off M2-D12 (conditional accept). Asked scout to confirm commits → then close C sessions and start D. §3 #1 at c400 still below single-pass — Phase F question, reported to user.
- ~17:10 Scout confirmed: m2 HEAD 5fc1e58, ca5107a..5fc1e58 commits present, tree clean except tpl.md + log, eval/runs untouched, nothing pushed. **Phase C ACCEPTED (closing commit 5fc1e58).** Closed m2-C-impl, m2-C-review, m2-C-test. Next: Phase D implementer (Opus).
- ~17:15 User M2-D19 (add neighbour-duplicate + wrong-script checks to D). goal-D-impl.md updated (M2-D16/D17/D19, carried Phase C findings, measure qwen c1500 + c400 + single-pass@1). Started m2-D-impl wC:p43 Opus, /goal sent. Live: scout wC:p3S, A-impl wC:p3T (judge runner), D-impl wC:p43.
- Iteration ~17:30: D-impl picked up goal, working (reading code). ctx: sup 11, scout 12, A-impl 10, D-impl 17. No reports. Wake 10 min (D-impl near 20%).
- Iteration ~17:45: D-impl interrupted by Mac sleep (goal retry), ctx 20% → nudged + checkpoint warning. ctx: sup 12, scout 12, A-impl 10, D-impl 20.
- Iteration ~17:55: D-impl committed 75396c6 (budget v0, default 400k tokens, 0 = no limit; 953 tests), check-stage commit (1) earlier; second Mac-sleep interruption while adding harness counters → nudged. ctx: sup 12, scout 12, A-impl 10, D-impl 22.
- Iteration ~18:05: D-impl running Phase D eval measurement (background, e.g. go-errors-are-values final 7/7 lost 0, check 0→0/0, code 3/3) at ctx 24% → checkpoint request sent (compact while runs continue). ctx: sup 13, scout 12, A-impl 10, D-impl 24.
- ~18:20 D-impl checkpoint: commits 93d4d4c (check stage + D19), 75396c6 (budget v0), ec9399e (harness counters). Run 1 phaseD-ctx2: 0/149 lost, 1 re-request (number) repaired, +757 in/53 out, code 25/25. Runs c400 + sp1 in background. Compacted D-impl (24%→0), resumed to collect runs and report.
- ~18:50 D-impl FINAL round 1: 93d4d4c (check stage v1 + M2-D19), 75396c6 (budget v0, default 400k, 0 = none), ec9399e (harness counters). 953 tests. Live qwen: ctx2 c1500 lost 0/149, code 25/25, 1 re-request (number) repaired; ctx2 c400 lost 1/149 (network stall, rerun of that doc 0/7), code 25/25, revised 43, 1 kept rev 1; sp1 lost 0/149, code 25/25, 1 re-request repaired. ~175k tokens. Carried C items all done except pool-slot note (comment). Open: strict number check; check-failed text dropped from memory; CHECK_MESSAGE raw in panel; harness chunk 1500 vs extension 1200.
  Started m2-D-test wC:p44 and m2-D-review wC:p45 (Sonnet), /goal sent. D-impl holding.
- ~19:05 D-review round 1 (5fc1e58..ec9399e): 1 BLOCKING — B1 panel shows a rev-2 segment that failed the check twice as translated (segment.failed has no revision; harness counts it lost) → product breaks §2/§3 #4, eval can't see it. 9 NB (N1 machine-readable check failure, N2 attempt numbering, N3 marker nesting, N4 number tokenization 3.5 vs 35 / lists, N5 language-aware length ratio, N6 TARGET_SCRIPTS coverage, N7 empty budget = 0 no limit, N8 noted, N9 tests). Forwarded as D round 2 (all but N8; N4 keep policy). D-test still on ec9399e.
- Iteration ~19:20: D-impl round 2 working (15%), D-test working (11%), D-review idle (ctx unreadable, was low), scout 12, A-impl 10. No reports.
- ~19:45 D-impl round 2: c92e1e0 fixes B1 (segment.failed.revision; panel + harness failure replaces finals at ≤ revision), N1–N7, N9; N8 noted. check clean, 967 tests. Offline number recheck 2,851 segments: 0 new failures. Sent D-review re-review ec9399e..c92e1e0. D-test still on ec9399e.
- ~20:00 D-review re-review ec9399e..c92e1e0: B1, N1–N7, N9 CLOSED; 0 BLOCKING; 3 new NB (isDense counts link markers; *** crossing tokenization; trailing decimal zeros + space thousands separator) → forwarded as D round 3.
- ~20:20 D-impl round 3: 7be92fa (isDense strips link markers, *** stack pairing, trailing zeros + space thousands). 968 tests; offline counts unchanged (script 9, code 10, markers 18, length 1, duplicate 1, number 2 over 2,851 stored segments). Sent D-review c92e1e0..7be92fa.
- ~20:35 D-review round 3 (c92e1e0..7be92fa): 3 findings CLOSED, 0 BLOCKING, 1 optional NB (space-grouping merges 'Figure 3 100%' → 3100; rare) → recorded as known limitation, not forwarded (diminishing returns). Reviewer: nothing blocking at 7be92fa. Waiting on D-test (ec9399e) then delta recheck on 7be92fa.
- ~20:40 User: peers must be in separate tabs, not split into the supervisor's tab. Moved D-impl wC:p43, D-test wC:p44, D-review wC:p45 to their own tabs (pane IDs unchanged). Future sessions: create-session.sh without --split flags.
- ~20:50 D-test on ec9399e: check MET (953); recount MET (ctx2 0/149, c400 1/149 network, sp1 0/149, code 25/25 each); fault injection a–g MET (re-request once → final attempt 2 or failed; localised separators not flagged); budget in Chrome MET (2000 → stops 17/21 cleanly, 0 = no limit, persists in sync); panel segment.failed MET (screenshot runF/check-failed.png). **§3 #3 NOT MET live**: go-errors-are-values c400 loses segment 1nbjt7m127q 2/2 runs (backticks on `bufio`/`Scan` dropped in both first pass and retry, plus glosses). Open: panel shows no failure reason (M3); budget change needs retry.
  → D round 4 to D-impl: targeted re-request (per-segment failure detail), root cause of the drop, verify go-errors c400 ×3 + one full ctx2 c400 run; ≤150k live.
- Iteration ~21:10: D-impl round 4 interrupted by Mac sleep after feedback tests passed → nudged + 21% warning. ctx: sup 18, scout 12, A-impl 10, D-impl 21, D-test 15 (working), D-review 13.
- Iteration ~21:30: D-impl committed 38d3659 (round 4: glossary keeps backticks on code words inside longer terms where source has them; re-request shows the failed answer + per-segment fix list). Root cause: brief glossary 'bufio package → gói bufio' without backticks overrode the keep-code rule. check 973 tests (side-panel controller tests flaky twice on timing, passed on rerun — watch). Live runs in background (go-errors c400 ×3 + full ctx2 c400). Acked D-test (it waited on a reply to its ec9399e report), holding for delta recheck. ctx: sup 19, D-impl 21, D-test 15, D-review 13.
- ~21:55 D-impl round 4 report: 38d3659 (glossary code-word backticks inside terms; re-request shows earlier answer + per-segment fix lines) + 486a0a2 (leak fix line quotes leaked text). 973 tests (controller.test.ts timing flake once). Live: go-errors c400 ×3 lost 0; full ctx2 c400 lost 1/149 (wp-beans 麻烦 leak, retry repeated) → after 486a0a2 wp-beans ×3 lost 0 (one leak repaired); code 25/25. ~138k used. Sent D-review 7be92fa..486a0a2; D-test delta recheck on 486a0a2 incl. independent full ctx2 c400 run (≤130k), check ×3 for flake, fault matrix, B1 panel, empty budget.
- ~22:15 D-review round 4 (7be92fa..486a0a2): 0 BLOCKING, 4 NB (glossary shown() quadratic cost ~0.75 s/fit on code-heavy pages; ASCII \w boundary vs Vietnamese letters; fix lines quote page text un-neutralised/unbounded (§8 hygiene); parenthesis heuristic fires on legit gloss). controller.test.ts flake pre-existing (M0/M1 real timers), not Phase D. → D round 5 (all 4, no live).
- ~22:35 D-impl round 5: b14c6ae fixes the 4 NBs (memoised shown + perf test <250 ms, old 2.6 s; Unicode boundaries; quoted page text cut/neutralised/<data>-fenced, ≤8 items; paren rule only after code). 977 tests. Sent D-review 486a0a2..b14c6ae. D-test still on 486a0a2 live recheck.
- ~22:50 D-review round 5: 4 findings CLOSED, 0 BLOCKING, 2 tiny NB ($ patterns in string replacer; wall-clock perf test) → D round 6.
- ~23:00 D-impl round 6: dad63e7 (function replacers + $$ test; perf bound 1 s). 978 tests. Sent D-review quick confirm. D-test still on 486a0a2.
- ~23:10 D-review round 6: both closed, 0 findings. Reviewer: nothing open at dad63e7. Waiting on D-test (486a0a2 full live run); then quick D-test check on dad63e7 (pnpm run check) before acceptance.
- ~23:30 D-test delta on 486a0a2: ALL MET — check ×3 green (973, no flake); full ctx2 c400 lost 0/149, code 25/25 (own recount), 1 re-request (script) repaired; go-errors c400 ×2 lost 0; fault matrix + 3-message re-request with fix lines; B1 panel (rev-2 double failure shows failed, no text); empty budget → 400000 in Chrome. ~123k tokens. Sent D-test final check on dad63e7 (mock only) and scout commit confirmation.
- ~23:40 Scout confirmed Phase D: m2 HEAD dad63e7, 9 commits 93d4d4c..dad63e7 present (25 files, +1893/−143), tree clean except tpl.md + log, eval/runs + src/engine/prompts untouched, nothing pushed, no home paths in diff. Waiting on D-test final check on dad63e7.
- ~23:50 D-test final on dad63e7: fault matrix MET; pnpm run check failed 2/3 (different controller.test.ts tests, timing under load; file alone 5/5; 486a0a2 was 3/3). → D round 7 test-only: make controller.test deterministic (no behaviour change), lighten context perf test if needed, check ×5 green.
- ~00:05 D-impl round 7: 8bc7484 controller.test.ts on fake timers (cause: real sleeps vs real 20/30 ms controller timers under load); check 5/5 green (978). Sent D-test check ×3 and D-review quick confirm.
- ~00:10 D-review round 7: confirmed test-only, no assertion/prod change, no hidden race. 0 findings. Waiting on D-test check ×3 on 8bc7484.
- ~00:20 Scout confirmed 8bc7484 (test-only, parent dad63e7, tree clean, nothing pushed). D-test check 3/3 green. **Phase D ACCEPTED (closing commit 8bc7484).** Closed m2-D-impl, m2-D-test, m2-D-review. Phase F goal written (scratchpad/goal-F-impl.md); F start pending user: M2-D4 says baseline scoring (user's human sheet on qwen baseline) must finish before F.
- ~00:30 User M2-D20: start F now. Started m2-F-impl wC:p46 (own tab), Sonnet, /goal sent. Live: scout wC:p3S, A-impl wC:p3T (idle, judge runner — superseded by F-impl's own judge runs), F-impl wC:p46.
- Iteration ~00:50: F-impl running run 1 (ctx2 c1500), ctx 6%. Closed idle m2-A-impl (judge work now in F-impl). ctx: sup 23, scout 13, F-impl 6.
- ~01:30 F-impl REPORT: 8945506. Judge (fid/nat/tone/term/overall, cost×): single-pass@1 frozen 4.43/4.04/4.65/4.70/4.46; ctx@2 c1500 4.22/4.00/4.70/4.74/4.41 ×1.17; ctx@2 c400 4.04/3.91/4.65/4.43/4.26 ×3.59; ctx@1 c400 4.26/4.04/4.78/4.48/4.39 ×1.84. Re-judge c1500: fid 4.30, tone 4.57, term 4.61 (MAD 0.27). All lost 0/149. §3 #1 judge NOT MET (c1500 fidelity −0.22/−0.13; tone/term +0.04 first judge, −0.08/−0.09 on re-judge); §3 #2 MET at c1500 only. Baselines committed: baseline-contextual-translate2-qwen3.8-flash(-c400), m2-final-report.md. Panel default contextual jobs.ts:44. Rec: c1500 as M2 baseline.
  Started m2-F-test wC:p47, m2-F-review wC:p48 (own tabs). GATE to user: §3 #1 judge miss, baseline choice, human sheets (3), demo.
- ~01:40 User: M2-D21 score first then decide on §3 #1; M2-D22 M2 baseline = contextual@2 c1500. F-impl told to hold (and record the baseline choice in m2-final-report.md if the report names it).
- ~01:55 F-impl: 0ea44fe (report names c1500 as M2 baseline, §3 #1 pending human). Scoring guide in state-F-impl.md; relayed sheet paths + report command to user. D-review range extended to 0ea44fe. F-impl holding.
- ~02:10 F-review (8bc7484..0ea44fe): 0 BLOCKING, 7 NB (commit in summary.json; re-judge not committed + its lower tone/term; ctx@1 c400 local; c400 'baseline-' name; single-chunk consequence for M6 gate; c400 briefs not committed; §3 #2 per run) → F round 2 (records/report only).
- ~02:25 F-impl round 2: e9a30bf (N1–N7 fixed; records only). Reported it briefly swept the user's tpl.md into a commit then amended it out → scout asked to verify tpl.md not in any commit and the working-tree change intact. F-review quick confirm sent.
- ~02:35 F-review round 2: N1–N7 CLOSED, 0 findings (cosmetic: c400 README 'briefs' includes 12 skip records — not forwarded). tpl.md not in range. Reviewer: nothing open at e9a30bf. Waiting: scout tpl.md verification, F-test report, user human scores.
- ~02:45 Scout: tpl.md SAFE — no commit on m2 touches it; working-tree change intact (2+/2−: PLAN_FILE M2, LOG_FILE progress-m2); the commit that included it (a6b4afb, reset away) is orphaned, reflog only. m2 HEAD e9a30bf, nothing pushed.
- ~03:00 F-test (8945506): checks 1–6 MET (check green; report regenerated, every number matches; judge means + ratios recomputed; baselines complete, 0 lost, gitCommit; sheets readable by eval:report; panel default contextual jobs.ts:44). Human parts BLOCKED on user.

## RESUME SNAPSHOT 3 (2026-10-08 ~03:00)
- Phases A, B, C, D ACCEPTED (D closing commit 8bc7484). F WAITING ON USER — work done (e9a30bf), tester + reviewer clear.
- User to do: score 3 sheets (eval/runs/baseline-single-pass-translate1-qwen3.8-flash/, baseline-contextual-translate2-qwen3.8-flash/, baseline-contextual-translate2-qwen3.8-flash-c400/ human-scores.md), then run `pnpm run eval:report -- <those 3 dirs> --out eval/runs/m2-final-report-human.md`; then the §3 #1 decision (M2-D21); §7 demo; LanguageDetector check (M2-D8); confirm APIBOX prices.
- After user scores: have F-impl commit the human report (or the user commits); bring §3 #1 decision with human vs judge numbers; on sign-off ask scout to confirm, accept F, close all sessions, final summary, stop loop.
- Live sessions (all idle): m2-scout wC:p3S, m2-F-impl wC:p46, m2-F-test wC:p47, m2-F-review wC:p48.
- ~21:04 User: human sheets scored + eval:report run (m2-final-report-human.md). Asked F-impl to validate, summarise human vs judge, commit sheets + human report (explicit paths, not tpl.md).
- F-impl: human scores committed 6970862 (3 sheets + m2-final-report-human.md + report "Human result" section; tpl.md untouched). Harness rounds sheet scores to 0.5 (user wrote one-decimal values). Human (rounded) single-pass / c1500 / c400: fid 4.50/4.57/4.50, nat 4.39/4.11/3.61, tone 4.41/4.24/3.96, term 4.20/4.07/3.72, overall 4.38/4.24/3.95. Unrounded c1500 deltas: fid +0.08, nat −0.21, tone −0.13, term −0.08. §3 #1 human NOT MET (c1500 tone/term below; c400 worse). Judge vs human: judge high on tone/term, low on fidelity (opposite of human on c1500) → judge not a valid stand-in. GATE: §3 #1 decision to user.
- User M2-D23: accept M2 with §3 #1 gap; contextual stays default. Asked F-impl to record the decision in m2-final-report.md.
- F-impl: d1c3f63 records M2-D23 + Carried forward in m2-final-report.md. Scout asked for final Phase F confirmation.

## FINAL STATE (2026-10-08)
- **M2 COMPLETE.** All phases accepted: A (conditional scoring now done), B, C, D (8bc7484), F (d1c3f63). Branch m2 at d1c3f63, NOT pushed (pushing is the user's call). All peer sessions closed.
- §3 results: #1 NOT MET (accepted gap, M2-D23); #2 met at c1500 ×1.17; #3 segment loss 0 (Phase D tester full run); #4 code preservation 100%; #5 brief failure never fails the job; #6 same-language skip; #7 23 passages, scored (human + judge).
- M2 baseline: eval/runs/baseline-contextual-translate2-qwen3.8-flash (c1500); reference run c400; frozen single-pass reference baseline-single-pass-translate1-qwen3.8-flash.
- Carried forward: tone/terminology gap at c1500; multi-chunk quality at c400 (gloss/term drift, naturalness); judge mis-calibration vs human; translate@2/contextual version bump before release; number check strict (spelled-out numbers); "Figure 3 100%" number merge; dense length bounds uncalibrated; panel shows CHECK_MESSAGE without reason (M3 UX); budget change needs retry; harness default chunk 1500 vs extension 1200; analyze@1 JSON robustness; human score rounding to 0.5 in the harness; translate@2 version bump.
- Open human work: §7 browser demo; LanguageDetector check (M2-D8); confirm real APIBOX prices.
- Uncommitted: docs/prompts/tpl.md (user's edit, intact), docs/progress/progress-m2.md (this log).
