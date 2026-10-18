# M8 screenshots

Taken by `e2e/ui-screens.spec.ts` (`pnpm run ui:screens -- before|after`) against the mock provider: the panel with
the translated store article, the top of the settings page and onboarding step 1, at panel widths of 320 and 480 px.

- `before/`: the UI at d7b41cc (v1.1.0), light and dark (paper did not exist yet).
- `after/`: the UI after M8, light, dark and paper.

| Surface | Before | After |
|---|---|---|
| Panel | `before/panel-{light,dark}-{320,480}.png` | `after/panel-{light,dark,paper}-{320,480}.png` |
| Settings | `before/options-{light,dark}-{320,480}.png` | `after/options-{light,dark,paper}-{320,480}.png` |
| Onboarding | `before/onboarding-{light,dark}-{320,480}.png` | `after/onboarding-{light,dark,paper}-{320,480}.png` |

The store screenshots (`docs/store/assets/01` to `05`) were regenerated with the new UI by `pnpm run store:screenshots`.
