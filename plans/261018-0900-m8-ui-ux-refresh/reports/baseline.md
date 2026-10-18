# M8 baseline (phase 1, step 1)

Measured on 2026-10-18 at `d7b41cc` (master, v1.1.0) in a clean detached worktree, before any M8 change.

## `pnpm check` on the base

Green. Lint, typecheck, engine boundary, 117 test files with 2104 tests, the build, the bundle budget
and the manifest check all passed.

## Bundle (gzip level 9, `scripts/check-bundle.mjs` naming)

Total 291181 B against a total budget of 309287 B.

| File | Measured | Budget | Headroom |
|---|---|---|---|
| `assets/onboarding.css` | 597 | 646 | 49 |
| `assets/sidepanel.css` | 2615 | 2617 | 2 |
| `assets/style.css` (settings and onboarding) | 1310 | 1405 | 95 |
| `background.js` | 5837 | 6870 | 1033 |
| `chunks/anthropic.js` | 53472 | 58820 | 5348 |
| `chunks/node.browser.js` (two files, 268 + 729) | 997 | 1096 | 99 |
| `chunks/onboarding.js` | 3133 | 3910 | 777 |
| `chunks/openai.js` | 81998 | 90199 | 8201 |
| `chunks/options.js` | 13529 | 14969 | 1440 |
| `chunks/route.js` | 16256 | 17868 | 1612 |
| `chunks/sdk.js` | 1450 | 1599 | 149 |
| `chunks/sidepanel.js` | 23565 | 24480 | 915 |
| `chunks/sites.js` | 53935 | 55800 | 1865 |
| `chunks/style.js` (the settings page's shared code) | 9861 | 11832 | 1971 |
| `chunks/toggle-shortcut.js` | 578 | 812 | 234 |
| `content-scripts/content.js` | 22048 | 24253 | 2205 |

`sidepanel.css` has 2 B of headroom, so any shared CSS in the panel needs its budget line measured
again (done in phase 1, see the budget note).

## Chunk map (which page loads what)

| Page | Loads |
|---|---|
| `sidepanel.html` | `sidepanel.js`, `sites.js`, `toggle-shortcut.js`, `route.js`, `sidepanel.css` |
| `options.html` | `options.js`, `sites.js`, `style.js`, `toggle-shortcut.js`, `style.css` |
| `onboarding.html` | `onboarding.js`, `sites.js`, `route.js`, `style.js`, `style.css`, `onboarding.css` |

`style.css` is the settings page's stylesheet, which onboarding loads before its own
`onboarding.css`. `style.js` is the code the settings page and onboarding share. The provider SDK
chunks (`anthropic.js`, `openai.js`, `sdk.js`, `node.browser.js`) load on demand from `sites.js`.

## After phase 1's shared CSS

With `src/ui/tokens.css` and `src/ui/base.css` imported, `sidepanel.css` measured 4266 B and
`style.css` 3209 B; only those two budget lines were edited (measured plus 10%), with a dated note.
No chunk was added or renamed. Total 295400 B.

## Vietnamese coverage of the serif candidates (step 3)

`scripts/glyph-check.html` in headless Chrome 156 on macOS:

| Font | Glyphs present | Drawn correctly |
|---|---|---|
| Iowan Old Style | All | No: the horn of ơ ư is drawn like a hook above, so ơ reads as ỏ, ờ as ò with a hook, and Ở loses its horn |
| Charter | All | No: the same horn problem |
| Georgia | All | Yes |
| Noto Serif | Not installed | — |
| Times New Roman | All | Yes |

The pixel comparison cannot see a badly drawn horn (the glyph exists), so the page also shows large
pairs (ơ ỏ, ư ủ, ờ ở, Ơ Ở) to compare by eye. Result: `--font-serif` is
`Georgia, 'Noto Serif', 'Times New Roman', serif`. Iowan Old Style and Charter are dropped. Windows
is pending for phase 6.
