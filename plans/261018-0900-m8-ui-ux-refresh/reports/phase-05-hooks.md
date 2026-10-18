# Phase 5 hook list (onboarding)

From `Onboarding.test.tsx` (no e2e drives onboarding; `e2e/ui-screens.spec.ts` only waits for its first `h2`).

| Hook | After phase 5 |
|---|---|
| `onboarding`, `onboarding-closed`, `onboarding-language`, `onboarding-how`, `onboarding-try`, `onboarding-sample` | Kept |
| `onboarding-step-1..3` with `aria-current="step"` | Kept on the same `li`; the number becomes a check icon once a step is done |
| `onboarding-lang` (`#onb-lang`), `cloud-preset` (`#onb-cloud`), `local-preset` (`#onb-local`) | Kept on the native selects inside `Select` |
| `path-key`, `path-local`, `path-builtin`, `path-builtin-card`, `label[for=onb-path-key]` with its exact text, `fieldset legend` | Kept; no select inside a label (`label select, label label` stays empty) |
| `onboarding-next`, `onboarding-back`, `onboarding-skip`, `onboarding-finish`, `translate-sample`, `onboarding-change` and their texts | Kept on `Button`s |
| `onboarding-privacy` (`role="alert"`), `onboarding-privacy-provider`, `onboarding-privacy-ok` (focused when it appears) | Kept; the notice is a `Notice tone="warn"` |
| `sample-original`, `sample-translation`, `sample-error`, `sample-model`, `onboarding-saved`, `onboarding-key-note`, `onboarding-shortcut-note` | Kept |
| Heading focus on each step (`h2` with `tabIndex=-1`) | Kept |
