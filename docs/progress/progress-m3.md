# M3 — Reading UX core → MVP: supervisor progress log

Plan: docs/plans/M3-reading-ux-core.md · Spec: DESIGN.md · Prompt: docs/prompts/implement-plan.md

## Supervisor

- Session name: `update-readme` · pane `wC:p2J` · tab `wC:t1T` · model Opus 5.5
- Goal files for peers: the supervisor session's scratchpad directory (session-local, not in the repo)
- Peers: `idle` or `done` from `herdr agent get wC:p2J` = supervisor free.

## Phases

The plan groups tasks into sub-goals A–E with no other ordering, so each sub-goal is one phase, run in plan order
(A → B → C → D → E). The plan allows no parallel phases. M1 and M2 (the plan's dependencies) are accepted.

| Phase | Tasks | Depends on | Status |
|---|---|---|---|
| A — readable in seconds | M3-E1, M3-E7 | M1, M2 | ACCEPTED 2026-10-08, closed at 274d834 |
| B — free on revisit | M3-E2, M3-E3 | A | ACCEPTED 2026-10-08, closed at 08a4f3e |
| C — failure never loses the page | M3-E8, M3-E4 | B | ACCEPTED 2026-10-08, closed at 1987d28 |
| D — control and trust | M3-E5, M3-E6, M3-E9, M3-E10 | C | ACCEPTED 2026-10-08, closed at 8c42ae3 |
| E — prove it's an MVP | M3-E11 (HUMAN: 7-day dogfood), triage, fix MVP blockers | D | WAITING ON USER (dogfood week started 2026-10-08) |

### Tasks (verbatim from plan §6)

- M3-E1 IntersectionObserver → `priority` ids; engine orders chunks by priority and re-prioritizes pending chunks on scroll.
- M3-E7 One-way scroll follow (page → panel), header toggle.
- M3-E2 IndexedDB translation cache (key, LRU, revision rule), brief cache, cache stats in settings.
- M3-E3 Job persistence/resume per S1, or panel-hosted engine wiring.
- M3-E8 Error UX: auth → "Fix key" (no fallback); rate limit → backoff indicator per chunk; `segment.failed` → inline retry; network down → whole-page retry.
- M3-E4 Selection mode via context menu (`translateSnippet`) and the extraction-failure hint.
- M3-E5 Per-block actions: show original inline, retranslate, copy.
- M3-E6 Header controls, including target-language and style-mode switches.
- M3-E9 Per-page cost readout and running total in settings (built-in Anthropic pricing).
- M3-E10 First-run privacy notice and built-in denylist.
- M3-E11 Dogfood for one week. Log every time you reach for another translator and why. Triage: MVP blockers fixed in M3, the rest scheduled.

### Done criteria per phase (verbatim from plan §2 "Done looks like" and §3 success criteria)

The plan has no per-phase done criteria; these are the §2/§3 lines that map to each phase.

- **A:** "Open the panel and the paragraphs on screen are translated first, within about 2 seconds. Scrolling moves what's translated next." · §3 #1 "Visible segments translated after opening, any article/docs page — ~2 s" · §3 #2 "Whole 3,000-word page — < ~30 s" · header part of §2: "a scroll-follow toggle" (E7). Decision: "Re-prioritization on scroll — Reorder pending chunks only; never abort in-flight ones."
- **B:** "Revisiting a translated page shows the translation instantly, with no API calls." · §3 #3 "Reopen a translated page — renders from cache, 0 API calls". Decisions: cache key, brief excluded from key (state it in DESIGN; retranslate bypasses cache), resume per S1.
- **C:** "If the network drops, everything already translated stays, and the panel offers a retry. A bad key shows "Fix key" inline. A rate limit shows a backoff indicator. A failed segment has its own retry button." · "Select text, right-click **Translate in side panel**: works on any page, including ones where extraction fails ("Couldn't read this page. Select text to translate it.")." · §3 #4 "Kill network mid-translation — translated part intact, retry offered" · §3 #5 "Selection mode on a page where extraction fails — works" · §3 #6 "Bad key — "Fix key" inline, nothing sent elsewhere".
- **D:** "Each block has: show original inline, retranslate (skips the cache), copy." · "The header shows the language pair (with a target-language switch), model, style mode, settings, cancel/retranslate page and a scroll-follow toggle." · "First run shows a privacy notice. Banking, mail, `chrome://`, Web Store and pages with a focused password field are never extracted." · §3 #7 "Denylisted page — never extracted, never sent". E9: per-page cost readout + running total in settings.
- **E:** §3 #8 "Dogfood — 7 days of daily use, no other translator needed; bug list triaged". Demo script §7 runs end to end.

### Plan decisions (§5) — need user confirmation (gate)

| Decision | Recommended default | User decision |
|---|---|---|
| Translation cache key | `hash(segmentText + targetLang + model + styleMode + strategy@version + promptVersions + glossaryHash)`; highest revision only; LRU ~50 MB | ACCEPTED (M3-D1..D5) |
| Brief excluded from segment cache key | Yes; state it in DESIGN; retranslate bypasses cache | ACCEPTED (M3-D1..D5) |
| Re-prioritization on scroll | Reorder pending chunks only; never abort in-flight | ACCEPTED (M3-D1..D5) |
| Resume after interruption | Panel-hosted engine → no resume machinery; cache keeps finished segments; retry re-runs only missing | ACCEPTED (M3-D1..D5) |
| Password field rule | Focused `input[type=password]` at extraction → skip page | ACCEPTED (M3-D1..D5) |

### Human work (not delegated)

- M3-E11 7-day dogfood + dogfood log (blocks phase E).
- Any live measurement the testers can't run under the plan's conditions (real Chrome, real network) → user.

## Sessions

| Name | Pane | Role | Phase | Model | Why model | Status |
|---|---|---|---|---|---|---|
| m3-scout | wC:p49 (tab wC:t3C) | Scout | all | Sonnet 5.5 | default | closed |
| m3-A-impl | wC:p4A (tab wC:t3D) | Implementer | A | Opus 5.5 | E1 cuts across content script, engine runner/strategies and panel, and carries a design decision (how mid-job re-prioritization enters the engine as data) | closed |
| m3-A-test | wC:p4B (tab wC:t3E) | Tester | A | Sonnet 5.5 | default | closed |
| m3-A-review | wC:p4C (tab wC:t3F) | Reviewer | A | Sonnet 5.5 | default | closed |
| m3-B-impl | wC:p4D (tab wC:t3G) | Implementer | B | Sonnet 5.5 | default (design decisions already fixed by M3-D1/D2/D4) | closed |
| m3-B-test | wC:p4E (tab wC:t3H) | Tester | B | Sonnet 5.5 | default | closed |
| m3-B-review | wC:p4F (tab wC:t3J) | Reviewer | B | Sonnet 5.5 | default | closed |
| m3-C-impl | wC:p4G (tab wC:t3K) | Implementer | C | Sonnet 5.5 | default | closed |
| m3-C-review | wC:p4H (tab wC:t3M) | Reviewer | C | Sonnet 5.5 | default | closed |
| m3-C-test | wC:p4J (tab wC:t3N) | Tester | C | Sonnet 5.5 | default | closed |
| m3-D-impl | wC:p4K (tab wC:t3P) | Implementer | D | Opus 5.5 | four tasks cutting across panel header, segment list, jobs, options, extraction and cost; header layout carries a design decision (M4 switcher slot) | closed |
| m3-D-review | wC:p4M (tab wC:t3Q) | Reviewer | D | Sonnet 5.5 | default | closed |
| m3-D-test | wC:p4N (tab wC:t3R) | Tester | D | Sonnet 5.5 | default | closed |

## Decisions (M3-D#)

- M3-D1..D5 (user, 2026-10-08): all five plan §5 defaults accepted as written (cache key; brief excluded from key, stated in DESIGN, retranslate bypasses cache; scroll reorders pending chunks only; panel-hosted engine → no resume machinery, cache keeps finished segments, retry re-runs missing; focused password field at extraction → skip page).
- M3-D6 (user): phases run sequentially A→B→C→D→E on branch `m3`, no parallel worktrees.
- M3-D7 (user, deviation): keep APIBOX (openai-chat) as runtime default; plan's "Anthropic only" not enforced. E9 cost readout uses existing per-profile pricing (any provider) plus built-in Anthropic prices on the Anthropic preset. "Fix key" applies to whichever connection is active. Live tests run on APIBOX.
- M3-D9 (user, Phase A R1): chunk order after the screen = chunks after the screen, then those before it (differs from DESIGN §3 "rest in reading order" only when opened mid-page). Recorded as a DESIGN §3 note by A-impl.
- M3-D10 (user, Phase A R5): page→panel scroll follow defaults ON, one global setting (localStorage), not per tab.
- M3-D11 (user, Phase A speed gate): accepted as known gap. §3 #1 counts as met on first on-screen text (~1.9–2.6 s); whole-screen done (8.6–11.6 s) and §3 #2 whole page (95–138 s vs < ~30 s) are accepted gaps tied to provider/model throughput (single call 12–15 s, concurrency 2), revisit in M4 (per-profile concurrency/providers).
- M3-D12 (user, Phase B): cached pages still need a resolvable client (key + host access) to render, since model is in the key; no change (Phase C 'Fix key' covers the missing-key case).
- M3-D13 (user, Phase C prep): selection mode is blocked on denylisted hosts (DESIGN §8 "never read or sent"); existing denylist message shown.
- M3-D14 (user, Phase D prep): banking stays per DESIGN §8 / D23 — user-editable denylist in M4+. The plan §2 "Banking … never extracted" item is deferred to M4; M3 ships mail/sign-in hosts, browser pages, Web Store and the focused-password rule (M3-D5).
- M3-D15 (user, Phase E): supervisor loop paused during the dogfood week; user re-runs the same /loop to resume. Dogfood log + triaged bug list live in docs/progress/dogfood-m3.md (user writes it; committed with M3). m3 merges into master only after Phase E is accepted.
- M3-D8 (user): no browser e2e exists. Testers verify logic with unit tests + instrumented timings and attempt live checks via claude-in-chrome; any live check they can't run goes to the user.

## Iterations

### Iter 1 — 2026-10-08
- ctx: supervisor 8%. No peers yet.
- Created log. Started scout m3-scout (wC:p49, Sonnet). User accepted §5 defaults + sequential order (D1–D6), provider + live-check rules (D7, D8).
- Scout Q1 baseline: master=origin/master=46d3473, clean except this log; branches master, m1; one worktree. Engine is panel-hosted (S1), in-memory per-tab jobs with resume of final segments (jobs.ts ~372). E1/E7/E2/E5/E6: none. E3: panel-hosted done, no persistence. E8 partial (job-level Retry failed/Resume; failed note per segment, no per-segment retry; auth msg "Add your APIBOX API key", no "Fix key"; no backoff indicator). E4 stub (context menu 'Open Translate Side', translateSnippet exists in engine but unused). E9 partial (per-page cost in JobBar; no running total). E10 partial (host denylist; form fields never read; no first-run notice; no focused-password skip). Commands: `pnpm run check` (lint+typecheck+check:engine+test+build+check:manifest). No e2e.
- Started m3-A-impl (wC:p4A, Opus) with goal file scratchpad/goal-A-impl-full.md; confirmed working, /goal active. Branch `m3` to be created by it.
- Next: wait for A-impl report → start tester + reviewer.

### Iter 2 — 2026-10-08 ~09:56
- ctx: supervisor 10%, m3-scout 7% (idle), m3-A-impl 19% (working).
- A-impl progress (state file): branch m3 created; engine step committed 9f5274e (src/engine/priority.ts pickByPriority, livePriority port on TranslationJob, runner reorders pending only; 13 new tests). Working on step 2 (content IO + viewport push protocol) and step 3 (scroll follow + toggle). On plan, no drift.
- A criteria: none verified yet (impl in progress).
- Next: wake in ~10 min to catch A-impl crossing 20% (checkpoint warning) / 25% (compact).

### Iter 3 — 2026-10-08 ~10:07
- ctx: supervisor 11%, m3-scout 7% (idle), m3-A-impl 26% (working) → checkpoint request sent; compact once idle.
- A-impl commits on m3: 9f5274e (engine priority), 96bcc9a (protocol v2 viewport push, content IO, jobs.setViewport), 92bd83c (scroll follow + header toggle data-testid=scroll-follow). `pnpm run check` green, 1012 tests (per its state file). Remaining: live timings (APIBOX) + chrome live check, then report.
- A-impl checkpoint report: 4 commits (+cd10f47 `pnpm run latency` harness: real Jobs, live APIBOX qwen3.8-flash, ~3,000-word page). Live Chrome extension load not possible from the session (Chrome can't reach localhost); injected bundled watchViewport into live go.dev/blog/pipelines — IO + scroll anchor worked.
  Baseline timings (pre step 4): top screen first text 1.7 s, 16 on-screen segs 8.5 s, whole page 103.6 s; brief in parallel (0→7.9 s), first translate call at 0.0 s. Middle screen: first text 9.2 s, screen 18.3 s, whole 156 s (priority makes middle screen ~6× faster than without).
  OPEN: §3 #1 middle-screen first text 9.2 s vs ~2 s (step 4 targets it). §3 #2 whole page ~104–156 s vs < ~30 s — fails 3–5×, attributed to qwen profile (later chunks' minimal thinking, concurrency 2); outside E1/E7 → likely a missed-budget gate for the user once tester confirms.
- Compacted m3-A-impl 26% → 5%; resumed with step 4 (chunk boundary at first on-screen seg; thinking-off to first-started chunk), check, `pnpm run latency -- --runs 2`, final report. Told not to change the profile.
- 10:15 A-impl: step 4 committed eb7ccd6, check green 1019 tests; latency runs (--runs 2) running in background shells; ctx 9%. Baseline round 2 top screen: first text 2.7 s, screen 9.7 s, whole 140 s. Waiting for final report.

### Iter 4 — 2026-10-08 ~10:25 (user nudge: "peers all idle")
- ctx: supervisor ~12%, scout 7% idle, A-impl 9% idle (its latency run `--runs 2 --scenarios top,middle` still running in a bg shell since 10:15; it reports when done).
- Supervisor had been waiting on A-impl's final report unnecessarily: code is committed, so started tester + reviewer in parallel now on m3 HEAD (eb7ccd6+). Goals in scratchpad goal-A-test-full.md / goal-A-review-full.md; both confirmed working, /goal active. Tester told to run its own `pnpm run latency` after A-impl's run finishes (avoid contention).
- Lesson: don't wait for an implementer's measurements before starting tester/reviewer once code is committed.
- Review round 1 (m3-A-review, SHA eb7ccd6): PASS, no BLOCKING. Verified: engine boundary; M3-D3 pending-only (priority.test.ts:52,190,238); unchanged with nothing on screen (priority.test.ts:18,229,289); privacy (rects+ids only); listener cleanup; no M5 creep. check: tsc clean, 1019 tests. No live Chrome (→ user). Non-blocking: R1 order screen→after→before vs DESIGN:71-72 "rest in reading order" (→ user accept or DESIGN note); R2 Readability path: big ancestor always visible → priority degrades, anchor sticks (src/extract/index.ts, viewport.ts:26-38); R3 no initial anchor → follow inert until first scroll (translator.ts:172-173); R4 follow.ts:42 per-frame querySelectorAll; R5 follow default ON, global flag (→ user); R6 protocol v2 harmless; R7 startOrder cosmetic; R8 latency budget (→ user gate).
  Supervisor ruling: R2, R3 (+R4 optional) sent to A-impl to fix in Phase A; R1, R5, R8 → user; R6, R7 no action.
- A-impl FINAL REPORT: 6 commits (… eb7ccd6, 32e0eee review fixes R2/R3/R4), check green 1022 tests. Latency after step 4 (run1/run2): top first text 3.2/2.1 s, screen 11.4/9.0 s, whole 112/96.5 s; middle first text 1.9/5.4 s, screen 10.0/12.9 s, whole 120.8/184.6 s. Pre-M3 middle (no priority): first text ~91–107 s. Brief runs in parallel (0→6.6–9.5 s), on-screen chunk call at 0.0 s → §8 risk not a problem. §3 #1: first on-screen text 2–5 s, full screen 9–13 s (not within ~2 s for the whole screen). §3 #2 FAILS 96–185 s (3–6×): profile/concurrency (12 calls ×2, minimal thinking, revise slot). One check-failed segment in one run, not investigated. Extension not run end-to-end in a browser.
- Review round 2 (m3-A-review, 32e0eee): PASS, no BLOCKING. R2/R3/R4 fixed (viewport.ts:48 coarse(), content.ts:50/protocol.ts:30/translator.ts:175 anchor, follow.ts blockFinder). New non-blocking (a) viewport.ts:48 drops legit tall multi-seg element (rare), (b) follow.ts:46 rebuild-per-frame on missing anchor (edge). Supervisor ruling: (a)(b) no action.
- User ruled R1 → M3-D9 (A-impl adding DESIGN §3 note), R5 → M3-D10. R8 latency → user after tester's numbers.
- A-impl committed 274d834 (DESIGN §3 M3-D9 note, DESIGN only); sent to reviewer for check. A-impl's uncommitted experiment (on-screen paras as own chunk) gave no gain (screen 9.5–11.3 s; ~10 s per call regardless of size) — reverted. Told A-impl: no more live runs while tester measures (contention).
- Review round 3 (274d834): PASS — DESIGN §3 matches priority.ts:3-6,29-34; diff touches only those DESIGN lines. Reviewer: no open findings. Waiting on tester.
- TESTER report (m3-A-test; check at eb7ccd6 + 274d834 green, 1022 tests; latency at eb7ccd6, later commits don't touch engine): PASS E1 ordering (priority.test.ts), M3-D3 pending-only (multiplex test), viewport push (viewport.test.ts, jobs.test.ts), E7 follow + toggle (follow.test.tsx), §8 brief risk (brief + first call both at 0.0 s), engine boundary.
  Latency (APIBOX qwen3.8-flash c1200×2, 3003 words): top first text 1.9/2.1 s, screen 8.6/9.5 s, whole 95.1/135.3 s; middle first text 2.5/2.6 s, screen 9.8/11.6 s, whole 120.5/138.0 s; middle-old (page order) first text 66 s, whole 111 s. Single translate call 12–15 s.
  §3 #1: first text ~2–2.6 s MET; whole screen 8.6–11.6 s NOT MET. §3 #2 whole page 95–138 s FAIL (no regression vs page order). Live claude-in-chrome extension check NOT RUN → user.
- GATE → user: (1) §3 #1 screen-done / §3 #2 whole-page misses: accept gap or work; (2) live browser check of Phase A.
- User: M3-D11 accept speed gap; user will run the Phase A live check now. Asked scout Q2 for exact build/load steps.
- Scout Q2: m3 HEAD 274d834 clean (except log); build `pnpm run build` → .output/chrome-mv3 (existing build 10:37 may be stale → user rebuilds); key in Options (APIBOX) + host permission prompt on Save; Alt+T = _execute_action; follow toggle ⇅ in header (App.tsx:87-98), aria 'Follow page scroll'. Live-check steps sent to user; waiting for result.

### Iter 5 — 2026-10-08 ~10:53 (no-op)
- ctx: supervisor 15%, scout 7%, A-impl 13%, A-test 8%, A-review 13% (all idle).
- Phase A: tester + reviewer done, no blocking findings; waiting on user's live check (gate). Phase B blocked until A accepted.

### Iter 6 — 2026-10-08 (user live check)
- User ran the extension in their live browser: "extension works, it can translate". Sign-off for Phase A gate (screen-first / scroll / follow toggle not reported individually; any issues will surface in Phase E dogfood).
- PHASE A ACCEPTED: tester PASS on all non-timing criteria (timing gaps accepted M3-D11); reviewer no open findings (3 rounds); user signed off live check; M3-D9 recorded in DESIGN §3 (274d834); scout Q2 confirmed m3 HEAD 274d834 committed, tree clean except this log. Review rounds: 3. Closing commit 274d834.
- Closed m3-A-impl, m3-A-test, m3-A-review. Starting Phase B.
- Started m3-B-impl (wC:p4D, Sonnet) with goal-B-impl-full.md. Tester/reviewer goals prepared (goal-B-test-full.md, goal-B-review-full.md); start them once B-impl has committed code.
- B-impl REPORT: commits c240efc (IndexedDB translation + brief cache in panel shell src/shared/cache.ts, jobs read/fill, Options cache stats + Clear, DESIGN §7 M3-D2 note) and e264c16 (latency harness revisit scenario). Engine unchanged. Key = normalized text (NFC, ws collapse, zero-width drop) + kind + targetLang + model + style + gloss mode + strategy@version + prompt ids + glossaryHash; no brief. Highest (revision, attempt) stored; check-failed removed; LRU by last-used, 50 MB; brief cache by briefCacheKey, 200 entries. `Jobs.start(..,{fresh:true})` bypass for Phase D. Cache errors = miss. check green 51 files / 1045 tests. Harness: cold 12 requests 88.5 s; revisit 0 requests, 158/158 from cache, whole page 35 ms (fake-indexeddb).
  Open: no live Chrome (→ user); revisit needs a resolvable client (key + host access) since model is in the key — no key → cached page doesn't render; fixture re-extraction perturbs stored segments, doesn't re-run the DOM extractor; cancelled contextual run can leave revision-1 finals cached (retranslate fixes).
- Started m3-B-test (wC:p4E) + m3-B-review (wC:p4F), Sonnet, on m3 HEAD e264c16.
- Review round 1 B (m3-B-review, e264c16): APPROVE, 0 BLOCKING. Verified key per D1 + normalization, no brief (D2, DESIGN §7), highest revision only, LRU bytes in meta row, injected port (engine clean), errors degrade, no extra resume, no C/D work, privacy ok. tsc clean, 33 targeted tests. Non-blocking: N1 cache.ts:147-161 no onblocked/onversionchange/onclose → hung open stalls fromCache (jobs.ts ~411) before engine start; N2 jobs.ts flushCache ~660 flushes not serialized (delete can overtake put); N3 briefKey from full segment list but partial hit analyzes leftovers only → mismatched brief; N4 readwrite per hit, byte estimate.
  Supervisor ruling: N1–N3 → B-impl to fix now; N4 no action.
- B review addendum: races OK (IDB txn serialize, revision guard; cross-tab duplicate pay = waste only). Test gaps forwarded to B-impl: hung open, flush order, partial-hit brief, overlapping putMany, eviction size from rowBytes (optional abort/quota).
- TESTER B report (e264c16; note: B-impl's uncommitted fix edits appeared mid-run): §3 #3 PASS (jobs.cache.test requests=0; harness live APIBOX 1500 words cold 6 req 73.1 s → revisit 0 provider calls, 57/57 cached, 8 ms fake-indexeddb). §8 normalization PASS. Key-change misses PASS (style/glossary/lang/gloss via Jobs scratch test; strategy/prompt version at key level only). M3-D2 PASS via tester's scratch test, but committed test only asserts arity (weak). Revision/LRU/fresh/retry-only-missing PASS. Options stats PASS. FAIL: flaky Options.test "shows what the cache holds and clears it" (1/1045 in full check; passes alone). Live Chrome NOT RUN → user.
  Supervisor: T1 flaky test, T2 replace weak D2 test with Jobs-level, T3 Jobs-level prompt-version miss → B-impl same fix round. Tester to re-run full check on fix SHA.
- User: M3-D12 keep cache-needs-key behaviour.
- B-impl fix round committed (1 commit on e264c16 'M3-B review fixes'): N1 open reset + 1500 ms lookup timeout; N2 chained writes + cacheIdle(); N3 partial runs store no brief; tests a–e, deleteDatabase reopen, T2 Jobs-level D2, T3 strategy-version miss, T1 polling. check green twice, 1051 tests. Also ran real cache module in real Chrome IndexedDB via claude-in-chrome (localhost bundle, not the extension): behaved as in unit tests. Sent to reviewer + tester for round 2.
- Review round 2 B (08a4f3e): APPROVE, 0 BLOCKING; N1 (cache.ts:156-171, jobs.ts ~627-638), N2 (jobs.ts ~688-695), N3 (jobs.ts:418-420) fixed; tsc clean, 1051 tests. Leftovers non-blocking: L1 onblocked-then-success handle leak (rare), L2 writes queue behind a never-settling db() after timeout (memory only), L3 stale forget drops newer opening (harmless reopen). Supervisor ruling: no action now; carried over to M3 carry-over list (avoid churn while tester re-tests).
- TESTER B round 2 (08a4f3e): ALL PASS. check ×2 green 1051 tests (flake not recurred); revisit harness cold 6 req 45.7 s → revisit 0 provider calls 57/57 cached 8 ms; Jobs-level D2 test real (minor vacuous last assert); strategy miss via Jobs, version bump key-level (acceptable); hung cache → uncached run. Notes carried over: vacuous genre assert; cacheIdle hangs after timeout (tests-only API). Live Chrome NOT RUN → GATE user live check for Phase B.

### Iter 7 — 2026-10-08 ~11:57 (no-op)
- ctx: supervisor 18%, scout 7%, B-impl 16%, B-test 9%, B-review 9% (all idle).
- Phase B: tester + reviewer PASS at 08a4f3e; waiting on user's live check (gate). Phase C blocked until B accepted.

### Iter 8 — 2026-10-08 ~13:03 (no-op)
- All peers idle (ctx ≤18%). Still waiting on user's Phase B live check (2nd iteration on this gate).

### Iter 9 — 2026-10-08 (user live check B)
- User live check Phase B: "no request, accept B" — revisit made 0 requests in the live extension. Sign-off.
- Asked scout Q3 to confirm 08a4f3e committed + DESIGN §7 note before accepting. User decided M3-D13. Phase C goals written (goal-C-*-full.md, Sonnet).
- Scout Q3: m3 HEAD = 08a4f3e, nothing after; tree clean except log; DESIGN.md:773-777 holds the M3-D2 note. (Correction to Q2: follow default ON, follow.ts:15.)
- PHASE B ACCEPTED: tester PASS (round 2), reviewer APPROVE 0 blocking (2 rounds), user live sign-off, DESIGN §7 note recorded, scout confirmed commit. Closing commit 08a4f3e. Review rounds: 2.
- Carry-overs from B: cache L1 onblocked-then-success handle leak; L2 writes queue behind never-settling db() after timeout (cacheIdle hangs, tests-only); L3 stale forget drops newer opening; vacuous genre assert in D2 test; optional IDB quota/abort test; prompt-version miss tested at key level only.
- Closed m3-B-impl, m3-B-test, m3-B-review. Starting Phase C.
- Started m3-C-impl (wC:p4G, Sonnet) with goal-C-impl-full.md (includes M3-D13). Tester/reviewer start once code is committed.

### Iter 10 — 2026-10-08 ~13:41
- ctx: supervisor 20%, scout 8%, C-impl 17% (working).
- C-impl committed E8 673d1c8 (Fix key inline, per-chunk backoff, per-segment retry, network drop → stop with Retry; jobs.errors.test.tsx). Now on E4 (worker → storage.session snippet, panel SnippetRunner, hint, denylist block).
- Started m3-C-review (wC:p4H, Sonnet) to review E8 now (08a4f3e..673d1c8), E4 when it lands. Tester starts after E4 commit.
- Review C round 1 (E8 673d1c8): ACCEPT, 0 BLOCKING. Non-blocking: N1 jobs.ts:625/657 segment-retry network error flips done job to stopped (misleading); N2 jobs.ts:240 chunk -1 shared by analyze + snippet retries; N3 secret save auto-resumes stopped jobs; N4 Fix key opens generic options; N5 missing tests (retry during running job, network fail in retry, resume during retry). Ruling: N1, N2, N5 → C-impl after E4; N3, N4 no action (N4: one connection in M3, deep link is M4).
- Review C round 1b (E4 ebf798f, found by reviewer): ACCEPT, 0 BLOCKING; tsc/eslint clean, 53 files 1080 tests. Verified S1 (worker only writes storage.session), M3-D13 (denylist checked in worker + panel), text-only render, dedupe, hint on 'empty'. Non-blocking: a selection view survives navigation; b no hint on 'error' view; c page job runs behind selection; d record lingers in storage.session; e maybe brief call per selection. Ruling: a, b, e → C-impl; c, d no action. Starting tester now on ebf798f (fixes are small; tester re-checks fix SHA).
- C-impl REPORT: commits 673d1c8 (E8), ebf798f (E4), d8a4104 (review fixes 1/2/5/a/b/e + `pnpm run faults` harness). check green 1088 tests. Live faults vs APIBOX all PASS: network drop at 24/32 → stopped, Retry sent only 8 missing, done 32/32; ratelimit 429 Retry-After 2 s → backoff shown + cleared, done in 40 s; segment failure → Retry sent 1 seg, job stays done; badkey real 401 → stopped/auth, 2 requests, client resolved once. Selection jobs single-pass (no brief). Not run: live Chrome (context menu, panel, extraction-failure page) → user. Sent d8a4104 to reviewer + tester.
- Review C round 2 (d8a4104): ACCEPT, 0 BLOCKING; fixes 1/2/5/a/b/e verified (jobs.ts:120/635/667/652, translator.ts:53, StateMessage.tsx:52, snippet.test.tsx:175); badkey live: 2 requests = maxConcurrency, both via the one APIBOX client, then stopped. Non-blocking: R1 gone hook fires on panel's own reconnect (controller.ts:220/317/320) → right-click on 'error' view can wipe the selection; retry() also clears it; R2 restricted→restricted navigation leaves stale selection. Supervisor ruling: R1 MUST FIX (hits §3 #5), R2 if same fix, tighten badkey assertion → C-impl.
- C-impl committed 1987d28: `navigated` hook (page-side port close / tab URL change / loading only) clears selection; reconnect + 'Try again' keep it; restricted tabs via onUpdated; badkey assert tightened. check green 1091 tests. claude-in-chrome tried: chrome:// refused → no e2e (→ user). Sent to reviewer (round 3) + tester.
- ctx: supervisor 22%, scout 8%, C-impl 22% (idle; compact before giving it another round), C-review 12%, C-test 10%.

### Iter 11 — 2026-10-08
- ctx: supervisor 22%, scout 8%, C-impl 22% idle, C-review 12% working (round 3 on 1987d28), C-test 10% working (on d8a4104 → 1987d28; uses its own worktree in its scratchpad).
- C criteria so far: all PASS per impl harness + reviewer; tester round pending; live Chrome → user.
- Review C round 3 (1987d28): ACCEPT, 0 BLOCKING; R1 fixed (controller.ts:243-247 generation guard), R2 fixed (controller.ts:127 onUpdated), translator.ts:225-228; 1091 tests; badkey live 2 req ≤ maxConcurrency. Non-blocking: hash/pushState URL change also clears the selection (SPA; M5 territory) → carry over; idle storage.session.remove → no action. Reviewer has nothing open.
- TESTER C final (1987d28; worktrees per SHA): PASS §3 #4 network (live faults: 24/32 → stopped, Retry sent 8, done 32/32), §3 #6 bad key (real 401, only APIBOX contacted, 'Fix key' exact), rate limit (live 429 Retry-After honoured, indicator cleared), failed segment (Retry 1 request, job stays done), §3 #5 selection on extraction failure (unit/jsdom; hint on empty + error views; survives reconnect), M3-D13 denylist (unit: 0 requests). NOT RUN: live Chrome (context menu, real hostile page, real key reset), real offline mode → user. GATE → user live check Phase C. Asked scout Q4 for a page that yields the 'empty' view + denylist hosts.
- Scout Q4: 'empty' = no main/article/role=main with ≥500 chars and Readability <500, or editable doc (index.ts:13-14,38-50,74-76); 'error' = protocol exception. No real-world empty fixture; example.com likely empty (inference). Denylist hosts denylist.ts:12-27 (e.g. accounts.google.com). Live-check steps for Phase C sent to user.

### Iter 12 — 2026-10-08 (user live check C)
- User: "accept C". Scout Q4 had confirmed m3 HEAD 1987d28 committed, tree clean except log.
- PHASE C ACCEPTED: tester PASS all runnable criteria (live faults); reviewer ACCEPT 0 blocking (3 rounds: E8, E4, fixes ×2); user sign-off; scout confirmed commit. Closing commit 1987d28.
- Carry-overs from C: SPA same-document URL change clears an open selection (M5); idle storage.session.remove; page job keeps running behind a selection; selection record lingers in storage.session; Fix key opens generic options (M4 deep link); secret save auto-resumes stopped jobs; no real Chrome offline-mode test.
- Closed m3-C-impl, m3-C-test, m3-C-review. User decided M3-D14 (banking → M4). Starting Phase D.
- Started m3-D-impl (wC:p4K, Opus) with goal-D-impl-full.md. Tester/reviewer goals ready; reviewer starts on the first committed task.

### Iter 13 — 2026-10-08 ~14:39
- ctx: supervisor 25%, scout 9%, D-impl 18% (working).
- D-impl committed E10 f54a899 (PrivacyGate holds page + snippet starts until the notice is acknowledged, storage.local privacyNotice v1; focused password field → blocked view reason 'password'; denylist tests over every host). check green 1119 tests. Next E6 → E5 → E9.
- Started m3-D-review (wC:p4M, Sonnet) on E10 (1987d28..f54a899).
- Review D round 1 (E10 f54a899): ACCEPT, 0 blocking; gate translator.ts:226-259, password extract/index.ts:78,138-149, no banking (D14), DESIGN §8 updated; 96 targeted tests (full suite not run: worktree lacked node_modules). Non-blocking: N1 notice hardcodes APIBOX (honesty); N2 held job uses pre-ack settings; N3 dialog a11y; N4 closed shadow/iframe password. Ruling: N1–N3 → D-impl batched after E9; N4 no action.
- Review D round 2 (E6+E5 07e1c60): ACCEPT, 0 blocking; tsc + 56 files / 1134 tests on exact SHA. Verified D2 (fresh/replace), text-only render, header labelled + quick-switcher slot (no picker), mid-job switch safe, failed retranslate keeps text. Non-blocking: prefs optimistic write not reverted; Copied timer/aria-labels; missing tests for retranslate during running job. Ruling: all three → D-impl batched after E9.
- ctx: supervisor 26%, D-impl 27% → checkpoint request sent; D-review 11%.
- D-impl checkpoint: E9 part 1 a019402 (pricing.ts built-in Anthropic table + pricingFor; Anthropic preset not default; spend.ts running total in storage.local via Jobs onSpend; Options 'Usage and cost' section with Reset). Left: E9 tests, batched fixes, report. Said idle but /goal kept it working (29%); /compact queued in its input, runs at turn end. Waiting for idle notice to confirm ctx drop + resume.

### Iter 14 — 2026-10-08
- ctx: supervisor 26%, scout 9%, D-impl 29% (still working through /goal: E9 tests + check; /compact queued), D-review 17% idle.
- Lesson: /goal keeps a peer working after a checkpoint request; queued /compact runs at its turn end.
- Review D round 3 (E9 a019402 + d4e6e6c): ACCEPT, 0 blocking; tsc + 59 files / 1146 tests at d4e6e6c. Prices match claude-api table for 12 models; cached = $0; no double count. Non-blocking: N1 two panel windows can lose a ledger update (carry over); N2 cache writes priced as plain input — add one sentence in settings text (batch); N3 Anthropic preset unreachable at runtime (D7, note). Reviewer: Phase D ACCEPT overall pending batched fixes.
- Sent N2 to D-impl (batch) + told it to end turn after the fix commit (30%, /compact queued). Started m3-D-test (wC:p4N, Sonnet) on d4e6e6c.
- D-impl batched fixes 8c42ae3 (E10 1-3, E6/E5 1-3, E9 sentence), check green 1152 tests. Sent to reviewer (final check) + tester (final run). D-impl ending turn for queued /compact.
- Review D round 4 (8c42ae3): ACCEPT, 0 blocking; all 7 fixes verified (PrivacyNotice.tsx:5-12,21; translator.ts:226-236,255-269; prefs.ts:38-49, App.tsx:122-132; SegmentList.tsx ~96-120; Options.tsx:476); tsc + 59 files / 1152 tests. Leftovers (a11y polish: aria-modal without inert, Copy state not announced, prefsError sticky, JSDoc order) → carry over, no action. Reviewer done for Phase D.
- D-impl compacted 31% → 0% (queued /compact ran at turn end); resumed for final report only.
- D-impl FINAL REPORT: commits f54a899, 07e1c60, a019402, d4e6e6c, 8c42ae3; check green 1152 tests; 38 files +1993/-103; DESIGN §3, §4.3.5, §8 updated. Open: no live Chrome/screenshots (→ user); notice says local options 'coming later' (M4); Haiku >100K tier + cache-write 1.25× not modelled (UI states caveat); ledger two-window race; Anthropic preset unreachable (M4). Waiting on tester.
- Reviewer closed E10 evidence gap: exact-SHA f54a899 tsc + 54 files / 1119 tests pass. All four reviewed SHAs now have exact-SHA evidence.
- TESTER D final (8c42ae3; check green 1152 tests; d4e6e6c twice green): PASS E5 (retranslate 1 request even when cached, replaces entry), E6 (switch target saves + re-translates, switch back from cache 0 requests; style → new request; retranslate page bypasses cache; failed save reverts), E9 (page readout = sum of usage; ledger accumulates across pages, persists, reset), E10 (0 provider routes before ack; denylisted + focused password → 0 requests; inject blocks chrome:// + Web Store). NOT RUN: real browser → user. Carry-over: profile pricing without cachedInPerM → NaN cost. Note: tester worktree at ~/personal/agent/ts-test-d (outside repo) — to clean up at close. GATE → user live check Phase D.

### Iter 15 — 2026-10-08 ~15:01 (no-op)
- Phase D: impl/tester/reviewer done; waiting on user's live check (gate).

### Iter 16 — 2026-10-08 ~16:02 (no-op)
- Still waiting on user's Phase D live check (2nd iteration on this gate). All peers idle.

### Iter 17 — 2026-10-08 (user live check D)
- User: "accept D". Asked scout Q5 to confirm 8c42ae3 committed + leftover worktrees.
- Scout Q5: m3 HEAD 8c42ae3; 1987d28..HEAD = f54a899, 07e1c60, a019402, d4e6e6c, 8c42ae3; tree clean except log; DESIGN §3 (75-81), §4.3.5 (447-450), §8 (797-800, 807) carry Phase D notes. Extra registered worktree ~/personal/agent/ts-test-d (clean, tester's) → tester asked to remove it.
- PHASE D ACCEPTED: tester PASS all criteria (unit + probes), reviewer ACCEPT 0 blocking (4 rounds, exact-SHA evidence on all four SHAs), user sign-off, DESIGN updated, scout confirmed commit. Closing commit 8c42ae3. Banking deferred per M3-D14.
- Carry-overs from D: notice aria-modal without inert; Copy state not announced; prefsError sticky; JSDoc order; two-window ledger race; Anthropic preset unreachable until M4 routing; Haiku >100K tier + 1.25× cache writes not modelled (UI states caveat); profile pricing without cachedInPerM → NaN cost; password detection skips closed shadow roots/iframes; notice says local options 'coming later' (M4).
- Closed m3-D-impl, m3-D-review. m3-D-test kept until it removes its worktree.
- D tester removed ~/personal/agent/ts-test-d (--force; untracked build output only); `git worktree list` = main only. Closed m3-D-test.
- Phase E (M3-E11) is human: 7-day dogfood + log + triage. Asking user how to run it.

## PAUSED STATE (resume from here) — 2026-10-08
- Phases A–D ACCEPTED. Branch `m3` @ 8c42ae3 (not merged, not pushed); master = origin/master = 46d3473. Only uncommitted file: this log. Worktrees: main only.
- No live sessions (scout and all phase sessions closed). Supervisor loop stopped (M3-D15).
- Phase E (M3-E11) is the user's: 7 days of daily use from 2026-10-08; log every time another translator was needed and why in docs/progress/dogfood-m3.md; then triage: MVP blockers fixed in M3, the rest scheduled (M4/M5).
- On resume: re-read prompt + this log; start a fresh scout; read dogfood-m3.md (via scout or user); bring the triage to the user (gate); for each MVP blocker run implementer → tester + reviewer on `m3`; then accept Phase E when §3 #8 holds ("7 days of daily use, no other translator needed; bug list triaged") and the demo script §7 runs; commit this log + dogfood-m3.md; merge m3 → master (user pushes).
- Open accepted gaps: M3-D11 speed (whole screen ~9–12 s, whole page ~95–140 s vs < ~30 s); M3-D14 banking → M4. Carry-overs listed under each phase above.

## WRAP-UP — 2026-10-08
- User asked to commit and push master now (supersedes M3-D15's "merge after Phase E"): m3 fast-forwarded into master and pushed with this log. Phase E (dogfood) stays open; it can continue on master or a new branch.
- M3-D16 (user, 2026-10-08): M3 stays OPEN until the 7-day dogfood (Phase E) is done; the user returns after 7 days and re-runs the M3 /loop to triage and close. M4 may run in parallel (its plan allows it) on an `m4` branch; the user dogfoods a `master` build; any M3 MVP blocker is fixed on master first, then m4 is rebased.

## PHASE E RESUMED — 2026-10-10 (supervisor session `m4`, pane `wC:p2J`, Opus 5.5)
- M4 is complete and fast-forwarded into master (6af810b, not pushed). M3 Phase E resumes on master.
- **User decision (2026-10-10): the 7-day human dogfood (M3-E11) is replaced by an agent QA pass** — a deviation from §3 #8 approved by the user. Report: docs/progress/dogfood-m3.md (19 content sites + 3 negative cases; 12 pass, 3 borderline, 4 fail/degraded; denylist/password rule pass; spend $0.545). Not testable by an agent: real toolbar click/Alt+T/side panel, real permission prompt, logged-in sites, the human 7-day criterion.
- **Triage (user chose "a", 2026-10-10):** MVP blockers fixed in M3:
  - B1 bad Gemini key → every block "Retry failed", no "Fix key" (Gemini answers HTTP 400 for an invalid key; errors.ts treats 400 as bad_request) — breaks §7 demo step 5.
  - B2 a failed "Retranslate page" replaces the on-screen translation with errors and deletes the cached entries.
  - B3 layout tables (Paul Graham essay → one row of 290 cells; HN comment threads → side-by-side columns) are unreadable.
  - B4 mid-article open: the job marks the visible screen done at ~2 s, but visible paragraphs finish at 7.6–9.7 s (Substack, BBC) — recheck the M3-D11 evidence.
  Later: B5 SPA navigation (M5); B6 wide table overflows the panel header, B7 raw `[link]` marker flashes while streaming; B8/B10 quality (M7); B9 Stack Overflow recheck in the user's Chrome; B11/B12 timing labels, $0 on a cancelled run.
- Work runs on branch `m3e` (worktree ../translate-side-m3e) off master 6af810b; merged into master after acceptance.
- Sessions (Phase E fixes): m3e-impl, pane wC:p5E (tab wC:t4H), implementer, **Opus 5.5** (four bugs across error classification, cache/retranslate, extraction policy and scheduling; design choices for layout-table detection and visible-first). Goal scratchpad goal-M3E-impl.md, state state-M3E-impl.md. Reviewer + tester (Sonnet) after its first commit; scout for the final commit check.
- m3e first commit 488d86d (B1: 400/422 → auth only on Google's key-invalid signal; tests in errors.test.ts and adapters.test.ts; auth latches, stops the job, "Fix key", no fallback). Started reviewer m3e-review (wC:p5F) and tester m3e-test (wC:p5G), Sonnet 5.5; goals goal-M3E-review.md / goal-M3E-test.md (common-M3E.md).
- Phase E review round 1 (488d86d, B1): PASS, no blocking. Rulings: fix the onAuthError doc (jobs.ts:~388); add a job-level "Fix key, no fallback" test for the Google 400; accept the message regex firing on any provider's 400 (specific phrases). Forwarded to m3e-impl.
- Phase E tester (488d86d): **B1 PASS** — check green 1405; built extension, bad Gemini key on MDN → "Key invalid or missing" + Fix key, 2 Gemini 400s, 0 requests elsewhere. B2–B4 and regressions pending.
- m3e 8925483 (job-level B1 test, real adapter, 0 requests to fallback) + cc8f1dd (B2: Job.earlier keeps earlier finals on screen during a fresh run; a failed block restores the earlier final with redoError and keeps its cache; finish() restores unreached blocks on stop/cancel; Retry re-runs owed blocks; 3 tests fail without the fix; onAuthError doc fixed). Review round 2 sent; tester told to test B2.
- Phase E review round 2 (cc8f1dd): 8925483 good. **1 BLOCKING (B2):** a retranslate started during a running job seeds that job's unfinished (pending-with-text) blocks as empty and ignores prev.earlier → content reverts, and a later failure drops the cache entry → fix + test. Non-blocking, ruled fix: partial-owed resume test; bar note when blocks were restored (+ confirm resume() redoing them is intended). Forwarded to m3e-impl.
- Phase E tester (cc8f1dd): **B2 PASS** for a retranslate on a finished page (bad key → Fix key, 82 finals kept, failure note; offline → finals kept; reopen/revisit 0 requests). Regressions on 488d86d pass (offline → Retry 54/54, cache 0 requests, denylist). Asked the tester to add the retranslate-during-run case on the next B2 commit.
- m3e d5b174e: B2 round-2 fixes (seeding falls back to before.earlier for unfinished blocks; tests for a second retranslate mid-run and for a partial-owed resume; JobView.kept + bar note "N blocks kept their earlier translation" with Retry; resume() redoing restored blocks intended, commented). Review round 3 sent; tester told.
- Phase E review round 3 (d5b174e): **B2 PASS**, no blocking; full suite 1412, tsc clean. Non-blocking: test for the kept decrement on single-block redo → asked; bar test with a hand-built view → accepted.
- Phase E tester (d5b174e): **B2 follow-up PASS** — retranslate during a run plus a bad key: "82 blocks kept their earlier translation · Fix key", 82 finals kept, reopen/revisit 0 requests. Flake seen: adapters.test.ts "a stream that keeps sending events… not cut" (M4 idle guard, 20 ms vs 30 ms) failed once under load → asked m3e-impl for a test-only margin fix.
- m3e c1350a1 (B3): isLayoutTable() (Readability _markDataTables on the table's own rows/cells) → layout cells become plain containers; liveTexts() maps copy text nodes to live ones (survives Readability's innerHTML retry), Range targets in viewport.ts; real pages: PG 290 table-cells → 262 p, HN 265 → 265 p; 10 existing site snapshots unchanged; fixtures layout-table-essay/thread (structural replicas, filler text, MIT); tests. Open: HN author line dropped by Readability, nesting lost (later site rule). 53c340b idle-guard test margins 300/100 ms (still fail without touch()). 48d5275 kept-decrement test. Suite 1430. Review round 4 + tester B3 sent.
- Phase E review round 4 (48d5275): **B3 PASS**, no blocking; general rule (mirrors Readability _markDataTables), data-table fixtures unchanged; HN byline/nesting loss accepted for M3 (on-page nesting kept; only the panel list is flat). Rulings: document the layout-table rule and its small-data-table consequence in S3-extraction-policy.md (fix); verify the Range zero-rect-after-replacement against B4 ordering and the "screen done" signal in the live run (fix if it distorts); liveTexts worst-case cost accepted.
- Phase E tester (48d5275): **B3 PASS** — check green 1431, no flake; PG essay 263 blocks, no table cells, panel width 1200 px (was 41,463); HN thread 272 blocks, flowing (usernames/nesting absent, accepted); PostgreSQL data table still a grid (Wikipedia blocked the automated browser); MDN 64/64 and Docusaurus 69/69 (2 transient failures healed on reopen; revisit 0 requests). Timing seen for B4: PG screen-done 4.8 s; after a jump to 70%, the 13 on-screen blocks were final within 12 s. One-off MDN panel scrollWidth 2854 right after a reopen, not reproduced (likely B6).
- ctx check (2026-10-10): supervisor 36%, m3e-impl 30% (working on B4) → checkpoint request sent (compact once idle); m3e-review 12% (idle), m3e-test 11% (idle).

### RESUME STATE (Phase E fixes) — 2026-10-10
- Sessions: m3e-impl wC:p5E (Opus; goal scratchpad/goal-M3E-impl.md, state state-M3E-impl.md) — B4 in progress, checkpoint requested, then compact + resume. m3e-review wC:p5F, m3e-test wC:p5G (Sonnet; goals goal-M3E-review/test.md, common-M3E.md). No scout yet (start one for the final commit check).
- Branch m3e (worktree ../translate-side-m3e) @ 48d5275: B1 488d86d+8925483 PASS/PASS; B2 cc8f1dd+d5b174e(+48d5275) PASS/PASS; B3 c1350a1 PASS/PASS; idle-guard test margins 53c340b. B4 pending (plus: S3 decision-record line; verify Range zero-rect after replacement vs B4 ordering and "screen done").
- After B4: review + test B4 (tester reruns regressions on the final tip, demo step 5 live), scout confirms commits, accept Phase E (user approved the agent QA as the dogfood substitute), merge m3e → master (fast-forward if master hasn't moved), commit this log + docs/progress/dogfood-m3.md, close sessions; then the user decides on M5.
- m3e-impl checkpoint: B4 part 1 b7d5c88 (screen chunk cut at both screen edges; up to 3 screen chunks skip the brief, each with its own revise pass). Live harness before the fix (Wikipedia at 40%): first visible final 3.2 s, visible finals 3.2–6.0 s, part of the screen in a second chunk waiting for the brief (21.7 s). Hypothesis: the QA's 7–10 s also includes background-tab throttling. Compacting m3e-impl.
- Phase E review round 5 (b7d5c88): logic right ("reorder pending only, never abort in-flight" holds), but untested. Rulings: tests required before B4 passes (breakBefore array, end-break incl. table-row groupId and a screen at doc end, freeChunks up to MAX_SCREEN_CHUNKS, revise count); log the cost — up to 3 revise calls per contextual page, tiny screen chunks lose context (accepted trade-off for the ~2 s target); live run must open mid-article after the viewport is reported; part 2 must make "screen done" use the same ids as the visible paragraphs (B3 Range targets), with a test. To forward after compaction.
- m3e-impl kept working past its checkpoint (/goal) to 34%; the /compact text didn't take. Sent STOP; compact once idle (a background wait for its ctx drop is running), then resume with review round 5 notes (B4 tests; "screen done" on the visible ids; live run mid-article after the viewport is reported; S3 decision-record line; Range zero-rect check). Supervisor at 38%: self-compacting soon; RESUME STATE above is current.
- m3e 334df84 (B4 part 2: revise waits until all brief-free screen chunks have started; 3 priority tests; engine 373). Live Wikipedia at 40% (unthrottled): on-screen set correct (9 segments, one 831-token chunk); first visible final 2.1–2.8 s; full visible 2.4–5.6 s (before: 3.2–6.0 s + one 21.7 s). Remaining tails = Gemini mid-stream stalls (~16 s gap; one 52 s hang caught by the idle guard). **Supervisor ruling:** no hedging in M3; accept the stall tails and record them under the accepted speed gap M3-D11 (hedging / shorter screen-chunk idle limit → later robustness work). Compacting m3e-impl (sent /compact while idle).
- Phase E review round 6 (334df84): B4 chunking half PASS (revise gate can't deadlock; tests cover multi-chunk screen, cap 3, table rows). **BLOCKING for B4:** the "screen done" signal is unchanged and untested — screenDoneAt (jobs.ts:1052, 1128) snapshots screen ids at job start and counts `failed` as done, never checks the page; explain the QA discrepancy (stale viewport at start? ids not matching the visible paragraphs?) and fix/test it. Needed: live mid-article run (Substack/BBC style, after the viewport has reported) measuring when the in-window paragraphs have translated text in the DOM next to data-screen-done (both ~2 s and agreeing; also covers the B3 Range-collapse question). Non-blocking: eval/latency.ts:122 also counts failed as screen-done → report failed separately.

### RESUME STATE (Phase E fixes) — updated 2026-10-10 (supervisor self-compacting at ~39%)
- m3e-impl wC:p5E (Opus): /compact sent while idle at 34–36%; a background wait for its ctx drop was running. NEXT ACTION: once its ctx is low, SendMessage "m3e-impl": re-read state-M3E-impl.md, then do — (1) review round 6 BLOCKING: fix + test the "screen done" signal (screenDoneAt must reflect the paragraphs actually visible, not a start snapshot counting failed); explain the QA's 2.1 s vs 7.6–9.7 s; (2) supervisor ruling: no hedging for Gemini mid-stream stalls in M3, record under M3-D11; (3) the live mid-article run (BBC/Substack, after the viewport reports; DOM-translated time vs data-screen-done; throttled run for the background-tab hypothesis); (4) eval/latency.ts report failed separately; (5) S3 decision-record layout-table line; (6) Range zero-rect check on live PG; (7) final Playwright run for B1 demo step 5, B2, B3, B4 with screenshots; pnpm run check; final report.
- m3e-review wC:p5F, m3e-test wC:p5G (Sonnet): idle; send them the next B4 commit; the tester reruns regressions on the final tip.
- Then: scout for the final commit check, accept Phase E, merge m3e → master, commit this log + dogfood-m3.md, close sessions, report to the user (M5 next).
- Iteration (post supervisor compact): ctx — supervisor 5%, m3e-impl 39% (working; its earlier /compact didn't take), m3e-review 14% (done), m3e-test 13% (working on regressions). Sent m3e-impl a checkpoint request (notify_when_idle); next: compact it, then send the round-6 NEXT ACTION above.
- Phase E tester (334df84): **B4 NOT met**. Check green (70 files, 1434 tests). Time until all on-screen blocks are final, new tip vs baseline 6af810b: ACX 3.0 vs 5.8 s; Wiki Industrial_Revolution 7.5 vs 11.0; Movable_type 7.1 (no baseline); Byzantine 17.2 vs 10.9; Roman 17.4 vs 14.4. The first on-screen block is final at 0.8–3 s; stamped screen-done is 7–9 s on Wikipedia. BBC unreachable (ERR_TIMED_OUT). Confound: the shared Gemini key is returning 429 (47/51 requests on MDN), so the live check is partly blocked. 429 handling is correct. Denylist regression passes; the offline/Retry rerun is inconclusive (429). Spend about $0.35–0.45. Ruling: hold; retest on the next B4 commit; report the 429 state before measuring.
- m3e-impl checkpoint 3:
  - New commits: b5c4280 adds the layout-table line to the S3 decision record. 4be2a5d adds `ext-run --scroll/--screen-only` with visibleFirstMs, visibleAllMs and screenDoneMs; not validated yet because Gemini returned 429s.
  - PG live: 262 paragraphs, no overflow, screen done at 5.5 s, scroll follow tracks the page. The extension never writes to the page, so the Range question is closed.
  - Cause of the QA numbers: the QA harness navigated within the same tab. The worker re-injected at load, so the job started at the top about 3.9 s before the gesture, and the gesture was ignored. The implementer calls this **B5**: a possible product bug (navigating within a tab ignores the reading position), to put to the user.
  - Fresh-tab runs: ACX at 30% scroll, visible paragraphs final at 3.5–4.6 s; Wikipedia at 40%, 2.1–5.6 s. These conflict with the tester's 7–17 s on dense Wikipedia.
  - Compact sent at about 39%, while it was idle.
- m3e-impl compacted (ctx 0%). Sent round 6: (1) BLOCKING screenDoneAt fix + tests; (2) stall ruling → M3-D11; (3) eval/latency failed separately; (4) explain the gap to the tester's 7–17 s; (5) B5 description only, user decision pending; (6) live runs after the 429s clear, ACX + Wikipedia + throttled; (7) final Playwright + check + report. Reviewer and tester holding for the next B4 commit.
- m3e-impl round 6:
  - **4583a68**:
    - screenDoneAt is now the first moment every block in the latest viewport report is final, with at least one block owed by this run.
    - It doesn't count failed blocks, or a retranslate that reverted to its earlier text.
    - It is re-checked on segment events, cache hits and setViewport.
    - 4 tests in jobs.test.ts. Check green (1437 tests).
    - latency.ts reports screenFailed separately, and a screen with a failed block gets no screenDoneMs.
  - **984007f**:
    - scripts/eval/README.md "Visible first": records the stalls under M3-D11 and the QA same-tab explanation.
    - ext-run gains --url and --throttle.
  - **M3-D11 addendum (supervisor ruling):** Gemini mid-stream stalls are not hedged in M3; they are accepted under the M3-D11 speed gap.
  - **B5 (not fixed):** in a tab that already has access, a full navigation re-injects at load, and the job starts from the screen at load time. A later scroll costs one chunk round trip (3–6 s), and Alt+T during the job does nothing. Nothing is wrong, only slower.
    - Fix (a): delay the auto-start until the first viewport report after load settles; about 30 lines.
    - Fix (b): a gesture from a different screen cancels the pending chunks and re-reads the screen; about 20 lines.
    - Neither aborts in-flight requests. The SPA half belongs to M5.
    - USER DECISION PENDING.
  - Live runs (items 4, 6, 7) are waiting: Gemini still returns 429 to a probe. The implementer re-probes every 10 minutes.
  - Sent 4583a68 and 984007f to m3e-review for round 7.
- **USER DECISION (2026-10-10): fix B5 in M3 with option (b).** A gesture on a running job, made from a different screen, cancels the chunks that haven't started and re-reads the screen; in-flight requests are never aborted. Sent to m3e-impl, along with a same-tab live run before and after.
- **Review round 7 (4583a68, 984007f): PASS, no blocking findings.** The reviewer showed the new tests fail against the old jobs.ts.
  - Non-blocking 1: the stamp is set once.
  - Non-blocking 2: the stamp and ext-run measure job and panel state, not the page DOM. **Noted here.**
  - Non-blocking 3: the same-tab explanation hasn't been reproduced on the branch.
  - **§3 #1 "~2 s" is only partly met:** fresh-tab runs show 2.1–5.6 s on Wikipedia and 3.5–4.6 s on ACX, plus the Gemini stalls. Propose accepting this under M3-D11; **the user must acknowledge it in the final log.**
  - The reviewer still needs the live Playwright run before signing off the whole set: B1 demo step 5, B2, B3 (paulgraham/HN, a real data table, the Range check after translation).
- Tester: Gemini returns 429 on every request (13/13 at 984007f). Told to wait for quota and the B5 tip; the B4 verdict must come from the tester.
- m3e-impl: **B5 committed, 7033b60 (option b)**. hooks.asked → Jobs.refocus (bumps focus when the screen differs); runner recut replaces pending elements and keeps in-flight ones; recutChunks in single-pass and contextual. Tests in priority, jobs and controller; mutation check: 2 fail with recut off. Known limit: re-cutting changes the stage output order the check stage sees. 30500a4: README note that the stamp measures panel and job state, not the DOM. Check green (1445 tests). Gemini still 429 at 19:24. Sent to m3e-review for round 8.
- **Review round 8 (30500a4 incl. 7033b60 B5): PASS, no blocking findings.**
  - Never-abort, send-once, contextual and cache: all OK.
  - Non-blocking 1: re-cut breaks page order in the check stage (check.ts:91, :106). Sent to the implementer: sort outcomes by page index, plus a test.
  - Non-blocking 2: cutAround changes only on a gesture, never on a scroll, as designed. Noted here.
  - Non-blocking 3: no jobs-level test combines cache hits with a recut (optional).
- Gemini 429 all day, probably the daily quota (reset around 14:00 +07 on 2026-10-11).
  - User first said "wait for quota". Then, told it is probably the daily quota, the user chose to **split**: functional checks run now on another key; only the B4 timings, the throttled run and the timing reconciliation wait for Gemini.
- Implementer, without quota, at 30500a4:
  - B1 demo step 5 on PG: bad key → "Key invalid or missing · Fix key" in 0.8 s.
  - B3: HN 8863 gives 113 paragraphs, no overflow. A Wikipedia population list stays a table (1434 cells).
  - Shots are in the implementer's scratchpad.
- Next, both started on another key:
  - Implementer: B2, the Range check, same-tab before/after B5, ext-run validation, plus the check-order fix.
  - Tester: B5, B2 and the regressions.
- Review of **6690291** (check-stage page-order sort + test): PASS, no findings (1446 tests). Reviewer: the B1–B5 code and tests all PASS, with no blocking findings, at 6690291. Sign-off of the whole set waits on the live evidence (B2 real page, Range check, B4 tester numbers, B5 same-tab before/after).
- Phase E tester (30500a4, APIBOX qwen3.8-flash): **B5 Alt+T PASS, B2-live PASS, regressions PASS**. Check green (1445 tests).
  - B5 on Docusaurus: with Alt+T from about 70% down, a brief-free chunk starting on screen went out after 3.7 s (2 slots were busy). The in-flight requests were not re-sent or aborted. The control with no Alt+T sent nothing from that screen in 22 s.
  - B2 on MDN: "65 blocks kept their earlier translation · Fix key". Docusaurus kept 69/69, and reopening cost 0 requests.
  - Regressions: offline then Retry reached 122/122; reopen and revisit cost 0; the denylist blocks with 0 requests; a 10 s outage self-healed.
  - The tester's same-tab run was an SPA route change, which belongs to M5. Asked for a full-navigation same-tab run (Wikipedia→Wikipedia, or a reload mid-page) at 6690291 vs pre-B5, plus a check at the tip.
- Phase E tester: **B5 full-navigation PASS at 6690291** (APIBOX). Check green (1446 tests).
  - Run: Wikipedia Printing_press → link to Movable_type, scroll to the middle, Alt+T.
  - At 6690291: the next chunk had 7 segments starting at the first on-screen paragraph and covered 6 of the 7 on-screen paragraphs.
  - Pre-B5 (984007f): the next chunk had 22 segments starting above the screen.
  - In both builds, in-flight chunks finished and were not re-sent.
- Remaining before acceptance: the B4 timings on Gemini after the reset (around 14:00 +07, 2026-10-11) from both the tester and the implementer, and the implementer's functional-run report (B2, Range, ext-run). Then reviewer sign-off on the live evidence, the user's acknowledgement of §3 #1 under M3-D11, the scout's commit check, and the merge.
- Iteration (about 20:30). Context use: supervisor 10%, m3e-impl 23% (running ext-run on APIBOX), m3e-review 19% (idle), m3e-test 22% (idle, waiting for the reset).
  - Compact sent to the reviewer.
  - Checkpoint requests sent to the tester (then compact) and the implementer (report, then compact).
- m3e-test checkpoint: B1, B2, B3, B5 and the regressions PASS; check green at 6690291; B4 waits for Gemini. Worktrees wt (6690291) and wtbase (984007f); ports 18731 and 18741. Compact sent; the B4 baseline is 6af810b.
- m3e-impl checkpoint 4 (HEAD **e6faade**). All live runs below were on AIBOX qwen3.8-flash, with shots in the implementer's scratchpad (final-*).
  - e6faade changes ext-run:
    - desktop user agent;
    - reports "no-job" when the panel can't read the page;
    - --screen-only clicks the header's Cancel (not re-run yet).
  - B2 on PG fn.html:
    - 27/27 translated, then a bad-key Retranslate: "27 blocks kept their earlier translation · Fix key", with all 27 still showing the earlier text;
    - revisit: 0 requests.
  - Range check after translation on PG: the panel follows the page at every scroll point (at 0.6 and 0.8 the panel is at its maximum scroll and the block is on screen).
  - Same-tab, PG → Movable_type, scroll 0.4, Alt+T. The times are AIBOX-specific (about 50 s per request).
    - Pre-B5: the screen was inside a 22-segment chunk; visible paragraphs final at 75–84 s.
    - After B5: a 9-segment re-cut chunk; visible paragraphs final at 46–54 s.
  - ext-run on ACX at 0.3: visibleFirst 6.3 s, visibleAll 9.6 s, screenDone 9.5 s (the stamp agrees with the panel).
  - Open: Wikipedia sends ext-run's headless browser a robot-policy 403. The implementer's own harness loads Wikipedia, so it uses that for the Wikipedia timings.
  - Waiting for the Gemini reset: the B4 timings, the throttled run, the timings on the tester's pages, the final check and the final report.
  - Compact sent; e6faade sent to the reviewer.
- **Review round 9 (e6faade): PASS.**
  - Non-blocking: ext-run.mjs:~141 breaks the poll loop on any `.state`, which also matches loading and idle. Narrow it to `[data-state=blocked]`; sent to the implementer.
  - **SIGNED OFF by the reviewer: B1, B2, B3, B5** (code at 6690291 plus the live evidence). Range caveat: at 0.6 and 0.8 the check confirms the block is on screen but doesn't test following; not blocking.
  - Remaining:
    - B4 Gemini timings and the tester's verdict;
    - the §3 #1 "~2 s" partial result, to be recorded as accepted under M3-D11 with the user's acknowledgement;
    - re-running the ext-run Cancel fix.
  - No blocking findings open.
- WAITING for the Gemini reset (around 14:00 +07, 2026-10-11). Then: tester go (probe, B4 vs 6af810b, regressions on the final tip); implementer B4 timings and final report; reviewer whole-set sign-off; user acknowledgement of §3 #1; scout commit check; accept; merge.
- m3e-impl: committed the ext-run .state narrowing as 8f2ade4 (not pushed).
- **USER DECISION (2026-10-11): "skip Gemini, make it accepted".** The B4 Gemini timings are waived. B4 is accepted on the review PASS (rounds 6–8) and the fresh-tab evidence (Wikipedia 2.1–5.6 s, ACX 3.5–4.6 s). The tester's 334df84 "not met" verdict is superseded by the user's waiver. **§3 #1 "~2 s" is only partly met; the user accepts it under M3-D11.**
  - Closing steps:
    - the implementer stops its Gemini probe and confirms a clean tree, plus a check at tip 8f2ade4;
    - the reviewer signs off 8f2ade4 (eval tooling);
    - the tester confirms the check at the final tip and cleans up;
    - a scout confirms the commits;
    - then accept and merge.
- Started **m3e-scout** wC:p5H (Sonnet 5.5) with goal-M3E-scout.md: the m3e tip, a clean tree, master..m3e, whether master can fast-forward, the 18 commits, no username or paths, no servers. Sent close-out messages to the implementer (stop the probe, check, final report), the reviewer (8f2ade4 plus whole-set sign-off) and the tester (check at the tip, cleanup).
- **Scout:** m3e tip **8f2ade4**, clean. master 6af810b is an ancestor, so master can fast-forward. All 18 commits are present and are exactly master..m3e. No username or paths in the commits. No listeners on 11434 or 1234. Two tester scratch worktrees remain (8f2ade4, 984007f); the tester is cleaning up.
- **Reviewer, final (8f2ade4): WHOLE-SET SIGN-OFF B1–B5, no blocking findings.** Product code and tests are unchanged since round 8 (1446 tests, tsc clean). Non-blocking leftovers: the ext-run Cancel click hasn't been re-run live; the Range check at 0.6/0.8 only shows maximum scroll. No scope creep: B6–B12 and M5 untouched. M3-D11 wording recorded above: §3 #1 '~2 s' is only partly met (2.1–5.6 s Wikipedia, 3.5–4.6 s ACX) and accepted by the user.
- **Tester, final (8f2ade4):** check green (70 files, 1446 tests). The first run had 2 timeouts at 30 s under load average about 30 (fixture-chunks mdn-promise-then, layout-tables HN); both pass alone and in the full rerun, so they look like load flakes (open item). Cleanup done. B1, B2, B3, B5 and the regressions PASS. B4 at 334df84 was not met; the user's waiver supersedes it.

### PHASE E — ACCEPTED (2026-10-11)
- Closing commit: **m3e 8f2ade4** (18 commits on top of master 6af810b).
- **Conditions met:**
  - The reviewer signed off the whole set B1–B5, with no blocking findings.
  - The tester confirmed B1, B2, B3, B5 and the regressions, with the check green at 8f2ade4.
  - B4's live timing criterion was waived by the user ("skip Gemini, make it accepted").
  - User sign-offs:
    - the agent QA in place of the 7-day dogfood (deviation from M3 §3 #8);
    - triage "a";
    - B5 fix (b);
    - the split for live checks;
    - the Gemini waiver;
    - §3 #1 "~2 s" partly met, accepted under M3-D11.
  - The scout confirmed the commits: clean, master can fast-forward, no username or paths.
- **Open items carried forward:**
  - B4 Gemini timings not reconciled with the tester's 7–17 s on dense Wikipedia; no throttled run.
  - The ext-run --screen-only Cancel click not re-run live.
  - ext-run gets a 403 from Wikipedia's robot policy.
  - HN item 38000000 gives 0 blocks (not investigated).
  - On HN, Readability drops the byline and the nesting (accepted).
  - Optional jobs test of cache plus recut not written.
  - Load-sensitive 30 s test timeouts: fixture-chunks, layout-tables HN.
  - QA items B6–B12 untouched (see the triage above).
  - The SPA half of B5 belongs to M5.
- **Sessions:** m3e-impl wC:p5E (Opus 5.5), m3e-review wC:p5F (Sonnet 5.5), m3e-test wC:p5G (Sonnet 5.5), m3e-scout wC:p5H (Sonnet 5.5).
- **Next:**
  - fast-forward master to 8f2ade4 (local only, not pushed);
  - commit this log and docs/progress/dogfood-m3.md on master;
  - close the sessions;
  - the user decides on M5.

## M3 FINAL STATE — all phases A–E accepted (2026-10-11)
- Closed m3e-review (wC:p5F) and m3e-test (wC:p5G). Asked m3e-impl to fast-forward master to 8f2ade4, scan the log and the QA report for username and paths, commit both on master (no push), and run the check.
