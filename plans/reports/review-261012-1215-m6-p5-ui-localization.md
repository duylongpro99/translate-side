# Review: M6 phase 5, UI localization (en, vi)

Scope: `git diff 8e57a15..m6` (head f210ae5, six commits), read-only in the m6 worktree. Screenshots in `plans/reports/m6-p5-screens/` were checked.

## Verdict

**No blocking findings.** The scaffold, the English and Vietnamese locale files, the manifest wiring, the test setup and the e2e flow meet the done criteria ("English and Vietnamese UI strings both load"). The findings below are non-blocking. The one to act on before release is the Linux CI run of the Vietnamese e2e flow (F1).

Checked and clean: only `default_locale` and `__MSG_*__` changed in the manifest; `check-manifest` asserts are real (default locale, at least one `__MSG_` key, each key resolves non-empty in both built locales); en and vi key sets, kinds and placeholders are compared by `locales.test.ts`; the vitest stub loads the generated `en` messages; no existing text assertion was weakened (changes are constant→function renames, and one removed `ROLE_LABELS` assertion for a removed constant); `src/llm` and `src/engine` are untouched; the added lines contain no plan IDs, phase numbers, finding codes, home paths or username; commits are conventional with no AI references.

## Deviation judgements

1. **E2E locale on macOS and Linux (F1): acceptable, needs one Linux run.** See F1 and F2.
2. **Constants to functions, removed constants, English saved label: acceptable.** Functions are required because the language is resolved at call time. The removed constants (`ROLE_LABELS`, four `snippet.ts` messages) have no remaining users, and the tests moved to the functions. A saved connection keeps the English preset label because it is user data and editable (see F6 for the side effect).
3. **Diagnostics `KIND_MESSAGES`, provider/LLM text, DevView stay English: acceptable.** They are developer or export-file text and the plan keeps `llm/` messages English. Provider-supplied text inside `quota`, `model_not_found` and the default branch of `failureText` stays English in a Vietnamese panel; that is unavoidable.
4. **`errors.auth` is a fixed message: acceptable.** Every HTTP 401, 403 and Google-400 auth error already carried the fixed text "Key invalid or missing" (`src/llm/errors.ts:95,101,122`), so the user sees the same words in English. Only a mid-stream `permission_error` or `authentication_error` event (`errors.ts:146-147`) carried a provider sentence, which is now replaced by the generic message. See F4 for the coupling this introduces.
5. **No beta checklist yet: acceptable.** `vi.yml` has a draft header; phase 7 owns the native review. Phase 7 must add the checklist entry, which step 6 requires.

## Findings (all non-blocking)

**F1. The Vietnamese e2e flow is unverified on Linux CI.** `e2e/fixtures.ts:44-57,136-141`, `.github/workflows/ci.yml` (e2e job on ubuntu-latest). Linux Chromium reads its UI locale from `LANGUAGE` (the fixture sets it, plus `--lang` and Playwright's `locale`), which is the mechanism I expect to work, but nobody has run it. The flow asserts `chrome.i18n.getUILanguage()` matches `vi` and `getMessage('actionTitle')` is Vietnamese, so a wrong locale fails loudly rather than passing falsely. The risk is a red CI, not a silent pass. Recommendation: run `pnpm run e2e` once on Linux (the CI job after the next push, or a Playwright ubuntu container) before phase 6 relies on it. Violates: phase file Verification ("`pnpm run e2e` is green, including the `--lang=vi` flow"), for the CI environment.

**F2. The darwin wrapper is test-only but has two small rough edges.** `e2e/fixtures.ts:50-56`. It lives only under `e2e/` and only runs when `uiLang` is set on darwin, so it cannot reach the shipped extension. (a) It writes a fixed path `$TMPDIR/e2e-chromium-vi.sh` with no per-worker name, so two parallel workers starting a vi test could rewrite the file while another executes it. Today there is one vi test, so it cannot happen; a unique name (or a write-once check) would remove the trap. (b) `-AppleLanguages` and `(vi)` are appended as loose arguments, which Chromium may treat as extra start URLs. It passes today because the fixture opens pages by itself, but a test that reads `context.pages()[0]` for the vi flow could see a stray page.

**F3. Compositional sentences remain in a few places, against "no concatenated sentences".** `panel.privacy.text` plus `now`/`fallback`/`then` (`PrivacyNotice.tsx:22-31`), `panel.job.fallback.*` built from `$1 $2` where `$2` is a `why`/`whyPast` clause, `panel.job.localBusy` (`$1 $2`), `options.providers.and` joining protocol names, and `removed0`..`removed3` (count-selected by hand instead of the plural form). The `{name}` slot approach keeps word order in the translator's hands for the privacy and redirect messages, so this is a limited problem; the `why`/`fallback` clause pairs fix a grammatical shape that Vietnamese happens to tolerate but other languages would not. Acceptable for en and vi, worth noting before a third language.

**F4. `failureText` and `noBasicText` depend on English developer message text.** `src/entrypoints/sidepanel/status.ts:30-36,41,58-60`. It matches `"Key has characters that can't be sent"`, `/^No access to (.+)$/`, and the regex for "X can't translate A → B on this device…" against messages produced in `src/llm` and `src/engine`. If any of those developer strings is reworded, the match fails silently: `authCharacters` becomes the generic auth message, the host is dropped, and the basic-translation reason falls back to English. There is no test that ties the matched strings to their producers. Suggested follow-up: a unit test that calls the real producers (`classifyHttp` and the engine message helper) and asserts the mapped key, or export the matched strings as constants from `llm/` and `engine/`. Not blocking because the producers are stable and the fallback is still readable English.

**F5. Vietnamese wording, sample (draft status already declared).**
- Same concept, two terms: "block" is "đoạn" in the panel (`panel.segment.retranslateTitle`, `panel.meta.original`) but "khối" in `options.shortcuts.rowNext`, `rowPrevious`, `rowEnds`, `rowOriginal`, `rowRetranslate`, `rowExplain`, `rowCopy`, `focusHint`, `stats` in `options.cache.stats`. Pick one (the panel's "đoạn" matches what users see).
- "site" is rendered three ways: "trang" (`panel.offer.siteRules` "Quy tắc trang", `panel.state.never`, `options.sites.none` "Chưa có trang nào"), "trang web" (`options.sites.title` "Quy tắc theo trang web", `errors.tooManySites`, `errors.syncItems`). "Trang" alone is ambiguous with "page" (for example `panel.state.never` "không bao giờ dịch trang này" says "this page", the source says "this site"). Use "trang web" for site and "trang" for page throughout.
- `options.sites.neverHint`: "sẽ được thả ra ngay" is a literal rendering of "let go" and reads oddly; something like "sẽ được ngừng đọc ngay" is closer to the meaning.
- `panel.job.localOnly`: "Quy tắc chỉ-cục-bộ" is awkward; "Quy tắc chỉ dùng cục bộ cho $1" matches `options.providers.localOnly`.
- `panel.controls.style.simplified` "Đơn giản" versus `options.style.simplified` "Đơn giản hóa": make them the same.
- `panel.job.skipped`: "đã bằng ngôn ngữ $1" is stilted when `$1` is a language name; "đã ở dạng $1" or "đã là tiếng $1" is more natural.
- Technical names are kept as the plan asks (Ollama, LM Studio, API key, token, Alt+T). "key" and "API key" are mixed (`panel.switcher.noKey` "chưa có key", `panel.job.fixKey` "Sửa key", versus `errors.auth` "API key"); consistent enough, but the native reviewer should decide.
- The target-language selector in the panel still shows English language names ("Vietnamese"); that follows the plan's "target language list unchanged" and is not a defect.

**F6. English text still reaches a Vietnamese UI through saved data.** A saved connection keeps the English preset label (`Custom — OpenAI-compatible`, `Ollama (local)`), deviation 2, so connection names in the Providers list and the model switcher appear in English for a Vietnamese user. These are user-editable names and brand-like, so this is acceptable; note it in the phase 7 native-review checklist.

**F7. Small items.**
- `src/entrypoints/options/Options.tsx:502` formats sizes with a fixed "KB"/"MB" and `toFixed(1)`, so Vietnamese would show a dot decimal where vi uses a comma. Cosmetic.
- `Providers.tsx:984` keeps `https://llm.example.com/v1` as a literal placeholder, and `App.tsx:306` keeps an English dev-only title; both acceptable (an example URL, a dev build only).
- The context-menu title (`src/shared/panel.ts:94`) is resolved when the menu is created, so changing Chrome's language after install keeps the old language until the worker re-creates the menu. Minor.

## Coverage against the review checklist

- Completeness: a scan of `src/entrypoints/**` and `src/shared/**` for sentence literals, JSX text and `aria-*`/`title`/`placeholder`/`alt` attributes found only the dev-only and developer-message items listed above. Keys are grouped `panel.*`, `options.*`, `errors.*`, `onboarding.*`. Plural forms use the library (`1`/`n`); vi has the single `n` form and builds to a single message, which is correct. The Alt+T rebinding note is `onboarding.rebindNote`.
- Unchanged: model prompts, the target language list and `src/llm` messages are untouched; `LLMError.kind` maps to `errors.*` in `status.ts`, with a `ui` tag in `raw` for shell-raised errors.
- Tests: one e2e flow in vi and a locale parity test; no `data-testid` substitution was needed beyond the existing ones. There is no unit render of the panel in vi, which the plan did not require.

## Unresolved questions

- Should the supervisor run the Linux e2e before phase 6, or accept a first red CI as the check? I recommend running it once before phase 6.
- Does the user want the Vietnamese terminology in F5 fixed now, or left to the phase 7 native review? The terminology split (block, site) is worth deciding once.

## Re-review: 85b5b16, 08f781c, bd230b2

No blocking findings. F2 and F4 are resolved, F5 is mostly resolved; three small Vietnamese items remain (all non-blocking).

- **85b5b16 (launcher):** resolved. `mkdtemp` gives each launch its own directory, so parallel workers cannot clash. The directory is never removed; harmless in the OS temp folder.
- **bd230b2 (producer test):** resolved. `status.test.ts` imports the real producers (`checkKey`, `classifyFetchError`, `BASIC_MISSING_MESSAGE`, `basicUnavailableMessage`, `NoBasicRaw`) and asserts the mapped message, so rewording a producer fails the test.
- **08f781c (Vietnamese):** no "khối" remains; "đoạn" is used for block everywhere. "Đơn giản hóa" now matches in panel and options. The "thả ra", "chỉ-cục-bộ" and "bằng ngôn ngữ" phrases are fixed. Remaining, all minor:
  1. `errors.localOnly` still ends "cho trang trong phần cài đặt" where it means a site: use "trang web".
  2. `panel.offer.siteRules` is "Quy tắc trang web" but the Settings section (`options.sites.title`) and the `panel.state.never` pointer say "Quy tắc theo trang web": use the same label.
  3. `options.sites.neverHint` ends "sẽ được ngừng đọc ngay", which is not quite grammatical; "sẽ ngừng được đọc ngay" or "sẽ bị ngừng đọc ngay" reads better. Also "Chỉ cục bộ" and "chỉ dùng cục bộ" are both used for local-only; pick one for the native review.
