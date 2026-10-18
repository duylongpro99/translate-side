---
phase: 1
title: "Phase 1: Owner gate: provider account and public config"
status: todo
priority: P2
effort: "owner time + 0.25d"
dependencies: []
---

# Phase 1: Owner gate: provider account and public config

## Overview

This is the "phase 0" gate. No licensing code is written until the owner has proven that the chosen provider can
pay an individual in Vietnam, and the Pro product and its license-key benefit exist. The research could not verify
onboarding: Stripe's self-serve cross-border payouts list only the US, UK, EEA, CA and CH, so Polar's Vietnam payout
depends on its own arrangement (research, Unresolved question 1). If Polar fails, the plan switches to Lemon Squeezy here,
before any adapter exists.

## Requirements

- The owner does the account steps. The agent prepares the checklist, captures the sandbox response fixtures with
  a sandbox key the owner supplies locally, and records the results.
- Only public values are recorded: organization id, benefit id, checkout URL and customer portal URL, for sandbox
  and production. A license key, customer email or customer name is never committed or written to the log.
- Recommended time box: 7 days of elapsed time for payout onboarding. After that, the owner decides between waiting
  and Lemon Squeezy.

## Implementation Steps

1. **Polar payout onboarding (owner).** Create a Polar organization as an individual. Complete payout onboarding
   (Stripe Connect Express) with a Vietnamese bank account. **Pass:** the dashboard shows payouts enabled, or the
   account as verified. **Fail:** onboarding refuses the country or the individual status. Then go to step 6.
2. **Product and benefit, production and sandbox (owner).** In both `polar.sh` and the sandbox
   (`sandbox.polar.sh` [UNVERIFIED host name; confirm in the dashboard]):
   - a product "Translate Side Pro", recurring monthly, $5.00;
   - a License Key benefit on it: activation limit 3 (owner-accepted default, Validation Session 1), no fixed expiry (the
     subscription governs it), and customers may deactivate activations in the portal;
   - failed-payment grace (dunning) set to 7 days, the research's recommendation;
   - a checkout link for the product, and the customer portal enabled.
3. **Record the public config (agent).** In `docs/progress/progress-pro.md`, record a table with the organization
   id, benefit id, checkout URL, customer portal URL and API base for sandbox and production. Phase 2 hard-codes
   these values in the adapter.
4. **Capture sandbox fixtures (agent, local only, never in CI).** The owner buys a sandbox subscription with a test
   card and puts the sandbox key in `.env` as `POLAR_SANDBOX_KEY` (`.env` is never committed). With `curl` against
   the sandbox API, the agent records the status, the `content-type` and the JSON body of each call:
   <!-- Red Team: definitive-answer shapes and the 403/404 causes -->
   - activate (200);
   - validate granted (200);
   - activate past the limit (403), after 3 activations;
   - activate a revoked key (403), for comparison with the previous one;
   - deactivate (204);
   - validate with a wrong `benefit_id`;
   - validate after the owner revokes the key in the dashboard (404);
   - validate after the activation is freed in the customer portal while the key stays valid (404, the
     `deactivated` case);
   - activate with a made-up key (404).

   For each, also record the error envelope's type field (for example Polar's `error` / `detail` keys). Phase 2
   counts an answer as definitive only when it matches one of these recorded shapes.

   It replaces the key, email, name and ids with placeholders, and writes the results to
   `src/shared/license-fixtures/polar-*.json` in phase 2's branch. Phase 2 owns the folder; this phase only
   produces the content.
5. **CORS check (agent).** Repeat the research's check against the sandbox host: an `OPTIONS` preflight with
   `Origin: chrome-extension://test` and `Access-Control-Request-Headers: content-type` must answer
   `Access-Control-Allow-Origin: *`. Record the result (plan.md Unresolved question 1).
6. **Fallback: Lemon Squeezy (only if step 1 fails).** The owner creates a store as an individual with Vietnam bank
   or PayPal payout, a subscription product at $5/month, and license keys with activation limit 3. The agent records
   `store_id`, `product_id`, `variant_id`, the checkout URL and the "My Orders" portal URL. It captures the same
   fixtures in test mode (`POST https://api.lemonsqueezy.com/v1/licenses/{activate,validate,deactivate}`,
   form-encoded) and marks phase 2's adapter as `license-lemonsqueezy.ts`.
7. **Record the decision.** Write "Provider: Polar" or "Provider: Lemon Squeezy, because …" at the top of
   `docs/progress/progress-pro.md`.

## Todo

- [ ] Owner: payout onboarding passes (or fails, and step 6 runs)
- [ ] Owner: product, license-key benefit, 7-day dunning grace and checkout link in sandbox and production
- [ ] Agent: public config table in `docs/progress/progress-pro.md`
- [ ] Agent: redacted sandbox fixtures for the 9 calls in step 4, with content type and error type
- [ ] Agent: sandbox CORS result recorded
- [ ] Provider decision recorded

## Success Criteria

- Payouts are confirmed enabled for the owner's individual account on the chosen provider.
- The public config table is complete for sandbox and production.
- The 9 fixtures exist, with no key, email or name in them (a grep for `@` and for the key's prefix finds nothing).
- **Pass conditions recorded:** <!-- Red Team: 403 difference is a pass condition -->
  - whether the two 403 bodies (limit reached, revoked) differ in a field the adapter can read;
  - whether the two 404 bodies (activation freed, key revoked) differ.

  If either pair does not differ, record that. Phase 2 then uses the combined view described in its step 4, and
  never makes a follow-up call to tell them apart.

## Risks

- **Onboarding takes weeks.** Phases 2–5 cannot start. The time box forces a decision.
- **Sandbox behaviour differs from production.** The fixtures come from the sandbox. Phase 6 re-runs activate and
  validate once against production with the owner's own purchase.

## Rollback

Nothing to roll back in code. A Polar account that is not used can be closed.
