---
title: "M9 — Beyond v1"
description: "Seven independent tracks (gemini-native, passphrase lock, Firefox, code comments, site style and domain packs, PDF, agentic deep mode) plus one tool-call foundation, each shippable alone behind the M6 regression gate."
status: pending
priority: P3
effort: 21.5d
branch: m9
tags: [feature, engine, llm, security, firefox, pdf, pro]
blockedBy: [261013-0348-m7-stronger-translation, 261018-0900-m8-ui-ux-refresh]
blocks: []
created: 2026-10-13
---

# M9 — Beyond v1

## Overview

The source plan is `docs/plans/M9-beyond-v1.md`: seven independent tracks (§2.1–2.7), each with a goal, a shape,
a "done when" and a guarantee, and the rule that every track fits an existing boundary (adapter, strategy, context
provider or shell port) without changing the engine interface (`TranslationEngine`, `src/engine/types.ts:193-196`)
and passes the M6 regression gate. This directory is its execution plan.

Evidence comes from `plans/reports/scout-261013-1036-m8-track-surfaces.md` (M9 surfaces),
`plans/reports/scout-261013-1036-m7-engine-surfaces.md` (what M7 builds that M9 reuses) and the pricing decision in
`plans/reports/brainstorm-261013-1036-free-pro-pricing.md`. The claims each phase relies on were re-checked against
the working tree on 2026-10-13; anything not checked is tagged [UNVERIFIED].

Delivery follows the M6 convention: a supervisor using `docs/prompts/implement-plan.md` with `{{PLAN_FILE}}` = this
file, `{{SPEC_FILE}}` = `docs/plans/M9-beyond-v1.md` and `{{LOG_FILE}}` = `docs/progress/progress-m9.md`, on a
branch `m9` in a worktree. Because the tracks are independent, every phase ends at a green `pnpm check` and a green
`pnpm run e2e` on its own, so the owner can merge or release an accepted phase without waiting for the others.

## Phases

| # | Phase | Track | Tier | Depends on | Effort | Model | Status |
|---|---|---|---|---|---|---|---|
| 1 | [Gemini-native adapter](./phase-01-gemini-native-adapter.md) | §2.5 | Free | — | 1.5d | Sonnet | Pending |
| 2 | [Passphrase lock for keys](./phase-02-passphrase-lock-for-keys.md) | §2.3 | Free | — | 2d | Opus (crypto, data safety) | Pending |
| 3 | [Firefox build](./phase-03-firefox-build.md) | §2.2 | Free | — | 3d | Opus (new target, new harness) | Pending |
| 4 | [Code-comment translation](./phase-04-code-comment-translation.md) | §2.6 | Pro `code-comments` | — | 2.5d | Opus (byte identity) | Pending |
| 5 | [Site style and domain providers](./phase-05-site-style-and-domain-providers.md) | §2.4 | Pro `domain-packs` | — (soft: M7 phase 6) | 2.5d | Sonnet | Pending |
| 6 | [PDF reader](./phase-06-pdf-reader.md) | §2.7 | Pro `pdf` | — | 4d | Opus (new source, permission flow) | Pending |
| 7 | [Tool calls in the LLM contract](./phase-07-tool-calls-in-the-llm-contract.md) | foundation for §2.1 | — | — | 2d | Opus (contract change) | Pending |
| 8 | [Agentic deep mode](./phase-08-agentic-deep-mode.md) | §2.1 | Pro `deep-mode` | 7, M7 phases 1–4 and 6 | 4d | Opus (security, eval) | Pending |

"Depends on: —" means the phase can start from master once the previous phase on the branch is accepted; it has no
functional dependency on any other M9 phase.

## Track order

M9 §3 ranks the next track by (1) what beta and store users ask for most, (2) what reuses the most existing pieces,
(3) what carries the least privacy risk. There is no beta or store demand data yet (the M6 beta is still with the
user), so criteria 2 and 3 decide the default order, and the supervisor re-ranks the remaining tracks whenever beta or
store requests arrive.

**Recommended order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

| Order | Track | Reuse | Privacy risk | Why here |
|---|---|---|---|---|
| 1 | gemini-native | High: one new `ProtocolAdapter`, same host as the existing Gemini grant | None new | Smallest track, proves the M9 regression routine |
| 2 | Passphrase lock | High: one read path (`resolveConnection`) | Lowers risk | Privacy feature, free, no new network calls |
| 3 | Firefox | Medium: same code, new target, new harness | None new (re-run S1) | Highest likely demand among free tracks; heavy infra, so it goes after two small wins |
| 4 | Code comments | High: segmenter and existing panel | Low: sends comment text from read-only code | Cheapest Pro track; pull it forward if the Pro launch needs a second Pro feature early |
| 5 | Site style + domain | High: the context-provider pattern | Low: local data only | Benefits from M7's provider work but does not need it |
| 6 | PDF | Low: new source, new page, new dependency | Medium: fetches document bytes with a new grant | Large and self-contained |
| 7–8 | Tool calls + agentic | Medium: M7 review path | Highest: first tool loop and first non-provider web call | Needs M7 accepted, and carries the most risk |

## File ownership and parallelism

The phases run one after another on `m9`, because several shared files are touched by more than one track:
`src/locales/en.yml` and `vi.yml` (every phase with UI), `scripts/bundle-budget.json` (every phase that changes
sizes), `src/shared/settings.ts` (phases 2, 4, 5), `src/llm/types.ts` (phases 1, 7), `src/llm/client.ts` (phases 1, 7),
`src/entrypoints/sidepanel/jobs.ts` (phases 5, 8), `src/entrypoints/sidepanel/translator.ts` (phases 2, 8),
`src/entrypoints/sidepanel/controller.ts` (phases 4, 6), `src/shared/portable.ts` (phases 2, 4, 5),
`.github/workflows/ci.yml` (phases 1, 3), `scripts/check-bundle.mjs` (phases 3, 6), `e2e/fixtures.ts` (phases 3, 6, 8),
`docs/privacy.md` (phases 2, 6, 8), `docs/store/` (phase 8) and `DESIGN.md` (phases 6, 7, 8).

Two kinds of work may run early in parallel, because they write no repository files: the spikes that open phases 3
and 6 (their findings go into the phase report under `plans/261013-0345-m9-beyond-v1/reports/`).

The first phase to run adds `m9` to the CI push branches (`.github/workflows/ci.yml:5`).

## Cross-Plan Dependencies

| Plan | Relationship | What crosses | Contract | Status |
|---|---|---|---|---|
| `m7-stronger-translation` (`plans/261013-0348-m7-stronger-translation/`) | M9 phase 8 is blocked by it; phase 5 reuses its provider pattern (soft) and must keep its `translation-memory` provider in the list it builds (red team finding 5) | The `review` role routed (today `jobs.ts:1316` throws), the `refine` strategy and `review@N` prompt, the revision UI and "refined" marker, the translation-memory store and its search, `refine` accepted by `scripts/eval/run.ts` and a Best baseline | M7 phases 1 (review stage, refine), 2 (eval baseline), 3 (Best mode in the panel), 4 (quality modes, review routing), 6 (translation-memory provider) | M7 `plan.md:57` (the `features.ts` contract) and phase 6 (memory provider after the tail, up to 400 of 1,500; data through `JobOptions`) read on 2026-10-13; phases 1–4 not re-read [UNVERIFIED] |
| `pro-subscription-licensing` (`plans/261013-0348-pro-subscription-licensing/`) | M9 consumes its entitlement check; its wiring of the four M9 features waits on the M9 phases | One check by feature id, consulted at exactly one call site per M9 Pro track; the locked-state UI (`<ProLock>`, string `pro.locked`, "Part of Pro"); the privacy and store text (licensing phase 5), which M9 phase 8 amends when `define_term` ships | Shared contract (set by M7, adopted by licensing): `featureAvailable(id: FeatureId): Promise<boolean>` in `src/shared/features.ts`; M9 adds its ids below to `FeatureId`. If the file does not exist when the first Pro phase starts, that phase creates it as a one-function default that returns `true` for every id; from then on the licensing plan owns the file and replaces the body. <!-- Updated: Validation Session 1 - gate resolved once and stored --> **Amended across all three plans (2026-10-13):** access is resolved once, at the start of the work, with the async `featureAvailable(id)`, and stored on the job or document; sync code (`engineFor`, `defaultEngine`, strategy reads, rendering) reads the stored value and never calls the check. No call from `src/engine/**` or `content.ts`. A locked option in a shared select is shown disabled with a "(Pro)" suffix, and the lock note appears only beside that control. M9 builds no licensing, no license UI and no network check | Confirmed against M7 `plan.md` and the licensing plan (2026-10-13) |

| Feature id | Phase | The one call site (awaited once) | Where the answer is stored, and who reads it | Behaviour when `false` |
|---|---|---|---|---|
| `code-comments` | 4 | The panel controller, when a page's extract result arrives (`src/entrypoints/sidepanel/controller.ts:321`, async) | The tab's document session; comment derivation and rendering read it | Code blocks behave exactly as in v1; the Options toggle is disabled with `<ProLock>` beside it |
| `domain-packs` | 5 | `Jobs.start`, before the `engineFor` call (`jobs.ts:899`), with the site-style and pack snapshot | The job; sync `engineFor`/`defaultEngine` (`jobs.ts:1240, 1311`) and the explain/redo paths (`:1129, 1197`) read it | The default providers (with M7's memory provider when present); the Options sections are disabled with `<ProLock>` beside each; a pack in a shared select is a disabled "(Pro)" option |
| `pdf` | 6 | The PDF reader page's boot, before any fetch | The reader page, for its lifetime | `<ProLock>` beside the reader's load control; nothing fetched |
| `deep-mode` | 8 | The Deep action handler in `src/entrypoints/sidepanel/translator.ts` (async, beside M7's `best-mode` call site) | `doc.strategy`; the four `jobs.ts` strategy reads (`:916, 1419, 1489, 1604`) and the sync engine construction read it | The job runs the user's quality mode; the action is disabled with `<ProLock>` beside it; "Deep" in a shared quality-mode select is a disabled "(Pro)" option |

Free on purpose (pricing decision): phases 1, 2, 3 and the tool-call foundation (phase 7) consult no entitlement.
Gates only stop new work from starting; they never hide cached translations, which keeps the pricing decision's
"cached translations stay readable" criterion with the licensing plan.

## Success criteria (M9 §2 "done when", one per track)

- [ ] §2.5 gemini-native passes the provider-matrix run, paired with the OpenAI-endpoint Gemini provider at the matrix row's settings, and the regression gate (phase 1).
- [ ] §2.3 keys are unreadable in `storage.local` while locked; translation prompts for unlock instead of failing (phase 2).
- [ ] §2.2 the M6 e2e suite passes on Firefox for the article and docs fixtures (phase 3).
- [ ] §2.6 code tokens are byte-identical on all code fixtures; comments are translated (phase 4).
- [ ] §2.4 measurable terminology gain on domain passages added to the eval set, over ≥ 3 runs per arm with a subset-SD margin, a passage win rate and the hit rate (phase 5).
- [ ] §2.7 text PDFs in the fixture set segment cleanly; scanned PDFs show a clear "not supported" state (phase 6).
- [ ] §2.1 `agentic` beats `refine` on a hard-text subset of the eval set, at a documented cost, over ≥ 3 runs per arm with a subset-SD margin and a passage win rate (phase 8).
- [ ] Every phase: `pnpm check`, `pnpm run e2e` and, when engine, LLM or default code changed, a recorded local `pnpm run eval:gate` are green.

## Constraints

- No change to `TranslationEngine` or `Strategy` (`src/engine/types.ts:193-196, 249-254`). Additive, optional
  changes to `src/llm/types.ts` only (its header, `:1-3`).
- No stage changes for phase 5; the user glossary keeps priority (`mergeGlossary`, `src/engine/context/glossary.ts:30-40`).
- The engine boundary holds (`pnpm run check:engine`): shell data reaches the engine through closures or `JobOptions`.
- The production Chrome manifest changes only where a phase says so and `check:manifest` is updated in the same
  commit. No phase adds a required permission. `optional_host_permissions` already covers every new origin
  (`wxt.config.ts:21`).
- The repo is public: no keys, `.env` contents, absolute home paths or usernames in commits. CI holds no secrets.
- No telemetry. Conventional commits; no plan IDs or finding codes in code, tests or commit messages (`.claude/rules`).
- A one-page track plan in `docs/plans/` is written at the start of each phase (M9 §3), derived from the phase file.

## Non-goals

- Licensing, payments, license UI or the license network check (the licensing plan).
- OCR for scanned PDFs (M9 §2.7). Translating comments in editor surfaces (DESIGN §8, `DESIGN.md:810-812`).
- Store or AMO submission (the user publishes, as in M6).
- Changing the default strategy or the shipped default model.

## Key risks

- **M7 slips or misses its margin.** Phase 8 cannot start and Pro has no lead feature. Phases 1–7 do not depend on M7.
- **Playwright cannot load a Firefox extension** [UNVERIFIED]. Phase 3 opens with a spike and names a fallback
  loader before any harness work.
- **pdf.js does not fit the ~28 KB total headroom.** It cannot (the measured total is about 279.5 KB against a
  307,482 B budget, `scripts/bundle-budget.json`). Phase 6 loads it only in its own reader page and hand-adds its
  budget lines and the total with a note (`--update` would rewrite every entry); `check-bundle.mjs` must count `.mjs`
  in both its file filter and its hash-stripping name rule (`:16, 21`).
- **`define_term` is the first call to a third party other than the provider and the license check.** Decided in
  Validation Session 1: it ships off, behind an opt-in, with a strict term filter and a cap of 8 per job, and
  `docs/privacy.md` and the store answers name it as a second outside call (phase 8).
- **Shared-state bugs from the lock and the tool loop** (red team): the import redirect guard, the unlock retry, the
  retry wrapper's terminal branch and the Firefox firewall each have a named fix and a test in their phase.

## Unresolved questions

<!-- Updated: Validation Session 1 - questions answered -->
1. Which single dictionary endpoint `define_term` calls (for example Wiktionary's REST API). Shipping is decided (off by
   default, opt-in, Validation Session 1); the endpoint is chosen in phase 8 step 1 under the stated condition (a
   published privacy policy, logs not readable by third parties) and recorded there. Still open.
2. Resolved (Validation Session 1): domain packs are import-only, with test packs under `eval/`.
3. Resolved: the gate is `featureAvailable(id)` in `src/shared/features.ts` (M7 contract, adopted by licensing),
   resolved once and stored.
4. Resolved (Validation Session 1): Firefox assumes MV3; the phase 3 spike confirms or overturns it with evidence.
5. Resolved (Validation Session 1): Deep mode is per-document.

## Red Team Review

### Session — 2026-10-13

**Findings:** 10 (1 Critical, 6 High, 3 Medium). All 10 accepted by the user.
**Report:** `plans/261013-0345-m9-beyond-v1/reports/red-team-261013-1043-m8.md`

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | The lock silently turns off the import guard that keeps a key from following a redirected connection | Critical | Accept | Phase 2 (requirements, step 5, tests, risks) |
| 2 | Nothing retries a job after unlock; the named listener never sees a session write | High | Accept | Phase 2 (architecture, step 4a, e2e) |
| 3 | The engine retry wrapper ends the stream at the first `tool_call` | High | Accept | Phase 7 (context, requirements, step 5, criteria, risks) |
| 4 | The byte-identity check cannot fail on lexer misreads | High | Accept | Phase 4 (language families, check scope, step 2a, step 4, criteria, risks) |
| 5 | Phase 5's provider list drops M7's memory provider, and the gate cannot sit in sync `defaultEngine` | High | Accept | Phase 5 (order, baseline, shares, gate, architecture, steps, risks); plan.md Cross-Plan tables |
| 6 | The PDF reader skips the denylist and never list, and its origin grant doubles as a site grant | High | Accept | Phase 6 (design decision 2–4, requirements, architecture, steps 5–9, risks, security, DESIGN §8 edit) |
| 7 | The Firefox request firewall would pass every extension request silently | High | Accept | Phase 3 (Spike B, step 7, todo, security, risks, new firewall spec) |
| 8 | The bundle-budget steps cannot be done as written; `.mjs` names keep their hash | Medium | Accept | Phase 1 step 10; phase 6 requirements, step 7, risks; plan.md Key risks |
| 9 | `define_term` validation checks the term's shape, not where it came from; `flag_ambiguity` writes | Medium | Accept | Phase 8 (tools, constraints, steps 2–3, risks, security) |
| 10 | The eval pass bars use a gate margin built for a different sample size and settings | Medium | Accept | Phase 1 criteria and verification; phase 5 step 7 and criteria; phase 8 step 6 and criteria; plan.md success criteria |

### Whole-Plan Consistency Sweep

- **Searched** plan.md and all eight phase files for superseded terms:
  - `isEntitled` and `entitlement.ts`: none left (the controller's earlier replacement holds);
  - `credentials: 'include'`: only in phase 6's one-time cookie choice, by design;
  - `--update` for the bundle budget: only in explanations that it is not used (phases 1 and 6, plan.md);
  - a hand-written provider list replacing `DEFAULT_CONTEXT_PROVIDERS`: none; phase 5 inserts into it;
  - a service-worker-only firewall: phase 3 now generalises it, and phases 6 and 8 rely on the generalised one;
  - `defaultEngine` as a gate site: none; it only reads the stored snapshot;
  - "at most 20 lookups": replaced by 8 in phase 8.
- **Reconciled:**
  - the Cross-Plan feature table now says where each answer is awaited, where it is stored and who reads it;
  - the M7 row records the memory-provider constraint;
  - the success criteria match the phase criteria (paired matrix run, ≥ 3 runs per arm);
  - File ownership adds `translator.ts`, `portable.ts`, `e2e/fixtures.ts` and `docs/store/`;
  - the unresolved questions are reduced to the dictionary endpoint choice.
- **Not changed:** the track order and the phase dependencies. No finding moved a dependency. Phase 6's
  `e2e/fixtures.ts` use depends on phase 3's generalised firewall only if phase 3 has shipped; on Chromium alone the
  existing firewall already covers the reader page, because its URL is `chrome-extension://`.
- **Unresolved:** the dictionary endpoint for `define_term` (phase 8 step 1). The M7 phases 1–4 contents that phase 8
  relies on were not re-read and stay [UNVERIFIED] until phase 8 step 1.

## Validation Log

### Session 1 — 2026-10-13

| # | Question | Answer | Propagated to |
|---|---|---|---|
| 1 | May `define_term` ship, given the pricing decision's "the license check is the only outside call"? | Yes, OFF by default: an explicit opt-in. Strict term filter: the term must occur in the source, no capitalised proper nouns, no mostly-digit terms, a lower per-job cap (8). One fixed, allow-listed endpoint. Named in `docs/privacy.md` and the store data answers as a second outside call. The licensing plan's privacy phase writes the first text; M9 phase 8 amends it when it ships | Phase 8 (tools, constraints, step 2 tests, step 8 docs, risks, security, related files); plan.md Key risks, Cross-Plan table, unresolved question 1 |
| 2 | Domain packs: curated built-ins or import-only? | Import-only (no reason found to change it) | plan.md unresolved question 2; phase 5 unchanged |
| 3 | Firefox: MV2 or MV3? | MV3 stays the assumption, decided by the spike | plan.md unresolved question 4; phase 3 unchanged (Spike A already decides) |
| 4 | Deep mode: per-document or also per-site? | Per-document | plan.md unresolved question 5; phase 8 unchanged |
| 5 | Shared gate contract, agreed across the M7, licensing and M9 plans | Access is resolved once, at the start of the work, with the async `featureAvailable(id)` and stored on the job or document; sync code reads the stored value. A locked option in a shared select is disabled with a "(Pro)" suffix, and the lock note appears only beside that control | plan.md Cross-Plan tables; phases 4, 5, 6 and 8 (gate requirement, architecture, steps, todo) |

**Sweep:** a grep for `featureAvailable` across the phase files finds exactly one awaited call site per feature id
(phase 4 controller, phase 5 `Jobs.start`, phase 6 reader boot, phase 8 `translator.ts`). Every gate requirement says
the answer is stored and read by sync code.
