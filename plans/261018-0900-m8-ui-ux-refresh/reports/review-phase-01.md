# Review: M8 phase 1 (foundations), uncommitted work on `m8`

Date: 2026-10-18 (Asia/Saigon). Worktree `translate-side-m8`, base master @ d7b41cc. Read-only review.

## Scope and method

- Files: every phase-1 file listed in the task (src/ui/**, src/shared/reading.ts and its test, portable.ts and its
  test, Transfer.tsx and its test, the three main.tsx and style.css files, check-tokens.mjs, ui-screens.mjs,
  glyph-check.html, e2e/ui-screens.spec.ts, e2e/store-article.ts, package.json, bundle-budget.json, docs, locales).
- Ran: `vitest run src/ui src/shared/reading.test.ts src/shared/portable.test.ts src/entrypoints/options/Transfer.test.tsx src/locales`
  (9 files, 78 tests, green). `eslint` on the new files (clean). `node scripts/check-tokens.mjs` (passes).
  `node scripts/check-bundle.mjs` against the existing `.output` (passes, 295400 B total). gzip(9) of the built CSS:
  sidepanel.css 4266 B, style.css 3209 B, so ceil(x1.1) = 4693 and 3530: the budget edits match exactly, only those
  two lines plus the note changed.
- Probe: a scratch vitest config outside the worktree rendered the real `Popover` + `Segmented` + `IconButton`
  (finding B1 output below). Nothing in the worktree was edited.
- **Important context:** while this review ran, phase-2 files showed up in the same worktree (`App.tsx`,
  `HeaderControls.tsx`, `JobBar.tsx`, `ModelSwitcher.tsx`, `ProgressBar.tsx`, `ReadingPopover.tsx`). `sidepanel/style.css`
  went from a 100-line diff to a 387-line diff and `en.yml` from 2 to 33 lines. `tsc --noEmit` now fails, but only in
  `ReadingPopover.tsx` (locale keys missing). The style.css findings below come from the phase-1 diff taken before
  the phase-2 edits arrived.

## Verified against the spec (no finding)

- Req 1: every listed token exists in every theme. `color-scheme` is `light dark` only on `:root:not([data-theme])`,
  `light` on light and paper, `dark` on dark. System dark is scoped to `:root:not([data-theme])`, and a test checks
  it equals dark. Spacing, radii, font stacks and per-script stacks are plain tokens. Georgia leads the serif stack
  (controller decision). No `Canvas` or `LinkText` is left in page CSS.
- Req 2: base.css has the reset, 14px and `--font-ui`, body ground and ink, the focus ring, `.sr-only` (moved
  unchanged from the panel) and the reduced-motion handling.
- Req 4: `reading.ts` copies `quality.ts`. The raw-record merge in `updateReading` keeps unknown fields (tested).
  `readReading`, the theme.ts `onChanged` handler, the mirror read and the import all go through `cleanReading`.
  The item is not in `prefs`. The translator (`translator.ts:608`) and prefs (`prefs.ts:110`) listeners check only
  their own keys. The App listener (`App.tsx:91`) re-reads route state on any change, which is harmless.
- Req 5: export, `ImportPlan.reading`, the `hasKnownReading` gate, the `skipReading` note, `ImportReport.reading`,
  `resolveImport` write (shared by preview and apply), the Transfer preview line, both locales. An old file leaves
  the item alone. All of these have tests.
- Req 6, 8, 10: 13 icons, aria-hidden, currentColor. Onboarding imports neither token file and inherits them through
  options/style.css. `--fg` and `--surface` are renamed. Every `var(--x)` in page CSS resolves to a token (the one
  exception is the runtime `--panel-header-h`, set by App.tsx). design-system.md is linked from the README and
  DESIGN.md §3.
- Test hooks: phase 1 touches no sidepanel TSX apart from main.tsx. No `data-*`, id or `.seg`/`.state` hook changed.
- Preact 11 forwards `ref` as a prop, so `trigger={(p) => <IconButton {...p}/>}` gets focus back (probe confirmed).
- The ui-screens spec is env-gated (`test.skip` unless `UI_SCREENS`), and the script refuses to overwrite an existing
  folder. The 12 before images are present.

## Blocking

### B1. Popover Tab/Shift+Tab close fails when the first or last control is a radio group: the reading popover strands focus

`src/ui/Popover.tsx:52-62` (and the focus on open at `:41-43`, `FOCUSABLE` in `src/ui/overlay.ts:28`).

The handler closes only when `document.activeElement` is the first or last element that matches `FOCUSABLE`. A radio
group is one Tab stop, and its stop is the **checked** radio, so `last` is the group's last radio whether or not it
is checked. `ReadingPopover.tsx:76` ends with the theme `Segmented`, and its default value `system` is the *first*
radio. Probe output on the real components:

```
PROBE focused on open: system          <- first radio, not the checked one ("paper")
PROBE hidden after Tab from checked middle radio: false prevented false
PROBE hidden after Shift+Tab from checked middle radio: false prevented false
```

What happens: the user opens Aa and Tabs to Theme (system checked), then presses Tab again. The native Tab moves
focus to the next control after the popover, and the popover **stays open** over the reading view with focus
outside it. The same happens for Shift+Tab whenever the first control is a group whose first radio is not checked.
On open, focus lands on an unchecked radio, so a screen reader announces "System, not selected" when the group is
the first control. The existing tests use only buttons and an input, so they cannot catch this.

A second way to lose focus: a control can become disabled while it has focus. Pressing "smaller" down to 13 disables
`reading-smaller`. Focus then drops to `<body>`, so the Escape handler on the dialog never runs (see S4).

Fix: close on focus leaving instead of guessing edges. Add `onFocusOut` on the anchor: if `relatedTarget` is outside
the anchor, call `change(false, false)`. If it is the trigger (Shift+Tab out of the first control), also close and
keep focus there. Keep the Escape handler. On open, focus `panel.querySelector('input:checked, ' + FOCUSABLE)`, or
better, the first element that is either a checked radio or not a radio. Add a test with a `Segmented` as the last
and as the first control, with a middle value checked.

## Should-fix

### S1. The menu item keyboard focus is nearly invisible, and invisible in forced colors

`src/ui/base.css:253-257`: `.ui-menu__item:focus-visible { background: var(--tint); outline: none; }`. The
`--tint` on `--raised` contrast is about 1.1:1 (#f4f3f0 on #fff in light, #26241f on #24221f in dark: nearly the same
color). A keyboard user moving with the arrow keys cannot see which item is focused (WCAG 2.4.7 and 1.4.11). Under
Windows forced colors the background is overridden, and with no outline there is no indicator at all.

Fix: keep the tint for hover. For `:focus-visible`, keep the global accent outline (`outline-offset: -2px` so it
fits the menu), or use `--pressed` together with an outline.

### S2. The pressed and checked states rely on a background at about 1.2:1

`src/ui/base.css:98-101` (`IconButton[aria-pressed=true]` and `[aria-expanded=true]` use `--pressed`) and
`:193-196` (the checked segment uses `--pressed` and weight 600). `--pressed` against `--ground` is about 1.23:1 in
light and about 1.26:1 in dark. The follow toggle's on/off state has no other cue. WCAG 1.4.11 asks for 3:1 on state
indicators.

Fix: add a second cue, such as an accent-colored icon or text for pressed or checked, or a 1px `--ink`/`--accent`
inset ring on the checked segment. Extend tokens.test.ts with the state-indicator pairs at 3:1.

### S3. The theme is not guaranteed to apply "before the first paint"

`src/entrypoints/*/main.tsx` call `applyThemeSync()` after their imports. The built `sidepanel.html` loads
`<script type="module">` at the end of `<body>`, with modulepreloads of `sites`, `route` and `toggle-shortcut`.
Module scripts are deferred and do not block rendering. `applyThemeSync` also runs only after the whole imported
graph has evaluated (App, controller, translator, engine chunks). Chrome may paint the stylesheet-only body first.
A user who chose dark on a light OS, or light or paper on a dark OS, then sees a flash of the other ground each
time the side panel opens; the panel is a fresh document on every open. The unit test proves only that the
function is synchronous, not when it runs. This is unverified empirically, because e2e was off-limits here.

Fix (keeps the spec's mechanism): add a tiny dedicated script, `src/ui/theme-boot.ts` or an unlisted entry, that
only calls `applyThemeSync`, loaded in each page's `<head>` with `blocking="render"`, or as a classic external
script (CSP allows external). Keep `followTheme` in main.tsx. At minimum, check it with a Playwright trace: dark
mirror, light `colorScheme`, first frame.

### S4. Focus can fall to `<body>` inside an open Popover, and then Escape does nothing

`src/ui/Popover.tsx:68`: the dialog `div` has no `tabIndex`. A click on its padding, a legend or a size label moves
focus to `<body>`, and so does a focused control becoming disabled (B1). The `keydown` handler is on the dialog, so
Escape then neither closes nor returns focus, and Tab starts from the top of the document while the popover stays
open.

Fix: `tabIndex={-1}` on the dialog, so clicks inside keep focus in it. While open, also listen for Escape on
`document`, or at least handle the disabled-control case by refocusing the dialog.

### S5. The linked block (hover link) is now barely visible

`src/entrypoints/sidepanel/style.css` (`.seg[data-linked]`, about lines 551-555 in the phase-1 diff) changed from
amber (`rgba(255,200,0,.22)` plus a bar) to `--tint` plus a 6px `--tint` spread. That is about 1.1:1 against the
ground in every theme. The M5 hover link (page pointer, panel block) is close to invisible, inline `code`
(`--code-bg` is almost the same color as `--tint`) disappears inside it, and the panel no longer matches the page
highlight, which is still amber (`src/extract/link.ts:57`). Req 9 asked for "a token-based marker without a left
border". It did not ask for a near-invisible one.

Fix: add a `--linked` token (warm, at least about 1.5:1 against `--ground`, matching the page highlight's hue), or
use `--pressed`. Phase 3 may restyle block states, but this ships in the phase-1 commit.

### S6. The privacy policy is now wrong about storage

`docs/privacy.md:77` lists the `storage.sync` contents without the reading settings. `:81` says the panel's
`localStorage` holds "one on/off setting". There is now a `ts.reading` mirror on the panel, options **and**
onboarding pages (`src/ui/theme.ts:9`). The file at `:190` lists source locations. This is a public, store-linked
policy.

Fix: add the reading settings (theme, typeface, size, width) to the sync row and the `ts.reading` mirror to the
localStorage row, plus `src/ui/theme.ts` to the source list.

### S7. "Stays inside the panel width at 320px" is not enforced or tested

`src/ui/base.css:202-227`: the popover is `position:absolute`, `width:min(280px, 100vw - 24px)`, and anchored at
`right:0` (end) or `left:0` (start) of the trigger's span. With `align='end'`, a trigger whose right edge sits less
than 280px from the panel's left edge overflows off-screen to the left, and `start` has the mirror problem. Whether
it fits depends on where phase 2 places the trigger. Nothing checks it.

Fix: clamp in JS on open (measure `getBoundingClientRect`, set an inline `left`/`right` offset; offsets are not
colors, so check-tokens is fine), or document that the anchor must sit at the matching panel edge. Add a 320px e2e
assertion that `dialog.getBoundingClientRect()` lies within `[0, innerWidth]`.

### S8. The phase-1 changes cannot be verified or committed on their own right now

The phase-2 work landed in the same worktree before phase 1 was committed (see Scope). `pnpm check` fails at
typecheck because of `ReadingPopover.tsx`, so the acceptance item "`pnpm check` and `pnpm run e2e` are green"
cannot be shown for phase 1. `style.css`, `en.yml` and `vi.yml` now hold both phases' hunks.

Fix: commit phase 1 with a path-and-hunk-scoped staging (`git add -p` on style.css and the locales), then run
`pnpm check` on a clean checkout of that commit, for example `git stash -u` of the phase-2 files or a temporary
worktree, before accepting.

### S9. Two acceptance items are not met yet

- The progress log has no visual review against the anti-pattern list (acceptance item 8).
- `docs/design-system.md` ("Anti-patterns") says "None of these appear anywhere", but the panel still has
  left-border accent cards. Phase-1 style.css keeps `border-left: 3px solid var(--accent)` with a tint and radius on
  the explain/about block (about line 411) and `.offer` (about line 508), plus the 2px accent bar on `.seg__explain`.
  Onboarding keeps its pill step list (`onboarding/style.css:5`).

Fix: soften the claim to "the target is that none appear; phases 2-5 remove the remaining X, Y", or remove them
now. Record the review in progress-m8.md.

## Nits

- **N1. check-tokens false negatives** (`scripts/check-tokens.mjs:10, 32`). `SYSTEM` is case-sensitive, but CSS
  keywords are not, so `canvas`, `CANVAS` and `canvastext` pass. Other system colors (`LinkText`, the one this phase
  removed, `ButtonFace`, `ButtonText`, `GrayText`, `Highlight`, `Mark`, `AccentColor`) and named colors (`white`,
  `black`), `color-mix()`, `oklch()`, `lab()` and `hwb()` all pass. `style={obj}` with the object defined elsewhere
  is not seen. `.ts` files that inject CSS (`src/extract/link.ts:57`, which the page highlight legitimately needs)
  are outside its scope. It meets the literal req 9. Add the `i` flag and the system-color list at least.
  The doc lists `LinkText` as banned but the script does not check it.
- **N2.** `src/ui/overlay.ts:19-20` listens to both `pointerdown` and `mousedown`. One outside click closes twice,
  so `onOpenChange(false)` fires twice. Use `pointerdown` only, or guard `change` with `if (next === open) return`.
- **N3.** `src/ui/theme.ts:58`: `readReading` swallows a storage error and returns defaults. `apply` then overwrites
  a good mirror with "system" and flips the theme. Skip the mirror write when the read failed (needs a variant that
  reports failure). The initial `get` can also resolve after an `onChanged` that carries a newer value; this is
  low risk.
- **N4.** Opening a Menu or Popover with no enabled focusable item leaves focus on the trigger, where Escape is not
  handled.
- **N5.** `src/ui/tokens.test.ts:20,41` finds the system-dark block through its two-space indentation. This is
  fragile; match `@media (prefers-color-scheme: dark)` instead. The contrast pairs leave out `--muted` on
  `--code-bg` and `--pressed`.
- **N6.** An import replaces the stored record wholesale (`portable.ts:582`). A file with only `{ size: 18 }` resets
  theme, typeface and width to their defaults, and newer-build fields in storage are dropped. This matches the
  quality precedent and the preview line says the file's values "replace yours", so it is acceptable. One sentence
  in design-system.md would make it explicit.
- **N7.** The global `box-sizing: border-box`, `body { line-height: 1.45 }` and `button, input, select, textarea
  { font: inherit }` in base.css shift existing layouts on all three pages (the options form controls grow from
  13.33px to 14px). Req 2 allows this; check it in the after screenshots.
- **N8.** The branch README still shows "M8 Beyond" in the roadmap table, while the main checkout's uncommitted docs
  rename it to M9. Expect a conflict when those land.

## Positive notes that matter for risk

- The reading store matches the quality precedent line for line, including the serialized write chain and the
  raw-record merge, and the tests cover the unknown-field survival.
- The import path reuses `resolveImport` for preview and apply, so the preview line cannot diverge from what is
  written.

## Recommended order

1. B1 (focus-out based close, checked-radio focus, tests with Segmented at both edges), with S4 at the same time.
2. S1, S2 (focus and state indicators), S5 (linked token).
3. S6 (privacy.md), S9 (progress log entry, doc wording).
4. S3: decide whether to add the render-blocking boot script now or confirm with a trace.
5. S8: stage phase 1 apart from phase 2 and run `pnpm check` on it.
6. S7 and the nits, as phase 2 places the triggers.

## Unresolved questions

- S3: is a flash on panel open acceptable as "before first paint" for the owner, or should the boot script be
  added? The plan mandated main.tsx, so this may need an owner nod.
- S5: does phase 3 already plan a new linked-block style? If so, a temporary `--pressed` is enough here.

Status: DONE_WITH_CONCERNS
Summary: Most of phase 1 matches the spec. The reading store, import and export, tokens, color-scheme and the
bundle budget check out. One blocking defect: the Popover's Tab and Shift+Tab close fails with radio groups, which
is exactly how the reading popover is built. There are also several a11y contrast gaps and a stale privacy policy.
Concerns/Blockers: phase-2 files are mixed into the same uncommitted worktree, so typecheck currently fails and
phase 1 cannot be verified or committed as a unit without hunk-scoped staging.
