---
title: "Free and Pro pricing, and plans for licensing, M7 and M8"
date: 2026-10-13
summary: v1 free; Pro $5/month gates only new M7/M8 features; three plans written and red-teamed
---

# Free and Pro pricing, and plans for licensing, M7 and M8

## What happened
- Decided pricing: v1.0 launches free with every shipped feature. Pro is $5/month, users keep their own key, and only new M7/M8 features are gated. Beta testers get no Pro grant. Record: plans/reports/brainstorm-261013-1036-free-pro-pricing.md.
- Research picked Polar.sh (license-key benefit; merchant of record; Vietnam payouts listed) with Lemon Squeezy as fallback. The endpoints allow any origin, so no new host permission is needed; this was tested in an MV3 worker. Report: plans/reports/researcher-261013-1036-pro-subscription-licensing.md.
- Wrote three separate plans:
  - plans/261013-0348-pro-subscription-licensing: 6 phases, 4.25d. It starts with an owner gate on Polar payouts.
  - plans/261013-0348-m7-stronger-translation: 7 phases, 10.5d.
  - plans/261013-0345-m8-beyond-v1: 8 phases, 21.5d.
- Red team: 30 findings, all accepted (3 Critical). The Critical ones:
  - A fake 404 from a portal or proxy could permanently revoke a paying user.
  - Translation memory could leak corrections made on local-only sites to cloud models.
  - The passphrase lock would bypass the import guard that removes a key when its connection is redirected.

## Decision
- Shared gate: `featureAvailable(id)` in `src/shared/features.ts`. It is awaited once at job start and stored on the job, and sync code reads the stored value. `best-mode` gates `refine` from every source. A locked option shows as disabled with "(Pro)".
- Feature ids: best-mode, translation-memory (M7); deep-mode, pdf, domain-packs, code-comments (M8). Firefox, the passphrase lock and gemini-native stay free.
- If Best misses its margin, it is held back from store releases. Editing and exact reuse of edits are free; similar-edit retrieval is Pro. define_term ships off by default and is disclosed.
- Owner defaults: 3 activations per key, the privacy notice is re-shown, the per-run budget stays.

## Next steps
- Owner: confirm that an individual in Vietnam can finish Polar payout onboarding (licensing phase 1).
- Implement M7 first; licensing phases 1–5 can run in parallel. The Pro sale goes live only after Best beats Balanced by the margin.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
