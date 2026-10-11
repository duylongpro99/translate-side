---
phase: 6
title: "Store package and docs"
status: pending
priority: P1
effort: "1.5d"
dependencies: [3, 4, 5]
---

# Phase 6: Store package and docs

<!-- Updated: Red Team 2026-10-11. The privacy text describes auto-translate on allowlisted sites and diagnostics,
     and is written after phase 3. The http://*/* decision is a user gate before steps 2-4. The listing is English
     only. Onboarding is owned by phase 5. -->

## Goal

Everything the Chrome Web Store submission needs is ready in the repo. The docs a new user needs are published.
Nothing claims behavior the code doesn't have.

## Plan tasks owned

- M6-E1: store assets, privacy policy and permission justifications.
- M6-E8: docs — README, local model setup, provider matrix (from M4) and the privacy page.

## Done criteria (copied from docs/plans/M6-release-hardening.md, with the contract's reading)

- §2: "The store listing has screenshots, a privacy policy and a justification for every permission, including the
  wildcard `optional_host_permissions`." and "README, Ollama/LM Studio setup guide, provider matrix and privacy page
  are published."
- §5: "Host permission justification | `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` (and `http://*/*`
  for LAN gateways), requested only on user action per origin." and "`Alt+T` on macOS | Keep default; document
  rebinding in onboarding and README."
- Contract reading of §3 #1: the agent's part is done when the zip, the listing text, the screenshots, the privacy
  policy and the permission justifications are complete. The user publishes.

## Ordering

Steps 5 and 6 (the local model guide and the README) may start in parallel with phases 1–4. Their implementer owns
only `docs/local-models.md` and `README.md`.

Steps 2–4 (privacy, justifications, listing) wait for two things:
- the user's decision on `http://*/*` (see "Decision gate");
- phases 3 and 4, so storage and diagnostics claims cite the final modules.

Steps 1, 7 and 8 wait for phase 5, because the final UI and locales are needed for screenshots and the zip.

## Decision gate: `http://*/*`

<!-- Updated: Validation Session 1 - http://*/* decided: localhost and private network only -->
Store policy requires user data to be sent over HTTPS (research §2). The manifest offers `http://*/*` for LAN
gateways (`wxt.config.ts:17-19`, asserted by `scripts/check-manifest.mjs:17`).

**Decision (Validation Session 1).** The manifest keeps `http://*/*`, `http://localhost/*` and `http://127.0.0.1/*`.
The code accepts a plain-HTTP provider endpoint only when its host is:
- loopback: `localhost`, `127.0.0.0/8` or `[::1]`;
- a private network: `10.0.0.0/8`, `172.16.0.0/12` or `192.168.0.0/16`;
- or a `*.local` name.

Any other `http://` endpoint is refused, with a message asking for HTTPS. A private-network HTTP endpoint shows a
standing note: "Unencrypted: only use this on a network you trust."

`http://*/*` also covers allowlisting plain-HTTP websites. Those pages are only read; their text goes to the
provider over that provider's own connection, so that use is unchanged.

The justification states that page text is sent over plain HTTP only to the user's own machine or local network,
never across the internet. `check-manifest.mjs` is unchanged.

## Starting point

- **Docs.** There is no privacy page, no permission justification text and no local-model guide. Privacy wording
  exists only in the app (`src/entrypoints/sidepanel/PrivacyNotice.tsx:12-38`). That notice blocks sending until the
  user acknowledges it. But it says "only after you click below", while allowlisted sites translate each new page
  automatically (`src/shared/sites.ts:4-7,115-125`). The disclosure must cover that.
- **Permissions.** The M5 handoff (`docs/progress/progress-m5.md:674-691`) lists every permission and the code that
  uses it.
- **Store rules** (research §2):
  - assets: a 128 px icon, 1–5 screenshots at 1280×800, and a 440×280 small promo tile, which is required;
  - the Privacy tab: single purpose, a justification for each permission, remote code "No", data-type disclosures
    ("Website content"), Limited Use certification and a privacy policy URL;
  - user data must be sent over HTTPS (the July 2026 policy, enforced from 2026-08-01).
- **Version.** `package.json:3` is `0.0.1`.

## Steps

1. **Version 1.0.0.** Set `package.json` to `1.0.0`. WXT carries it to the manifest.
1a. **HTTP endpoint rule.** This may run as soon as the decision is recorded. Add `isPlainHttpAllowed(url)` beside
   the existing `isLocal` helper (`src/entrypoints/options/Providers.tsx:88`), or in `src/shared/settings.ts` if it
   is shared, and enforce it in two places:
   - when a connection is saved or tested in Providers (around `Providers.tsx:586,737`);
   - when it is resolved for a request (`resolveConnection`, `src/shared/settings.ts:218`), so an imported or synced
     connection that breaks the rule is refused too.

   Unit tests cover each address range, public HTTP, IPv6 loopback and `.local`.
2. **Privacy policy.**
   - **`docs/privacy.md`:** what is read (page text, only on user action and never on excluded pages), where it goes
     (the provider the user chose, over the user's own connection), and what is stored locally and where (keys in
     `storage.local`, settings in `storage.sync`, cache in IndexedDB, diagnostics in `storage.local`).
   - **It also says:** there is no telemetry, there is no developer server, and how to delete everything.
   - **Automatic translation:** the policy states that sites the user allowlists are translated automatically on
     each visit while the panel is open. The same sentence goes into the privacy notice (with the version bump from
     phase 4) and into the listing.
   - **Diagnostics:** what the log holds, that it stays on the device, and how to clear it.
   - **Source of every claim:** the code. Cite the module per claim in a reviewer-only comment block at the end.
   - **URL:** the public GitHub URL of this file.
3. **Permission justifications.** `docs/store/permission-justifications.md` has one paragraph per permission and
   per optional host pattern, citing the user action that triggers it. It must apply the decision taken in
   validation on `http://*/*` against the HTTPS rule.
4. **Listing copy.** `docs/store/listing.md`, in English:
   - the single-purpose statement, short description and detailed description;
   - the Privacy-tab answers: data types, Limited Use and remote code "No";
   - the category, the support URL (GitHub issues) and the homepage URL.
5. **Local model guide.** `docs/local-models.md` covers Ollama and LM Studio setup:
   - install, pull a model, and the origin setting needed for requests from the `chrome-extension://` origin
     (Ollama's `OLLAMA_ORIGINS`);
   - the base URLs, the Providers screen steps and troubleshooting.

   It also notes decision G5: the project's own measurements used Ollama cloud, so local numbers are the user's to
   measure.
6. **README.** Update install (store link placeholder until it is published), features, privacy (link), local models
   (link), provider matrix (link to `docs/provider-matrix.md`, including phase 1's Haiku cost), and the keyboard
   shortcuts with `Alt+T` rebinding on macOS (`chrome://extensions/shortcuts`). Phase 5 adds the onboarding note;
   this step covers only the README.
7. **Screenshots and tile.** `scripts/store-screenshots.mjs` reuses the phase 2 harness against the mock provider
   and fixture pages, because no real key belongs in an image. It produces:
   - five screenshots at 1280×800: the page with the panel, hover link, options and providers, the glossary and
     site rules, and the Vietnamese UI;
   - a 440×280 tile rendered from an HTML template.

   Output goes to `docs/store/assets/`.
8. **Zip.** Run `pnpm run zip`, then check the zip: production manifest, no source maps unless intended, no `.env`,
   and no host permissions beyond the decided optional ones (`check:manifest` on the unpacked build). Record its name, size and SHA-256 in `docs/store/submission.md`, together with
   the step-by-step upload checklist for the user.

## Files

- Create: `docs/privacy.md`, `docs/local-models.md`, `docs/store/listing.md`, `docs/store/permission-justifications.md`,
  `docs/store/submission.md`, `docs/store/assets/*.png`, `scripts/store-screenshots.mjs`, `scripts/store-tile.html`.
- Modify: `README.md`, `package.json` (version), `src/entrypoints/sidepanel/PrivacyNotice.tsx` (the auto-translate
  sentence), `src/entrypoints/options/Providers.tsx` and `src/shared/settings.ts` (the HTTP endpoint rule), and
  their tests.

## Verification

- Every claim in `docs/privacy.md` and in the justifications maps to a code citation. A reviewer checks this against
  the source, not against the M5 log.
- The assets' dimensions are exact (check with `sips -g pixelWidth -g pixelHeight` or `file`).
- `pnpm check` is green and `pnpm run zip` succeeds. The zip contents are listed in the report.
- The README links resolve (relative links only).

## Risks

- **Store rejection over `http://*/*`.** The validation decision applies here, and an unlisted release goes first
  (plan §8).
- **Docs drifting from code.** Cite modules, and don't restate numbers that a machine-owned file already holds;
  link to it instead.
