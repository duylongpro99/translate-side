---
phase: 5
title: "Phase 5: Privacy and store text"
status: todo
priority: P2
effort: "0.5d"
dependencies: [2, 4]
---

# Phase 5: Privacy and store text

## Overview

The license check is the first request that goes somewhere other than the user's AI provider. This phase makes
the privacy page, the store's privacy answers, the permission page's data note and the in-panel notice say so
accurately. The store listing's pricing line and description wait for the launch (phase 6). Everything here is in
English; the one new panel string also gets a Vietnamese draft.

Steps 1–4 touch only `docs/**` and may run alongside phase 4. Steps 5–6 touch code and `e2e/fixtures.ts`, so they
wait until phase 4 is accepted.

## Starting point (verified)

These statements become false once the check exists:
- `docs/privacy.md:11`: "no account", and "Nothing is sent to the developer";
- `docs/privacy.md:99`: "The extension makes network requests only to the provider addresses you configured";
- `docs/store/permission-justifications.md:111`: "There is no developer server, no telemetry and no account."

Other starting facts:
- `docs/privacy.md:18` promises that a change to what the page describes re-shows the panel's notice. The notice
  version is `PRIVACY_NOTICE_VERSION = 2` (`src/entrypoints/sidepanel/privacy.ts:12`). The e2e seed acknowledges
  version 2 (`e2e/fixtures.ts:179`).
- The store data-use answers are in `docs/store/listing.md:79-86`. "Authentication information" is ticked; PII,
  financial and payment information are unticked.
- The export leaves the license out structurally (`src/shared/portable.ts:159-199` reads only `secret:<connectionId>`).
  Its header comment lists what never goes in (`portable.ts:1-6`).

## Requirements

- [ ] The privacy page names Polar (or Lemon Squeezy, per phase 1). It says what is sent, when, what comes back,
  what is kept, where, how to delete it, and that a user without a key makes no such request.
- [ ] Every new claim has a reviewer citation in the page's closing comment, as the existing ones do.
- [ ] No text claims that the extension sends nothing to anyone but the provider.

## Implementation Steps

1. **`docs/privacy.md`.**
   - **In short:** change the "no account" bullet to keep "no Translate Side server, no analytics, no telemetry",
     and add: "If you buy Pro and enter its license key, the extension checks the key with Polar, the shop that
     sells Pro, when you activate it and about once a day while you use Pro. It never happens without a key."
   - **One list of outside calls.** <!-- Updated: Validation Session 1 - extendable claim for M9's define_term -->
     Word the claim as a list, not as "the only request". Add a short subsection, "Requests other than your
     provider", with one bullet per call: "the Pro license check, only if you entered a license key". M9 appends
     "dictionary lookups, only if you turn them on" when `define_term` ships, with no other sentence to rewrite. The
     In short bullet, the No tracking sentence, the store answer and the permission page's Data note all point to
     this list instead of repeating "only".
   - **New section "Pro license check"** (after "What is sent, and to whom"):
     - What is sent: the key, Polar's public organization id, this browser's activation id, and the fixed label
       "Translate Side (Chrome) · activated <date>" (the date only, to tell your browsers apart in Manage
       subscription). Polar sees the network address and the `chrome-extension://` origin, as with any
       request. No page text, page address, setting or provider key is sent.
     - When: on Activate; then at most about once a day, when Settings is open or a Pro feature is used, after 24
       hours (and once a day for up to 30 days after a subscription ends, to catch a mistaken "ended"); on Check now;
       and on Remove. There is no background timer.
     - What comes back, and what is kept: the status, the expiry date and the activation id. Polar's answer also
       carries the buyer's email and name. The extension does not keep them.
     - Offline: Pro stays on for up to 7 days without an answer.
     - Payment happens on Polar's site, under Polar's own terms and privacy policy. The extension never sees card details.
   - **Storage table:** in the `storage.local` row, add "Your Pro license key, its activation id and the result of
     the last check". The license is never synced and never exported, even with "include keys".
   - **No tracking:** reword `:99` to "The extension makes network requests to the provider addresses you
     configured, and otherwise only those listed under Requests other than your provider."
   - **Deleting your data:** add "Pro license: Settings › Pro › Remove from this browser. This also frees the
     browser's slot at Polar."
   - **Reviewer comment:** cite `src/shared/license.ts` (record, fields kept, lazy check),
     `src/shared/license-polar.ts` (endpoints, body fields, `credentials: 'omit'`),
     `src/shared/features.ts` (no check without a record), `e2e/fixtures.ts` (no license call without opt-in)
     and `src/shared/portable.ts` (never exported). Add line numbers once the code exists.
   - Leave "Effective for version 1.0.0" alone. Phase 6 sets the launch version.
2. **`docs/store/listing.md`, Privacy tab** (`:79-86`).
   - "Authentication information": add that the Pro license key is sent to the license provider to check it.
   - Add a note that the license check receives the buyer's email and name and discards them on the device. PII
     stays unticked (owner-accepted default, Validation Session 1). <!-- Updated: Validation Session 1 - PII unticked -->
   - "Financial and payment information" stays unticked: payment happens on Polar's site.
   - Add a reviewer-comment line for the new answers.
   - Do **not** change `Pricing: free` (`:101`) or the description yet.
3. **`docs/store/permission-justifications.md`, Data** (`:111`). Replace the sentence with: "There is no developer
   server and no telemetry. Requests other than the user's provider are listed in the privacy policy;
   today that is the optional Pro license check, made only after the user enters a key." Add a sentence that the license check needs no permission, because the
   license service allows any origin (CORS).
4. **Docs check.** A grep for "only to the provider", "the only request", "no account" and "nothing to its developer" across `docs/`
   and `README.md` lists every remaining hit, and each is either reworded or confirmed true. The listing's
   description bullet "sends nothing to its developer" is handed to phase 6.
5. **The panel's notice** (after phase 4). The notice is re-shown to every user once licensing ships (owner-accepted
   default, Validation Session 1). <!-- Updated: Validation Session 1 - notice re-shown -->
   - Set `PRIVACY_NOTICE_VERSION = 3` (`src/entrypoints/sidepanel/privacy.ts:12`).
   - Add `panel.privacy.license` (en and vi draft): "If you add a Pro license key in Settings, the extension also
     checks it with Polar about once a day. Without a key, no license check is made."
   - Render it in `PrivacyNotice.tsx` after the diagnostics line.
   - Update the e2e seed to version 3 (`e2e/fixtures.ts:179`). Check `e2e/upgrade.spec.ts` and
     `src/entrypoints/sidepanel/privacy.test.tsx` still pass; the upgrade test already expects the notice again
     after an update (commit c99ce95).
6. **Export comment and test.**
   - Extend the header comment of `src/shared/portable.ts` (`:5-6`, "Device-only data … never goes in") with the Pro license.
   - Add a test to `portable.test.ts`: with a `license` item in local storage and `includeKeys: true`, the exported
     JSON contains neither the key nor the activation id.
   - Add a second test: an import file with a `license` field writes no `license` item.

## Todo

- [ ] `docs/privacy.md` (In short, new section, table, No tracking, Deleting, reviewer comment)
- [ ] `docs/store/listing.md` Privacy tab answers
- [ ] `docs/store/permission-justifications.md` Data
- [ ] Grep sweep done
- [ ] Notice version 3 with the new line (if confirmed)
- [ ] Export comment and two tests

## Files

- Modify: `docs/privacy.md`, `docs/store/listing.md`, `docs/store/permission-justifications.md`,
  `src/entrypoints/sidepanel/privacy.ts`, `src/entrypoints/sidepanel/PrivacyNotice.tsx`, `src/locales/en.yml`,
  `src/locales/vi.yml` (`panel.privacy.license`), `e2e/fixtures.ts` (seed line), `src/shared/portable.ts` (comment),
  `src/shared/portable.test.ts`.

## Success Criteria

- Each claim in the new privacy text matches the code and has a citation in the reviewer comment. The reviewer
  checks it against the source, not this plan.
- `pnpm check` and `pnpm run e2e` are green.
- The grep in step 4 leaves no false statement.

## Risks

- **The text is ahead of the shipped version.** The policy URL resolves to `master` (`docs/store/listing.md`
  Privacy policy URL). Describing a check that store users do not have yet is over-disclosure, which is safe.
  Leaving it out would be the unsafe direction.
- **The notice bump re-asks every user.** It is one click, and the owner accepted it (Validation Session 1).

## Rollback

Revert the docs together with the code. Lowering the notice version again is harmless: users who acknowledged
version 3 would simply see version 2 as unacknowledged and click once more.
