---
phase: 5
title: "UI localization (en, vi)"
status: pending
priority: P2
effort: "1.5d"
dependencies: [3, 4]
---

# Phase 5: UI localization (English and Vietnamese)

<!-- Updated: Red Team 2026-10-11. A vitest getMessage stub, LLMError kinds mapped to keys, the onboarding rebinding
     note owned here, action.default_title localized. The JSX scan test is dropped. -->

## Goal

Every user-visible string in the extension comes from locale files. The UI follows Chrome's language in English or
Vietnamese, and the manifest name and description are localized.

## Plan tasks owned

- M6-E7: the UI localization scaffold.

## Done criteria (copied from docs/plans/M6-release-hardening.md, with the contract's choice)

- §4: "Full UI translation (only the localization scaffold plus English and the assumed user's target language)."
  Contract decision 4 fixes the second language as Vietnamese (`vi`).
- Contract acceptance: "The English and Vietnamese UI strings both load".

## Why this order

This phase touches almost every UI file: the side panel, options, onboarding and shared error messages, about
170–200 strings in the scout's estimate. It runs after phases 3 and 4 so it doesn't collide with their UI edits, and
before phase 6 so the store screenshots show the final UI.

## Starting point

- **No i18n library.** `chrome.i18n`, `_locales` and `@wxt-dev/i18n` are all unused. The only i18n call is
  `getUILanguage` (`src/shared/settings.ts:290`).
- **Manifest text.** The name and description are hardcoded (`wxt.config.ts:14-15`).
- **Research** (§3): `@wxt-dev/i18n` 0.2.8 is a typed wrapper over `chrome.i18n`. It works in Preact pages and uses
  `src/locales/<lang>.yml`, plus `default_locale: 'en'` and `__MSG_*__` in the manifest.

## Steps

1. **Add the library.** Add `@wxt-dev/i18n`, pinned, and the WXT module. Create `src/locales/en.yml` and
   `src/locales/vi.yml`. Set `default_locale: 'en'` and use `__MSG_extName__` and `__MSG_extDescription__` for the
   manifest name and description. Also localize `action.default_title` (`wxt.config.ts:20`) and the panel-toggle
   command description.
2. **Move the strings.** Move every user-visible string in `src/entrypoints/**` and the user-facing messages in
   `src/shared/**` to keys. That covers labels, `aria-*` attributes, titles, placeholders, and error and status text.
   - **Grouping:** keys are grouped by surface (`panel.*`, `options.*`, `onboarding.*`, `errors.*`).
   - **Plurals:** use the library's plural form, never string concatenation.
   - **Unchanged:** prompts sent to models and the translation target language list.
   - **Error messages:** user-visible messages in `src/llm/errors.ts` (:22, :95, :99, :110, :198) are shown through
     `LLMError.kind` mapped to keys in the shell. The `llm/` layer keeps its English developer messages.
   - **Onboarding:** add the `Alt+T` rebinding note (`chrome://extensions/shortcuts`) to
     `src/entrypoints/onboarding/Onboarding.tsx:88`, as a localized key. This phase owns that file.
3. **Translate to Vietnamese.** Write natural Vietnamese for every key. Keep technical names (Ollama, API key,
   OpenRouter) as they are, and keep keyboard key names.
4. **Update the checks.** `scripts/check-manifest.mjs` asserts `default_locale` and that every `__MSG_*__` resolves
   in both locales. The rest of the production manifest stays unchanged.
5. **Tests.**
   - **Test setup:** add a vitest setup file for the `shell` project (`vitest.config.ts:16-21`). It loads the
     generated `en` messages into a `getMessage` stub on the fake browser, which has no `i18n` today
     (`src/shared/settings.ts:290` guards for that). The 36 test files that assert English text keep passing.
   - en and vi have identical key sets, and no placeholder is missing.
   - Existing UI tests keep passing in `en`.
   - One e2e flow runs Chromium with `--lang=vi` and asserts the panel's Vietnamese heading and the privacy notice.
6. **Flag for review.** Add the Vietnamese text to the beta checklist for human review in phase 7. The agent's
   Vietnamese is a draft until a native reader signs it off.

## Files

- Create: `src/locales/en.yml`, `src/locales/vi.yml`, `src/shared/i18n.ts` (if a thin wrapper is needed for tests),
  `src/locales/locales.test.ts`.
- Create: `tests/setup/i18n.ts` (the `getMessage` stub).
- Modify: `wxt.config.ts`, `vitest.config.ts`, `package.json`, `pnpm-lock.yaml`, `scripts/check-manifest.mjs`, the UI
  files under `src/entrypoints/**` (including `onboarding/Onboarding.tsx`), the user-facing messages in
  `src/shared/**`, the panel's error display (mapping `LLMError.kind` to keys), and `e2e/flows.spec.ts`.

## Verification

- `pnpm check` and `pnpm run e2e` are green, including the `--lang=vi` flow.
- `.output/chrome-mv3/_locales/{en,vi}/messages.json` exist, and the manifest resolves the name in both locales.
- The phase report includes screenshots of the panel and options pages in en and vi.

## Risks

- **Long Vietnamese strings overflow narrow panel layouts.** Check the en and vi screenshots at panel width
  (360 px) and fix the layouts, not the text.
- **Moving the strings breaks text-matching tests.** Prefer updating them to `data-testid`, and keep English as the
  test locale.
