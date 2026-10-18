---
title: "Phase 6: PDF reader"
status: todo
priority: P3
effort: "4d"
dependencies: []
tier: pro
feature_id: pdf
---

# Phase 6: PDF reader

## Goal

Read text PDFs side by side: a new extraction source that produces `Segment[]`, with everything downstream unchanged,
and a clear "not supported" state for scanned PDFs (OCR stays out of scope) (M9 §2.7). Pro feature id `pdf`.

## Context links

- Spec: `docs/plans/M9-beyond-v1.md` §2.7; DESIGN §1 (`DESIGN.md:25`, PDFs a v1 non-goal), §8 (permissions).
- Scout: `plans/reports/scout-261013-1036-m8-track-surfaces.md` §7.
- Today on a PDF tab (from code, not run): `classifyUrl` accepts the URL (`src/shared/denylist.ts:31-47`);
  `injectInto` runs `executeScript` on frame 0 (`src/shared/inject.ts:33-53`) and a gesture failure becomes
  `blocked / inject-failed` (`:49-52`); even if it ran, `extractPage` (`src/extract/index.ts:77-86`) would return
  `no-content`.
- Panel ⇄ page: the panel connects with `tabs.connect(tabId, { name: CONTENT_PORT_NAME, frameId: 0 })`
  (`src/entrypoints/sidepanel/controller.ts:288`) to `runtime.onConnect` in the content script
  (`src/entrypoints/content.ts:57`); protocol and `ExtractResult` in `src/shared/protocol.ts:11-55`.
- Bundle: `scripts/bundle-budget.json` total 307,482 B gzip, measured about 279.5 KB, so about 28 KB headroom;
  `scripts/check-bundle.mjs:16, 21` count only `/\.(js|css)$/` files, so a `.mjs` worker would not be counted.

## Design decision: no injection into Chrome's viewer

Chrome's PDF viewer is an extension-hosted frame that extensions cannot script [UNVERIFIED, spike step 1], and
Firefox's built-in pdf.js viewer is a privileged page that is likewise closed to extensions. So the plan does not
depend on injecting either viewer. Instead:

1. On a tab whose injection fails at a gesture and whose URL looks like a PDF (path ends in `.pdf`, or the spike finds
   a reliable signal), the panel shows "This is a PDF. Open it in the Translate Side reader" (and on any tab, a
   "Open a PDF file…" entry in the panel menu).
<!-- Red Team: PDF reader skips the denylist; its grant doubles as a site grant -->
2. Before offering the button, the panel checks the PDF URL with `classifyUrl` (`src/shared/denylist.ts:31-47`) and
   the user's never-translate list (`isNeverTranslate`, `src/shared/sites.ts:92`). A denylisted or never-listed URL
   gets the same blocked state as any such page, and no button. The reader page repeats both checks on its `src` at
   boot, before any fetch, so a hand-typed `pdf.html?src=` cannot bypass them. (Those checks today run only on the
   tab or page URL, `src/shared/inject.ts:38`, `src/extract/index.ts:79`; the reader tab's own URL is
   `chrome-extension://…`, which `classifyUrl` calls `restricted`, so the panel recognises its own reader URL
   explicitly, by `runtime.getURL('pdf.html')`, and classifies the `src` instead.)
3. The button asks for the PDF's origin with `permissions.request` in that click (`https://*/*` and `http://*/*` are
   already optional, `wxt.config.ts:21`), then opens the extension's own `pdf.html?src=<url>` in the same tab. A PDF
   grant is not a site grant: an origin grant otherwise means "re-inject here with no gesture"
   (`hasSitePermission`, `src/shared/sites.ts:101-112`). So when the origin was not granted before the click (not a
   provider endpoint, not an allowlisted site), the reader calls `permissions.remove` for it as soon as the fetch
   ends. Reloading or restoring the reader tab then shows "Load this PDF again" and fetches only after that click.
4. The reader fetches with `credentials: 'omit'` by default. If the answer is 401 or 403, or is not a PDF (a sign-in
   page), the reader offers a visible choice, "This PDF needs your sign-in for <host>. Send your cookies for this one
   download?", with one privacy line; only that click retries with `credentials: 'include'`, for that one fetch.
   The reader also reads a local file chosen with `<input type="file">` (no permission at all). `file://` URLs need
   Chrome's "Allow access to file URLs"; without it the reader offers the file picker.
5. pdf.js (from `pdfjs-dist`) loads only in the reader page: it parses, renders pages to canvas lazily, and builds a
   text layer of DOM spans. A pure segmenter groups text items into lines and paragraphs and emits `Segment[]` whose
   targets are Ranges over the text-layer spans, so highlight, scroll and hover work through the existing DOM-based
   code (`src/extract/link.ts`).
6. The reader page speaks the same content port protocol as `content.ts` (`hello`, `extract`, `viewport`,
   `highlight`, `scroll`). Whether `tabs.connect` reaches an extension page in a tab is spike step 1; if it does
   not, the panel's controller uses `runtime.connect` with the tab id in the port name when the tab's URL is the
   reader's, and nothing else in the panel changes.

## Requirements

- Text PDFs: paragraphs in reading order, headings by font size, single and two-column layouts, de-hyphenation at line
  ends, running headers and footers (repeated on most pages) dropped, page numbers dropped. Each segment's `domPath`
  is `pdf/page[n]/block[k]`; ids stay stable across reloads of the same file.
- Scanned PDFs: when the text layer has fewer than a threshold of characters per page on most pages (threshold set
  from the fixtures), the reader shows "This PDF is scanned images. Translate Side can't read it (no OCR)" and the
  panel shows the same state. `ExtractResult` gains a reason `'scanned-pdf'` (additive, `src/shared/protocol.ts:42`).
- Caps: 50 MB and 1,000 pages; above that a clear message. Encrypted or password PDFs: a "can't open" message (no
  password prompt in M9).
- pdf.js configured for an extension page: `isEvalSupported: false`, worker from a bundled extension URL, no remote
  fonts or CMaps (bundled or disabled), no `wasm-unsafe-eval` CSP change unless the spike proves text rendering needs
  it (then it is a deliberate manifest change with `check:manifest` updated).
<!-- Updated: Validation Session 1 - gate resolved once and stored -->
- Gate: `featureAvailable('pdf')` is awaited once at the reader page's boot, before any fetch, and the answer is kept
  for the page's lifetime. Not available → the `<ProLock>` note (`pro.locked`) beside the reader's load control,
  nothing fetched. The panel's "Open in reader" button is never gated (it only opens the page).
<!-- Red Team: PDF reader skips the denylist; its grant doubles as a site grant -->
- Denylist and never list on `src` (panel and reader boot); `credentials: 'omit'` by default with the one-time
  cookie choice; a PDF-only origin grant is removed after the fetch.
<!-- Red Team: budget update rewrites every entry; .mjs names keep their hash -->
- Bundle: the reader entry and its pdf.js chunks are new budget lines, hand-added at their measured gzip size plus
  10%, with `total` raised by their sum and the reason appended to `note`; `--update` is not used, because it rewrites
  every entry. `check-bundle.mjs` counts `.mjs` in both the file filter (`:16`) and the hash-stripping name rule
  (`:21`, `(\.(m?js|css))$`), in the same commit, so a hashed `pdf.worker-<hash>.mjs` keeps one stable name.

## Architecture

```
Tab (PDF in browser viewer) --Alt+T--> inject fails (gesture) --> panel: URL looks like PDF
   classifyUrl(url) ok && !isNeverTranslate(url) ? "Open in reader" : blocked state
   click → permissions.request(origin) → tabs.update(tab, pdf.html?src=url)
pdf.html (extension page in the tab)
   boot: available = await featureAvailable('pdf')                 ← the one gate call site, kept for the page
         classifyUrl(src) && !isNeverTranslate(src)                (again, before any fetch)
   bytes: fetch(src, credentials 'omit') [→ 401/403/not PDF → cookie choice → one 'include' fetch] | file picker
          then permissions.remove(origin) if it was granted only for this PDF
   pdf.js (lazy, this page only) → pages → canvas + text layer (DOM spans)
   src/extract/pdf.ts (pure): TextItem[] per page → lines → blocks → Segment[] + Range targets
   page agent: same port protocol as content.ts (hello/extract/viewport/highlight/scroll)
Panel: unchanged pipeline (jobs, engine, cache), port opened by tabs.connect or runtime.connect (spike)
```

The segmenter is split from pdf.js: `src/extract/pdf.ts` takes plain `{ str, x, y, w, h, fontSize, fontName }` items,
so its tests run in Node on recorded item dumps without pdf.js.

## Related files

- **Create:** `src/entrypoints/pdf/index.html`, `src/entrypoints/pdf/main.ts` (boot, gate, fetch, render, port agent),
  `src/extract/pdf.ts` and `src/extract/pdf.test.ts`, `src/shared/page-agent.ts` (the port handlers shared by
  `content.ts` and the reader, extracted from `content.ts` without behaviour change), `fixtures/pdf/` (generated
  text PDFs: single column, two column, headers and footers, a long one; one image-only PDF), `fixtures/pdf/items/`
  (recorded text-item dumps for Node tests), `fixtures/snapshots/*.pdf.segments.txt`, `e2e/pdf.spec.ts`,
  `scripts/pdf-fixtures.mjs` (generates the fixtures from existing site fixtures with Playwright `page.pdf()`, and the
  image-only one from a screenshot, so every fixture's license is the source fixture's).
- **Modify:** `package.json` (`pdfjs-dist` dependency, `pdf:fixtures` script), `src/entrypoints/content.ts` (use
  `page-agent.ts`), `src/entrypoints/sidepanel/controller.ts` (`:288` port choice if needed; the PDF state),
  the panel view that shows blocked states, `src/shared/protocol.ts` (`'scanned-pdf'`), `src/shared/inject.ts` (a
  `pdf` hint on `inject-failed` when the URL looks like a PDF), `src/shared/features.ts` (only if absent),
  `scripts/check-bundle.mjs` (`.mjs`), `scripts/bundle-budget.json`, `src/locales/en.yml`, `src/locales/vi.yml`,
  `docs/privacy.md` (the reader fetches the PDF from its own address, with the user's grant), `DESIGN.md` (§1
  non-goal line: PDFs now read through the reader page; scanned PDFs still out; §8 permission sentence), `README.md` (feature table, Pro).

## Steps

1. **Spike (manual, no repo changes).** On Chrome 138+ with the current build: open an `https://…pdf`, press Alt+T,
   record whether the side panel opens, the `inject-failed` detail, and what `tab.url` shows. In a throwaway branch
   load an extension page in a tab and check whether `tabs.connect(tabId)` reaches its `runtime.onConnect`; check
   whether an activeTab grant alone lets an extension page fetch that origin. Measure `pdfjs-dist` gzip sizes (main
   module and worker) with `check-bundle.mjs`'s method. Check whether pdf.js text-layer rendering needs WASM. Record
   all results in the phase report and in `docs/plans/M9-pdf.md` (M9 §3).
2. Generate the fixtures (`pnpm run pdf:fixtures`) and record text-item dumps for each.
3. Write `src/extract/pdf.ts` with snapshot tests over the dumps: reading order, columns, headings, de-hyphenation,
   header/footer and page-number removal, stable ids, scanned detection.
4. Extract `src/shared/page-agent.ts` from `content.ts`; the existing content tests must pass unchanged.
5. Reader page: gate, fetch or file, pdf.js with the extension-safe options, lazy page rendering, text layer, segment
   targets as Ranges, the agent on the port; the `src` checks, the `omit`-first fetch with the one-time cookie
   choice, and the removal of a PDF-only grant after the fetch.
6. Panel: the PDF state and "Open in reader" with the permission request in the click, offered only after
   `classifyUrl` and the never list pass for the PDF URL; recognising its own reader URL and classifying its `src`;
   the port choice from the spike; the scanned state.
7. `check-bundle.mjs`: widen the filter (`:16`) and the name rule (`:21`) to `m?js`. Build, read the new files'
   sizes from the "not in the budget" messages, and hand-add those lines and the total to `scripts/bundle-budget.json`
   with a note; no other line changes. Rebuild after touching any pdf.js import to confirm the names are stable.
8. `e2e/pdf.spec.ts` with the mock provider: open each text fixture in the reader via its `pdf.html?src=` URL on the
   fixture server, translate, all blocks final; hover and scroll sync on one; the image-only fixture shows the
   scanned state in both reader and panel; a PDF over the cap shows its message. The request firewall stays on (only
   the fixture server and the mock are reached). Red-team cases: a `src` on a built-in denylisted host and one on a
   never-listed host are refused in the panel and at reader boot with nothing fetched; a fetch carries no cookies
   unless the cookie choice was clicked; after the fetch, a PDF-only origin is no longer granted, and reloading the
   reader fetches nothing until "Load this PDF again".
9. Docs: `docs/privacy.md`, `DESIGN.md` §1 line and the §8 permission sentence (`DESIGN.md:819-821`: optional host
   permissions are also requested for a PDF's origin for one download, then removed), README feature table.
10. Run `pnpm run eval:gate` only if engine or LLM code changed (expected: no).

## Todo

- [ ] Spike recorded (viewer injection, port to extension page, activeTab fetch, pdf.js size, WASM)
- [ ] One-page track plan
- [ ] PDF fixtures generated with item dumps
- [ ] `src/extract/pdf.ts` with snapshot tests
- [ ] `page-agent.ts` extracted, content tests unchanged
- [ ] Reader page with gate, fetch/file, render, agent
- [ ] Panel PDF and scanned states, permission request in the click
- [ ] Bundle check counts `.mjs` (filter and name rule); budget lines hand-added with a note
- [ ] Denylist and never list on `src`; `omit`-first fetch with the cookie choice; PDF-only grant removed after the fetch
- [ ] E2E PDF spec green
- [ ] Privacy, DESIGN and README updated

## Success criteria

- M9 §2.7 done when: text PDFs in the fixture set segment cleanly (snapshot tests reviewed once by a human; the e2e
  translates every block of every text fixture); scanned PDFs show a clear "not supported" state (e2e on the
  image-only fixture).
- The Chrome manifest is unchanged unless step 1 forced a CSP change, recorded and checked by `check:manifest`.
- The panel, content and background bundles stay within their existing budget lines.

## Guarantee to keep

Everything downstream of `Segment[]` is unchanged (jobs, engine, cache, panel rendering). No new required
permission: the PDF origin is requested at the click, like the allowlist.

## Verification

```
pnpm run test -- src/extract/pdf.test.ts tests/content.test.ts
pnpm check
pnpm run e2e
pnpm run build && pnpm run check:bundle && pnpm run check:manifest
```

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| pdf.js is far over the 28 KB headroom (expected: on the order of 100 KB+ gzip main, more for the worker [UNVERIFIED]) | High × Medium | Loaded only in the reader page; deliberate budget lines; the panel and content entries keep their budgets |
| A PDF on a denylisted or never-listed host is read and sent | Medium × High | `classifyUrl` and the never list on `src` in the panel and at reader boot; e2e cases |
| A PDF origin grant turns into a lasting site grant (re-injection, re-fetch with cookies) | Medium × High | Remove a PDF-only grant after the fetch; `credentials: 'omit'` by default |
| A hashed `.mjs` worker gets a new budget name each build | High × Low | The name rule strips hashes from `.mjs` too, in the same commit as the filter |
| `tabs.connect` does not reach an extension page | Medium × Medium | Spike first; `runtime.connect` fallback confined to the controller's port choice |
| Reading order wrong on complex layouts | High × Medium | Fixture set covers one and two columns; the done criterion is the fixture set; complex layouts (tables, footnotes) recorded as known limits |
| A cross-origin fetch fails without a grant | Medium × Medium | The click requests the origin; the file picker works with no grant |
| pdf.js needs `wasm-unsafe-eval` | Low × Medium | Spike; prefer disabling the feature that needs it; otherwise a recorded manifest change |

## Security

<!-- Red Team: PDF reader skips the denylist; its grant doubles as a site grant -->
The PDF is fetched only after a user click that also grants its origin, and only when its URL passes the built-in
denylist and the user's never-translate list; nothing is fetched on navigation, reload or session restore, because a
PDF-only grant is removed once the fetch ends. Cookies are sent only after the user chooses to, for that one
download. A PDF grant never acts as a site allowlist grant. Bytes stay
in the reader page; only extracted text goes to the user's provider, as for any page. pdf.js runs with eval off and
no remote resources. PDF JavaScript and forms are never executed (`enableScripting` off, no annotation layer forms).
The reader page renders translations as text, never HTML.

## Rollback

Remove the reader entry and the panel's "Open in reader" state; tabs fall back to today's `inject-failed`. The
`page-agent.ts` extraction is behaviour-neutral and may stay.
