# M4 — Providers: progress log

Plan: docs/plans/M4-providers.md · Spec: DESIGN.md (§4.2, §4.3, §5.1, §7, §8) · Prompt: docs/prompts/implement-plan.md

## Supervisor

- Session name: `m4` · pane `wC:p2J` · tab `wC:t1T` · model Opus 5.5
- Started 2026-10-08. M3 stays open in parallel for the dogfood week (M3-D16): M4 runs on an `m4` branch;
  M3 blockers are fixed on master first, then `m4` is rebased.

## Phases

The plan groups work into sub-goals A–F with milestone-level done criteria (§2) and success criteria (§3).
Each sub-goal is run as one phase, in order. The plan allows no parallelism between sub-goals, so they run
one after another. Done criteria below are copied from §2/§3 and assigned to the phase that delivers them.

| Phase | Tasks | Depends on | Status |
|---|---|---|---|
| A — a second protocol | M4-E1 | M1-E6 (done) | **accepted 2026-10-08**, closed by m4 @ f27f00f |
| B — connections, profiles, routing | M4-E2, M4-E8 | A | **accepted 2026-10-08**, closed by m4 @ d4d065f |
| C — setup that explains its own failures | M4-E3, E4, E5, E6, E7, E12 | A, B | **accepted 2026-10-09**, closed by m4 @ 60bd883 |
| D — resilient and private at runtime | M4-E9, M4-E10 | A, B | **accepted 2026-10-09**, closed by m4 @ 8a2c3ee |
| E — switching is easy | M4-E11, M4-E13 | B, C | **accepted 2026-10-09**, closed by m4 @ 4ed5a59 |
| F — provider matrix | eval set through five providers, publish matrix | A–E | **accepted 2026-10-10**, closed by m4 @ e7c8811 (first accepted @ 54a3b65; reopened for the idle-guard fix) |

### A — M4-E1 `openai-chat` adapter
Task (plan): `openai-chat` adapter on the `openai` SDK: `baseURL`, auth styles, `stream_options.include_usage`,
`max_tokens` vs `max_completion_tokens`, system-role folding, JSON mode flag; quirk learning (flip, retry once, persist).
Done criteria (from §3/§5):
- §3 #1 (adapter part): the harness translates the eval set through an `openai-chat` endpoint.
- §5 "Retry vs fallback ownership": SDK retries off.
- §5 "Ollama 403": `403` + auth `none` + localhost → `cors`.
Spec: §4.2.1–4.2.4, §4.3.5 (error classification).

### B — M4-E2, M4-E8 data model and routing
Tasks: E2 `ProviderConnection`, `ModelProfile`, `Routing` in sync storage; schema version and migration.
E8 routing resolution: site override → tab override → `routing.translate`; `analyze` defaults to `translate`.
Done criteria:
- §3 #7: M1 single-key settings migrate to the new data model with no re-entry.
- §5 "Settings schema": versioned schema in `chrome.storage.sync` with a migration from M1 keys; secrets stay in `local`.
- §5 "Role naming": `analyze` / `translate` / `review`; UI label "Document brief".
Spec: §4.3.1, §4.3.4, §4.3.5 (Resolve), §5.1.

### C — M4-E3, E4, E5, E6, E7, E12 setup
Done criteria:
- §2: Settings ▸ Providers lists connections, models and routing (DESIGN §4.3.3 mock).
- §2: Adding a connection: pick a preset → enter a key → **Test connection** (asks for host permission for that
  origin only) → pick a model from a discovered list → save. The first one becomes the translate route.
- §2: A Custom connection on Auto-detect finds which protocols a gateway speaks and fixes common URL mistakes
  (double `/v1`, missing `/v1`, pasted `/chat/completions`).
- §2: Ollama with CORS blocked shows a "CORS blocked" status and a **Fix…** guide with the exact command for each
  OS, not "Fix key". A missing model shows the `ollama pull` command.
- §3 #5: Test connection message correct for: bad key, CORS/origin blocked, model not found, wrong base URL — 4 of 4.
- §3 #8: Removing a connection deletes its key and revokes its host permission.
- §5 "Dual-protocol gateway default": `claude-*` → `anthropic-messages`, else `openai-chat`; show the choice with a switch.
- §5 "Local model chunking": local presets `maxConcurrency: 1`, smaller `chunkTokens`.
Spec: §4.2.5, §4.3.2, §4.3.3 A, §4.3.4, §4.3.6, §8 (permissions).

### D — M4-E9, M4-E10 runtime
Done criteria:
- §2: If the primary provider is rate-limited or down, blocks continue on the fallback with a small model badge.
  A bad key stops and never falls back.
- §2: Settings shows usage per profile and estimated daily/monthly spend, with an optional soft limit.
- §3 #3: Stop Ollama mid-page → blocks continue on fallback with a badge.
- §3 #4: Bad Anthropic key → "Fix key", nothing sent to any other provider.
- §3 #6: "Local only" site rule never falls back to a cloud profile — test passes.
- §5 "Retry vs fallback ownership": pipeline backoff → next fallback profile on `rate_limit`/`overloaded`/`network`; never on `auth`.
Spec: §4.3.5, §5.2 (producedBy), §4.3.1 Routing.

### E — M4-E11, M4-E13 switching and onboarding
Done criteria:
- §2: The panel header has a quick switcher for this tab, with "Make default".
- §2: A 3-step onboarding with a sample-paragraph translation.
- §4: onboarding shows the Chrome built-in path only if S8 said it's viable, otherwise "coming soon".
Spec: §3 (header), §4.3.3 B and C.

### F — provider matrix
Done criteria:
- §3 #1: Harness and extension translate the eval set through: Anthropic direct, OpenRouter (both protocols via
  auto-detect), Gemini via OpenAI endpoint, Ollama (Qwen 7–8B), LM Studio — 5 of 5.
- §3 #2: Provider matrix (quality and cost per provider) recorded from the harness.
- §5 "Local model chunking": `single-pass` for < 7B decided from harness data.
Human-owned inputs: OpenRouter and Gemini keys, a running Ollama with Qwen 7–8B, a running LM Studio (user).
Final gate: the demo script (§7) on the user's machine.

## Gates and decisions

| ID | Question | Status |
|---|---|---|
| G2 | Phase B: load the built m4 extension in real Chrome on an M1-configured profile and confirm it still translates with no key re-entry (tester can't load an unpacked extension, same limit as M3-D8). Harness evidence: `pnpm run migration` PASS m1/m3, 7/7 segments through migrated routing | **closed 2026-10-08, user accepted ("ok")**: first reload looked like a failure because no key had been saved under master; with a key the m4 build translates normally in the user's Chrome. The master→m4 key carry-over itself is accepted on B-impl's Playwright repro (same path upgrade in Chrome for Testing) + harness `pnpm run migration` |
| G3 | Phase C: in real Chrome, Test connection shows the real host-permission prompt for that origin only, and removing a connection really revokes it (tester used a fake chrome.permissions; headless can't answer the prompt). Also no real Ollama/LM Studio available to testers (mocks only) | **passed 2026-10-09** (user: "2 ok, 3 ok, 4 ok" — prompt named only openrouter.ai; Cancel removed it from Site access; removing a saved connection removed its site) |
| G4 | Phase D: §3 #3 "Stop Ollama mid-page" verified with a mock Ollama in the built extension (Chrome for Testing) and in the implementer's Playwright run, not with a real Ollama install. Proposed: accept D now; run the real-Ollama stop during phase F / the §7 demo (step 5) | user: "run it now" (2026-10-09). **closed 2026-10-09: user chose skip** ("Skip Ollama now, i intent to just using cloud ollama, not local"). §3 #3 accepted on the S1 run (built extension, real adapters, mock Ollama stopped mid-page) |
| G6 | Phase E: §7 demo step 1 says "onboarding with an Anthropic key"; no Anthropic key exists, so the tester walked onboarding with a live Gemini key (Anthropic listed as recommended). Proposed: accept E on the Gemini run; do step 1 with an Anthropic key in the §7 final demo (phase F) if the user has one | **accepted by user 2026-10-09 ("accept")** |
| G5 | Phase F provider matrix (plan §3 #1): (a) replace local Ollama (Qwen 7–8B) and LM Studio with Ollama cloud; keep local chunking default (maxConcurrency 1, smaller chunks) and record the §5 single-pass decision as open (no local data); §3 #3 stays on the phase D mock run. (b) Anthropic and OpenRouter need keys not in .env; without them those rows are marked not run (matrix: Gemini, Ollama cloud, AIBOX) | user "accept" 2026-10-09: (a) accepted; (b) accepted as proposed. Keys (user 2026-10-09): OPENROUTER_API_KEY added → OpenRouter row runs; Anthropic skipped → row "not run — skipped by user" |
| G7 | Phase F: the OpenRouter auto-detect fix makes the openai-chat shape check accept a non-empty /models listing without `object: "list"`; DESIGN §4.2.5 step 2 still says `object: "list"`. Proposed: update the spec text to match | **accepted by user 2026-10-09 ("yes")** → F-impl edits DESIGN §4.2.5 step 2 on m4 |
| G8 | Phase F: OpenRouter account has 0 credits → only detect + free models. (a) user adds credits, run a paid model over both protocols; (b) accept OpenRouter as detect-only | **user 2026-10-09: no credits, use the free tier** → F-impl runs both protocols with a non-reasoning :free model within 50 req/day (subset if needed), records results honestly |
| G9 | Phase F: OpenRouter free-tier extension rows (both protocols) failed 0/69 because the 50/day free quota ran out during the runs; rerun possible after UTC midnight. Options: (a) accept F now with those two extension rows recorded as open, rerun later; (b) hold F and rerun tomorrow | **user 2026-10-09: (a) accept now** — OpenRouter free-tier extension rows rerun after the reset (F-impl job) and get added to the matrix later |
| G10 | Final gate: §7 demo on the user's machine, from scratchpad/g2-ext (m4 @ 54a3b65 build). Substitutions: step 1 Gemini (G6); step 4 skipped (no local Ollama); step 5 accepted on the D mock run (G4); step 6 via a hand-made rule pointing at a non-running localhost Ollama (no site-rules UI until M5-E6); step 7 with a fake Anthropic key | **passed — user 2026-10-10: "G10 demo ok"** (54a3b65 build; steps 4–6 skipped as agreed) |
| G1 | Confirm the plan §5 recommended defaults (Ollama 403 → cors; SDK retries off + pipeline backoff → fallback, never on auth; no Chrome Translator fallback in M4; dual-protocol default by model family; roles analyze/translate/review; versioned sync schema + M1 migration; local presets maxConcurrency 1 + smaller chunks) and M4 on an `m4` branch off master | **accepted by user 2026-10-08 ("yes")**: all §5 defaults; M4 on `m4` branch off master (separate worktree so master stays free for M3 dogfood fixes) |

## Sessions

| Session | Pane | Role | Phase | Model | Status |
|---|---|---|---|---|---|
| m4-scout | wC:p4P (tab wC:t3S) | scout | all | Sonnet 5.5 | Q1–Q10 answered; closed at the end |
| m4-A-impl | wC:p4Q (tab wC:t3T) | implementer | A (M4-E1) | Sonnet 5.5 (ordinary single-adapter task) | worktree ../translate-side-m4, branch `m4`; phase A done; closed |
| m4-F-impl | wC:p57 (tab wC:t4A) | implementer | F (eval + matrix) | Sonnet 5.5 | closed after committing this log |
| m4-F2-review | wC:p5C (tab wC:t4F) | reviewer | F idle-guard fix | Sonnet 5.5 | closed |
| m4-F2-test | wC:p5D (tab wC:t4G) | tester | F idle-guard fix | Sonnet 5.5 | closed |
| m4-F-review | wC:p58 (tab wC:t4B) | reviewer | F | Sonnet 5.5 | closed |
| m4-F-test | wC:p59 (tab wC:t4C) | tester | F | Sonnet 5.5 | closed |
| m4-E-impl | wC:p54 (tab wC:t47) | implementer | E (E11, E13) | Sonnet 5.5 | phase E done; closed |
| m4-E-review | wC:p55 (tab wC:t48) | reviewer | E | Sonnet 5.5 | closed |
| m4-E-test | wC:p56 (tab wC:t49) | tester | E | Sonnet 5.5 | closed |
| m4-D-impl | wC:p51 (tab wC:t44) | implementer | D (E9, E10) | Opus 5.5 (pipeline-wide fallback + privacy design) | phase D done; closed |
| m4-D-review | wC:p52 | reviewer | D | Sonnet 5.5 | closed |
| m4-D-test | wC:p53 | tester | D | Sonnet 5.5 | closed |
| m4-C-impl | wC:p4X (tab wC:t30) | implementer | C (E3–E7, E12 + B carry-overs) | Opus 5.5 (six tasks, many files, design choices) | phase C done; closed |
| m4-C-review | wC:p4Y | reviewer | C | Sonnet 5.5 | closed |
| m4-C-test | wC:p4Z | tester | C | Sonnet 5.5 | closed |
| m4-B-impl | wC:p4T (tab wC:t3X) | implementer | B (M4-E2, E8, quirk persistence) | Opus 5.5 (schema design decision, many files) | phase B done; closed |
| m4-B-review | wC:p4V (tab wC:t3Y) | reviewer | B | Sonnet 5.5 | closed |
| m4-B-test | wC:p4W (tab wC:t3Z) | tester | B | Sonnet 5.5 | closed |
| m4-A-test | wC:p4R | tester | A | Sonnet 5.5 | closed |
| m4-A-review | wC:p4S | reviewer | A | Sonnet 5.5 | closed |

## Iterations

### Iteration 1 — 2026-10-08
- ctx: supervisor 8%. No peers yet.
- Created this log. Started the scout (wC:p4P, ctx 4%), goal received, working on Q1.
- Asked the user G1 (§5 defaults, branch). Phase A waits on G1 and the scout's answer.
- Scout Q1 answer (2026-10-08):
  - Git: master @ 955746a, clean except this log (untracked). No local or remote `m4` branch. One worktree.
  - Existing M4 work: E1 minimal `openai-chat` adapter exists (src/llm/openai.ts, M1-D5; `openai` ^7.28.0); its probe lists models (no 1-token chat probe). E2 `ProviderConnection`/`ModelProfile` types are constants only (src/shared/settings.ts:13/:24); routing is a stub (:138-152); no schema version or migration. Secrets in local `secret:<id>`. E3 only base URL constants (src/llm/presets.ts). E4 optional host permissions in the manifest; request/remove code is hard-wired to DEFAULT_ORIGIN. E5 adapter probes only, no UI. E6 none. E7 listModels only, no dropdown. E8 stub. E9 none. E10 M3-E9 running total + pricing.ts + Usage and cost section; no soft limit. E11 none (HeaderControls.tsx:60 placeholder). E12 error-message mapping only (src/llm/errors.ts:58). E13 none.
  - Commands: `pnpm test`, `pnpm run typecheck`, `pnpm lint`, full gate `pnpm run check`; eval `pnpm eval` (+ eval:judge, eval:report).
  - .env key names: OLLAMA_API_KEY, GEMINI_API_KEY, AIBOX_API_KEY. No Anthropic, OpenAI or OpenRouter key (matters for F; user-owned).
- ctx: supervisor ~9%, scout ~5%. Waiting on G1.

### Iteration 2 — 2026-10-08
- G1 accepted by the user. Started phase A implementer m4-A-impl (wC:p4Q). Goal: scratchpad/goal-A-impl.md; state file scratchpad/state-A-impl.md.
- Usage warning seen on the implementer pane: "You've used 94% of your weekly limit · resets 10pm (Asia/Saigon)". Told the user.
- ctx: supervisor ~10%, scout ~5%, A-impl 5%.
- Next: start tester and reviewer once A's first commit lands.
- A-impl report: existing openai.ts already covered baseURL, auth styles, include_usage, max_tokens flip, system folding, JSON mode, flip-retry-once, SDK maxRetries 0, 403+none+localhost → cors/origin. Added AdapterOptions.onQuirkLearned (src/llm/sdk.ts), QuirkFlip.key, tests (src/llm/adapters.test.ts). One commit on m4 ("M4-E1: openai-chat adapter reports a learned quirk ..."). `pnpm run check` exit 0 (1155 tests). Eval via Gemini OpenAI endpoint (gemini-3-5-flash-lite): 23 passages, lost 0/149, 3 repairs ok, code preserved 25/25, 0 failing finals, $0.0334. Persistence of learned quirks deferred to B (hook exposed).
- Started tester m4-A-test (wC:p4R) and reviewer m4-A-review (wC:p4S), review round 1.
- A review round 1 (m4 @ ab49b4a): no blocking findings; every task item covered (persist deferred to B as planned). Non-blocking: (1) max_tokens flip pattern too broad, (2) system-role fold pattern too broad, (3) bad extraHeaders reported as a key error, (4) confirm() conservative. Supervisor ruling: fix 1–3 with tests, accept 4. Forwarded to m4-A-impl.
- A tester round 1 (ab49b4a): all four criteria met. 11 own tests pass (scratchpad/tester-a.test.ts): baseURL, 4 auth styles, include_usage, max_tokens param, system fold, JSON mode, quirk flip/retry once/hook, SDK retries off (500/429/503/network = 1 request), 403 rules. `pnpm run check` OK but ran over the implementer's uncommitted edits. Eval was the fixtures set (docusaurus-code-blocks): 5 calls, no errors, lost 1/141 (model content). Round 2 (after the fix commit): re-run tests + check on the clean commit, and the eval on `--set eval`.
- A fixes committed fe1bb5e (narrowed flip patterns + tests; checkHeaders in preflight + test); check exit 0, 1159 tests. Round 2 sent to tester (incl. `--set eval`) and reviewer (diff ab49b4a..fe1bb5e).
- A review round 2 (fe1bb5e): 1 and 3 closed. 2: regression (OpenAI o1 wording "'messages[0].role' does not support 'system'" no longer flips) + residual ("Invalid system prompt" still flips). Ruling: fix both with tests. Forwarded to A-impl (round 3 on the system-role pattern). Tester round 2 still running on fe1bb5e.
- A fix 8c814fb (o1 system/developer wording flips; bare "invalid" removed; tests); check exit 0, 1160 tests. Review round 3 sent; tester retargeted to 8c814fb.
- A review round 3 (8c814fb): item 2 closed; new non-blocking: `invalid\s+role` matches without naming system/developer. Ruling: fix (require system|developer nearby) + test. This pattern has now had 3 review rounds; if round 4 raises more on it, the supervisor accepts and notes it rather than looping.
- A fix f27f00f (invalid role needs system/developer nearby; tests); check exit 0, 1161 tests. Review round 4 sent; tester retargeted to f27f00f.
- A review round 4 (f27f00f): closed. Reviewer final verdict: no open blocking findings, all task items covered (persist deferred to B; item 4 accepted). Waiting on tester verdict at f27f00f.
- A tester round 2: all criteria met at f27f00f. `pnpm run check` green on clean f27f00f (1161 tests). Eval on `--set eval` (run at fe1bb5e; later commits don't touch the Gemini path): 23 passages, lost 0/149, 1 repair ok, 0 failing finals, code 25/25, $0.0318, exit 0. 16 own tests pass. Minor: unquoted "Invalid role: system" no longer flips — supervisor ruling: accept (real OpenAI wording quotes the role). Extension-side translation through openai-chat not run: the extension can only target a non-default connection once B/C land; §3 #1's extension part is checked in phase F.
- Asked scout Q2: confirm A commits on m4 and a clean worktree.
- Scout Q2: m4 clean at f27f00f; commits ab49b4a, fe1bb5e, 8c814fb, f27f00f on m4; diff 5 files (src/llm). Worktrees: master, m4.
- **Phase A accepted** (tester all criteria met, reviewer no open blocking, no user gate in phase A, scout confirmed commit f27f00f). Review rounds: 4. Closed A implementer, tester, reviewer.
- Carry-overs from A into B: persist learned quirks via `onQuirkLearned` on the stored connection.

### Iteration 3 — 2026-10-08 (phase B start)
- ctx: supervisor ~13%, scout 6%.
- Phase B implementer on **Opus 5.5**: the phase carries the settings-schema design decision (versioned sync schema + M1 migration) and cuts across settings, options, side panel and adapters.
- B first commit e74478c: src/shared/providers.ts (+25 tests); async route in sidepanel route.ts/jobs.ts/translator.ts/App/HeaderControls/PrivacyNotice/Options.tsx; background migrates on install; panel clears tab override on tab close. check green, 1186 tests. Started reviewer (wC:p4V) and tester (wC:p4W) right away.
- B tester's first goal arrived truncated (second long paste in a row, the known M1 lesson); re-sent as a short /goal pointing at scratchpad/goal-B-test.md; now working.
- B review round 1 (e6cd6af; e6cd6af adds scripts/eval/migration.ts only): no blocking; E2, E8, quirk persistence covered. Non-blocking: (1) analyze not resolved through routing at runtime (jobs.ts defaultEngine), (2) saves drop unknown newer-schema fields, (3) no total/item-count sync quota check, (4) fresh-device migration can overwrite synced routing with default, (5) routing+siteRules saved non-atomically, (6) Options key-save window before route loads, (7) non-numeric schemaVersion. Ruling: fix 1–5 with tests; accept 6 (C replaces) and 7. Forwarded to B-impl.
- B tester round 1 (e6cd6af, clean worktree): all criteria met at storage/resolve level. Migration from M1 (Gemini-only, APIBOX, both, none): key unchanged, prefs/glossary identical; `pnpm run migration` live PASS (7/7 segments, Gemini 3.1 s, APIBOX 4.9 s). Idempotent (3 sequential + 3 concurrent), newer schema not downgraded, no key text in sync, items < 8192 B. Resolution order, wildcard match, localOnly holds analyze, stale tab override ignored. fallback with 'basic' round-trips. Not run: real Chrome (→ G2); panel.ts tab-close clearing; UI; "Document brief" label; adapter hook → saveLearnedQuirk wiring (unit level only). Round 2 will cover those.

### Iteration 4 — 2026-10-08
- ctx: supervisor 15%, scout 7% (done), B-impl 25% (working), B-review 9% (done), B-test 9% (idle).
- B-impl at 25%: sent checkpoint request (+ idle notice subscription); will compact then resume from state-B-impl.md.
- B-impl checkpoint: ea3ccf0 (fix 1, analyze routed at runtime) and abb8c68 (fixes 2–5; `migratedRoute` item, migration never writes `routing`; built-in profiles for a built-in connection without stored profile). check green, 1193 tests. Left: live migration run, full report.
- **Compacted B-impl** (25% → 0%), resumed via SendMessage. Started B review round 2 and B tester round 2 on abb8c68.
- B-impl FULL REPORT (abb8c68): commits e74478c, e6cd6af, ea3ccf0, abb8c68. check green 1193 tests; providers.test 30 tests; live `pnpm run migration` PASS m1 (gemini, migratedRoute) and m3 (apibox, no routing item), 7/7 each, key local only.
  - Implementer decisions (supervisor ruling: all accepted, none deviates from the spec): (1) sync layout schemaVersion + `conn:<id>` + `profile:<id>` (prefix scan) + `routing` + `siteRules` (separate item; spec puts siteOverrides inside Routing — storage detail only); built-in ids kept so `secret:<id>` stays valid. (2) `migratedRoute` only for a non-default M1 route; read order routing ?? migratedRoute ?? default; implicit default connection; built-in connection gets built-in profiles. (3) tab overrides in storage.session `tabRoute:<tabId>`. (4) site patterns host-only, `*.x.com` matches apex, first match wins. (5) site rule → missing profile = error, no fall-through; stale tab override ignored. (6) localOnly forces every role to the site profile. (7) analyze route that can't run stops the job (no fallback to translate). (8) failed migration write non-fatal, retried on next read; serialized. (9) learned quirk saved on profile if it sets the flag, else connection.
  - Carry-overs: deleted built-in profiles come back at read time (tombstone → phase C); Options key section single-connection + DEFAULT_ORIGIN fallback (→ C); tab override writers (→ E); pre-sync migration may add built-in records (never overwrites; accepted).
- B tester round 2 (abb8c68): fixes 1–5 met; quirk wiring through route.ts met; tab-close clearing met; check + live migration green; 16 own tests. "Document brief" label: no UI names analyze yet → carry to C (connection/profile UI). Findings: (A) built-in connections added at read time only when none stored → a Gemini-only device can't route to a built-in APIBOX profile; (B) sync `migratedRoute` leaks to a device without that key. Ruling: fix A (add every missing built-in at read time) and B (`migratedRoute` → storage.local). Forwarded to B-impl. Real Chrome still → G2.
- B review round 2 (abb8c68): items 1–5 closed; no blocking. New: (a) analyze client resolved up front, so a job stops on an unrunnable analyze route even with a cached brief → fix (lazy); (b)/(f) synced migratedRoute → closed by tester finding B fix; (c) built-ins reappear at read time → C carry-over; (d) site-rule unknown fields dropped → accept (M5 owns site rules); (e) siteRules always written → accept. Forwarded (a) to B-impl, folded into round 3 with tester A/B.

### Iteration 5 — 2026-10-08
- ctx: supervisor 16%, scout 7%, B-impl 12% (working on round-3 fixes A, B, a), B-review 11% (done), B-test 13%. No checkpoints needed.
- B tester round 3 (fc521e2, self-started on the new tip): A and B fixed; check green 1195 tests; live migration PASS (no routing/migratedRoute in sync). All B criteria met except "Document brief" label (→ C, ruled earlier). Real Chrome → G2. Lazy-analyze fix (review a) not yet reported by B-impl.
- B-impl round 3 report: fc521e2 (tester A + B) and d4d065f (review a: lazy analyze resolver, called only after cache lookup when no brief kept/cached). check green 1197 tests; live migration PASS both. Review round 3 sent (abb8c68..d4d065f). Tester already verified fc521e2; will ask it to confirm d4d065f with check if the review is clean.
- B review round 3 (d4d065f): a, b, f, tester A, tester B closed. Reviewer verdict ACCEPT, no blocking. Non-blocking: (1) every built-in reappears at read time → C must show built-ins as "built-in, no key"/hide on delete (C carry-over); (2) local migratedRoute derived once, a key added later keeps default until user picks (accepted; C's form sets routing); (3) extra storage round-trip on cold start (accepted).
- B tester round 4 (d4d065f): confirmed, no findings. check 1197 green; live migration PASS; new test with real route.ts + Jobs: no brief + broken analyze route stops naming Gemini with no translate requests; cached brief / keepBrief + broken analyze route finishes done with 0 analyze requests. Criteria met except "Document brief" UI label (→ C, no UI names analyze yet) and real Chrome (→ G2).
- Asked scout Q3: confirm B commits on m4 + unpacked build path for G2.
- Scout Q3: m4 clean at d4d065f; B commits e74478c, e6cd6af, ea3ccf0, abb8c68, fc521e2, d4d065f; 22 files, +1657/−123. Build at translate-side-m4/.output/chrome-mv3 (no source newer than it).
- Phase B: tester all met, reviewer ACCEPT, scout confirmed commit d4d065f. Remaining for acceptance: G2 (user Chrome check). "Document brief" UI label moved to C (no UI names analyze yet).
- G2 note: an unpacked extension's ID comes from its path, so loading the m4 build from a new path starts with empty storage and tests no migration. Proposed recipe: a scratch dir holds a master build first (user sets key there), then the m4 build replaces it at the same path and the user reloads.
- G2: user chose option 1 (in-place upgrade in a scratch folder). B-impl asked to build master 955746a into scratchpad/g2-ext (via a scratchpad worktree g2-master), then on my word replace it with the m4 d4d065f build at the same path.
- G2 step 1 done: g2-ext holds the master 955746a build. Waiting for the user to load it and set a key; then step 2 (m4 build at the same path).
- G2 step 2 done: user loaded master build + set key; g2-ext replaced with m4 d4d065f build (folder hash 7fc175905ee01a8e vs master 6865a876b90c12a1; migration code present); g2-master worktree removed. Waiting for the user to reload and confirm.

### Iteration 6 — 2026-10-08
- ctx: supervisor 18%, scout 8%, B-impl 14%, B-review 13%, B-test 16%; all idle. Everything waits on G2 (user reload + confirm). No-op otherwise.
- G2 FAILED: user reports the panel does nothing after reloading to the m4 build. User asked us to check their Chrome; delegated diagnosis + fix to B-impl (claude-in-chrome permitted by the user).
- G2 diagnosis (B-impl): cause not found. claude-in-chrome refuses chrome-extension:// pages (browser wall, stopped after 2 tries). Local Playwright repro of the same upgrade (master → m4, same path, APIBOX key): storage migrated correctly (conn:apibox + 3 profiles + schemaVersion 1; local secret:apibox + migratedRoute {}), no errors, panel behaves the same as master. Known gotcha: an extension reload revokes activeTab grants; an open tab needs a fresh toolbar click/Alt+T. Asked the user for: which symptom, errors, console, storage key names.
- User: with a key entered under the m4 build, the panel asked for access and then translated normally. User accepted G2 on that plus the Playwright repro.
- **Phase B accepted** (tester all met; reviewer ACCEPT; G2 signed off; scout confirmed d4d065f). Review rounds: 3 (+ tester rounds 4). Closed B implementer, reviewer, tester. The user's Chrome still has the g2-ext unpacked extension loaded (scratchpad).
- Carry-overs into C: (1) "Document brief" UI label wherever analyze is named; (2) built-ins reappear at read time → list/delete UI must show built-ins as "built-in, no key" or hide them (tombstones if needed); (3) Options key section is single-connection + DEFAULT_ORIGIN fallback → per-connection keys and permissions; (4) a key added after migration keeps the default route until the user picks one → the connection form sets routing (first one becomes translate route).

### Iteration 7 — 2026-10-08 (phase C start)
- Phase C implementer on **Opus 5.5**: six tasks (E3–E7, E12) across options UI, permissions, adapters' probes and presets, with design choices (auto-detect, error mapping).
- C first commit 392474f (E3–E7, E12, B carry-overs): presets.ts, connect.ts, options/form.ts, Providers.tsx; check green 1255 tests. Started reviewer (wC:p4Y) and tester (wC:p4Z) with short /goal messages pointing at their goal files (avoids truncation).
- C review round 1 (392474f): no blocking; all tasks + carry-overs covered; local profile concurrency 1, 600-token chunks. Non-blocking (all ruled fix): (1) key reused after origin edit → require re-entry; (2) Fix… on custom localhost does nothing → generic guide; (3) permission from Test not revoked on cancel; (4) honesty hint: extra headers/query params sync; (5) auto re-test writes sync every 3 s, stale state; (6) §4.2.5 shape checks missing in auto-detect; (7) 404 text for auto preset, no Grant access in model discover, built-in message wording, revokeUnusedOrigin vs M3 allowlist. Forwarded to C-impl.

### Iteration 8 — 2026-10-08
- ctx: supervisor 21%, scout 8%, C-impl 31% (working; checkpoint requested), C-review 11% (done), C-test 13% (working).
- C-impl checkpoint: f0dcca2 (UI polish), 1d8dbab (#6, #7a, generic guide text), f2283ca (#1–5, #7b–d); check green 1266 tests. Notes: revokeUnusedOrigin keeps origins in sync key `siteAllowlist` (M5-E3 must use that key — M5 handoff item); shape checks only on Auto-detect. Screenshots (pre-fix) in C-impl's scratchpad shots/; headless can't answer the permission prompt, so it stubs chrome.permissions.request (asked only http://127.0.0.1/*).
- **Compacted C-impl** (31% → 0%), resumed. Review round 2 sent (392474f..f2283ca).
- C tester round 1 (392474f, report scratchpad/report-C-test.md, 70 screenshots in scratchpad/ct/shots): all criteria met with mocks; real Gemini key: 62 models, 1-token ok, saved as translate route; real Ollama cloud key: bad key/good/bad model messages right. Limits: chrome.permissions faked (→ G3); no real Ollama/LM Studio. Open items 2–8 (detect message vs switch, port hint, keyless removal wording, Gemini `models/` prefix, Ollama cloud auto-picks paid model, radio alignment, Usage refresh) → ruled fix, forwarded to C-impl.
- C review round 2 (f2283ca): all round-1 items closed; full suite 1266 green. New non-blocking: N1 `siteAllowlist` key unused until M5-E3 (**M5 handoff: M5-E3 must store its allowlist under sync key `siteAllowlist`, or change `allowlistedHost` with it**); N2 Auto-detect Anthropic probe uses form auth not Anthropic-style headers (§4.2.5 step 1) → fix; N3 both-fail message wording → fix. Forwarded N2, N3 to C-impl.

### Iteration 9 — 2026-10-08
- ctx: supervisor 22%, scout 8%, C-impl 11% (working on tests, tester 2–8, review N2/N3, screenshots), C-review 14%, C-test 16% (idle). No action needed.

### Iteration 10 — 2026-10-09
- ctx: supervisor 23%, scout 8%, C-impl 12%, C-review 14%, C-test 16%. Mac slept: C-impl's turn was cut off ("computer went to sleep", done 00:18). Nudged it to re-read its state file and continue. herdr commands were slow/hung once after wake.
- Follow-up: C-impl picked up after the nudge and is working (ctx 13%; mid-fix test run 17 failing / 1261 passing — in progress).

### Iteration 11 — 2026-10-09
- ctx: supervisor 24%, scout 8%, C-impl 13%, C-review 14%, C-test 16%. Mac slept again: C-impl cut off at 01:43 while rerunning UI tests (most failures were sleep timeouts, two looked real). Nudged again. Suggested to the user: keep the Mac awake (`caffeinate`) while the loop runs.

### Iteration 12 — 2026-10-09
- ctx: supervisor 25%; C-impl working (turn running 50 min, includes sleep). herdr reads are slow since the sleeps; run them in the background. No action.
- E tester FINAL (b487f69; first runs on 8a73d10, re-run on b487f69; check green 1377): **all four criteria MET**. §2 switcher (tab-only 25 blocks/13 req, routing unchanged, other tab unaffected, cache 0 req, Make default, tab close, site rule, Grant access http://localhost/* only, overlap fixed S4-overlap-scrolled.png, rerun waits for privacy: 0 req before ack). §2 onboarding (auto-open on install, 3 steps, fieldset, focus, skip/reopen, panel offer, live Gemini sample → Vietnamese, local mock path "Nothing leaves this computer", 0 requests before ack, permission origin-only). §4 Chrome built-in disabled "Coming soon". §7 demo 1 and 8 met with a substitution: **no Anthropic key → Gemini used for step 1** (→ user gate G6). Notes accepted: Save/Test connection sends a 1-token probe before the privacy ack (no page text; phase C behaviour); permission prompt faked headless (real prompt covered by G3). Screenshots scratchpad/ob/shots (O1-*, O2-*), et/shots (E11-*, S4-*). Cleaned up; no mocks left.
- E review round 3 (8a73d10..b487f69): **no blocking; verdict confirmed: phase E passes review**; round-2 fixes 1–4 verified; screenshots E13-2, E13-3d, E11-3, E11-5, E11-6 checked. Non-blocking rulings: (a) select clips the model name → fix (title / width); (b) site-rule override only in title attr → fix, visible text (§4.3.5 "say so in the UI"); (c) Translate-the-sample active while notice open → accepted (gated); (d) step-3 heading focus skipped before settings load → fix. Forwarded a, b, d to E-impl.
- E reviewer addendum (all screenshots): verdict unchanged (passes). Two cosmetic notes → fix: step 3 shows both Cancel and Back (hide form Cancel in onboarding); "(default)" marker clipped in select (same as a). Forwarded.
- E reviewer FINAL (4ed5a59; cosmetic fixes a, b, d + hideCancel; 296 entrypoint tests): no findings, **phase E passes review**; all E11/E13 items covered; all screenshots viewed. Sent tester a final confirmation run on 4ed5a59 and scout Q8 (commits, clean tree, ports).
- E-impl round-3 report (4ed5a59): select 20em + title with full label; "(overrides tab choice)" visible + test; step-3 heading focus after settings load (no test for the delayed-load case — accepted, minor); hideCancel prop on ConnectionForm in onboarding + test; check green 1378 tests. E-impl idle.
- Scout Q8: m4 clean at 4ed5a59; E commits 22594ad, 1a03e65, 8a73d10, 1c7dcae, b487f69, 4ed5a59 (18 files, +1458/−20); nothing on 11434/1234/7201; E-impl's page server still on 127.0.0.1:7300 (node page.mjs) → asked E-impl to stop it.
- E-impl stopped the :7300 page server (lsof: nothing on 7300/11434/1234). Phase E waits only on the tester's 4ed5a59 confirmation.
- E tester final confirmation (4ed5a59; check green 1378): all four items met (full label + title, visible "(overrides tab choice)", step 3 Back/no Cancel + heading focus, switch + Make default ol→cl). Cosmetic accepted: a 36-char model name still clips in the closed select (title carries it). Screenshots et/shots F-1…F-4, ob/shots F-5.
- **Phase E accepted** (tester all criteria met; reviewer no open findings, 3 rounds + final; G6 signed off; scout confirmed 4ed5a59). Closed E implementer, reviewer, tester.
- Asked the user G6 (Anthropic substitution, demo step 1) and G5 (provider matrix: Ollama cloud instead of local Ollama/LM Studio; keys for Anthropic/OpenRouter).

### Iteration 13 — 2026-10-09
- ctx: supervisor 26%, C-impl 14% (working; long turn mostly spent asleep). No action.

### Iteration 14 — 2026-10-09
- ctx: supervisor 26%, C-impl 14%. Third sleep interruption (C-impl done 06:45 mid-turn). Nudged again; asked for small commits + state updates after each step.

### Iteration 15 — 2026-10-09
- ctx: supervisor 27%, C-impl 14%. Fourth sleep interruption (07:50). Same blocker for 4 iterations (the Mac sleeping overnight) → escalated to the user: keep the Mac awake (`caffeinate -dims`). Nudged C-impl again; next wake-up in 60 min.
- C-impl FULL REPORT (9c5cfd8; 21 files +3544/−260): commits 392474f, f0dcca2, 1d8dbab, f2283ca, b8ac375 (unit tests), cd12a05 (tester 2,3,4,6,7,8 + N2 auth per protocol `authByProtocol` + N3), 9c5cfd8 (tester 5 Gemini prefix by host + UI tests). check exit 0, 1283 tests. Screenshots 01–17 in C-impl scratchpad shots/ (4662ff3b…). Decisions D1–D20 accepted (incl. APIBOX preset, no Chrome built-in preset yet, local concurrency 1 / 600 chunks, Ollama cloud 4, keyless unrouted built-ins hidden, translate profile can't be removed, no fallback UI until D, authByProtocol, Gemini prefix strip by host). Asked C-impl to stop its mock on 11434/8787.
- Review round 3 and tester round 2 sent on 9c5cfd8.
- C review round 3 (9c5cfd8): **reviewer verdict ACCEPT**, no blocking; N2/N3 closed, authByProtocol safe. Non-blocking, ruled fix: (1) stale authByProtocol kept after an auth/origin edit; (2) Gemini prefix strip is a host check in code → preset/connection flag; (3) useTranslateRoute re-reads on every storage change → filter. Accepted: Save not blocked when no model chosen on Auto-detect (UI says pick and test again). Forwarded 1–3 to C-impl.
- C fix 60bd883 (review 3 notes 1–3; `modelIdPrefix` quirk); check 1286 tests; mock stopped. Review round 4 sent; tester retargeted to 60bd883.
- C review round 4 (60bd883): 1–3 closed; **verdict ACCEPT** stands. Caveat accepted: a Gemini connection already stored without the quirk (e.g. migrated in B) shows `models/` ids until edited/re-added — cosmetic, ids work. migratedRoute needn't trigger the Options reload. Waiting on tester round 2 at 60bd883.
- C tester round 2 (60bd883 for check/Gemini/auth-per-protocol/stale-auth/grant/allowlist/usage; 9c5cfd8 for the rest): all criteria MET; every change verified. Auth-per-protocol gateway translated 4/4 on each protocol through real translateClient + Jobs; negative control fails as expected. Real Gemini key: bare ids, permission only generativelanguage.googleapis.com/*, translated 4/4. Limits: permission prompt faked (→ G3), Ollama/LM Studio mocks. Accepted observations: single-protocol custom "Connected · no model list" (S4); "no price set" for Gemini/custom local (pricing is phase D).
- Asked scout Q4 (C commits) and C-impl to rebuild 60bd883 into g2-ext for G3.
- g2-ext rebuilt from 60bd883 (hash 0c759078…). G3 steps sent to the user.
- Scout Q4: m4 clean at 60bd883; C commits 392474f, f0dcca2, 1d8dbab, f2283ca, b8ac375, cd12a05, 9c5cfd8, 60bd883 (21 files, +3603/−262); no listeners on 11434/8787. Phase C now waits only on G3.

### Iteration 16 — 2026-10-09
- ctx: supervisor 29%, scout 8%, C-impl 19%, C-review 16%, C-test 21%; all idle. Everything waits on G3 (user's real-Chrome permission check). No-op.
- G3 passed (user, real Chrome). **Phase C accepted** (tester all met; reviewer ACCEPT; G3 signed off; scout confirmed 60bd883). Review rounds 4, tester rounds 2. Closed C implementer, reviewer, tester.
- M5 handoff (record in the M4 closing summary): M5-E3 must store its site allowlist under sync key `siteAllowlist` (or change `allowlistedHost`).
- Carry-overs into D: pricing for non-Anthropic profiles ("no price set" today; usage per profile and pricing table are E10).

### Iteration 17 — 2026-10-09 (phase D start)
- Phase D implementer on **Opus 5.5**: fallback chain + privacy rule cut across the job pipeline, routing, adapters' error kinds and the panel; carries design choices (retry/backoff ownership, badges).
- D first commit 278cc2c: engine fallback (src/engine/fallback.ts withFallback; sticky per job; stops at primary on auth/quota/cors/model_not_found/bad_request/context_length), servedBy so producedBy/usage name the answering model, context_length halving. 22 tests; suite 1308 green. Started reviewer (wC:p52) and tester (wC:p53).
- D review round 1 (278cc2c engine): no blocking; stops at primary for auth/quota/cors/model_not_found/bad_request/context_length/unknown verified; Retry-After handled; engine free of chrome.*. Non-blocking, rulings: (1) links matched by model name → fix, by profile; (2) unreachable "all dead" branch → remove; (3) failed link's usage billed to the answering model → fix; (4) no job-level shrink memory → fix, single over-long segment may still fail; (5) sticky switch → accepted (plan); (6) nit → fix. Forwarded to D-impl.
- D tester engine run (278cc2c, mocks on 7201–7204): all pass — Ollama stopped mid-page 12/12 on fallback (producedBy/usage follow the answering model), 401/402 zero requests elsewhere, Retry-After 2 s honored on same link, 503/drops 3 attempts then fallback, sticky, 3-link chain, all-down → last link retried, context_length shrink. Observation → ruled fix: after auth/quota the engine keeps sending remaining chunks to the primary; must stop for the job. Forwarded to D-impl. Tester idle until the shell side lands.
- D 5d18df6: review-1 fixes (#1 profile-id links + usage `client`, #2, #3, #4 shrink memory + lean retry, #6), tester ruling (withLatch: no more requests to a link after auth/quota/cors/model_not_found), withRetry abandon, and E9 panel side (isLocalConnection loopback-only, fallbackRoutesIn skips basic/unknown/repeats, route.ts skips links lacking key/permission/protocol, badges, per-model cache key, usage by spending profile, auth → connection error + Fix key, privacy notice names fallback providers). check green 1324. Review round 2 + tester E9-shell run started. E10 next.
- D review round 2 (5d18df6): no blocking; round-1 fixes verified; shell checks OK (local-only incl. analyze, basic never a client, shared dead set per profile, no permission/privacy bypass, auth → error, latch, cache key by producing model). Rulings: (1) privacy ack global/one-time even when a fallback adds a host → accepted, matches DESIGN §8 "once on first run" (decision); (2) add analyze-under-local-only test; (3) watchFor should use deps.retry → fix; (4) cache lookup only for primary model → accepted (§7); (5) analyze link vs same-profile fallback separate clients → fix if small. Forwarded.

### Iteration 18 — 2026-10-09
- ctx: supervisor 32%, scout 8%, D-impl 31% (checkpoint requested), D-review 11%, D-test 16% (testing E9 shell).
- D-impl checkpoint (6916a19; check 1327 tests): 9d57c46 "If it fails" chain UI in Providers ▸ Routing (basic kept); 6916a19 E10 part 1 (spend per profile/day, estimateSpend, monthly soft limit in local `spendLimit`, checked before a run's first request after cache, JobBar "Continue anyway"/Settings, running job never cut) + review 2 (#2 test, #3 deps.retry, #5 one client per profile). Left: E10 settings UI + tests, mock-Ollama screenshot run, final report. Compaction sent.
- D tester E9 shell run (5d18df6; Chrome for Testing, mocks 7201–7204, cloud mocks on LAN IP, chrome.permissions faked): §3 #3 met (22 badged blocks from gpt-mock after Ollama stopped; bar note), §3 #4 met on isolation (0 requests elsewhere; Fix key; conn error), 402 stop no fallback, §3 #6 met (0 cloud requests; analyze held local; positive control 25/25 via cloud), §5 retry ownership met, basic/unknown ids tolerated, privacy notice names fallbacks. Findings → ruled fix: F1 a 401 re-runs the job once because the panel's own conn status write triggers retryStopped (4 requests not 2); O1 local-only stop message should name the provider and the rule; O2 privacy notice text says local options "coming later". Sent with the compaction resume.
- D review round 3 (6916a19: chain UI 9d57c46 + E10 part 1): no blocking; review-2 fixes verified. Ruled fix: (1) ~900 lines of quote/wrap reformatting churn in App.test.tsx and jobs.errors.test.tsx → revert; (2) settings text: soft limit counts priced spend only; reset re-arms it; (3) continuePastLimit lacks a catch. Reviewer briefly checked out the implementer's worktree (restored, clean) → told to use its own scratch worktree.
- D-impl kept working past the checkpoint (/goal) to 33%; told it to end its turn; then **compacted** (33% → <10%) and resumed with the to-do list (F1, O1, O2, review-3 1–3, E10 settings UI, mock-Ollama run, report).
- D review round 4 (1b24c7b, tester F1 fix: isErrorStatusWrite ignores only the panel's own error-status write): no findings (reviewer self-started on the new commit, in its own scratch worktree). Outstanding: review-3 fixes, E10 settings UI, mock-Ollama run.
- D tester: F1 fixed at 1b24c7b (401 → exactly 2 requests to the primary, 0 elsewhere, Fix key, conn error); "If it fails" UI passes (basic shown as "Chrome built-in (basic)", unknown "(missing model)", persistence ok). Observation → ruled fix: dropdown offers the primary as a fallback. E10 UI pending.
- D review round 5 (582299f): no blocking; review-3 item 1 (format churn) fixed; tester O1/O2 OK. Nit accepted (local-only text wording). Review-3 items 2–3 still pending (expected with E10 part 2).
- D review round 6 (9eeff1f): no blocking; dropdown excludes primary/duplicates (27431e0); continuePastLimit failure handled; Reset re-arms the limit; E10 tests good. Open: unpriced-spend note; E10 Settings UI uncommitted (needed for §2); mock-Ollama run.
- D tester (9eeff1f E10 storage/limit): per-profile pricing correct (Ollama $3.60 + fallback $39.60), soft-limit stop before sending with 0 requests, Continue anyway holds for the month. Observation → ruled fix: Continue anyway after a stopped "Retranslate page" resumes from cache instead of retranslating. §2 Settings criterion not met until the E10 Settings UI is committed.
- D review round 7 (f221952, E10 Settings UI): no findings; reviewer's phase-D verdict: all criteria covered, no blocking; round-3 items closed; no scope creep; engine free of chrome.*. §3 #3 real-extension evidence = tester's S1 run (Chrome for Testing, mock Ollama stopped mid-page, 22 badged blocks). Accepted non-blocking: R2-1 (privacy ack once), R2-4 (re-translate after primary returns). Tester final run sent on f221952.
- D-impl progress: 1b24c7b, 582299f, 27431e0, 9eeff1f, f221952, 8a2c3ee (Continue anyway carries out the stopped action); check green 1350 tests. Left: mock-Ollama screenshot run, final report. Review round 8 sent on 8a2c3ee; tester retargeted.
- D review round 8 (8a2c3ee): no blocking; Continue anyway redo path verified; two nits accepted (a block redo hitting the limit mid-job shows its bar after the job stops; the limit bar outranks a later stop error). Reviewer ACCEPT stands. Waiting on tester final + implementer's report.
- D-impl FINAL REPORT (8a2c3ee; 39 files +2384/−118; check 1350): commits 278cc2c, 5d18df6, 9d57c46, 6916a19, 1b24c7b, 582299f, 27431e0, 9eeff1f, f221952, 8a2c3ee. Screenshot run (real Jobs/adapter/JobBar in Chromium, mock Ollama :11500 stopped after 3 requests, cloud :11600): blocks 5–8 badged claude-haiku-4-5; screenshots in D-impl scratchpad fbdemo/out/ (4b55b1b2…). Decisions accepted: backoff 3 retries 1 s doubling + jitter, 30 s cap, Retry-After > 60 s hands over; local = loopback/chrome-builtin; cache lookup primary-model key only; privacy ack once; limit in storage.local, checked after cache before first request; new limit amount clears "continued". Open: no real-Ollama run (→ user, with F/demo).
- D tester FINAL (8a2c3ee): all done criteria met (S1 mid-page fallback 22 badges; S9 usage per profile + estimate + limit set/change/remove; Fix key with 0 requests elsewhere, primary exactly 2; local-only 0 cloud requests incl. analyze; retry ownership; basic tolerated; Continue anyway retranslates). Observation accepted: cached tokens shown in the total line, not per profile. Not exercised: real permission prompt (covered by G3), real Ollama (→ G4), real cloud providers (→ F).
- Asked scout Q5 (D commits). Asked user G4.
- Scout Q5: m4 clean at 8a2c3ee; 10 D commits (39 files, +2384/−118); no leftover mock listeners (only macOS Control Center on :7000). Phase D waits only on G4.
- G4: user chose to run the real Ollama check now; delegated to D tester (real Ollama on 11434 with OLLAMA_ORIGINS, real Gemini fallback, stop Ollama mid-page, restore Ollama state after).
- G4 blocked: Ollama isn't installed (dangling symlink, no models, nothing on 11434). Gemini key present. Asked the user to choose a/b/c.
- **Phase D accepted** (tester all met; reviewer ACCEPT, 8 rounds; G4 closed by the user; scout confirmed 8a2c3ee). Closed D implementer, reviewer, tester.
- **User intent (affects F):** the user will use Ollama cloud, not local Ollama. Plan §3 #1 names "Ollama (Qwen 7–8B)" (local) and "LM Studio" among the five providers → a deviation to propose and settle with the user before phase F starts (G5).

### Iteration 19 — 2026-10-09 (phase E start)
- Phase E implementer on Sonnet 5.5 (two UI features on existing route/settings plumbing).
- E first commit 22594ad (M4-E11 quick switcher: header select, "This tab only", "Make default", site rule shown as winning; sidepanel/switcher.ts, ModelSwitcher.tsx, 8 tests; check green). Decision: a switch writes the tab override and reruns the page non-fresh (cache keyed by model). Started reviewer m4-E-review (wC:p55) and tester m4-E-test (wC:p56), both Sonnet, with goal files goal-E-review.md / goal-E-test.md (shared common-E.md).
- S8: the implementer found no S8 decision in docs/decisions. Ruling: the plan's §4 rule applies (no S8 record → Chrome built-in "coming soon"); not a deviation. Asked scout Q6 to confirm that no S8 record exists anywhere.
- ctx: supervisor 9% (after compaction), scout 9%, E-impl 15%, E-review 4%, E-test 5%; all working.
- E review round 1 (22594ad, E11 only): no blocking. Rulings: (1) rerun in translator.ts skips privacy.whenAcknowledged → fix; (2) global privacy ack → accepted (DESIGN §8, D ruling R2-1); (3) a11y aria-describedby + live-region announcement → fix; (4) switch to an ungranted origin must show grant access → implementer test + tester Chrome check. Forwarded to E-impl and E-test.
- Scout Q6: no S8 decision or spike result exists (docs/decisions has S1–S5 only; spikes/ s1–s5; S8 appears only as a definition in ROADMAP.md:63 and as gates in ROADMAP.md:249/:403, M4 plan :51, M5 plan :61). Chrome LanguageDetector check is still open human work from M2 (progress-m2.md:87). → Chrome built-in is "coming soon" in onboarding, per plan §4. No change sent to E-impl (already told).
- E tester round 1 (22594ad, E11): all switcher criteria MET — check green; Chrome for Testing + mocks: tab-only switch (25 blocks via CloudA, routing unchanged, tab B untouched), cache reuse 0 requests, Make default writes routing.translate + clears tabRoute, tab close clears tabRoute, site rule (plain/local-only) wins and is shown, 0 cloud requests; ungranted origin → "No access to localhost" + Grant access requesting only http://localhost/* (retry after grant not runnable headless). Screenshots scratchpad/et/shots/E11-*. Observation → ruled fix: sticky job bar (top 41px) overlaps the ~139px header/switcher row. Forwarded to E-impl. Tester idle until E13.

### Iteration 20 — 2026-10-09
- ctx: supervisor 11%, scout 10% (done), E-impl 23% (working on E13), E-review 8%, E-test 11% (idle, waiting for E13). Sent E-impl a checkpoint request (commit, state file, report, end turn) with an idle notice; compact it once idle.
- E-impl checkpoint (8a73d10; check green, 69 files, 1373 tests): E11 + review fixes 1/3/4 (13 switcher tests); sticky job bar offset from header height (ResizeObserver; 420 px panel headerBottom = jobTop = 110); E13 onboarding (onboarding/ entrypoint, src/shared/onboarding.ts, 10 tests; reuses Providers ConnectionForm via initialPreset; opens on install, skippable, reopens from Settings "Set up guide"; panel offers it while unfinished and no route can run). Live Playwright with Gemini: sample translated to Vietnamese and set the route; privacy ack only after the notice. Left: overlap screenshot check, final report; mock page server on 127.0.0.1:7300 to stop at the end. Started review round 2 (22594ad..8a73d10) and tester E13 run on 8a73d10. Compaction of E-impl pending its idle state (pane still shows working).
- E review round 2 (22594ad..8a73d10): **no blocking; reviewer verdict: phase E passes review**. Verified privacy gating (rerun + onboarding sample), origin-only permission via reused ConnectionForm, no duplication, Chrome built-in disabled "Coming soon", trigger/skip/reopen, honest key note, round-1 fixes, sticky offset, no scope creep; 23 tests pass. Non-blocking, all ruled fix: (1) nested interactive content in step-2 radio labels → fieldset/legend or selects outside label; (2) focus management on step change / privacy notice; (3) test that onboarding permission request covers only the provider origin; (4) live region announces default on first render. To forward to E-impl after its compaction. Reviewer still to see the screenshots.
- E-impl FINAL REPORT (1c7dcae; check green 69 files, 1374 tests): commits 22594ad, 1a03e65, 8a73d10, 1c7dcae (Set up guide test). Switcher 13 tests, onboarding 10, options +1. Playwright + live Gemini: guide auto-opened on install, 62 models, sample → Vietnamese via gemini-flash-lite-latest, privacy notice before send, routing set; switcher tabRoute/Make default verified; sticky bar no overlap (110/110). Screenshots in E-impl scratchpad 93fe56b3…/pw/shots/ (E13-1…E13-4, E11-1…E11-6). Page server :7300 stopped; nothing on 11434/1234. Decisions (accepted): opens once in a tab on install, skippable, reopen via Settings "Set up guide"; panel offers it while unfinished and no route runs; Chrome built-in "Coming soon"; switch = tab override + non-fresh rerun; site rule replaces the select; select only with ≥2 options; Make default keeps analyze/fallback/rules, no rerun; sample is single-pass, no cache, written to spend ledger, same privacy gate. Open: install-tab lacked extension APIs under --load-extension (harness artifact); headless panel job showed "Translating 0 of 25" (background tab, not investigated; switcher rerun not shown completing live — tester to cover); headless can't grant real host permissions. Review round-2 items 1–4 still to forward after compaction. E-impl at 24% and still "working" → sent STOP/end turn.
- **Compacted E-impl** (24% → 0%); resumed with review round-2 fixes 1–4 (step-2 label nesting, focus management, origin-only permission test, live region only on change).
- E round-2 fixes b487f69 (fieldset/legend step 2, focus to step heading + privacy button, origin-only permission test (https://api.anthropic.com/*), live region only on change; +2 tests); check green 1377 tests. Screenshot E13-2-how-key-round2.png. Open: live switcher retranslate (demo step 8) → tester. Review round 3 sent (8a73d10..b487f69 + screenshots); tester retargeted to b487f69.
- E-impl live demo step 8 (no new commit; real Gemini, Chrome for Testing, 25 segments): default gemini-flash-lite-latest 25/25 in 6.9 s → switch (this tab) to gemini-flash-latest 25/25 in 12.0 s, tabRoute written, routing p-a unchanged → Make default → routing.translate p-b, tabRoute cleared; site rule wins on 127.0.0.1. Earlier stall was a harness artifact (panel tab activation pausing the job, D14). Screenshots pw/shots E11-1…E11-6. An earlier run with `gemini-2.5-flash-lite` as default showed "Model not found" → asked scout Q7 whether that id is a shipped default.
- Scout Q7: `gemini-2.5-flash-lite` appears only in tests (adapters.test.ts, errors.test.ts fixture) on m4 @ b487f69 and master; shipped default is `gemini-3.5-flash-lite` (presets.ts:95, settings.ts:84-86). The "Model not found" came from the implementer's harness setup, not the product. No action.

### Iteration 21 — 2026-10-09 (phase F start)
- Phase F implementer m4-F-impl (wC:p57) on Sonnet 5.5 (running the harness and writing a doc; no design-heavy code). Goal scratchpad/goal-F-impl.md: providers per G5 (Gemini OpenAI endpoint, Ollama cloud, AIBOX now; Anthropic/OpenRouter "not run — no key" unless the user adds keys); single-pass decision recorded open; matrix where ROADMAP §7 says; extension run per provider. Reviewer + tester after its first commit. Final gate after F: §7 demo with the user.
- ctx: supervisor 16%, scout 11% (idle), F-impl 7% (working, goal picked up).
- User: OPENROUTER_API_KEY added to .env; Anthropic skipped. Told F-impl (OpenRouter row runs, both protocols; Anthropic row "not run — skipped by user").

### Iteration 22 — 2026-10-09
- ctx: supervisor 17%, scout 11% (idle), F-impl 16% (working; no commit and no state file yet). Reminded F-impl to write its state file and commit a first step.
- F first commit b4b51c0 (check green): matrix draft in docs/provider-matrix/ + screenshots; product fix src/llm/openai.ts (+test): auto-detect finds OpenRouter's OpenAI path (/models lacks object:"list"). Harness 23 passages: Gemini 0/149 lost, judge 4.24, $0.0318; APIBOX qwen3.8-flash 0/149, 4.49, $0.0015; Ollama cloud gemma4:31b 0/149, 4.46 (no Qwen on Ollama cloud); gpt-oss:20b default lost 127/149 (reasoning fills output cap), with reasoning-low quirk 0 lost, 3.48. Extension: gemini/apibox/gemma 73/73, gpt-oss default 10/73, quirk 72/73. OpenRouter: 0 credits → paid models 402, only :free models (50 req/day); free nemotron-super lost everything. Anthropic "not run — skipped by user". Started F reviewer (wC:p58) and tester (wC:p59), Sonnet; goals goal-F-review.md / goal-F-test.md (common-F.md).
- F review round 1 (b4b51c0): no blocking. Rulings (all fix): (1) matrix rows not like-for-like (chunk/concurrency differ) → per-row settings; (2) nemotron run + eval:detect output uncommitted → commit or mark; (3) connect-level OpenRouter-style detect test → add; DESIGN.md:265 §4.2.5 step 2 says `object: "list"` but code now accepts listings without it → **spec change, ask the user (G7)**; (4) process text in doc → open decision; (5) unsupported APIBOX latency claim → soften/measure; (6) glossary behaviour untested → say so. Forwarded to F-impl.
- F-impl FINAL REPORT (354bcd1; check green 1378): matrix docs/provider-matrix.md (ROADMAP §7 names no path; stated in doc); runs eval/runs/m4f-*; screenshots/JSON docs/provider-matrix/; scripts/eval/ext-run.mjs (Playwright extension driver; patches manifest host permissions in a copy); new `pnpm run eval:detect`. Rows: Gemini 3.5-flash-lite 0 lost/4.24/$0.0318/ext 73/73; APIBOX qwen3.8-flash 0/4.49/$0.0015/73/73; Ollama cloud gemma4:31b 0/4.46/n/a/73/73; gpt-oss:20b default 127 lost/10/73; reasoning-low quirk 0/3.48/72/73; Anthropic not run (user); OpenRouter haiku both protocols not run (0 credits). Judge uncalibrated: <0.25 differences are noise. Ruling on gpt-oss: no product change in M4; document options (preset defaultModel gemma4:31b / learned empty-max_tokens quirk) as open item. Round-1 fixes still to do (report crossed). Tester retargeted to 354bcd1.
- F round-1 fixes: 9559b72 (connect.test.ts OpenRouter-style detect; fails without the openai.ts fix) and 8b0d3b6 (per-row settings + comparability note, nemotron summaries + detect-openrouter.json committed (no key), gpt-oss open decision, APIBOX latency softened, glossary untested note); check green 1379. DESIGN.md untouched pending G7 (proposed wording: "`object: \"list\"`, or no `object` and no Anthropic-style `type: \"model\"` entries"). Review round 2 sent; tester retargeted to 8b0d3b6.
- F review round 2 (b4b51c0..8b0d3b6): **no blocking; verdict ACCEPT**, conditional on the user's G7 call. Round-1 items 1–6 fixed; all 5 screenshots and committed files free of keys; 130 tests + tsc clean. Accepted non-blocking: gpt-oss rows use hand-set profile quirks (documented in the doc).
- Asked the user: add OpenRouter credits so a paid model (e.g. claude-haiku-4.5) runs over both protocols, or accept OpenRouter as detect-only + free-model row?

### Iteration 23 — 2026-10-09
- ctx: supervisor 20%, scout 11% (idle), F-impl 20% (idle; checkpoint warning sent), F-review 10% (idle, ACCEPT), F-test 9% (working on 8b0d3b6). Waiting on: tester final, user G7 + G8.
- Iteration 24: ctx supervisor 20%, F-impl 20% (idle), F-review 10%, F-test 10% (working: harness repro Gemini/APIBOX/gemma match the matrix; gpt-oss low lost 1/149 vs 0 (model variance); extension reruns ok, gpt-oss slow under load). No action.
- F tester FINAL (8b0d3b6; check green 1379): **all criteria MET** for runnable rows (G5): §3 #1 Gemini/APIBOX/gemma4/gpt-oss harness + extension; OpenRouter auto-detect both protocols live (433/469 models, authByProtocol, 1-token chat both); §3 #2 matrix numbers recomputed from committed summary/judge JSON — match; §5 recorded open; §8 documented. Repro: Gemini/APIBOX/gemma match; gpt-oss default 137 lost (matrix 127, same conclusion); gpt-oss low 1/149 (matrix 0 — luck); extension Gemini/APIBOX/gemma 73/73; gpt-oss extension inconclusive under load. Nits → fix: gpt-oss low 0–1 lost, 3.48 vs 3.47 rounding, "gemma slowest per call" load-dependent. Not run: Anthropic, OpenRouter quality rows, judge re-runs, e301583 (ext-run --protocol flag, scripts only). Forwarded nits to F-impl.
- F doc nits d5fb821 (provider-matrix.md only): gpt-oss low "0–1 of 149 across runs"; footnote: 3.48 = mean of per-passage overalls (3.47 from rounded dims); gemma timing marked load-dependent, slowest claim dropped. e301583 = ext-run.mjs `--protocol auto|anthropic-messages` for OpenRouter rows (not run). F-impl has a credits watcher; told it to report only, no paid runs without my instruction. Phase F now waits only on G7 + G8 (then scout confirm, accept).
- F tester addendum (d5fb821; check green 1379): gpt-oss extension rerun unloaded — default 6/73 (matrix 10/73), low 69/73 with 4 failed (matrix 72/73, 1 failed); gemma unloaded 3.8 s median, 90 s set (footnote covers). All verdicts stand. Asked F-impl to state gpt-oss extension cells as ranges.
- F 8c09001 + 33ab794: gpt-oss extension cells/prose as ranges (default 6–10/73, low 69–72/73). Docs only. Phase F waits on G7 + G8.
- User: G7 yes, G8 free tier. Sent F-impl: DESIGN §4.2.5 edit (own commit) + OpenRouter free-tier rows on both protocols. Then review round 3 + tester check of the new rows, scout confirm, accept F, then the §7 demo gate.
- F G7 11848ce (DESIGN §4.2.5 step 2 reworded, refs openai.ts fix). G8 070009d: free model poolside/laguna-s-2.1:free (non-reasoning; others failed probes). Harness 3-passage subset (docker-multistage, go-gofmt, wodehouse-jeeves), both protocols: openai-chat lost 1/19 judge 2.92; anthropic-messages lost 1/19 2.42 (same subset: Gemini 4.0, APIBOX 4.5, gemma 4.33). Extension both protocols 0/69 — free quota exhausted (52/50), "provider is busy"; rerun possible after UTC midnight. Haiku row stays "not run — no credits". Credits watcher stopped. Review round 3 + tester check (no OpenRouter calls) sent. **Open → user gate G9**: OpenRouter extension rows not runnable today.
- Iteration 25: ctx supervisor 22%, scout 11%, F-impl 22% (idle), F-review 11%, F-test 13% (checking 070009d). F review round 3 (8b0d3b6..070009d): **ACCEPT**, no blocking; DESIGN §4.2.5 matches code; subset scores recomputed OK; no keys. Doc fixes → F-impl: laguna OpenAI repaired 3 not 2; Anthropic go-gofmt loss was rate_limit (comparison confounded); extension cells name mdn-promise-then (69 blocks); footnote/item numbering.
- F 54a3b65: round-3 doc fixes 1–4 (laguna 3 repaired; Anthropic go-gofmt loss = rate_limit, comparison withdrawn; mdn-promise-then in cells; footnotes ¹²³, items renumbered, G8 item now 7). F-impl has a background job waiting for the free quota reset to rerun the two OpenRouter extension rows (free tier, within user's G8 decision).
- F tester on 070009d: check green 1379; OpenRouter laguna rows recomputed from committed runs — match (OpenAI 1/19, 2.92; Anthropic 1/19, 2.42; subset comparisons 4.00/4.50/4.33; extension 0/69 both). Nit "3 repaired" already fixed in 54a3b65. DESIGN §4.2.5 wording matches eval:detect behaviour. Phase F: tester MET, reviewer ACCEPT; waits on G9 (user), then scout confirm.
- Iteration 26: ctx supervisor 23%, scout 11%, F-impl 23% → **compacted** (first /compact didn't take; retried; now 0%), resumed: only open item is its background job b4fqedhu6 that reruns the two OpenRouter free-tier extension rows after the UTC-midnight reset (~07:00 local 2026-10-10). F-review 11%, F-test 13% idle. Phase F waits on G9 (user).
- User: G9 (a) accept F now. Asked scout Q9 (F commits, clean tree, no keys, ports) before accepting.
- Scout Q9: m4 clean at 54a3b65; 11 F commits (b4b51c0 … 54a3b65); 148 files (+13125/−4), mostly eval runs; product code: src/llm/openai.ts (+test), connect.test.ts; DESIGN.md §4.2.5; key scan: only test fakes + 2 harmless non-test matches; .env untracked; no listeners on 11434/1234/7300.
- **Phase F accepted** (tester all criteria met as adjusted by G5/G8; reviewer ACCEPT, 3 rounds; G5, G7, G8, G9 signed off; scout confirmed 54a3b65). Closed F reviewer and tester. F-impl kept alive only for its OpenRouter free-tier extension rerun after the UTC-midnight reset (open item, per G9).
- Next: final gate — §7 demo on the user's machine (G10), with the substitutions the user agreed (no Anthropic key, no local Ollama/LM Studio).
- g2-ext rebuilt from m4 @ 54a3b65 (same path, same extension ID). Sent the user the §7 demo steps (G10).
- Iteration 27: ctx supervisor 25%, scout 12% (idle), F-impl 5% (idle, rerun job waiting). Waiting on G10 (user demo). No-op.
- Iteration 28: ctx supervisor 26%, scout 12%, F-impl 5% (idle). Still waiting on G10 (user demo). No-op.
- Iteration 29: still waiting on G10 (3rd iteration with no reply). Re-asked the user; wake-ups stretched to hourly. No-op.

### Iteration 30 — 2026-10-10
- F-impl OpenRouter free-tier extension rerun (bf693b8, docs only): both protocols 0/69 again on mdn-promise-then with a fresh quota; auto timed out at 1218 s; anthropic stopped after 279 s "Lost the connection"; only 3 free requests counted → quota not the cause; cause unknown. Since the harness worked on both protocols, this may be an extension or driver defect → asked F-impl to diagnose (≤10 free requests, no product commit before my ruling). G10 still pending.
- F-impl diagnosis (10 free requests, uncommitted ext-run --net/--max/--chunk): 6-block page translates on both protocols in the built extension (6/6, ~10–13 s). The 69-block page (concurrency 2, chunk 1200) gets 17 requests in 150 s: most 200, one 429, 7 net::ERR_ABORTED about 40 s apart with no response; the panel then shows "0 of 69 · 25 failed" with all blocks failed but the job still running. No 40 s abort found in src/llm or src/engine (SDK timeout 10 min, maxRetries 0). Possible product issue (unknown abort; job stuck "running" with everything failed) → asked F-impl to reproduce with a local stalling mock (no OpenRouter calls), find what aborts, check the §4.3.5 classification and the stuck job, and propose a fix (no product commit before my ruling). Matrix rows to read "small page works; 69-block page fails, cause under investigation".
- F-impl local repro (zero OpenRouter requests; 56edbda, 934dd3c = docs + ext-run options): stalling mock shows **no per-request idle/first-byte timeout** in the adapters — a hung provider (no headers, or headers then a stalled stream) holds the chunk until the server closes; §4.3.5's network → backoff → fallback never fires; the job stays "running". All-429 with no fallback ends properly ("done · 0 of 69 · Retry failed"). The real-run 40 s ERR_ABORTED were not reproduced (likely OpenRouter/the connection closing). **Ruling: fix** (gap against §4.3.5 and the §2 fallback criterion): adapter idle guard, default 60 s (one constant), abort → `network` LLMError → retry/backoff/fallback; user cancel unaffected; tests both protocols; mock run with a fallback set (badges). Phase F reopened for this fix; a fresh reviewer + tester will check it. Told the user.
- F idle guard: 94f2aac (src/llm/sdk.ts + both adapters: IDLE_TIMEOUT_MS 60 s, idleGuard per attempt linked to req.signal, reset on response + every stream event, fires → network LLMError, cancel unaffected; adapters.test.ts both protocols) + 1ff72bd (driver, evidence docs/provider-matrix/idle-guard-fallback.*, matrix note). check green 1397. Extension: hung primary mock → aborts ~62 s apart → 69/69 on fallback with badges. Started fresh reviewer m4-F2-review (wC:p5C) and tester m4-F2-test (wC:p5D), Sonnet; goals goal-F2-*.md (common-F2.md).
- F2 review round 1 (1ff72bd): APPROVE except B1 (blocking unless accepted): SDKs drop SSE comments/anthropic pings, so keepalive-only thinking streams are cut at 60 s → **fix: reset the timer on raw response bytes** (wrap fetch body). Also fix: 2 spaced-events test, 3 keepalive test, 4 swallowed-abort branch test, 6 matrix note (≈4×60 s + backoff once per job); 5 consumer backpressure → accepted with a comment. Verified: network classification, no latch, cancel, cleanup, engine free of chrome.*. Forwarded to F-impl.
- F idle-guard fixes 091b9ae (B1: watchedFetch resets on body chunks + response arrival; tests 2–4 incl. keepalive-only and swallowed abort; mutation check: 4 tests fail without byte-level touch; 5 comment; 6 matrix note); check green 1403. Hung-primary extension run not re-run after the change → tester. Review round 2 sent; tester retargeted to 091b9ae. User asked how to run the final demo → sent step-by-step instructions (G10).
- F2 review round 2 (091b9ae): **APPROVE**, no blocking; B1 fixed (watchedFetch per attempt, reader cancelled on cancel); sticky once-per-job confirmed (engine.ts:106/118/130, fallback.ts), unless the primary is the last link. Tiny follow-ups → F-impl: backoff "about 3.5–7 s" + last-link caveat in the note; comment that the Response loses url/redirected. Accepted: highWaterMark caveat conservative. Waiting on the F2 tester.
- F 2bd5a24: review follow-ups (backoff 3.5–7 s + last-link caveat; watchedFetch comment). First full check flaked on switcher.test.tsx ("this tab only" live announcement; passes alone), rerun green 1403 → ruled fix: make that test deterministic (test only unless a real race; 3 green full runs).
- F e7c8811: flaky switcher test fixed (test-only; waits for the switcher-live announcement; test race, not a product race); 3 consecutive green checks, 1403 each. Waiting on F2 tester (091b9ae+).
- User: **G10 demo ok** (final gate passed on the 54a3b65 build). Remaining: F2 tester verdict on the idle-guard fix → scout confirm → re-accept F → close-out.
- F2 tester FINAL (extension checks 091b9ae; check green on 091b9ae and e7c8811, 1403, no flake): all checks pass — new idle-guard tests fail (16) before the fix, pass after; built extension with local mocks (0 OpenRouter requests): normal 73/73; hung primary → fallback 73/73 in 246.7 s with badges; mid-stream stall → fallback 73/73; no fallback → job stops "Lost the connection … Retry" (not stuck); cancel during stall → Cancelled, 0 failed, fallback 0 requests; keepalive-only 70 s not cut; slow active 100 s not cut; 401 → Fix key, fallback 0. Asked scout Q10.

- Scout Q10: m4 clean at e7c8811; 8 commits 54a3b65..m4 (14 files, +300/−27: src/llm/sdk.ts, openai.ts, anthropic.ts, adapters.test.ts, testing.ts, switcher.test.tsx, ext-run.mjs, matrix docs/evidence); no keys beyond the known test fakes and two harmless non-test matches; no listeners on 11434/1234/7300/18000–18199. Correction to Q9: nine m4f-* run directories.
- **Phase F accepted again** (idle-guard fix: reviewer APPROVE in 2 rounds, tester all checks pass, scout confirmed e7c8811). Closed F2 reviewer and tester.
- **G10 passed** (user: "G10 demo ok").
- **All phases A–F accepted. M4 complete on branch `m4` @ e7c8811** (not pushed, not merged; master stays for M3 dogfood fixes). The user asked to commit this log; it is committed on `m4` by m4-F-impl, then the remaining sessions are closed.

## FINAL STATE — M4 complete (2026-10-10)

| Phase | Closed by |
|---|---|
| A — openai-chat adapter (M4-E1) | f27f00f |
| B — connections, profiles, routing (M4-E2, E8) | d4d065f |
| C — setup that explains its own failures (M4-E3–E7, E12) | 60bd883 |
| D — fallback, privacy, badges, usage, soft limit (M4-E9, E10) | 8a2c3ee |
| E — quick switcher, onboarding (M4-E11, E13) | 4ed5a59 |
| F — provider matrix + idle guard | e7c8811 |

User decisions: G1 §5 defaults + m4 branch; G2/G3 real-Chrome checks passed; G4 real-Ollama stop skipped (mock run accepted); G5 Ollama cloud replaces local Ollama/LM Studio; G6 onboarding check with Gemini instead of Anthropic; G7 DESIGN §4.2.5 reworded (OpenRouter listing); G8 OpenRouter on the free tier, no credits; G9 accept F with the OpenRouter extension rows open; G10 §7 demo passed (steps 4–6 skipped as agreed).

Open items carried forward:
- OpenRouter extension rows: 6-block page works on both protocols; 69-block page failed before the idle-guard fix and is unproven after it (free tier; no paid model run).
- Anthropic direct and OpenRouter claude-haiku-4.5 rows not run (no key / no credits).
- §5 local chunking (`single-pass` for < 7B) undecided — no local model was available.
- gpt-oss:20b unusable with default quirks: preset `defaultModel` gemma4:31b vs a learned quirk for an empty max_tokens stop — decide in a later milestone.
- S8 (Chrome built-in availability) never recorded → onboarding shows Chrome built-in as "Coming soon"; the Chrome LanguageDetector check from M2 is still human work.
- Demo steps 4–6 (Ollama CORS guide, real Ollama stop, local-only rule) not run on real hardware; covered by mocks and tests.

M5 handoff:
- M5-E3: store the site allowlist under sync key `siteAllowlist` (or change `allowlistedHost` with it).
- M5-E6: site rules UI on the existing routing storage (`siteRules`, `localOnly`).
- M5-E7: the fallback chain already accepts and skips a terminal `basic` entry.
- Permission request/revoke flow reusable for per-site allowlisting.

## RESUME STATE (superseded by FINAL STATE above)
- M4 complete; nothing to resume. See FINAL STATE.
