---
title: "Zero-setup translation with Chrome built-in AI"
description: "Translate pages with no API key: Chrome Translator on the device, Gemini Nano when the target language allows it, and provider setup only when neither can run."
status: in-progress
priority: P1
effort: 10d
branch: feat/chrome-builtin-zero-setup
tags: [feature, frontend, llm, onboarding, privacy]
blockedBy: []
blocks: []
created: 2026-10-20
---

# Zero-setup translation with Chrome built-in AI

## Overview

Contract: `plans/reports/brainstorm-261020-1902-chrome-builtin-zero-setup.md` (direction C, accepted).
API facts: `research/researcher-01-chrome-builtin-ai.md`. User decisions on 2026-10-20: auto engine plus a
settings override, and the built-in route covers anyone without a usable provider.

**Outcome.** A fresh install, or an existing install with no usable provider, translates a page in the
side panel without an API key. Text stays on the device. When the device can't run on-device AI, the
panel says why and offers provider setup. Users with a working provider see no change.

**What research changed.** Gemini Nano writes only `en, es, ja` (`de, fr` from Chrome 149). So "auto"
means Nano when the target is one of those and `availability()` says it can run, otherwise Chrome
Translator, which covers 39 languages through an English pivot. Chrome reports every pair as
`downloadable` until this extension creates it, and Translator `create()` consumes the user's activation. So
the first use of each language pair needs one "Turn on on-device translation" click. No job path ever calls
`create()` on a model or pair that is not `available`, so no download starts without that click.

**Current code.** Nano adapter `src/llm/chrome-builtin.ts`, off via `CHROME_NANO` (`src/llm/client.ts:57`)
and refused in `src/entrypoints/sidepanel/route.ts:63`. Translator port `src/llm/chrome-translator.ts` and
`basic` strategy `src/engine/strategies/basic.ts` run only as the last fallback. Fresh installs route to
APIBOX Qwen with no key (`src/shared/settings.ts:170-171`, `src/shared/providers.ts:305`) and stop at
"Add your API key". The onboarding card is disabled (`src/entrypoints/onboarding/Onboarding.tsx:193`).

## Phases

| # | Phase | Depends on | Effort | Status |
|---|---|---|---|---|
| 1 | [Spike S8: built-in AI on real Chrome](./phase-01-spike-s8.md) | — | 1d | Provisional (Q1–Q6 wait for the owner) |
| 2 | [On-device route and engine choice](./phase-02-on-device-route.md) | 1 | 3.5d | Done |
| 3 | [Turn-on click, download progress, unavailable states](./phase-03-enable-and-download-flow.md) | 2 | 2d | Done |
| 4 | [Onboarding, settings override, privacy wording, labels](./phase-04-onboarding-settings-privacy.md) | 2, 3 | 2d | Done |
| 5 | [Verification, e2e and docs](./phase-05-verify-and-docs.md) | 2, 3, 4 | 2d | Agent part done; the Chrome stable check is open |

Phases run in order: 2, 3 and 4 share `route.ts`, `jobs.ts` and locale files, so they are not parallel.
Work happens on branch `feat/chrome-builtin-zero-setup` in a separate worktree, and is merged by PR.

## Acceptance criteria

1. On a clean profile with on-device AI available, the panel translates a page with no key and no provider setup.
   The only step is one "Turn on" click per new language pair (or for the Nano download).
2. That click starts the download, progress shows, and then translation runs. No download starts without it.
3. When neither engine can run, the panel gives a specific reason (unsupported device, policy, or language pair) and a "Set up a provider" action. It never fails silently.
4. Onboarding's built-in card is enabled and its sample translates on the device.
5. Settings offer "On-device engine: Auto / Gemini Nano / Chrome Translator".
6. Users with a usable provider keep their route, fallback chain and settings unchanged. A site rule or tab
   override with no key still says "Add your key". A user who removed "basic translation" from the fallback list
   is not given Chrome Translator. Existing tests stay green.
9. No page text goes to a route that leaves the device without an acknowledged privacy notice. On-device routes need no notice.
7. Each block says which engine produced it ("Gemini Nano" or "basic translation").
8. S8 results are recorded in `docs/decisions/S8-chrome-builtin.md`.

## Non-goals

Firefox (M9), Free/Pro gating (none exists in code: `src/shared/features.ts:6-11`), tool calls for Nano,
new cloud providers, translating in content scripts, and a background (service worker) proxy for the APIs
(undocumented, conflicts with decision S1, and gets around Chrome's download consent).

## Dependencies

- M8 UI refresh (`261018-0900-m8-ui-ux-refresh`): its code phases are done; this plan builds on its `src/ui/` components.
- Real Google Chrome stable (138+; 149 for Nano `de`/`fr`) on a machine that meets Nano's hardware bar, for phases 1 and 5. Chrome for Testing never settles Translator `create()` (`src/llm/chrome-translator.ts:8-9`).

## Red Team Review

### Session — 2026-10-20
**Findings:** 15 (15 accepted, 0 rejected). Reviewers: Security Adversary, Failure Mode Analyst, Assumption Destroyer.
**Severity breakdown:** 5 Critical, 6 High, 4 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | The basic switch never catches Nano errors | Critical | Accept | Phase 2 (`onDeviceSwitch`) |
| 2 | The Translator route had no client or profile; explain and redo break | Critical | Accept | Phase 2 |
| 3 | No "needs a click" state; privacy masking makes every new pair `downloadable` | Critical | Accept | Phase 2, Phase 3, AC 1–2 |
| 4 | The onboarding sample has no `mt` and loses activation | Critical | Accept | Phase 3, Phase 4 |
| 5 | Privacy exemption was a time-of-check/time-of-use gap | Critical | Accept | Phase 4, AC 9 |
| 6 | `noKey` trigger took over site rules, tab overrides and usable fallbacks | High | Accept | Phase 2, AC 6 |
| 7 | The route had no source or target language; mixed pages | High | Accept | Phase 2, Phase 3 |
| 8 | The setting ignored the existing `basic` opt-out | High | Accept | Phase 2, Phase 4, AC 6 |
| 9 | `CHROME_NANO` and `nanoOff` consumers; stored built-in host crash | High | Accept | Phase 2 |
| 10 | Background proxy breaks S1 and gets around download consent | High | Accept | Phase 1, Phase 2, Non-goals |
| 11 | Sticky activation lets a job start a Nano download | High | Accept | Phase 2, Phase 3 |
| 12 | Local-only reasoning was wrong; `protocolOverride` bypass | Medium | Accept | Phase 2 |
| 13 | Strategy and analyze choices were made before the route | Medium | Accept | Phase 2 |
| 14 | Switcher and setup offer still named APIBOX | Medium | Accept | Phase 4 |
| 15 | e2e hooks missing; the upgrade spec is not in `pnpm e2e` | Medium | Accept | Phase 1, Phase 5 |

## Validation Log

### Session 1 — 2026-10-20

**Verification results** (from the red-team fact check, 29 claims): 25 verified and 4 failed. All 4 failures are fixed in the plan:
- `noKeyError` is used at `route.ts:65`.
- `routedSummary` is no longer cited.
- The status reason union is cited at `status.ts:10`.
- The onboarding sample claim and the e2e hooks claim are fixed by findings 4 and 15.

Tier: Full.

| Question | Decision | Propagated to |
|---|---|---|
| Cache on-device results? | Yes, under their own model key; provider fallback basics stay uncached | Phase 2 (cache bullet, success criterion, todo) |
| What if Nano breaks the format? | Auto uses Translator only; Nano stays opt-in, marked experimental | Phase 2 Risks (already stated) |
| Onboarding default when on-device is available? | On-device first | Phase 4 requirement 3 (already stated) |
| Where to implement? | Feature branch in a worktree, merged by PR | plan.md Phases note, frontmatter `branch` |

Earlier decisions (2026-10-20): direction C, auto plus a settings override, and the route applies to anyone without a usable provider.

### Whole-Plan Consistency Sweep
- Searched all plan files for superseded terms: `zero-click`, the background proxy, `routedSummary`, `route.ts:181`, `status.ts:30`, `six questions`, `four decisions`, and old efforts. The only hit is phase 1's note that the service-worker path is out of scope, which is intended.
- Acceptance criteria 1, 2, 6 and 9 match phases 2–5. Efforts sum to 10d.
- No unresolved contradictions.

