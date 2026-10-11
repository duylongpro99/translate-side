# SPA fixtures (plan M5-E2)

Three single-page docs sites in the shapes of Docusaurus, MkDocs Material (instant navigation) and
GitBook, sharing one tiny router (`spa.js`). Original filler text, MIT (this repository). They are
for the SPA tests (`src/extract/spa.test.ts`: segment ids stay stable across re-reads, plan M5
§3 #5) and for the M6 end-to-end suite (plan M5 §9 handoff): serve this folder over HTTP (for example
`npx http-server fixtures/spa -p 8765`) and open `docusaurus.html`, `mkdocs.html` or `gitbook.html`.

- Routes are `?p=intro|install|config`; sidebar, breadcrumb and pagination links navigate with
  `history.pushState`, like a docs SPA, and back/forward work. A reload serves the same route.
- Every page repeats the same note admonition and the same "Next steps" list inside the content,
  so pages 2 and 3 show cache reuse (plan M5 §3 #2).
- `gitbook.html` renders a skeleton first and the page 300 ms later (re-read after a settle).
- `window.__spa` drives the changes an SPA makes without a route change: `rerender()` (same
  content, all new nodes), `banner()` (a block inserted above the layout, every path shifts),
  `append(text)` (late content), `edit(text)` (one block's text changes), `go(id)`.
