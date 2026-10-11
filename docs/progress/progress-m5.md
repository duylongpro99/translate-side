# M5 progress log — Reading UX complete and robustness

Plan: docs/plans/M5-reading-ux-complete.md · Spec: DESIGN.md · Supervisor prompt: docs/prompts/implement-plan.md

## Supervisor

- Session name: `m5` · Pane: `wC:p2J` (tab `wC:t1T`) · Model: Opus 5.5
- Peers: report with `SendMessage` to `m5`; check `herdr agent get wC:p2J` first, `idle` or `done` = free.

## Phases

The plan's sub-goals A–E are the phases. The plan puts A (navigation) first as the critical path and
does not explicitly allow parallel sub-goals, so they run in order A → B → C → D → E.
§3 success-criteria rows are assigned to the phase that delivers them.

### Phase A — keep translating as the reader moves through a site
- Tasks: M5-E3 per-site host permission + re-injection on navigation; "Translate this page" fallback.
  M5-E2 SPA handling: MutationObserver + URL-change detection → re-extract; stable ids; cache serves
  unchanged segments. M5-E6 site rules UI (allowlist, never translate, local only, per-site model) on
  M4-E8 storage.
- Depends on: M3, M4 (accepted).
- Done criteria (plan §2 / §3):
  - "On an allowlisted docs site, clicking through pages keeps translating with the panel open. Sidebar text that repeats across pages comes from the cache for free. On a non-allowlisted site, the panel shows a one-click **Translate this page**."
  - "SPA route changes re-extract; only new or changed segments are translated."
  - "Settings has site rules: auto-translate allowlist, never translate, local only, per-site model."
  - §3 #1 "Browse 3 pages of an allowlisted Docusaurus site with the panel open" → "each translates without re-clicking"
  - §3 #2 "Repeated sidebar text on pages 2 and 3" → "0 tokens (usage meter)"
  - §3 #5 "Segment ids stable across SPA re-extraction" → "100% on fixture SPAs"
- Decision (§5): docs-site navigation — recommended default: allowlisting requests an optional host
  permission for that site; "auto-open" = auto-translate when the panel is already open.
  Going with the recommended default (no user override).
- Status: **ACCEPTED 2026-10-11** at m5 @ 97d8af8 (branch m5, worktree ../translate-side-m5, not merged
  to master). Review rounds: 3 (0 blocking). Test rounds: 2 (all PASS). User sign-off: "ok continue"
  (accepts the §3 #2 reading: repeated blocks never sent = 0 tokens for them; page meter still counts
  prompt + new blocks). The manual Chrome permission-prompt check was not reported back by the user —
  carried as an open human check.
- Sessions: m5-A-impl (Opus 5.5), m5-A-rev (Sonnet 5.5), m5-A-test (Sonnet 5.5) — closed.
- Starting point (scout Q1): E3 not present (optional_host_permissions wxt.config.ts:18, SITE_ALLOWLIST_KEY
  providers.ts:53-57, idempotent inject.ts:41); E2 not present (no MutationObserver/URL detection);
  E6 storage only (SiteRule providers.ts:88-94, siteRuleFor :695), no options UI.
- Criteria status: none met yet.

### Phase B — true side-by-side
- Tasks: M5-E1 hover link both ways; bidirectional scroll sync with loop guard. M5-E8 "Explain this"
  (`explain@1` via `translateSnippet`, shown as a note).
- Depends on: A (plan order).
- Done criteria:
  - "Hovering a translated paragraph highlights the original on the page, and the reverse. Scroll sync works both ways with no jitter."
  - "Each block has **Explain this** (a short note on idioms or cultural references)."
  - §3 #6 "Scroll sync loop" → "no feedback loop or jitter"
- Decision (§5): scroll sync loop guard — source-tagged scroll events with a short suppression window.
- Status: **ACCEPTED 2026-10-11** at m5 @ 3e47d43 (6 commits 8569b0e…3e47d43 on 97d8af8). Review rounds:
  5 (0 blocking). Test rounds: 2 (all PASS, incl. the real docked side panel via CDP). No user gate in plan.
- Sessions: m5-B-impl, m5-B-rev, m5-B-test (all Sonnet 5.5) — closed.
- Carry-overs: hover/sync per-frame cost linear in segments; edgeOf ancestor walk per visible rect; status
  region pre-filled edge case; no CSS Highlight fallback (min Chrome 138); shared elements ≤ one window
  tall map to the element (error ≤ one screen).

### Phase C — survive big and structured pages
- Tasks: M5-E4 lazy mode for long docs. M5-E5 tables (cell segments, rows in one chunk via `groupId`),
  captions and alt text setting.
- Depends on: B (plan order) — B accepted.
- Done criteria:
  - "A 100-screen page stays responsive: the panel translates the viewport plus ~2 screens ahead, with a **Translate the rest** button."
  - "Tables translate cell by cell with each row in one chunk. Captions and alt text are a setting."
  - §3 #3 "100-screen page" → "panel stays responsive; lazy mode keeps ahead of the reader"
- Decision (§5): long-page threshold — lazy above a segment/token threshold (start ~400 segments,
  tune on fixtures); viewport + ~2 screens ahead; "Translate the rest".
- Status: **ACCEPTED 2026-10-11** at m5 @ f976f03 (7 commits e359381…f976f03 on 3e47d43). Review rounds:
  5 (0 open). Test rounds: 2 (all PASS on the real side panel, mock provider). USER GATE 2026-10-11 ("1"):
  "keeps ahead" (§3 #3) accepted as met — fast/medium providers keep ahead at skim pace; slow providers
  (≥6 s/request, real apibox ~13 s) fall behind when skimming.
- Sessions: m5-C-impl, m5-C-rev, m5-C-test (all Sonnet 5.5) — closed.
- Carry-overs: overlap lazy rounds so both request slots stay busy (slow-provider keep-ahead); patch() O(n);
  a site whose extractor keeps a fixed scrolling aside could be unpinned; after a lazy Retranslate, redo
  makes later resumes fresh (intended); real-model end-to-end lazy run not captured (bodies not capturable).

### Phase D — never leave the reader with nothing
- Tasks: M5-E7 `chrome-builtin` Nano adapter (flagged), `MTClient` port for Translator, `basic`
  strategy, "basic translation" label, terminal fallback entry.
- Depends on: C (plan order).
- Done criteria:
  - "If every provider is down, Chrome's Translator takes over, clearly labeled "basic translation"."
  - §3 #4 "All providers down" → "`basic` Chrome Translator fallback, labeled"
- Decisions (§5): Chrome built-in shape (Nano adapter behind a flag + separate `MTClient` port used
  only by `basic`; terminal `basic` fallback entry). **Chrome built-in in v1.0: ship only if S8
  showed it reliable — user gate.** Scout Q2: S8 was never run (no docs/decisions/S8, no spike, no
  commit; ROADMAP.md:63 defines it; progress-m4.md:295/:383 ruled built-in "Coming soon" for lack of
  S8). Per plan the default is then "move to v1.1, onboarding offers two paths", which conflicts with
  phase D's done criterion. USER DECISION 2026-10-11 ("as your recommended"): option 2 — build E7 anyway as
  the last fallback, gated by availability() (plan §8 mitigation), Nano adapter behind its flag;
  phase D done criterion stands. Deviation from the S8 rule accepted by the user.
- Status: **ACCEPTED 2026-10-11** at m5 @ 662979b (7 commits b4da67b…662979b on f976f03; scout Q9: clean).
  Review rounds: 5 (0 open). Test rounds: 3 (all PASS live on Google Chrome 155.0.8059.39 loaded via CDP
  Extensions.loadUnpacked, real side panel; CfT 153 for the not-downloaded case). User gate: S8 decision (option 2).
  Supervisor rulings: read-time one-time migration adds basic to stored routings; basic = §4.2.6 degraded mode
  (not cached, plain text, no re-request); Nano behind compile-time CHROME_NANO=false.
- Sessions: m5-D-impl (Opus 5.5), m5-D-rev, m5-D-test (Sonnet 5.5) — closed.
- Carry-overs: within one non-lazy job the switch drains every pending chunk to basic, so a provider that comes
  back mid-job is not used again in that job; no download-by-gesture flow for a 'downloadable' Translator pair
  (Chrome for Testing never settles create()); Nano adapter unit-tested only (unavailable on both builds);
  basic loses inline link/code markers.

### Phase E — portable and accessible
- Tasks: M5-E9 import/export settings JSON. M5-E10 shortcuts and a11y.
- Depends on: D (plan order).
- Done criteria:
  - "Settings export/import as JSON, with keys excluded unless confirmed."
  - "`Alt+T` toggles the panel; panel shortcuts and basic a11y (focus order, ARIA on segments)."
  - §3 #7 "Exported JSON contains no keys unless "include keys" confirmed" → "yes"
  - §3 #8 "Keyboard-only use of panel actions" → "possible"
- Status: **ACCEPTED 2026-10-11** at m5 @ 0874be5 (8 commits 6871255…0874be5 on 662979b; scout Q11: clean).
  Review rounds: 4 (0 open; B1 key-redirect fixed). Test rounds: 4 (all criteria PASS, Chrome 155; axe 0
  violations). User gate: Alt+T toggle = option D (fallback A), min Chrome 138, D11 superseded. HUMAN CHECK
  (user, Chrome 155, key rebound Alt+Shift+T because Alt+T was taken by another extension): toggle opens and
  closes immediately; assigned shortcut shown.
- Sessions: m5-E-impl, m5-E-rev, m5-E-test (all Sonnet 5.5) — closed.
- Carry-overs: Chrome 138–140 window.close() fallback unverified (NB2); rapid-press (NB1) and toolbar-icon toggle
  not observed by a human; system clock jump edge (NB6); panel Change-key button no failure feedback (NB7);
  adjacent ul/ol merge into one list (NB3); orphan secret edge (NB5); screen-reader speech not tested; dark-mode
  contrast flagged by axe (likely false positive) needs a visual look; identical redacted from/to when only a key
  param differs; fuzz.test.ts timed out once under heavy load (watch for flakiness).

## Not delegated / tracked
- Plan §6: "Start M6 store assets and docs (M6-E1/E8) in parallel during this milestone." That is M6
  plan work, outside this supervisor's plan file — flagged to the user, not started.
- Demo script (§7) is a milestone demo; the tester covers each step in its phase.
- HUMAN CHECK (phase E): press Alt+T and the toolbar icon twice in a real Chrome on the m5 build — panel opens,
  then closes (toggle option D). Pending until E's toggle commit lands.

## Sessions

| Name | Pane | Role | Phase | Model | Status |
|---|---|---|---|---|---|
| m5-scout | wC:p5J (tab wC:t4M) | Scout | all | Sonnet 5.5 | closed (Q1–Q12 answered) |
| m5-A-rev | wC:p5M | Reviewer | A | Sonnet 5.5 | closed |
| m5-A-test | wC:p5N | Tester | A | Sonnet 5.5 | closed (worktrees removed) |
| m5-A-impl | wC:p5K | Implementer | A | Opus 5.5 — phase cuts across SW/content/options/cache and carries the docs-navigation design decision | closed |
| m5-B-impl | wC:p5P | Implementer | B | Sonnet 5.5 | closed |
| m5-B-rev | wC:p5Q | Reviewer | B | Sonnet 5.5 | closed |
| m5-B-test | wC:p5R | Tester | B | Sonnet 5.5 | closed (worktree removed) |
| m5-C-impl | wC:p5S (tab wC:t4V) | Implementer | C | Sonnet 5.5 | closed |
| m5-C-rev | wC:p5T (tab wC:t4W) | Reviewer | C | Sonnet 5.5 | closed |
| m5-C-test | wC:p5V (tab wC:t4X) | Tester | C | Sonnet 5.5 | closed (worktree removed) |
| m5-D-impl | wC:p5X (tab wC:t4Z) | Implementer | D | Opus 5.5 — cuts across adapter registry, engine strategies, fallback chain and panel UI, and carries the S8/availability design decision | closed (compacted twice) |
| m5-D-rev | wC:p5Y (tab wC:t40) | Reviewer | D | Sonnet 5.5 | closed (wt-D removed) |
| m5-D-test | wC:p5Z (tab wC:t51) | Tester | D | Sonnet 5.5 | closed (worktrees removed) |
| m5-E-impl | wC:p50 (tab wC:t52) | Implementer | E | Sonnet 5.5 | closed (compacted once) |
| m5-E-rev | wC:p61 (tab wC:t53) | Reviewer | E | Sonnet 5.5 | closed (wt-E removed) |
| m5-E-test | wC:p62 (tab wC:t54) | Tester | E | Sonnet 5.5 | closed (wt-E-test removed) |

## Iterations

### 2026-10-11 — iteration 1 (setup)
- ctx: m5 8%.
- Log created. Scout m5-scout started (Sonnet 5.5), goal file in scratchpad goal-scout.md.
- Q1 to scout: git state (gitStatus showed detached HEAD at 60a8e5a) + which M5 tasks already exist.
- Next: on Q1 answer, ask scout for S8's Chrome built-in finding (phase D gate), then start phase A implementer.

- Scout Q1 answer: git on master = origin/master = 60a8e5a, clean (only untracked progress-m5.md), one
  worktree; branches m1, m3e, m4, master. M5 tasks: none implemented; partial groundwork E5 (table-cell
  groupId segmenter.ts:97-100, caption :103-105, img ignored :35), E7 stubs (client.ts:52 throws,
  BASIC_FALLBACK providers.ts:751), E10 (Alt+T _execute_action wxt.config.ts:22-30), E1 one-way follow
  (follow.ts), E8 translateSnippet exists (engine.ts:88) but no explain@1, E4/E9 absent.
- Started phase A implementer m5-A-impl (Opus 5.5; why: cross-cutting + design decision). Goal file
  scratchpad/goal-A-impl.md, state file scratchpad/state-A-impl.md.
- Q2 to scout: S8 conclusion on Chrome built-in (phase D gate).
- Scout Q2 answer: S8 never run; no result on record (see phase D). Question put to the user.
- User decision: phase D builds E7 without S8, gated by availability() (supervisor's recommendation).

### 2026-10-11 — iteration 2
- ctx: m5 11%, m5-scout 8% (done/idle), m5-A-impl 19% (working, ~9 min into a test run).
- A-impl state file: design drafted (trigger gesture/navigation; auto-translate only on allowlisted +
  permission; "Translate this page" + "Always translate on this site"; MutationObserver debounced
  ~500 ms with id remap by (kind,text); options Site rules). Its interpretation "Never translate" =
  user denylist (D23) — to be checked in its report/review. No commits yet.
- Criteria A: none met yet. No drift.
- Next: checkpoint warning when A-impl ≥20%; checkpoint+compact at ≥25%.

### 2026-10-11 — iteration 3
- ctx: m5 11%, m5-scout 8%, m5-A-impl 27% → checkpoint request sent (subscribed to its idle notice);
  compact it once idle.
- A-impl has a first commit (E3). Q3 to scout to confirm commits/diff before starting tester+reviewer.
- Supervisor slip: ran one `git log` in the worktree myself this iteration; from now on commit facts
  come from the scout only.
- Scout Q3: m5 has 1 commit 5d233f1 "M5-E3: per-site allowlist with host permission, navigation reads
  wait for "Translate this page"" (22 files, +1178/-52; sites.ts, translator.ts, OfferBar.tsx, tests).
  Worktree dirty with E2 WIP (watch.ts, stable.ts, fixtures/spa/). No E2/E6 commit yet.
- Started reviewer m5-A-rev (Sonnet 5.5) on committed E3. Tester to start when E2 lands (criteria
  #1/#4/#5 need SPA handling; Docusaurus is an SPA).
- A-impl checkpoint 1: 5d233f1 E3 (+ panel side of SPA `changed`), 36279fb E2 (MutationObserver + URL
  watch, keepIds, fixtures/spa/{docusaurus,mkdocs,gitbook}.html). vitest 1504 pass, typecheck+lint clean;
  spa.test 100% unchanged ids kept (§3 #5, unit); translator.nav.test page 2 sends only new block (§3 #2,
  unit). Open: failing uncommitted content.test `changed` case; E6; live run; permissions list.
- Compacted A-impl at 28% (→ ~0%), resumed with rulings: (1) never translate = D23 user denylist —
  provisionally accepted (DESIGN §7/§8), reviewer to judge; (2) SPA route change on non-allowlisted site
  waits for Translate this page — accepted (DESIGN §8, plan §2).
- Started tester m5-A-test (Sonnet 5.5). Told reviewer about 36279fb.
- Review round 1 (m5-A-rev, 5d233f1+36279fb): 0 blocking, 9 non-blocking (N1 siteNever/allowlist
  changes not enforced live; N2 orphan host grant if addAllowlisted throws, MAX_SITES vs 8 KB; N3
  non-allowlisted SPA route change re-offers Translate — accepted, needs cache test; N4 never=D23 agreed;
  N5 no e2e for 3-page click-through (tester live run); N6 content.ts read()/reread() untested; N7
  navigatesuccess may miss plain pushState; N8 chrome filter vs sidebar + non-ok reread leaves stale
  translation; N9 shared `last` across ports). Forwarded verbatim to A-impl with instruction (N1 in E6,
  fix N2/N6/N7/N8b, N3 test, N9 optional).
- Supervisor ruling N3: a docs SPA that is NOT allowlisted re-offers "Translate this page" after each
  route change (DESIGN §8 never auto-translate; plan §2 non-allowlisted → offer). Allowlisted SPA
  translates each route automatically. Recorded here as the plan reading.

### 2026-10-11 — iteration 4
- ctx: m5 14%, scout 9% (idle), A-impl 14% (working on review fixes + E6), A-rev 10% (idle, waits for
  next round), A-test 9% (working).
- A-test state: static checks green at 36279fb (1504 tests, build+manifest OK). Live driver (playwright,
  Chrome for Testing; host permission baked into manifest copy to stand in for the prompt — the real
  prompt click is a human check). Docusaurus fixture, 3 SPA routes allowlisted: each auto-translates
  9/9; pages 2–3 send only 4 of 9 blocks (5 cached). Gemini key quota exhausted → uses apibox provider.
- Criteria A: #5 unit-level pass (impl); #1/#2 fixture-level pass (tester, in progress); #3 (E6) not
  started; real permission prompt = needs user.

### 2026-10-11 — iteration 5
- ctx: m5 14%, scout 9%, A-impl 19% (working), A-rev 10% (idle), A-test 12% (working).
- A-impl state: review fixes committed — c873703+4619e77 N2, 7dcb8cd N8, 22f5e1f N3 test, b575391 N1,
  fe245c2 N6 content tests; E6 committed 7fbf57c (Options SitesSection + SiteModelRules). pnpm check
  passed at 7fbf57c. Still: content test fix, live run + screenshots, permissions list, report.
- A-test still on 36279fb live run. Reviewer round 2 waits for A-impl's report (then E6 + fixes).
- Next: warn A-impl at ≥20%.
- Tester report round 1 (m5 @ 36279fb, Playwright + Chrome for Testing, apibox qwen3.8-flash):
  (1) PASS — allowlisted fixtures (Docusaurus/MkDocs/GitBook, SPA + full nav + back) and real
  docusaurus.io p1 99/99 → /docs/installation 69/69 with no click; non-allowlisted shows offer bar, 0 sent
  until click; never-translate nothing read/sent. NOT RUN: real Chrome permission prompt (human), revoked
  permission. (2) PASS — only new segments sent (fixture 4 of 9; real site 0 repeats). (3) NOT RUN (E6
  not landed). (4) PASS (fixtures 3 pages; real site 2 pages). (5) PASS on fixtures, with note: meter shows
  new segments + fixed prompt per page (p2 864 in vs p1 994), repeated blocks are never sent; real
  docusaurus.io sidebar is not extracted (nav dropped), so it has no sidebar repeats to measure. (6) PASS
  unit (spa/watch tests). Observation: real site first chunk sent twice per page — asked tester to
  compare master vs m5 to tell pre-existing from regression.
- Open for user at phase A gate: real permission prompt check (human); §3 #2 reading (repeated text costs 0
  because never sent; page meter still counts prompt overhead; real sidebar is not extracted at all).
- A-impl report (phase A ready for test/review), head 0a42c90: fe245c2 N6, c873703+4619e77 N2,
  7dcb8cd N8, 22f5e1f N3 test, b575391 N1, 7fbf57c E6 (Options › Site rules: allowlist + never translate;
  Providers › Routing › Model per site, local-only warning), 0a42c90 (http-only allowlisted = accessible).
  vitest 1518 pass @0a42c90; pnpm check pass @7fbf57c. Live (fixtures, apibox): A1–A4 allowlisted pages
  auto-translate, p2/p3 only 4 new blocks sent (864 in vs 994); B1–B4 non-allowlisted offer, cache-served
  click, never-translate stops sending. N7: Chrome fires navigatesuccess + currententrychange for plain
  pushState, no change. N9 not done (optional). Known limits: shadow-root mutations not observed;
  sidebars (aside) not extracted; un-never'd page stays blocked until next gesture.
  Permissions used (plan §9): no new manifest permissions; per-site optional host (both schemes) on
  allowlisting, released on removal/never unless still needed; scripting from worker and panel.
  Evidence: other session scratchpad 1b6c51dc…/scratchpad/m5-live/.
- N3 record (requested): non-allowlisted SPA route change holds with the offer; the click after the
  offer serves repeated blocks from the cache (22f5e1f test; live B3/B3b 0 requests).
- Review round 2 sent to A-rev (master..0a42c90); test round 2 sent to A-test (after dup-chunk check).
- Compacted A-impl at 22% (idle) → 0%; resumed and told to wait for round-2 findings.

### 2026-10-11 — iteration 6
- ctx: m5 16%, scout 9%, A-impl 6% (idle), A-rev 13% (idle), A-test 13% (working: dup-chunk check, then round 2).
- Review round 2 (A-rev, master..0a42c90): 0 blocking. N1/N2/N3/N6/N8 resolved, N7 accepted, N9 skipped.
  Criterion (3) met (Site rules allowlist + never; Model per site + Local only on siteRules; fallback
  filters non-local under localOnly providers.ts:797). New non-blocking: R1 local-only rule with cloud
  primary still sends (providers.ts:733-735); R2 add form defaults local-only rule to cloud model; R3
  Options access display either-scheme vs exact-scheme check; R4 known limits; R5 = N5 e2e.
- Supervisor rulings: fix R1 (fail closed, test), R2, R3; R4 carry-over; R5 via tester live run.
  Forwarded verbatim to A-impl.
- Carry-overs (phase A): shadow-root mutations not observed (web-component docs sites won't re-extract on
  route change); removing a site from "never translate" leaves an already-blocked page blocked until the
  next gesture; N9 `last` shared across ports (two panel connections).
- A-impl: R1+R2 fixed 9d32268 (local-only rule with non-local model fails closed incl. analyze/review;
  form never saves cloud+local-only), R3 fixed 97d8af8 (per-scheme access display). pnpm check pass,
  1520 tests. Review round 3 (0a42c90..97d8af8) sent to A-rev. Tester round 2 still running (will need
  to include 9d32268/97d8af8).
- Review round 3 (A-rev, 0a42c90..97d8af8): R1/R2/R3 resolved, no new findings. Reviewer: phase A has no
  open blocking findings; only N5 (live e2e, tester) and accepted known limits remain.
- Tester round 2 (m5 @ 97d8af8): ALL PASS. Static green (1520 tests). (3) Options site rules PASS
  (allowlist/never add-remove, allow→never move, per-site model rule, local-only switches to local model,
  cloud on local-only refused). Per-site model actually used PASS (mock got the request, default 0).
  Local-only fail-closed PASS (0 requests). Local-only never falls back to cloud PASS (controlled
  comparison: with localOnly cloud 0 requests; without, falls back). N1 PASS, N8 PASS. Re-run (1)(2)(4)
  PASS on fixtures + real docusaurus.io; (5) same caveat. NOT RUN (human): real Chrome permission prompt,
  permission-revoked behaviour; per-scheme access text not exercised.
- Duplicate first chunk: PRE-EXISTING on master 60a8e5a (9/9 runs same) — speculative first chunk sent
  with empty glossary, re-sent once the brief/glossary arrives. Not an M5 regression → carry-over
  (cost: first chunk paid twice when the brief adds glossary terms).
- Q4 to scout: confirm m5 head 97d8af8 committed + clean.
- Scout Q4: m5 head 97d8af8, worktree clean, 12 commits master..m5 (5d233f1 … 97d8af8). Tester worktrees
  wt-head/wt-m5/wt-master in scratchpad (remove on tester close).
- PHASE A GATE — waiting for user: (1) manual Chrome permission-prompt check on m5 build; (2) ruling on
  §3 #2 "0 tokens (usage meter)" reading (supervisor recommends: met — repeated blocks never sent).
  Phase B start waits on the gate.

### 2026-10-11 — phase A accepted
- User: "ok continue" → phase A accepted (criteria 1,2,4,5,6 tested PASS; 3 PASS round 2; reviewer 0
  blocking; scout confirmed 97d8af8 committed, clean). Open human item: real permission prompt check.
- Plan §9 handoff recorded for A: SPA/navigation fixtures fixtures/spa/{docusaurus,mkdocs,gitbook}.html;
  permissions used (no new manifest permissions; per-site optional host both schemes; scripting from
  worker and panel).
- Carry-overs: pre-existing first-chunk double send (speculative chunk redone after glossary); shadow-root
  mutations unobserved; un-never'd page stays blocked until gesture; N9 shared `last`.
- Closing A sessions (tester removes its worktrees first). Starting phase B on branch m5.
- Started m5-B-impl (Sonnet 5.5: two contained tasks, the loop-guard design is fixed by plan §5). Goal hit
  the 4000-char /goal limit — starting point sent as a follow-up message. Keep goals < 4000 chars.

### 2026-10-11 — iteration 7
- ctx: m5 19%, scout 9%, B-impl 18% (working).
- B-impl state: E8 committed (explain@1 prompt/stage/strategy; Jobs.explainSegment; button + note; tests;
  1531 green). E1 next (hover both ways; panel→page scroll sync with source tag + suppression, rAF).
- Started reviewer m5-B-rev (Sonnet 5.5) on E8. Tester starts when E1 lands.
- Review round 1 (B-rev, E8 8569b0e): 0 blocking; non-blocking 1 no Continue-anyway after spend limit
  (M4-E10 parity), 2 fallbackProfiles not set (usage priced wrong), 3 aria-live per delta, 4 max_tokens
  fails the note (design choice). Forwarded to B-impl: fix 1–3, 4 justify or keep text. Reviewer had
  checked out 8569b0e in the impl worktree (restored) — told to use its own worktree.
- E1 committed cde1dc0 → review round 2 started; tester to start now. B-impl at 20% → warning sent.
- Started tester m5-B-test (Sonnet 5.5). Long /goal pastes arrived truncated ("nd stay idle." only) —
  fixed by a short /goal pointing to scratchpad/goal-B-test.md. Use that pattern for later goals.
- Review round 2 (B-rev, E1 cde1dc0): 0 blocking. Loop guard source-tagged 250 ms both sides, id+offset
  mapping per rAF, hover via class + CSS Custom Highlight (no loop). Non-blocking: 1 shared-element
  segments map to element (wrong hover/scroll on Readability pages), 2 inner scroll pane offset, 3 last
  panel scroll inside window dropped (no trailing re-check), 4 <style> leak / SPA head replace, 5 manual
  seg--linked class wiped by re-render, 6 no CSS.highlights fallback, 7 NaN offset, 8 O(n) per hover frame.
  Forwarded: fix 1–5,7,8; 6 optional (Chrome 114+ floor) but verify isolated-world highlights live.
- ctx: B-impl 22%.

### 2026-10-11 — iteration 8
- ctx: m5 21%, scout 9%, B-impl 23% (working on E1 R2 fixes; E8 R1 fixes committed), B-rev 10% (idle),
  B-test 10% (working).
- Criteria B: none confirmed yet (tester running). Next: checkpoint B-impl at ≥25%.
- Test round 1 (B-test, cde1dc0): ALL PASS. Static green (1553). Hover both ways PASS; scroll sync both
  ways, no jitter (§3 #6) PASS — single wheel each side moves once, 0 reversals, settles ~230 ms; 20-step
  wheel 0 reversals; 3 s idle 0 moves; toggle works. Explain PASS on 46/46 blocks; idioms correctly
  explained; note text-only. Note: near-simultaneous scrolls drop the panel's within the 250 ms window
  (review finding 3 addresses). Round 2 after fixes: add Readability-path page + inner scroll pane.
- B-impl report: 4 commits on 97d8af8 — 8569b0e E8, cde1dc0 E1, 33b45d9 E8 R1 fixes (Continue anyway,
  fallbackProfiles, aria-hidden until whole, max_tokens keeps cut note + ellipsis), 4d34e5b E1 R2 fixes
  (1,2,3,4,5,7,8; 6 not done — Chrome 114+). vitest 1560 green. Live (apibox) all PASS incl. a
  Readability-style page (within one block). Open: real side panel UI not used (panel ran as a tab) —
  both impl and tester; no live spend-limit/fallback for Explain.
- Review round 3 sent (cde1dc0..4d34e5b). Test round 2 sent (4d34e5b + Readability page, inner pane,
  trailing resend, Continue anyway, and attempt the REAL side panel; else flag for user).
- Compacted B-impl at 24% (idle) and told to wait.
- Review round 3 (B-rev, 33b45d9+4d34e5b): 0 blocking; E8 1–4 resolved; E1 1,2,3,4,5,7 resolved, 8 partly
  (linear per hover frame, accepted), 6 moot (minimum_chrome_version 138). New non-blocking: A Explain
  note no longer announced to screen readers; B inner-pane anchor offset mismatch vs viewport.ts.
  Forwarded A+B to B-impl to fix.

### 2026-10-11 — iteration 9
- ctx: m5 22%, scout 9%, B-impl 5% (fixing A/B), B-rev 12% (idle), B-test 12% (round 2 running).
- Criteria B: (1)(2)(3) PASS in round 1 at cde1dc0 with panel-as-tab; round 2 on fixes + real side panel
  pending. No drift.
- B-impl: A+B fixed 3f317a9 (1561 tests). Review round 4 sent; tester told head is 3f317a9.
- Review round 4 (B-rev, 3f317a9): A, B resolved; 0 blocking. New non-blocking: 1 viewport anchor picked
  by window top vs pane edge (fix requested), 2 edgeOf ancestor walk per read (carry-over), 3 status
  region mounted pre-filled may be skipped (theoretical; carry-over).
- B-impl: R4 item 1 fixed 3e47d43 (1562 tests). Review round 5 sent; tester told head 3e47d43.
- Review round 5 (B-rev, 3e47d43): resolved; 0 open findings for phase B. Nit: edgeOf per visible rect (carry-over, ignorable).
- Test round 2 (B-test, 3e47d43): ALL PASS. Static green (1561). REAL side panel driven (sidePanel.open
  via CDP userGesture from an extension page; docked 360px panel beside page): hover both ways, wheel sync
  top block equal every time. Hover/sync/no-jitter PASS; dropped-scroll resend now ends in sync;
  Readability-path shared container PASS (highlight only the paragraph); inner scroll pane PASS; Explain
  PASS (idioms, text only); Continue anyway after spend limit PASS (0 requests until click). Caveat: input
  via CDP events, not toolbar click/Alt+T or physical device.
- Q5 to scout: confirm 3e47d43 committed + clean.

### 2026-10-11 — phase B accepted
- Scout Q5: m5 head 3e47d43, clean; 6 phase-B commits. Phase B accepted (tester all PASS, reviewer 0 open,
  no user gate). Closing B sessions; tester removes wt-B-test first. Starting phase C.
- Started m5-C-impl (Sonnet 5.5; plan doesn't mark C heavy). Short /goal → goal-C-impl.md.

### 2026-10-11 — iteration 10
- ctx: m5 24%, scout 10%, C-impl 19%.
- C-impl commit 1: lazy mode in jobs.ts (LAZY_SEGMENTS=400 start, translateRest, JobBar button), alt
  segments (Segment.alt), prefs captions/altText + options UI. Remaining: fixtures (100-screen, large
  table), live measurement + threshold tuning, report. Told it not to write progress-m5.md.
- Started reviewer m5-C-rev and tester m5-C-test (Sonnet 5.5) on committed work.
- Review round 1 (C-rev, e359381): 1 BLOCKING — "Translate the rest" button only set in finish(), absent
  while running and on resumed rounds (criterion 1). Non-blocking: 2 LAZY_SEGMENTS comment cites
  progress-m5.md, no fixture evidence; 3 no row/alt chunker test or table fixture; 4 lazy brief built from
  window only and not cached (§5.7 Step 1); 5 alt/captions privacy correct. Ruling: fix 1, 2, 3; 4 make
  analyze input match non-lazy (whole outline + first ~1,500 tokens) and cache, or escalate; 5 none.

### 2026-10-11 — iteration 11
- ctx: m5 26%, scout 10%, C-impl 22% (warning sent), C-rev 8% (idle), C-test 9% (working; static green at
  e359381, 1580 tests; live next).
- C-impl: commit 2 = review R1 fixes 1–4. Live run 1 on long page: first round 64 s (slow provider, 5
  requests); fast scroll left blocks untranslated; catch-up 19.8 s. Working on dropping stale pending
  chunks on scroll-away + realistic-scroll measurement. Criterion (1)/(3) "keeps ahead" at risk — watch.

### 2026-10-11 — iteration 12
- ctx: m5 26%, scout 10%, C-impl 22% (done; bg live run 2), C-rev 8% (idle), C-test 10% (working).
- C-impl commits: e359381 (E4+E5), 92f5e27 (R1 fixes: view.lazy from start, briefFrom, threshold comment,
  fixtures/long + README + long.test, chunker alt-row test), 18faf00 (drop stale pending chunks on scroll
  away; in-flight never aborted). Live run 1: 767 segs/94.7 screens, first visible 868 ms, panel long
  tasks max 87 ms; slow provider ~13 s/request.
- C-test (mock provider, REAL side panel, e359381-era): start round + "Translate the rest" PASS;
  responsiveness PASS (0 page long tasks, frames ≤17 ms); keeping ahead depends on latency: 1.2 s/request
  + reader 1 screen/2 s → 100% viewport translated; 3 s/request → 80%; faster readers drop sharply.
  Hypothesis: rounds serial, ~1 chunk per round, concurrency 2 unused. Awaiting its full report + real
  apibox run. Possible criterion (1)/(3) gap → forward to impl when reported.
- C-impl report (e359381, 92f5e27, 18faf00): R1 1–4 fixed (button from start; threshold evidence in
  fixtures/long/README.md; table fixture 121 rows each one chunk; lazy brief from whole page, cached).
  Threshold LAZY_SEGMENTS=400, window = screen + 2 ahead, min 24 blocks. Fixtures long-100-screens (767
  segs, 94.7 screens), large-table (609 segs). Live apibox (~13 s/request): reading pace 800 px/4 s → ahead
  for ~6 steps then behind (11/14 samples untranslated in view); long tasks max 156 ms; Translate the
  rest 722 segs in 585 s, $0.0118. Table rows coherent. Open: alt live run; Retranslate on lazy page only
  redoes window; Options checkbox tests; full suite not re-run after 18faf00.
- Ruling: criterion (1)/(3) "keeps ahead" not yet shown. Asked C-impl to use full concurrency / pipeline
  lazy rounds, re-measure (apibox + 3 s mock), fix Retranslate-on-lazy (outside → waiting, in rest),
  alt live run + options test, full suite. If a 13 s/request model still can't keep up → user trade-off.
- Review round 2 (C-rev, 92f5e27+18faf00): R1 1–4 resolved; engine boundary OK; drop logic no loss/dup.
  Findings: 1 lazy window / within filter can split a table row across rounds (breaks criterion 2 on lazy
  table pages) → fix requested; 2 patch() O(n) per event → carry-over.

### 2026-10-11 — iteration 13
- ctx: m5 28%, scout 10%, C-impl 25% → compacted (idle) → 0%, resumed; C-rev 10% (idle); C-test 13%.
- C-impl commit 4: window ≥3000 tokens + low-water reach, row-aligned window (review finding 1), lazy
  retranslate waits, Options test; alt live: alt sent only with setting on (3 vs 0 requests).
- C-test notes (pre-report): FINDING 2 button absent while running (fixed in 92f5e27); options checkboxes
  PASS; RFC 9110 (214 screens, 3387 segs) responsiveness PASS (long tasks ≤111 ms); FINDING 3 big: after a
  fast scroll the lazy window doesn't hold — job walks the page from the top, button never shows
  (hypothesis: fixed/sticky element in on-screen set). Forwarded as a heads-up to C-impl.
- C-impl report (head ad257f4): c71be56 (window ≥3000 tokens, low-water reach, row-aligned window, lazy
  Retranslate, Options test), ad257f4 (cluster on-screen blocks — sticky header fix; test; RFC 9110 not
  re-run). Reading pace apibox ~13 s/request: ahead for ~6 screens then 0; 11/14 samples untranslated in
  view; panel long tasks max 180 ms. NOT done: pipelining (one Job = one engine run), mock 3 s run.
  Alt live PASS; row-aligned window test; pnpm check green at ad257f4 (1590 tests).
- Sent tester round 2 (RFC 9110 re-run; mock latency sweep 1.2/3/6 s at 2 and 4 s/screen; in-flight count;
  table rows; lazy Retranslate). Sent reviewer round 3 (c71be56, ad257f4; is a lazy round serial?).
- Likely user decision: keep-ahead criterion vs slow provider — wait for the sweep numbers.
- Review round 3 (C-rev, c71be56+ad257f4, code read): row split resolved; no stranding. Confirmed rounds
  are strictly serial (pipeline bubble at each round end); within a round ≤2 chunks in flight
  (maxConcurrency). Findings: 1 a fixed TOC bigger than the reader's cluster wins → never keeps ahead on
  such pages; 2 lazy Retranslate may serve OLD cached translation for far blocks (fresh flag lost).
  Forwarded: fix both (prefer flagging fixed/sticky in content script); pipelining waits for sweep.
- Test round 1 (C-test, e359381): (1) PARTIAL — responsive PASS (real side panel; RFC 9110 too), first round
  + button text PASS, threshold 386 whole / 417 lazy, Translate the rest 650/650 once; keep-ahead mock
  1.2 s/request: 1 screen/2 s 100%, 1 screen/1 s 98.8%, 2 screens/s 13%; 3 s/request: 1 screen/2 s 80%,
  1 screen/1 s 21%; after first round ONE request at a time. Findings F1 page already scrolled at start →
  first round from top (wasted) → forwarded; F2 button (fixed 92f5e27); F3 RFC 9110 walk from top
  (ad257f4 targets). (2) Tables/captions/alt PASS (60/200/400 rows, no split; settings correct).
  (3) responsive PASS, keeps ahead only at fast provider + 1 screen/2 s.
- C-impl: 0acaf90 (fixed/sticky flagged at source; Job.redo for lazy Retranslate; pre-scrolled start test). pnpm check green, 1594 tests. Not run live. Tester round 2 → 0acaf90; reviewer round 4 sent. ctx C-impl ctx:10%.
- Review round 4 (C-rev, 0acaf90): round-3 1, 2 resolved. Findings: 1 isPinned marks every block under a
  fixed app-shell scroller as pinned (breaks phase-B scroll follow + lazy follow) and unstuck sticky
  th/headings — fix before anything else; 2 getComputedStyle walk per read, cache per ancestor; 3 redo lost
  on an `all` run. Forwarded: fix 1–3 with tests + app-shell fixture. Tester told to add an app-shell page.
- C-impl: f976f03 (pin rule: no pin for scroll-container/≥80% fixed boxes, sticky only when stuck, all-pinned fallback; ancestor cache; redo through all runs). pnpm check green, 1599 tests. Review round 5 sent; tester → f976f03.
- Review round 5 (C-rev, f976f03): round-4 1–3 resolved; new: 1 overflow exemption may unpin a narrow fixed docs sidebar (mdBook) → asked C-impl to check live on the Rust book, fix only if sidebar blocks are extracted; 2 no change; redo makes later resumes fresh (confirm intended).
- C-impl: Rust book live (f976f03) — sidebar not extracted (nav dropped), 0 sidebar segments; no change to pins(). redo-resume-fresh confirmed intended. Head stays f976f03. Ruling: no hardening; carry-over 'a site whose extractor keeps a fixed scrolling aside'. Waiting for tester round 2.
- Tester notes on 0acaf90: F1 pre-scrolled start still translates from the top (long page @30000px, table @3000px) → forwarded to C-impl to reproduce with tester's drivers and fix. Also tester on ad257f4: RFC fast scroll window holds, button visible, max 2 in flight; Translate the rest 3387/3387 in 98 s (mock).
- C-impl on F1: driver artifact (panel opened at scroll 0, then scroll + re-inject = second job). With scroll before panel open (c2pre/c5pre): first chunk at the viewport (257-264; table rows 47-130). Analyze reads page start by design. No code change; head f976f03. Tester asked to re-run F1 its own way.

### 2026-10-11 — iteration 14
- ctx: m5 32%, scout 10%, C-impl 17% (idle), C-rev 16% (idle), C-test 16% (working on f976f03).
- Tester sweep on 0acaf90 (mock, 800 px per step; % samples viewport fully translated / min ahead):
  1.2 s/request: 4 s/screen 100%/5, 2 s/screen 100%/5; 3 s: 4 s 100%/5, 2 s 85%/-2; 6 s: 4 s 87.5%/-1,
  2 s 16%/-145. Button visible 100%. Max 2 in flight after first round. F1 REFUTED on f976f03 (driver
  artifact, implementer right). Remaining: app-shell page, RFC, retranslate on f976f03 → final report.
- Pending user decision once report lands: is "keeps ahead" met (fast/medium providers at skim pace yes;
  ~13 s/request apibox no) or do we add overlapping rounds?
- Test round 2 (C-test, f976f03, real side panel, mock): all items PASS. RFC 9110 fast scroll window holds,
  button always visible; Translate the rest 3387/3387 in 98 s. Sweep (viewport fully translated %): 1.2 s:
  100/100 (4 s, 2 s per screen); 3 s: 100/85; 6 s: 87.5/16. In flight ≤2; later rounds 1 chunk at 1.2 s.
  Tables no split (200/400 rows, pre-scrolled too); lazy Retranslate fresh + rest OK; F1 refuted; F2 gone;
  app-shell page follows + scroll sync OK; fixed-TOC page holds. NOT RUN: real model end-to-end (bodies
  not capturable; real ~13 s/request falls behind).
- Reviewer: 0 open findings after round 5. Q6 to scout (commit check). Then PHASE C GATE to user:
  "keeps ahead" with slow providers.
- Scout Q6: m5 head f976f03, clean; 7 phase-C commits (e359381 … f976f03). wt-C-test in scratchpad.
- PHASE C GATE — waiting for user: accept "keeps ahead" as met (recommended; carry-over = overlapping
  rounds / both slots busy) or rework rounds now.

### 2026-10-11 — iteration 15 (no-op)
- ctx: m5 6% (after compaction), scout 10% (done), C-impl 17% (idle), C-rev 16% (idle), C-test 18% (done).
- No user reply yet. PHASE C GATE still open ("keeps ahead": accept + carry-over, or rework rounds). Next wake ~60 min.

### 2026-10-11 — phase C accepted
- ctx: m5 6%, scout 10%, C-impl 17%, C-rev 16%, C-test 18% (all idle/done).
- User answered "1": accept "keeps ahead" as met; carry-over logged. Phase C ACCEPTED at f976f03.
- Closing C-impl, C-rev; C-test removes wt-C-test then closes. Starting phase D.
- C-impl (wC:p5S) and C-rev (wC:p5T) closed. C-test asked to remove wt-C-test (idle notice subscribed).
- Scout Q7: phase D starting point (chrome-builtin refs, fallback chain, strategy registry, provenance label, flags).
- Started m5-D-impl (Opus 5.5, reason in Sessions). Short /goal → goal-D-impl.md; told to wait for the
  scout's starting point. Reviewer and tester start on committed work.
- C-test: wt-C-test removed and pruned (worktree list: master, m5). C-test closed (wC:p5V).
- Scout Q7 answered (verbatim in scratchpad startpoint-D.md); forwarded unchanged to m5-D-impl with go-ahead. Scope note: minimal Nano flag; onboarding card / chain editor basic entry in scope if needed for the criterion.

### 2026-10-11 — iteration 16
- ctx: m5 9%, scout 12% (idle), D-impl 16% (working; routing default now ends in `basic`, wiring route.ts).
- Q8 to scout: git status of main worktree and m5 worktree (D-impl shell resets to main worktree — drift check).
- Phase D criteria: none met yet (no commit). Next wake ~10 min (D-impl near 20%).
- Scout Q8: main worktree clean (only progress-m5.md untracked); m5 has D work uncommitted (engine, strategies/basic.ts, llm/chrome-builtin.ts, llm/chrome-translator.ts, providers, route, jobs). No drift.

### 2026-10-11 — iteration 17
- ctx: m5 9%, scout 12% (idle), D-impl 23% (working; trying a live run on branded Chrome with a downloaded on-device model, via CDP Extensions.loadUnpacked).
- Checkpoint warning sent to D-impl (commit coherent work, update state file). Phase D criteria: none met yet (nothing committed). Next wake ~5 min.

### 2026-10-11 — iteration 18
- ctx: m5 10%, scout 12% (idle), D-impl 24% (working; live demo runs on Chrome for Testing, all-providers-blocked case). Warning already sent; checkpoint request at 25%. Next wake ~4 min.

### 2026-10-11 — iteration 19
- ctx: m5 10%, scout 12% (idle), D-impl 25% (about to report). Checkpoint request sent; idle notice subscribed; compact after report.
- D-impl report (checkpoint): E7 committed b4da67b, d169083; pnpm check green (83 files / 1638 tests). MTClient
  port + Chrome Translator (availability-gated, 30 s create timeout), basic strategy (plain text per block,
  §5.6 checks), terminal basic switch in engine on retryable failures (auth/quota/cors/model_not_found never
  switch), "basic translation" badge + JobBar note, Options "+ Chrome basic translation", default routing ends
  in basic, local-only keeps basic, Nano adapter behind compile-time CHROME_NANO=false. Live: Chrome 155
  (loadUnpacked over CDP, en→vi model present) providers blocked + Retranslate → 9/9 basic labeled (§7 step 6);
  CfT 153 Translator create() never settles → clear "no basic translation either" state; Nano unavailable
  both (unit tests only). Full report scratchpad report-D-impl.md; evidence under the impl scratchpad drvD/.
- Rulings: (1) one-time migration adds 'basic' to stored routings (removal afterwards sticks) — needed for
  the criterion for existing users; (2) basic not cached / plain text / no re-request = §4.2.6 degraded mode,
  accepted; (3) no download-by-gesture flow → carry-over; (4) compile-time Nano flag, onboarding card untouched.
- D-impl compacted at 27% → 0%; resumed with the rulings (migration commit next).
- Started m5-D-rev (wC:p5Y) and m5-D-test (wC:p5Z), Sonnet 5.5, goals goal-D-rev.md / goal-D-test.md.
- Review round 1 (D-rev, b4da67b..d169083): 0 blocking; criteria met by code (only rate_limit/overloaded/network
  switch after the chain gave up; plain-text render; engine free of chrome.*; Nano off; basic not cached;
  local-only keeps basic). NON-BLOCKING: N1 switch sticky for the whole job → fix/re-probe (forwarded);
  N2 unpaired 'basic-fallback' event → fix; N3 Retranslate replaces good text with basic when down → accepted
  (plan §7 step 6); N4 migration → re-review; N5 first-call analyze failure → verify with a test. Reviewer's
  own pnpm check failed on symlinked node_modules → told to pnpm install in its worktree.

### 2026-10-11 — iteration 20
- ctx: m5 13%, scout 12% (idle), D-impl 15% (working: migration + N1/N2/N5), D-rev 10% (waiting for next commits), D-test 10% (working on d169083).
- Phase D criteria: (1)/(2) met by code per reviewer round 1 and implementer live run on Chrome 155; tester confirmation pending; migration pending. Next wake ~20 min.
- D-impl: 102720a migration (read-time: stored routing without basicMigrated gets 'basic' appended in parseStored;
  saveRouting writes basicMigrated:true; respects "only the user writes routing" sync rule) — supervisor accepts
  the read-time form (meets the ruling's intent). f5e6bc9: N1 non-sticky switch (one probe at a time, recovery
  ends the switch, JobBar "recovered" note), N2 paired events, N5 verified with tests (analyze failure → no brief,
  blocks reach the switch). pnpm check green 1645 tests. Live Chrome 155 re-run 9/9 basic in 8 s
  (evidence drvD/evidence/chrome155-rev1). Review round 2 sent; tester told to cover migration + recovery.
- Review round 2 (D-rev, 102720a, f5e6bc9; own pnpm check 1645 pass): 0 blocking; N1/N2/N4/N5 resolved; migration
  sound (incl. old-build saves via keepUnknown). Nits forwarded: M1 queued basic segments lose the provider error
  when a probe recovers; M2 recovered note claims basic blocks even when none; M3 wording → no change. One
  unidentified test failed once at d169083 (pass on rerun) → asked impl about flakiness.
- D-impl: 355744b fixes M1 (queued blocks keep their cause; test fails on old code) and M2 (recovered note checks
  basic blocks); flaky chrome-builtin "create never settles" test moved to fake timers (7 D files × 5 runs, 166/166).
  pnpm check green 1646. Review round 3 sent; tester to use latest head.
- Review round 3 (D-rev, 355744b; own pnpm check 1646 pass): no findings. Reviewer done (keeps scratchpad/wt-D until closed). Waiting for the tester.
- Test round 1 (D-test, d169083→355744b, Chrome 155 branded via loadUnpacked, real side panel; CfT 153 fresh):
  criterion (1) PASS, §3 #4 / §7 step 6 PASS (up→block+Retranslate 9/9 basic ~6 s; blocked from start 9/9;
  mock 503 → basic). Auth/quota no switch PASS. Options chain + fresh default PASS. Local-only + basic, no
  network PASS. Pre-M5 migration PASS (no write on open; removal sticks). Nano off PASS. CfT create never
  settles → all fail after 36 s with the clear "no basic translation either" text. pnpm check green ×3.
  Findings forwarded: F1 pair 'unavailable' (Chrome 155) → "Lost the connection / network error", no mention of
  Chrome Translator; F2 "recovered" note never shown live (lazy page recovered via provider, note vanished);
  F3 stored chrome-builtin profile → endless spinner. Ruled carry-over: within one non-lazy job the switch
  drains all pending chunks to basic, so no recovery after an unblock (106/121 stayed basic).

### 2026-10-11 — iteration 21
- ctx: m5 15%, scout 12% (idle), D-impl 18% (working F1–F3), D-rev 12% (done, 0 open), D-test 15% (waiting).
- Phase D criteria: (1) and (2) PASS (tester, live Chrome 155); reviewer 0 open. Open: F1–F3 fixes, then a tester
  re-run of F1/F2/F3 + step 6 and a reviewer round 4. Next wake ~15 min (D-impl near 20%).
- D-impl: 421feab fixes F1 (no-basic reason appended to block + stopped job text), F2 (resumed runs carry the
  basic note; recovered when a model final arrives; live lazy rerun shows "…is translating again"), F3 (chrome-builtin
  route while flag off → immediate error "experimental and off"; throwing routes become errors). pnpm check 1649.
  Live reruns on Chrome 155 in impl scratchpad drvD-rerun/evidence. Tester re-run + review round 4 sent.
- Review round 4 (D-rev, 421feab; own pnpm check 1649): 0 blocking; F1/F3 fine; O1 non-blocking: recovered note set
  by in-flight model finals that finish after the switch → note claims recovery while still switched → forwarded.

### 2026-10-11 — iteration 22
- ctx: m5 16%, scout 12% (idle), D-impl 25% (working O1) → checkpoint request sent; D-rev 14% (done), D-test 16% (re-running F1–F3 + step 6 on 421feab).
- D-impl checkpoint: 662979b fixes O1 (Job.basicCarried; in-run recovery only via engine done+recovered; test fails
  without fix). pnpm check 1650. Compacted D-impl 26% → 0% (second compaction) and resumed (wait for findings).
  Review round 5 sent on 662979b. Tester will also re-check the note on the latest head.

### 2026-10-11 — iteration 23
- ctx: m5 17%, scout 12% (idle), D-impl 6% (resumed, waiting), D-rev 14%, D-test 16% (done; report pending?).
- Review round 5 (D-rev, 662979b; own pnpm check 1650): no findings. Reviewer: 0 open across 5 rounds.
- Test round 2 (D-test, 421feab; from its pane/state file): pnpm check 1649; F1 PASS, F2 PASS, F3 PASS, step 6 PASS
  (9 basic, 7 s), evidence r2-*. Asked for a final F2 + step 6 + pnpm check on head 662979b (O1) in one report.
- Test round 3 (D-test, 421feab + 662979b, Chrome 155): pnpm check green both (1649 / 1650); F1, F2, F3 PASS; F2 +
  step 6 identical on 662979b (no regression). Evidence evidence/D-test/r2-*, r3-*. Open: only the carry-over.
- All phase D criteria confirmed by tester; reviewer 0 open (5 rounds). Q9 to scout: commit check before acceptance.

### 2026-10-11 — phase D accepted
- Scout Q9: m5 head 662979b, clean, 7 phase-D commits; tester/reviewer worktrees wt-D, wt-D-test..5 present.
- Phase D ACCEPTED at 662979b. Closing D-impl; D-rev/D-test remove their worktrees, then close.
- Next: phase E (depends on D, accepted). Q10 to scout for the E starting point.
- D-impl closed (wC:p5X). Started m5-E-impl (wC:p50, Sonnet 5.5); told to wait for the scout's starting point.
- D-rev: wt-D removed + pruned; closed (wC:p5Y).
- D-test: wt-D-test..5 removed + pruned (worktree list: master, m5 @ 662979b); closed (wC:p5Z).
- Scout Q10 answered (verbatim in startpoint-E.md): no import/export; sync keys schemaVersion/conn/profile/routing/siteRules/siteAllowlist/siteNever/prefs/glossary; keys only in local secret:<id>; Alt+T = _execute_action, open-only per D11 (wxt.config.ts:23-25); no keyboard handlers in panel; no tabIndex/focus-visible in segment list; listitem without list. Forwarded unchanged to E-impl with notes: toggle vs D11 → stop and report if not possible; export scope §4.3.7 + prefs/site rules, device-only data out.
- E-impl STOP (toggle): sidePanel.close() exists only from Chrome 141 (Chrome docs; @types/chrome :15187-15193
  "@since Chrome 141"); manifest minimum is 138, so 138–140 cannot close the panel from Alt+T. ≥141: action
  handler checks runtime.getContexts SIDE_PANEL and calls close(), else open() keeping the gesture (not yet
  live-verified). Options: A keep min 138, toggle on ≥141, open-only on 138–140 (documented) — impl recommends;
  B raise minimum to 141; C keep open-only (D11), criterion unmet.
- PHASE E GATE — waiting for user: A / B / C. → RESOLVED below (user: option D, fallback A). E-impl continues E9 + non-toggle E10, may live-verify toggle, no
  toggle/minimum commit until decided.

### 2026-10-11 — iteration 24
- ctx: m5 20%, scout 16% (idle), E-impl 18% (working E9 + non-toggle E10).
- Still waiting on the user: Alt+T toggle A / B / C. Phase E criteria: none met yet (nothing committed). Next wake ~15 min (E-impl near 20%).
- E-impl: E9 committed 6871255, 804a91b. Toggle option D found: worker opens first (gesture kept) and messages
  the panel 'close-panel'; a panel alive >1.5 s in that window closes itself (sidePanel.close if present, else
  window.close()). Live on CfT 153: works; no min-version change. Not verified on 138–140 nor with a real
  Alt+T/toolbar gesture (headless). Prototype patch in its scratchpad, not applied. Added to the user gate.
- Started m5-E-rev (wC:p61) and m5-E-test (wC:p62), Sonnet 5.5, goals goal-E-rev.md / goal-E-test.md (E9 + non-toggle E10; Alt+T held).
- USER DECISION 2026-10-11 ("you recommend"): Alt+T toggle = option D (open first, panel closes itself on a
  'close-panel' message; sidePanel.close or window.close), fallback A; minimum stays 138; D11 superseded.
  Human item: the user presses Alt+T / toolbar twice in a real Chrome (no session can send a real gesture).
  Forwarded to E-impl (commit with tests, D11 comment, docs).
- Review round 1 (E-rev, E9 6871255/804a91b; own pnpm check 1667 pass): export without keys holds; confirm gate;
  import validates, merges, quota-checked, escaped. BLOCKING B1: keyless import can replace a connection's
  baseUrl/headers/params so the stored key goes to the file's endpoint (§8, §4.3.4) → ruling: preview names
  redirected connections AND drop the key by default unless ticked per connection; test. NON-BLOCKING N1 headerName
  / id / pattern bounds; N2 name-based redaction → say so in export note; N3 dialog focus in/out + keys-replaced
  preview; N4 tests (basicMigrated, removed basic, redaction, B1); N5 ignore keys of skipped records. All forwarded.

### 2026-10-11 — iteration 25
- ctx: m5 22%, scout 16% (idle), E-impl 27% → checkpoint request, E-rev 8% (waiting), E-test 12% (working).
- E-impl report: head 1346b50 (6871255, 804a91b E9; ec644fe, a524aee toggle D; 07137ec review r1 B1+N1–N5;
  1346b50 E10 roving tabindex, arrows/J/K/Home/End, O/R/E/C, aria-keyshortcuts, role=list, lang, aria-busy,
  focus-visible, reduced motion, ? list, docs in panel/Options/README). pnpm check 88 files / 1698 tests.
  Live CfT 153: export w/o keys 0 secrets; with keys after confirm; fresh-profile import; hostile import drops key;
  axe 0 violations (Options + panel; contrast "incomplete"); keyboard walkthrough OK; toggle message parts OK.
  NOT live: Chrome 138–140; real Alt+T/toolbar gesture (human); screen reader; multi-window (unit only).
- Review round 2 sent (804a91b..1346b50); tester told new head + B1/keyboard/axe/toggle parts.
- Asked E-impl for a stable build folder for the user's manual Alt+T check before compaction.
- E-impl built 1346b50 unpacked at scratchpad/m5-build-E (for the user's Alt+T check). Compacted E-impl 27% → 0%, resumed (wait for findings).
- HUMAN CHECK requested from user: load m5-build-E unpacked in real Chrome, Alt+T ×2 and toolbar ×2 → open then close.
- Review round 2 (E-rev, 804a91b..1346b50; own pnpm check 1698): 0 blocking; B1 + N1–N5 closed (incl. built-in
  connections); toggle gesture-safe (open first, unawaited; cross-window safe); E10 no traps, letters focus-scoped
  (WCAG 2.1.4 ok), ARIA correct. Notes: NB1 open/close race → add rapid presses to the human check; NB2 138–140
  window.close() unverified → recorded; NB3 adjacent ul/ol merge into one list (cosmetic, carry-over); NB4 add a
  shortcuts-text line that screen-reader browse mode needs focus mode (batch with tester findings); NB5 orphan
  secret edge (carry-over). Not judged: real Chrome toggle, screen reader, focus-ring contrast, step 8 in a real profile.

### 2026-10-11 — iteration 26
- ctx: m5 23%, scout 16% (idle), E-impl 5% (waiting), E-rev 13% (waiting), E-test 13% (working on 1346b50).
- Phase E criteria: (1)/(3) export/import + keys met by code (review r2) and implementer live run; (2) toggle on
  code + automated parts, real gesture pending HUMAN CHECK; (4) keyboard-only met by code; tester confirmation
  pending. Waiting: tester report, user's Alt+T check. Next wake ~20 min.
- User loaded m5-build-E in their Chrome and asked a subagent to verify for them: background general-purpose subagent (Sonnet) sends real OS-level Option+T / toolbar clicks via osascript and screenshots (slow ×2, toolbar ×2, rapid ×5).
- Subagent Alt+T check BLOCKED: Chrome 155.0.8059.39; screencapture fails ('could not create image from display') → likely no Screen Recording permission for the terminal; no key presses sent. A Wikipedia tab it opened may be left in another Chrome window. Asked user: grant Screen Recording and rerun, or watch while the agent presses.
- Test round 1 (E-test, 804a91b + 1346b50, Chrome 155; pnpm check 1698): criteria (1) PASS, (2) shortcuts + a11y
  PASS / real Alt+T gesture NOT RUN (human), (3) PASS, (4) PASS; demo step 8 PASS. Export without keys: no sentinel
  or real key; confirm gate holds; fresh-profile round trip; bad input → clear error, nothing half-written; B1
  holds (custom + built-in + headers-only). Tab sequence recorded, no trap; letter keys scoped; axe 0 violations
  (panel/options/onboarding). Dark-mode axe contrast flags (bg computed #fff) → likely false positive, manual look.
  Report scratchpad report-E-test.md. Forwarded small round: preview shows raw base URL with credentials → redact;
  Options table Esc wording; NB4 screen-reader note; fresh-profile onboarding change → find commit.
- User chose option 2 (watch while agent presses). Agent BLOCKED again: 'osascript is not allowed to send keystrokes (1002)' → terminal lacks Accessibility permission. No presses sent. Asked user: grant Accessibility and rerun, or press Alt+T themselves.
- Alt+T agent run 3 (17:51): still 'osascript is not allowed to send keystrokes (1002)'; no presses sent. Suggested user press manually (option 3) or grant Accessibility to the app that actually runs osascript (terminal hosting herdr) and restart it.
- E-impl: 7611a71 (preview addresses redacted; Esc wording; screen-reader focus-mode note in panel/Options/README; onboarding change predates E: 1a03e65 M4-E13, no change). pnpm check 1700. Review round 3 + tester re-check sent.
- User: Alt+T is already taken by another extension in their Chrome (Chrome then leaves Translate Side's suggested key unassigned). Asked user to rebind at chrome://extensions/shortcuts (or disable the other) for the test. Product note: show the actual bound shortcut (commands.getAll) + link to chrome://extensions/shortcuts when unassigned — proposed.
- Review round 3 (E-rev, 7611a71; own pnpm check 1700): no findings (cosmetic: identical redacted from/to when only a key param differs). Reviewer 0 open; keeps wt-E until closed.
- HUMAN CHECK result (user, Chrome 155, shortcut rebound to Alt+Shift+T): toggle works, but with a delay of several seconds. Asked user: delay on open, close or both; every press or first only; toolbar icon same?; rapid presses. Forwarded to E-impl to investigate the latency.
- E-impl on toggle delay: not reproducible on CfT 153 via CDP (sendMessage 1–3 ms, open ~20 ms, close <0.4 s, no reopen). Suspects: (a) a frozen/throttled extension context holds the sendMessage promise → delays injection, not opening; (b) 1.5 s settle looks like a delay; (c) Chrome-level shortcut handling. Proposed fix if delay is on open/translate: race the question against ~300 ms. Waiting for user's answers (open vs close).
- User: the delay is on CLOSE — right after opening, a second press doesn't close; takes several seconds (settle rule, counted from panel script start in real Chrome). Supervisor ruling: fix (close as soon as the user can press again; the opening press never closes; NB1 race safe), plus show the actually bound shortcut / 'Not set' in Options and ? list (user hit the clash). Forwarded to E-impl; rebuild m5-build-E for a user re-check.
- Test re-check (E-test, 7611a71): pnpm check 1700; preview redaction PASS; Esc wording + SR note PASS; keyboard smoke PASS. One driver artifact (panel empty after foregrounding Options) not reproduced on clean run. Next: toggle-close fix + bound-shortcut display commit → review + test + user re-check.

### 2026-10-11 — iteration 27
- ctx: m5 27%, scout 16% (idle), E-impl 9% (working: toggle close fix + bound-shortcut display), E-rev 14% (waiting), E-test 22% (warning sent).
- Phase E criteria: (1)(3)(4) PASS (tester), shortcuts/a11y PASS; Alt+T toggle works for the user (Chrome 155, rebound Alt+Shift+T) but close right after open is delayed → fix in progress, then review/test/user re-check. Next wake ~15 min.
- E-impl: 0874be5 — close fix (press stamped pressedAt; panel ignores only questions stamped before its creation via performance.timeOrigin + 100 ms; second press 400 ms after open closes in ~0.25–0.47 s on CfT 153; NB1 kept) + assigned shortcut shown from commands.getAll ('Not set' + Change-key button → tabs.create chrome://extensions/shortcuts). pnpm check 89 files / 1708. m5-build-E rebuilt at 0874be5. Review round 4 + tester check sent; user asked to re-test.

### 2026-10-11 — iteration 28
- ctx: m5 28%, scout 16% (idle), E-impl 11% (idle), E-rev 15% (round 4), E-test 22% (checking 0874be5).
- Waiting: review round 4, tester check, user's re-test of the rebuilt m5-build-E. Next wake ~10 min (E-test ≥20%).
- Review round 4 (E-rev, 0874be5; own pnpm check 1708): 0 blocking. Opening press can't close its panel; windowId safe; same system clock. NB6 system clock jump edge → recorded (decision record note, no code). NB7 panel's Change-key button gives no feedback on failure → carry-over (row names the URL). NB1 still on the user's manual check.

### 2026-10-11 — iteration 29
- ctx: m5 28%, scout 16%, E-impl 11% (idle), E-rev 15% (done, 0 open), E-test 24% (working on 0874be5; warned). Waiting: tester report, user re-test. Next wake ~8 min.
- Test check (E-test, 0874be5): pnpm check green on rerun (1708; one fuzz.test.ts timeout under load avg 8–12, engine untouched → load flake, carry-over to watch); pressedAt rules PASS (before birth / +50 ms / missing / string ignored; +400 ms closes); 'Not set' display PASS (Chrome 155 loadUnpacked has no binding), assigned '⌥T' shown on CfT; Change-key button opens a tab; commands.update n/a → set/clear NOT RUN; keyboard smoke + axe Options PASS. Only open: user's real-gesture re-test.

### 2026-10-11 — iteration 30 (no-op)
- ctx: m5 29%, scout 16%, E-impl 11%, E-rev 15%, E-test 24% — all idle. Phase E waiting only on the user's real-gesture re-test of m5-build-E (0874be5). Next wake ~60 min.
- HUMAN CHECK (user, Chrome 155, m5-build-E @ 0874be5, key Alt+Shift+T): toggle closes immediately; Options/? list show Alt+Shift+T. Rapid ×5 and toolbar ×2 not reported → carry-over (NB1 unobserved). Chrome 138–140 fallback unverified (NB2). Q11 to scout: commit check before acceptance.

### 2026-10-11 — phase E accepted
- Scout Q11: m5 head 0874be5, clean, 8 phase-E commits; wt-E, wt-E-test present. Phase E ACCEPTED.
- E-impl closed (wC:p50). E-rev/E-test removing worktrees. Q12 to scout: permissions list + fixtures for the §9 handoff.
- E-rev and E-test removed their worktrees (list: master, m5) and were closed (wC:p61, wC:p62). Waiting for scout Q12.

## M5 HANDOFF TO M6 (plan §9) — from scout Q12, m5 @ 0874be5
- Feature-complete v1.0 scope: phases A–E accepted (see each phase).
- SPA and navigation fixtures: fixtures/spa/{README.md, docusaurus.html, gitbook.html, mkdocs.html, spa.js}
  (routes ?p=intro|install|config via pushState; used by src/extract/spa.test.ts); fixtures/long/{README.md,
  large-table.html, long-100-screens.html} (scripts/make-long-fixtures.mjs; LAZY_SEGMENTS = 400).
- Permissions actually used (wxt.config.ts; built manifest has no host_permissions, no declared content scripts —
  content script is runtime-registered, src/entrypoints/content.ts:23-25):
  - sidePanel — open/setPanelBehavior/close (src/shared/panel.ts:40, :29; sidepanel/toggle.ts:19)
  - storage — local (API keys, settings.ts:184), sync (settings), session (per-tab state)
  - activeTab — injection after toolbar click / Alt+T (src/shared/inject.ts, panel.ts:47)
  - scripting — executeScript of the content script (src/shared/inject.ts:45)
  - contextMenus — "Translate in side panel" (src/shared/panel.ts:90-102)
  - optional_host_permissions https://*/*, http://*/*, localhost, 127.0.0.1 — requested per origin at runtime
    for allowlisted sites (src/shared/sites.ts:169) and provider endpoints (options/Providers.tsx:796), removed
    on un-allowlist / connection removal
  - commands _execute_action (suggested Alt+T, toggles the panel); commands.getAll, tabs.create, tabs.get,
    windows.getCurrent need no permission entry
  - minimum_chrome_version 138

## FINAL STATE (2026-10-11)
- All phases accepted: A 97d8af8, B 3e47d43, C f976f03, D 662979b, E 0874be5 — branch m5 in worktree
  ../translate-side-m5, clean, NOT merged into master (60a8e5a), NOT pushed. Merging/pushing and committing this
  log (untracked in the main worktree) are the user's call.
- User decisions: S8 not run → build E7 as last fallback gated by availability(); phase A §3 #2 accepted; phase C
  "keeps ahead" accepted with slow-provider carry-over; Alt+T toggle option D (fallback A), D11 superseded.
- Open human items: manual Chrome permission-prompt check (phase A) never reported; Alt+T rapid presses and
  toolbar-icon toggle not observed; Chrome 138–140 toggle fallback unverified; screen-reader speech and dark-mode
  contrast need a human look.
- Not started (outside this plan file): M6-E1/E8 store assets and docs in parallel (plan §6).
- Carry-overs: see each phase's Carry-overs line.
- Sessions: all closed (scout last).
