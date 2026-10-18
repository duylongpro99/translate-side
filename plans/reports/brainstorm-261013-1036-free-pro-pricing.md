# Free and Pro pricing decision

Date: 2026-10-13 · Status: accepted direction, not yet planned

## Decision

- **v1.0 launches free**, with every feature in the README feature table. The store listing's
  "Pricing: free" stays as it is.
- **Pro is $5 per month** and arrives with M7 and M8. Users keep bringing their own API key or
  local model; there is no hosted translation service.
- **Beta testers get no Pro grant.** They use Free like everyone else.

## Feature split

| Free (all of v1) | Pro ($5/month) |
|---|---|
| Side-by-side panel, streaming, Alt+T | Best mode: a reviewed second pass replaces drafts (M7 `refine`) |
| All providers, local models, routing, fallback | Learns from your edits: translation memory (M7) |
| Document brief, style modes, personal glossary | Deep mode for hard texts (M8 `agentic`) |
| Output checks and repair, cache, long pages, single-page apps | PDF side by side (M8) |
| Hover link, scroll sync, keyboard and screen readers | Domain packs and per-site tone (M8) |
| Cost readout, export and import, diagnostics | Code-comment translation (M8) |

These stay free on purpose: Firefox, the passphrase lock and other privacy and safety features,
accessibility, and any new provider adapter.

## Constraints

- No shipped v1 feature moves behind Pro.
- No Translate Side server for translation; MIT license unchanged.
- Licensing uses an external service, because the Chrome Web Store has no payments. A monthly
  subscription has to be checked again from time to time (with a grace period offline), not only
  on activation. `docs/privacy.md` and the store privacy answers must say that this license check
  is the only call that goes anywhere other than the user's chosen provider.

## Acceptance criteria for the Pro release

- Every feature in the README feature table still works without a license.
- Each Pro feature maps to a planned M7 or M8 item and is gated in one place.
- Best mode beats Balanced on the eval set by the M7 margin before Pro goes on sale.
- A lapsed subscription turns Pro features off cleanly; translations already cached stay readable.
- The privacy policy and store listing describe the license check accurately.

## Risks

- **Monthly price on top of provider costs.** Users already pay their provider per page, so $5 a
  month must feel worth it every month. This holds only if Best mode is clearly better. Watch
  early churn; a yearly option is the usual fix if it is high.
- **M7 may not reach its margin.** If `refine` does not beat `contextual`, Pro has no lead feature;
  delay the Pro launch rather than selling a small gain.
- **Forks can remove the gate** (MIT). Accepted: Pro sells convenience and support, not secrecy.

## Open for the M7 plan

- Licensing provider (Lemon Squeezy license keys, ExtensionPay, or Paddle): confirm subscription
  support, how often status is checked, and what data the check sends.
- Where the gate lives in code, and how the UI shows a locked Pro feature without nagging.
