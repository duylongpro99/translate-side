---
title: Zero-setup translation with Chrome built-in AI planned
date: 2026-10-20
summary: "Plan for keyless on-device translation: Chrome Translator first, Gemini Nano when the target allows, one turn-on click per new pair"
---

# Zero-setup translation with Chrome built-in AI planned

## What happened

The goal was to let users translate without setting up an LLM provider, by using Chrome's on-device AI. A brainstorm
picked direction C: Gemini Nano when it is available, otherwise Chrome Translator, otherwise provider setup. The plan
is at `plans/261020-1216-chrome-builtin-zero-setup/plan.md`, with 5 phases and about 10 days of work.

The code already had most of the parts. The Nano adapter (`src/llm/chrome-builtin.ts`) was turned off by
`CHROME_NANO = false`. The Translator port and the `basic` strategy ran only as the last fallback. A fresh install
routed to APIBOX Qwen with no key and stopped at "Add your API key". Spike S8 had never been run.

## What research changed

- Gemini Nano can output only en, es and ja (de and fr arrive in Chrome 149). For a Vietnamese reader that rules it
  out, so Chrome Translator became the main engine and Nano the upgrade for those targets.
- Chrome reports a Translator pair as `downloadable` until this extension has created it, even when the language pack
  is installed, and `create()` consumes the user's click. So zero setup still needs one "Turn on" click per new pair.
- Nano's `create()` accepts any earlier click (sticky activation). The plan therefore bans `create()` on job paths
  unless the state is `available`, so a job can never start a download of about 4 GB.

## What the red team caught

There were 15 findings and all were accepted. The ones that would have shipped broken:
- The basic switch only takes over retryable errors, so Nano overflow and parse failures would have failed blocks
  instead of falling back to Translator.
- A Translator route had no client or profile, which would have crashed Retry, Retranslate and Explain.
- The onboarding sample builds its own `Jobs` without `mt`, and loses the click through the privacy gate.
- Skipping the privacy notice for on-device routes was a time-of-check/time-of-use bug: a key added mid-session
  would send text to the cloud unacknowledged. The gate moved to the resolved route in `Jobs.start`.
- The `noKey` trigger would have taken over site rules and tab overrides, and ignored usable fallbacks.

The service-worker "zero-click" proxy was dropped. It relies on an undocumented exemption, conflicts with decision
S1, and gets around Chrome's download consent.

## Decisions

- Auto engine choice plus a settings override (Auto / Gemini Nano / Chrome Translator).
- The route applies to anyone without a usable provider: the default route only, after checking for a usable fallback.
- On-device results are cached under their own model key.
- If Nano keeps breaking the segment format, Auto uses Translator only and Nano stays opt-in.
- Onboarding preselects on-device when it is available.
- Work happens on a feature branch in a worktree.

## Next steps

Phase 1 is spike S8 on real Chrome stable. Chrome for Testing never settles a Translator `create()`. The spike
measures pair persistence, Nano's output format and chunk size, the unavailable reasons, and whether Playwright can
inject fakes into extension pages. Then run `/ak:cook plans/261020-1216-chrome-builtin-zero-setup/plan.md`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
