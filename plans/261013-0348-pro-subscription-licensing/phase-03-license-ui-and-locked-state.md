---
phase: 3
title: "Phase 3: License UI and the locked-feature state"
status: todo
priority: P2
effort: "1d"
dependencies: [2]
---

# Phase 3: License UI and the locked-feature state

## Overview

This phase adds the License section in Settings, and the one locked-feature state that M7 and M9 use in the panel
and in Settings. It also adds the en and vi strings for both. The section is hidden until some feature is gated
or a license record exists, so builds stay releasable before the launch.

## Starting point (verified)

- Settings is a list of sections in `Options()` (`src/entrypoints/options/Options.tsx:730-752`). Larger sections live
  in their own files and take `api`, as `DiagnosticsSection` does (`src/entrypoints/options/Diagnostics.tsx:14-35`,
  with a live `storage.local.onChanged` listener). The License section follows that pattern.
- Settings already imports a panel helper (`slots` from `../sidepanel/slots.tsx`, `Options.tsx:7`). So `ProLock.tsx`
  sits in `src/entrypoints/sidepanel/`, and Settings imports it the same way.
- Opening a tab needs no permission: `api.tabs.create` (`src/shared/onboarding.ts:25`). The panel opens Settings
  with `runtime.openOptionsPage()` without an anchor (`src/entrypoints/sidepanel/translator.ts:507`). The lock's link
  opens `runtime.getURL('/options.html#pro')` with `tabs.create`.
- The panel header's controls are `<select>`s (the style mode, `src/entrypoints/sidepanel/HeaderControls.tsx:55`).
  M7 puts Best in a quality `<select>` beside it (M7 phase-04). So a lock must work for one option of a shared select.
- Strings are grouped by surface in `src/locales/en.yml` and `vi.yml` (`options:` at en.yml:273). Locale key parity is
  tested by `src/locales/locales.test.ts`. The vitest `getMessage` stub is `tests/setup/i18n.ts`
  (`vitest.config.ts:35`).

## Requirements

- [ ] The section has the id `pro`, sits after the cache section and before Export and import, and has the title
  "Pro". It renders only when `proVisible(PRO_FEATURES, record)` is true.
  <!-- Red Team: License section visibility -->
- [ ] Each state in plan.md's States table has its own view and actions, `deactivated` included.
- [ ] **The locked state is quiet.**
  <!-- Updated: Validation Session 1 - locked option rule -->
  - A locked option in a shared select is disabled with a "(Pro)" suffix.
  - The `<ProLock>` note shows only beside that control.
  - A locked stand-alone control (a button or a checkbox) is disabled, with the note beside it.
  - There is no dialog, toast, banner, badge, countdown or repeated notice.
- [ ] Before the first activation, one line right above the Activate button says what the check sends and to whom.
- [ ] No price appears in the extension.

## Implementation Steps

1. **`src/entrypoints/options/License.tsx`** (`LicenseSection({ api, now, registry })`).
   <!-- Red Team: deactivated view, forced checks, freed-slot wording -->
   - **Mount.** It reads the record and derives the state. When the record is due, it runs the lazy
     `refreshLicense(api)` once (the section is a natural check point). It re-renders on `onLicenseChanged`.
   - **unlicensed:**
     - an intro (`options.pro.intro`, naming the Pro features without a price);
     - a "Get Pro" link to `checkoutUrl` (`target="_blank" rel="noopener"`);
     - a key field (`type="password"`, `autocomplete="off"`);
     - the disclosure line (`options.pro.disclosure`);
     - Activate. Its errors show inline: `notFound`, `offline`, `deviceLimit`.
   - **active:** "Pro is active on this browser", the last check date, Check now, Manage subscription (`portalUrl`),
     and "Remove from this browser". The key is shown only masked, with `maskKey` (`src/shared/settings.ts:202`).
   - **grace:** the active view plus one status line: "Couldn't reach {provider} since {date}. Pro stays on until {date}."
   - **unconfirmed:** "Couldn't confirm your Pro subscription", Check now and Remove.
   - **lapsed:** "Your Pro subscription has ended. Translations you already have stay readable.", Manage
     subscription, Check again, Remove, and a field to enter another key (activate-first, so a mistyped key changes
     nothing). If phase 1 found the two 404s identical, the first action is "Activate again on this browser"
     (`reactivateLicense`).
   - **deactivated:** "This browser was removed from your subscription, for example in Manage subscription.",
     "Activate again on this browser" (`reactivateLicense`), and Remove. It never says the subscription ended.
   - **device-limit:** "This key is already in use on all the browsers it allows. Free one in Manage subscription,
     then try again." Each browser in Manage subscription is listed as "Translate Side (Chrome) · activated {date}".
     Actions: Manage subscription, Try again, Remove. If phase 1 found the two 403s identical, the text adds "or the
     subscription has ended".
   - **Check now and Check again** call `refreshLicense(api, { force: true })`. That call queues behind a running
     refresh and always validates. The button shows `checking` until it settles.
   - **Remove when offline:** a confirm row. "Couldn't reach {provider}. Remove the key from this browser anyway? It
     keeps using a slot until you free it in Manage subscription."
   - Dates use `Intl.DateTimeFormat` in the UI language.
2. **Wire it in.** Add `<LicenseSection api={api} />` to `Options()` between `<CacheSection>` and
   `<TransferSection>` (`Options.tsx:747-748`). It renders nothing while `proVisible` is false.
   <!-- Updated: Validation Session 1 - release freeze removed -->
3. **`src/entrypoints/sidepanel/ProLock.tsx`.**
   - `useEntitlement(api, feature)` calls `entitlement(api, feature)` from `src/shared/features.ts`, and returns
     `{ available, state }`, or `undefined` while loading. It subscribes to `onLicenseChanged`. It is for display
     only: the job's decision is the value resolved once at job start (plan.md, Gate contract 2).
   - `<ProLock api feature />` renders nothing when the feature is available. Otherwise it renders one
     `<span class="pro-lock" data-pro-lock={feature}>` with "Part of Pro" and a link, "About Pro" (or "Renew" when
     `lapsed`, "Check" when `unconfirmed`), which opens Settings › Pro.
   - `proOptionLabel(label, available)` returns the label, or the label plus `pro.optionSuffix` (" (Pro)"). The call
     site uses it for the locked `<option>`, together with `disabled`.
   - The call site disables its own control or option, places `<ProLock>` beside that control, and sets
     `aria-describedby` to the lock's id. `ProLock` never disables anything itself.
4. **Strings (en and vi).**
   - `options.pro.*`: `title`, `intro`, `buy`, `keyLabel`, `activate`, `activating`, `disclosure`, `active`,
     `lastCheck`, `checkNow`, `checking`, `grace`, `unconfirmed`, `lapsed`, `deactivated`, `activateAgain`,
     `deviceLimit`, `deviceLimitOrEnded`, `tryAgain`, `checkAgain`, `manage`, `remove`, `removeOffline`,
     `removeAnyway`, `otherKey`, `errors.notFound`, `errors.offline`.
   - `pro.locked` ("Part of Pro"), `pro.optionSuffix` (" (Pro)"), `pro.about`, `pro.renew`, `pro.check`, and
     `pro.feature.<id>` for the six names.
   - The disclosure (en): "Activating sends this key to Polar, which sells Translate Side Pro, to check it. After
     that the extension checks it about once a day while you use Pro. The check sends only the key and this
     browser's activation id."
   - Vietnamese is an agent draft and is listed for a native reader's sign-off in phase 6. Keep "Pro", "Polar" and
     "Translate Side" untranslated.
5. **Styles.** Add `.pro-lock` and the section's rows to `src/entrypoints/options/style.css`, and `.pro-lock` to
   `src/entrypoints/sidepanel/style.css`. The lock is muted text, never an accent colour.
6. **Tests.**
   - `src/entrypoints/options/License.test.tsx`:
     - each of the seven states renders its view;
     - the section renders nothing with nothing gated and no record, and renders with a record present;
     - Activate success writes the record;
     - each Activate error shows its message and writes nothing;
     - an invalid key entered in the `lapsed` view leaves the old record;
     - Activate again in `deactivated` runs an activate, not a validate;
     - Check now while a refresh is running still validates;
     - Remove online removes the item;
     - Remove offline shows the confirm, and Remove anyway removes it;
     - the key never renders unmasked after activation.
   - `src/entrypoints/sidepanel/ProLock.test.tsx`:
     - nothing renders when available;
     - when locked it shows one note and one link, with no `role="dialog"` or `role="alert"`;
     - the link text follows the state;
     - `proOptionLabel` adds " (Pro)" only when unavailable;
     - a storage change re-renders.
   - The existing `Options.test.tsx` keeps passing unchanged (no `license` item and nothing gated, so the section
     is hidden).

## Todo

- [ ] `LicenseSection` with all seven views, visibility rule and forced checks
- [ ] Section wired into Settings
- [ ] `useEntitlement`, `<ProLock>`, `proOptionLabel`
- [ ] en and vi strings with key parity
- [ ] Styles
- [ ] Component tests green

## Files

- Create: `src/entrypoints/options/License.tsx`, `src/entrypoints/options/License.test.tsx`,
  `src/entrypoints/sidepanel/ProLock.tsx`, `src/entrypoints/sidepanel/ProLock.test.tsx`.
- Modify: `src/entrypoints/options/Options.tsx` (one import, one line), `src/entrypoints/options/style.css`,
  `src/entrypoints/sidepanel/style.css` (`.pro-lock` only), `src/locales/en.yml`, `src/locales/vi.yml`.

## Success Criteria

- `pnpm check` is green, including locale parity.
- The phase report has screenshots of Settings › Pro in each state, in en and vi (rendered with an injected gated
  registry or a seeded record), at 1280 px. It also shows a locked select option and its note at panel width,
  360 px, in a component harness.
- With no `license` item and nothing gated, Settings and the panel look exactly as before.

## Risks

- **"Nagging" is subjective.** The rules in Requirements are checkable: no dialog or alert role, one link, the
  note only beside its control. The reviewer checks them against the screenshots.
- **Long vi strings at 360 px.** Fix the layout (wrapping), not the text.

## Rollback

Revert the phase's commits. The entitlement core stays and works without UI.
