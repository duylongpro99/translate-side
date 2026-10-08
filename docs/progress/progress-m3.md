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
