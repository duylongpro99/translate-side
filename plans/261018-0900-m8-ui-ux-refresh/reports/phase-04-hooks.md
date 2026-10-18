# Phase 4 hook list (settings page)

Collected before the markup changed from `Options.test.tsx`, `Providers.test.tsx`, `Memory.test.tsx`,
`Transfer.test.tsx`, `Diagnostics.test.tsx`, `Onboarding.test.tsx` and the e2e specs.

| Hook kind | Hooks | After phase 4 |
|---|---|---|
| Control ids | `#target`, `#source`, `#style`, `#gloss`, `#captions`, `#alt-text`, `#budget`, `#quality-fast`, `#quality-balanced`, `#quality-best`, `#quality-strategy`, `#quality-keep-drafts`, `#g-term`, `#g-rendering`, `#g-keep`, `#spend-limit`, `#route-review`, `#route-analyze`, `#c-label`, `#c-base`, `#c-format`, `#c-auth`, `#c-key`, `#c-model`, `#m-conn` | Kept on the same native elements. A `Select` keeps the native `<select>` and every prop on it |
| Heading ids | `#sites-h`, `#cache-h` and the other `-h` ids | Kept |
| Section ids | `#sites`, `#memory`, `#shortcuts`, `#transfer`, `#diagnostics` | Kept; `#providers`, `#languages`, `#translation-style`, `#quality`, `#glossary`, `#spend` and `#cache` added for the index (the style section is not `#style`, which the style select already uses) |
| Test ids | `test-connection`, `save-connection`, `remove-connection`, `confirm-remove-yes`, `connection-row`, `connection-status`, `model-row`, `routing`, `route-fallback`, `fallback-add`, `site-rule`, `glossary-entry`, `glossary-form`, `cache-clear`, `spend-*`, `memory-*`, `import-*`, `export*`, `keys-confirm*`, `diag-*`, `open-onboarding`, `advanced`, `cors-guide`, `protocol-switch`, `preset-picker` and the rest | Kept on the same elements; buttons became `Button`, which passes every prop through |
| `data-preset` | Preset buttons | Kept; the presets stay buttons (see the progress log) |
| Labels | `[aria-label="Edit Work gateway"]`, `[aria-label="Remove docs.example.org"]`, `[aria-label^="Remove fallback 1"]`, `[aria-label="Grant access to …"]` | Kept |
| Generic selectors | `select`, `input[type=checkbox]`, `label select, label label`, `fieldset legend`, `.prov__name`, `[data-testid=quality-modes] input` | Still match: no control was added before the existing ones, and the new Theme radios sit after them |
| Classes | `.opt__section`, `.opt__hint`, `.opt__link` | Kept |

Never-fold list (final): `options.providers.honest`, `options.providers.rulesHint`,
`options.providers.fallbackHint`, `options.providers.unencrypted`, `options.style.mediaHint`,
`options.sites.allowHint`, `options.sites.neverHint`, `options.spend.hint`, `options.memory.hint`,
`options.memory.acrossSitesHint`, `options.transfer.intro`, `options.transfer.keyKept`,
`options.transfer.confirmWarning`, `options.diagnostics.intro`. Added to the plan's list: the two site
lists' hints, the spend hint, the memory hint, the transfer intro and the diagnostics intro, which each
say what is sent or kept where. The plan named `transfer.unencrypted`; the string is
`options.providers.unencrypted`.

Folded: `options.style.budgetHint`, `options.spend.limitHint`, `options.memory.replaceHint`.
