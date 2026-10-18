# Design system

The panel, the settings page and onboarding are built from one set of tokens and components in
`src/ui/`. There is no UI library and no web font. Colors, spacing, radii, type sizes and font
stacks all come from `src/ui/tokens.css`. `scripts/check-tokens.mjs` is part of `pnpm check` and
fails on any color literal or system color outside that file.

Each page's stylesheet imports `@/ui/tokens.css` and `@/ui/base.css` first. Onboarding loads the
settings page's stylesheet before its own, so it gets them without a second copy.

## Themes

There are four themes: system, light, paper and dark. The reading settings hold the choice (see
"Reading settings" below), and it applies to every page.

| Theme | Selector | `color-scheme` |
|---|---|---|
| System | `:root:not([data-theme])`: light, or dark under `prefers-color-scheme: dark` | `light dark` |
| Light | `:root[data-theme='light']` (the `:root` values) | `light` |
| Paper | `:root[data-theme='paper']` | `light` |
| Dark | `:root[data-theme='dark']` | `dark` |

**Before the first paint.** `storage.sync` is asynchronous, so each page keeps a copy of the
reading item in `localStorage` (`ts.reading`). A classic script in each page's `<head>`,
`public/theme-boot.js`, reads the copy's theme and sets `data-theme` on `<html>` before the body is
laid out. (A module script runs only after its whole import graph has loaded, which is too late.)
Each page's `main.tsx` then calls `applyThemeSync()` (`src/ui/theme.ts`) as its first statement,
which applies the cleaned copy, and `followTheme(api)`, which reads `storage.sync`, applies it,
rewrites the copy and follows later changes. A failed read leaves the copy as it is. Every value
goes through `cleanReading` before it touches the DOM.

System colors (`Canvas`, `CanvasText`, `Field`, `LinkText`) are not used. In a forced theme they
would follow the operating system instead of the theme.

## Color tokens

Text contrast is at least 4.5:1 in every theme. `src/ui/tokens.test.ts` computes it from
`tokens.css` for `--ink`, `--muted`, `--accent`, `--danger`, `--warn`, `--ok`, `--hidden` and
`--quote` on `--ground`, `--raised` and `--tint`, and for `--on-accent` on `--accent`.

| Token | Use | Light | Paper | Dark |
|---|---|---|---|---|
| `--ground` | Page background | `#ffffff` | `#faf8f3` | `#1c1b19` |
| `--ink` | Text | `#1f1e1c` | `#22201c` | `#e7e3da` |
| `--muted` | Secondary text, pending source text | `#66635d` | `#67635b` | `#9c978c` |
| `--line` | Hairlines and borders | `#e4e2de` | `#e6e1d6` | `#34312c` |
| `--tint` | Hover, notices | `#f4f3f0` | `#f1ece1` | `#26241f` |
| `--pressed` | A pressed or open control, the linked block (hover link) | `#eae8e3` | `#eae3d5` | `#302d27` |
| `--raised` | Popovers and menus | `#ffffff` | `#ffffff` | `#24221f` |
| `--accent` | The one accent: links, focus ring, progress, the primary button | `#2f5d8a` | `#2f5d8a` | `#8fb3d9` |
| `--on-accent` | Text on `--accent` | `#ffffff` | `#ffffff` | `#1c1b19` |
| `--danger` | Errors | `#b3261e` | `#a8321f` | `#ff8a80` |
| `--warn` | Warnings | `#7f6300` | `#775d00` | `#d6b44a` |
| `--ok` | Success | `#1d7a35` | `#2a6b35` | `#6cc283` |
| `--hidden` | Text the page hides | `#7f6300` | `#775d00` | `#d6b44a` |
| `--code-bg` | Code blocks | `#f3f2ef` | `#f1ece1` | `#24221f` |
| `--quote` | Block quotes | `#45423d` | `#4a463f` | `#c9c4b9` |
| `--shadow-overlay` | The one shadow, on popovers and menus only | | | |

## Spacing, radii and type

| Spacing | Value | Radius | Value |
|---|---|---|---|
| `--space-1` | 4px | `--radius-s` | 5px |
| `--space-2` | 8px | `--radius-m` | 8px (nothing is rounder) |
| `--space-3` | 12px | | |
| `--space-4` | 16px | | |
| `--space-5` | 24px | | |
| `--space-6` | 32px | | |

The interface text is 14px (`--text-base`). The UI scale is `--text-xs` 11px, `--text-s` 12px,
`--text-m` 13px, `--text-base` 14px, `--text-l` 16px and `--text-xl` 18px. The panel's reading
text has its own size, which the reader chooses (13 to 24px).

## Fonts

Fonts are system fonts only.

| Token | Stack |
|---|---|
| `--font-ui` | `system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-sans` | The same stack, for reading |
| `--font-serif` | `Georgia, 'Noto Serif', 'Times New Roman', serif` |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

**Why Georgia leads the serif stack.** `scripts/glyph-check.html` draws every Vietnamese vowel with
every tone mark, plus Ơ Ư Đ, in each candidate. On macOS (Chrome 156, 2026-10-18) Iowan Old Style
and Charter have every glyph, but they draw the horn of ơ and ư like a hook above, so ơ reads as ỏ
and Ở loses its horn. Georgia draws them correctly. The Windows result is recorded in phase 6 of
the M8 plan.

### Per-script stacks and why `lang` matters

Chinese, Japanese and Korean share one set of Han code points (Han unification). The same
character, for example 直 or 骨, has a different correct shape in Japanese, Simplified Chinese and
Traditional Chinese. Only the `lang` attribute tells the browser which one to draw. So every
translated block carries `lang={target}`, and every source block carries `lang={source}`.

The per-script stacks are plain tokens. They are applied with `font-family` rules on the elements
that carry `lang`, because a `:lang()` override of a variable cannot reach text through a variable
already resolved on an ancestor.

| Token | First choices (macOS, Windows), then Noto |
|---|---|
| `--font-ja-sans`, `--font-ja-serif` | Hiragino Sans, Yu Gothic; Hiragino Mincho, Yu Mincho |
| `--font-zh-hans-sans`, `--font-zh-hans-serif` | PingFang SC, Microsoft YaHei; Songti SC, SimSun |
| `--font-zh-hant-sans`, `--font-zh-hant-serif` | PingFang TC, Microsoft JhengHei; Songti TC, PMingLiU |
| `--font-ko-sans`, `--font-ko-serif` | Apple SD Gothic Neo, Malgun Gothic; AppleMyungjo, Batang |
| `--font-th` | Thonburi, Leelawadee UI |
| `--font-ar` | Geeza Pro, Segoe UI |
| `--font-he` | Arial Hebrew, Segoe UI |
| `--font-hi` | Kohinoor Devanagari, Nirmala UI |

## Components

Each component lives in `src/ui/` and is tested there (`*.test.tsx`). The styles are in
`src/ui/base.css`, under `ui-` classes.

| Component | What it is | Accessibility contract |
|---|---|---|
| `Button` | Variants `primary` (accent fill, at most once per view), `default` (hairline) and `quiet` | A native `<button type="button">`; every prop passes through |
| `IconButton` | A 32×32 hit area around an icon | A required `label` sets `aria-label` and the tooltip (`title` can say more); an optional `pressed` sets `aria-pressed`, shown with the accent icon color as well as a fill |
| `Select` | A native `<select>` restyled with `appearance: none`, a chevron, and a `quiet` variant | Native keyboard and screen-reader behaviour. Every single-choice list (language, style, quality, model) uses it |
| `Segmented` | Native radios in a `<fieldset>` with a `<legend>`, drawn as segments; the chosen one is bold with a `--muted` outline | Native arrow keys. Only for free settings (reading settings, the theme), never for `prefs` or `quality`, where each change starts a paid job |
| `Popover` | A non-modal dialog under its trigger | The trigger has `aria-expanded` and `aria-controls`; the popover is `role="dialog"` with a label and stays mounted while closed (`hidden`). Opening focuses its first tab stop (the checked radio of a group), or the dialog itself when it holds no control. Escape closes it, stops the event, and returns focus to the trigger; so does a second press of the trigger. A press outside closes it. Tab or Shift+Tab out of it closes it and lets focus move on. In the panel header it lines up with the row's edge, so it fits a 320px panel |
| `Menu` | A menu of actions; a focused item shows the accent focus ring | The trigger has `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`. `role="menu"` with `menuitem` (or `menuitemcheckbox`) entries. Arrow keys and Home/End move, skipping disabled items; Enter or Space runs an item. Escape closes it, stops the event and returns focus to the trigger; Tab and a press outside close it. No typeahead |
| `Field` | A label, a control and help text | The label's `for` points at the control, and the control's `aria-describedby` points at the help text |
| `Notice` | A flat tinted block in tones `info`, `warn` and `danger` | `info` is `role="status"`; `warn` and `danger` are `role="alert"`. No shadow, no left border |
| Icons (`icons.tsx`) | chevron-down, arrow-right, follow, refresh, stop, more, settings, close, copy, edit, explain, check, alert | Inline 16px stroke SVGs in `currentColor`, always `aria-hidden`; the control carries the name |

**Adding a component.** A new component goes in `src/ui/` with a test file next to it and a line
in the table above. Prefer a native element: only `Popover` and `Menu` are custom.

## Reading settings

`src/shared/reading.ts` holds the reading settings as their own `storage.sync` item, `reading`.
They follow the user across devices and travel with the settings export, with a line in the import
preview.

| Field | Values | Default |
|---|---|---|
| `theme` | `system`, `light`, `paper`, `dark` | `system` |
| `typeface` | `sans`, `serif` | `sans` |
| `size` | An integer from 13 to 24 (px) | 16 |
| `width` | `narrow`, `medium`, `full` | `medium` |

The theme applies to every page; typeface, size and width apply to the panel only. The item is
never a field of `prefs`: the translator's settings key includes `prefs`, so a reading field there
would translate the page again on every change. A write lands on the raw stored record, so fields
a newer version wrote survive it.

## Anti-patterns

None of these may be added, and each phase's review checks the UI against this list. Two older
patterns remain until their phase replaces them: the panel's notices with a left accent border
(the privacy notice, phase 3) and the onboarding step pills (phase 5).

- Gradients.
- Glassmorphism: blur, translucent panels.
- Emoji or ✨ as icons.
- Large rounded cards with shadows. A shadow appears only on popovers and menus.
- Cards with a colored left border as an accent.
- Pill clutter: rows of rounded tags and badges.
- Shimmer or skeleton animation.
- Decorative motion. The only motion allowed is an opacity or transform of 150ms or less on an
  overlay, and none under `prefers-reduced-motion`. The progress bar hides without a fade.
- More than one accent color.
- System colors (`Canvas`, `CanvasText`, `Field`) and color literals outside `src/ui/tokens.css`.
