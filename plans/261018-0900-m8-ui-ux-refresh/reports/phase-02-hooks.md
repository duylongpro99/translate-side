# Phase 2 hook list

Written before editing (phase 2, step 1). Each hook the named unit tests and e2e specs use, with its home after
phase 2. "Kept" means the same element keeps the hook where it is.

## Header

| Hook | Used by | Today | After phase 2 |
|---|---|---|---|
| `h1` (page title, `title` tooltip) | `flows.spec.ts:50` | First header row | The muted title line under the control row; still the visible `h1` |
| `scroll-follow` (`aria-pressed`, labels) | `follow.test.tsx:72`, `header.test.tsx:125` | ⇅ text button | `IconButton` with `pressed` in the control row; same id, labels and `aria-pressed` |
| `shortcuts-button` | `App.test.tsx:326` | ? button with `aria-expanded`/`aria-controls` | The "Keyboard shortcuts" item of the More menu. `aria-expanded` and `aria-controls="shortcuts"` move to the More trigger while the help is open |
| `shortcuts`, `shortcuts-close`, `shortcut-settings` | `App.test.tsx:328-334` | The help section | Kept; closing returns focus to the More trigger |
| `header [aria-label=Settings]` | `header.test.tsx:124` | ⚙ button | The "Settings" item of the More menu (`menu-settings`); the test checks the item inside `header` |
| Close (✕, no id) | none | ✕ button | The "Close panel" item of the More menu (`menu-close`) |
| `.panel__dev` | `App.test.tsx:140` | `{ }` button (dev builds) | The "Segment view" item of the More menu (`menu-dev`, dev builds only); the test opens More and clicks it |
| `.panel__header` | `follow.test.tsx:68`, `blocks-nav.ts:44`, `follow.ts:62-65` | Sticky header | Kept; the control row, title line, progress bar and notice strip are all inside it, so `coveredBy`/`coveredTop` need no change |
| `header-controls` | none in tests | Controls wrapper | Kept on the left group of the control row |
| `lang-pair`, `source-lang` | `header.test.tsx` | Pair span | Kept in the control row |
| `target-lang` | `header.test.tsx`, `sync.test.tsx` | Native select | `Select` (quiet) in the control row; same id, value and options |
| `style-mode` (`.value`, `.options`) | `header.test.tsx` | Native select | `Select` in the Translation popover (mounted while closed) |
| `quality-control`, `quality-mode` | `header.test.tsx`, `flows.spec.ts:296-310`, `upgrade.spec.ts:276` | Native select | `Select` in the Translation popover; the e2e Best flow opens the popover before `selectOption` (`toHaveValue` works while hidden) |
| `quality-lock-note` (`#quality-lock-note`) | `header.test.tsx` | Next to the select | The notice strip; `aria-describedby` on `quality-mode` still points at it |
| `header-model` (`data-slot="quick-switcher"`), `model-switcher`, `switcher-tab-only`, `make-default` | `header.test.tsx`, `switcher.test.tsx`, `upgrade.spec.ts` | Header row | The Model field of the Translation popover; same ids and elements |
| `switcher-site-rule` | `switcher.test.tsx:216-218` | Inside `header-model` | The notice strip (never inside a popover); `header-model` still shows the rule's model |
| `switcher-live` (`aria-live=polite`, `.sr-only`) | `switcher.test.tsx:277-287` | Inside the switcher | The notice strip, still `.sr-only` |
| `switcher-error` | `switcher.test.tsx` | Inside the switcher | The notice strip |
| `prefs-error` | `header.test.tsx` | Under the controls | The notice strip |
| `page-cancel`, `page-retranslate` | `header.test.tsx`, `App.test.tsx:261` | Text buttons | One `IconButton` in the control row: `page-cancel` (stop icon) while running, `page-retranslate` otherwise; hidden without a job; same labels |

## Job bar

| Hook | Used by | Today | After phase 2 |
|---|---|---|---|
| `[data-testid=job]` with `data-status`, `data-started`, `data-first-visible`, `data-screen-done`, `data-ended` | `fixtures.ts:261-263`, `flows.spec.ts:356`, every job test | Status line | Kept; always has a box (`min-height: 1px`). `jobSettled` also accepts the `data-status` attribute without visibility |
| Progress sentence ("Translating into X… N of M", "X · N of M · T s") | `App.test.tsx:269`, `jobs.errors.test.tsx` | Visible `.job__text` | On the page view: an `.sr-only` `role="status"` live region inside `job` (`job-live`), same strings, so screen readers still hear start, progress, failures and done. The 2px progress bar and the Translation popover's page line show it. The selection view keeps the visible sentence |
| "N failed" | `flows.spec.ts:94` | In the sentence | A visible warning notice inside `job` with `retry-failed` (exact text) |
| "the rest as you read" | `pages.spec.ts:42`, `perf.spec.ts:35-37` | In the done sentence | A visible notice inside `job` with `translate-rest` (exact text) |
| `retry-failed`, `translate-rest`, `job-kept`, `job-edits-kept` | `flows.spec.ts`, `App.test.tsx`, `jobs.errors.test.tsx` | Job bar | Kept inside `job` |
| `[data-testid=job] button` (first button) | `App.test.tsx:258-318` | Job bar | Kept: the page view's bar still has no button while running (Cancel is the header's Stop), and the first button in each other state is the same one |
| `job-cost` | `App.test.tsx:257, 268, 271` | Job bar | The Translation popover's page line (mounted while closed); the selection view keeps it in its bar |
| `job-skipped`, `retry-page`, `fix-key`, `job-local-only`, `job-limit`, `limit-failed`, `limit-continue`, `job-backoff`, `job-fallback`, `job-review-unavailable` | `jobs.errors.test.tsx`, `limit.test.tsx`, `flows.spec.ts:72` | Job bar | Kept, with their text; errors keep `role="alert"` with `.job__text` inside |
| `offer`, `translate-page`, `allow-site` (`data-reason`) | `offer.test.tsx`, `flows.spec.ts:52` | Offer section | Kept on the same elements, drawn as a flat notice with `Button`s |
| `setup-offer`, `setup-open` | `switcher.test.tsx:293-307` | Setup section | Kept, drawn as a flat notice with a `Button` |
| `privacy-notice`, `privacy-ok`, `#privacy-title` and the list ids | `privacy.test.tsx`, `upgrade.spec.ts:202` | Notice | Kept (restyling is phase 3); while it is pending the Translation, `Aa` and More triggers are `inert` |
