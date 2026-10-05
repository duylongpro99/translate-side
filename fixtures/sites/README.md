# Site fixtures (from spike S3)

Ten rendered-DOM snapshots of real docs and article pages, for M0-E8 extraction and segmentation snapshot tests.
`manifest.json` holds per fixture: the source URL, the final URL, the capture time, the generator, and
`contentSelector`, a hand-picked CSS selector for the real content root used as ground truth by `spikes/s3/`.

How they were made (`spikes/s3/capture.mjs`): headless Chrome 154, page load + 3 s, scroll to the bottom to trigger lazy
content, then `document.documentElement.getHTML({ shadowRoots })` over every open shadow root. After that, `<script>`,
`<noscript>`, `<iframe>` and non-shadow `<template>` are removed, and a `<base href>` is added.

**Shadow DOM.** Open shadow roots are kept as declarative shadow DOM (`<template shadowrootmode="open">`). MDN's code
examples live only there (13 `<mdn-code-example>` hosts with empty light DOM). Chrome rebuilds the shadow roots when it
opens these files. jsdom does not: there they are plain `<template>` elements. Tests must flatten them first (see
`flattenShadow` in `spikes/s3/analyze-lib.mjs`). That is the same composition the extractor must do on the live DOM.

Re-capture: `cd spikes/s3 && npm i && node capture.mjs [slug]`. Pages change, so re-capturing changes snapshots.

These are third-party pages saved for local testing. Check with the project owner before this repository is made
public.
