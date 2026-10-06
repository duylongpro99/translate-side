# Site fixtures (from spike S3)

Ten rendered-DOM snapshots of real docs and article pages, for M0-E8 extraction and segmentation snapshot tests. All
are under permissive or CC licenses: see `ATTRIBUTION.md` (authors, history links, license, changes) and the
`license` field per fixture in `manifest.json`. Each file also starts with a one-line attribution comment.

| Fixture | Family | License |
|---|---|---|
| `docusaurus-code-blocks` | Docusaurus docs | CC-BY-4.0 |
| `mkdocs-material-admonitions` | MkDocs Material docs | MIT |
| `mdbook-rust-book-ownership` | mdBook (GitBook-style docs) | MIT OR Apache-2.0 |
| `mdn-promise-then` | MDN reference | CC-BY-SA-2.5 (prose), CC0/MIT (code) |
| `docsrs-tokio` | docs.rs / rustdoc | MIT |
| `github-readme-bat` | GitHub README | MIT OR Apache-2.0 (README article only; the github.com page markup was cut out, see `ATTRIBUTION.md`) |
| `wikipedia-futures-promises` | Wikipedia | CC-BY-SA-4.0 |
| `goblog-pipelines` | Long-form blog essay (go.dev blog) | CC-BY-4.0 (text), BSD-3-Clause (code) |
| `twir-671` | Newsletter issue (This Week in Rust) | CC-BY-SA-4.0 |
| `globalvoices-bangladesh-protests` | News article (Global Voices, WordPress) | CC-BY-3.0 (text) |

`manifest.json` also holds per fixture: the source URL, the final URL, the capture time, the file size in bytes, the generator, and
`contentSelector`, a hand-picked CSS selector for the real content root used as ground truth by `spikes/s3/`.

How they were made (`spikes/s3/capture.mjs`): headless Chrome 154, page load + 3 s, scroll to the bottom to trigger lazy
content, then `document.documentElement.getHTML({ shadowRoots })` over every open shadow root. After that,
`spikes/s3/scrub.mjs` removes, at every shadow depth:

- `<script>`, `<noscript>`, `<iframe>`, and `<link rel>` network hints (prefetch, preload, modulepreload, preconnect,
  dns-prefetch);
- every `<meta>` except charset, viewport, description and generator (generator is kept because extraction may use it
  to detect the site's generator);
- tracking attributes (`data-hydro*`, `data-analytics*`, `data-ophan*`, `data-octo*`, `data-ga-*`, `data-gtm*`,
  `data-track*`).

Non-shadow `<template>` elements are removed and a `<base href>` is added.

**Shadow DOM.** Open shadow roots are kept as declarative shadow DOM (`<template shadowrootmode="open">`). MDN's code
examples live only there (13 `<mdn-code-example>` hosts with empty light DOM). Chrome rebuilds the shadow roots when it
opens these files. jsdom does not: there they are plain `<template>` elements. Tests must flatten them first (see
`flattenShadow` in `spikes/s3/analyze-lib.mjs`). That is the same composition the extractor must do on the live DOM.

**Offline and online use.**

- Images are not stored, only their URLs. Opened offline, images are broken.
- Opened in a browser while online, the `<base href>` makes the page fetch the site's external stylesheets and fonts
  (96 `<link rel=stylesheet>` across the set) and images from the original host. Tests in jsdom don't fetch anything.
- Network hints are stripped, so no prefetch storm. Docusaurus had 882 prefetch links before scrubbing.

Re-capture: `cd spikes/s3 && npm i && node capture.mjs [slug] && node attribution.mjs`. Pages change, so
re-capturing changes snapshots, and the hand-labelled noise list in `fixtures/noise.json` has to be re-checked.
