# Phase 3: block gaps on the store article

Measured by `e2e/reading.spec.ts` (`textGaps`): the store article translated with the mock, the panel at
420px. A gap is the space between the line boxes of neighbouring blocks' own text. A `Range` around the
text gives each line's content area, and half the leading is added above the first line and below the
last. Notes, badges, labels and the action toolbar are left out. Pairs with a code block or a table
cell are skipped, not bridged.

Why line boxes rather than raw text boxes: a raw text box excludes the leading, which at line height 1.6
is about 0.4 × the size between any two lines. That alone exceeds the plan's li→li threshold
(0.25 × size + 2px), so a raw measurement could never pass. With half the leading added back, a gap is
exactly what the margins set, which is what the thresholds are derived from.

## Before (after phase 2, before phase 3)

The panel body is 10.5px in the e2e browser (`<html>` is 14px; the base build at d7b41cc shows the same),
so the reading text is 10.5px here.

| Pair | Largest gap |
|---|---|
| p→p | 30.3px |
| li→li | 30.3px |
| heading→p | 30.8px |
| p→heading | 40.3px |
| p→quote, p→li | 30.3px |
| li→heading, quote→heading | 40.3px |

Every pair carries about 20px more than its margin (`.seg { margin: 0 0 10px }`, a heading's 20px top
margin). That is the per-block action row: it is `opacity: 0` but still in the flow (`margin-top: 2px`
plus its button height). This confirms the plan's suspected cause.

## After (phase 3)

The reading text now has its own size (`--reading-size`), so the gaps are measured at 16px and 20px.
The toolbar is out of the flow, and the margins follow the plan's scale.

| Pair | 16px | Limit at 16px | 20px | Limit at 20px |
|---|---|---|---|---|
| p→p, p→quote, p→li | 14.4px | 16.4px (0.9 × size + 2) | 18.0px | 20px |
| li→li | 4.0px | 6px (0.25 × size + 2) | 5.0px | 7px |
| heading→p | 8.2px | 16.4px | 10.1px | 20px |
| p→heading, li→heading, quote→heading | 23.8px | 26px (1.5 × size + 2) | 29.9px | 32px |

The e2e assertion (`e2e/reading.spec.ts`) checks every pair against these limits at both sizes.
