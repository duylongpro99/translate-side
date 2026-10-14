<div align="center">

<img src="public/icon/128.png" alt="Translate Side" width="96" height="96" />

# Translate Side

**Read any article in your own language, right next to the original.**

A Chrome extension that opens a side panel beside the page you're reading and fills it with a
natural translation from a light LLM. The translation keeps the author's meaning, tone and intent,
so it reads like a native writer wrote it.

![Chrome 138+](https://img.shields.io/badge/Chrome-138%2B-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)
![Version 1.1](https://img.shields.io/badge/version-1.1.0-blue)

[Features](#-features) · [How it works](#-how-it-works) · [Getting started](#-getting-started) · [Providers](#-providers-and-local-models) · [Privacy](#-privacy) · [Roadmap](#-roadmap) · [Contributing](#-contributing)

</div>

---

```
┌──────────────────────────── Browser window ─────────────────────────────┐
│  Original page (untouched)              │  Translate Side panel         │
│                                         │  ┌─────────────────────────┐  │
│  # Understanding Async Rust             │  │ EN → VI         Natural │  │
│                                         │  ├─────────────────────────┤  │
│  Futures in Rust are lazy: they do      │  │ # Hiểu về Async Rust    │  │
│  nothing unless polled...               │  │ Future trong Rust rất   │  │
│                                         │  │ "lười": ...             │  │
│  ```rust                                │  │ ```rust  (kept as-is)   │  │
│  async fn fetch() { ... }               │  │ async fn fetch() {...}  │  │
│  ```                                    │  │ ░░░░ translating… ░░░░  │  │
└─────────────────────────────────────────┴───────────────────────────────┘
```

## Why Translate Side?

Classic machine translation works one sentence at a time. It can't see who the article is for,
what it's trying to do, or whether the author is joking. You get text that is technically correct
and reads like a word-by-word translation.

Translate Side gives the model the **whole document's context** before it translates a line:

- **The page stays as it is.** The original stays in the tab and the translation sits beside it,
  block for block.
- **Meaning over words.** Idioms become natural equivalents, sarcasm stays sarcastic, and a
  formal doc stays formal.
- **Code is left alone.** Code blocks, inline `code`, URLs, numbers and product names come
  through unchanged.
- **Terms stay consistent.** If "executor" is kept in the first paragraph, it's kept in the
  last one too.

## ✨ Features

| | |
|---|---|
| 🪟 **Side-by-side reading** | Click the toolbar icon or press <kbd>Alt</kbd>+<kbd>T</kbd>. The panel opens for that tab and starts translating right away; the same key closes it again. |
| ⚡ **Streaming output** | Segments appear as they're translated. |
| 🗂️ **Any provider, or none online** | Bring your own key for Anthropic, OpenAI, Google Gemini, OpenRouter or any OpenAI- or Anthropic-compatible service, or run a model on your own computer with Ollama or LM Studio. Route pages to different models per site, with fallbacks. See [Providers and local models](#-providers-and-local-models). |
| 🧠 **"About this document"** | Before translating, the model writes a short brief covering genre, audience, purpose, tone and key terms. You can read it in the panel, and every chunk is translated with it. |
| 🎨 **Style modes** | **Natural** reads as if it was written in your language. **Faithful** stays closer to the original wording. **Simplified** uses short sentences and plain words. |
| ⚖️ **Quality modes** | **Fast** translates each part of the page in one pass, at the lowest cost. **Balanced**, the default, reads the page first and translates with what it learned. Choose in the panel header or in Settings › Translation quality. |
| ✨ **Best mode** | Best translates like Balanced, then a second look reviews each block for meaning errors, omissions and unnatural wording. The first draft appears as fast as in Balanced; a better version replaces it, marked "Refined", and "Show draft" brings back what it replaced. A fix that would lose code, links or numbers is dropped and the draft stays. It costs more than Balanced (about 1.3 to 1.5 times on the eval set), counts against the token budget, and can use its own model (Settings › Providers › Review with). |
| ✏️ **Edit a translation** | The Edit button on a block opens it for your own wording. Your version is marked "Edited", is shown whenever that text comes up again, and stays on this device, even when you clear the cache. |
| 🧾 **Translation memory** | In Balanced and Best, your corrections also guide later translations: when a passage is similar to one you corrected, the correction goes to the model as an example (at most three per chunk). By default only corrections from the same site are used; "Use corrections from other sites" widens that. Export and import the memory as its own file in Settings › Translation memory. |
| 📖 **Personal glossary** | Pick how a term is always rendered, or keep it as is (for example, "deploy" stays in English). It syncs to other devices signed in to the same Chrome profile. |
| 🛡️ **Checked output** | Every segment is checked for lost code spans, URLs, numbers and formatting. A segment that fails is re-requested once, so you never get a broken one without a warning. |
| 🌐 **Language aware** | Detects the page's language, and skips a page that is already in your target language. The interface is in English and Vietnamese and follows Chrome's language. |
| 🔗 **Hover link and scroll sync** | Point at a block in the panel and the matching block on the page is marked, and the other way round. The panel can follow the page as you scroll. |
| 📌 **Selection and sites** | Select text and choose "Translate in side panel" to translate just that. Allow a site and each page you open there is translated while the panel is open; mail and sign-in sites are never read. |
| 🗃️ **Cache and long pages** | Translations are cached on your device and resume after a reload. Long pages translate what you are looking at first, and single-page apps are followed as they change routes. |
| 💸 **Cost you can see** | The panel shows the token cost of each page. A per-page token budget keeps a runaway job in check. |
| ⌨️ **Keyboard and screen readers** | The panel is one Tab stop; the arrows (or <kbd>J</kbd>/<kbd>K</kbd>) move between blocks, and <kbd>O</kbd>, <kbd>R</kbd>, <kbd>E</kbd>, <kbd>C</kbd> show the original, retranslate, explain and copy the focused block. The translation is marked with its language. See [Keyboard shortcuts](#keyboard-shortcuts). |
| 📦 **Portable settings** | Export your connections, models, routing, preferences, glossary and site lists to a JSON file and import it in another browser (Options › Export and import settings). API keys stay out of the file unless you tick "include keys" and confirm. |
| 🩺 **Local diagnostics** | The last 50 translations (versions, model, counts, tokens, timings, error kinds; never page text or page addresses, and site names only if you turn them on) are logged on this device only. Options › Diagnostics shows the whole file before you save it to attach to a bug report. Nothing is sent automatically. |
| 🔒 **Minimal permissions** | No blanket access to every site. The extension runs only on the tab where you open it (`activeTab`), and asks for access to one provider or one allowlisted site at a time (a site's `http` and `https` addresses, and its subdomains for a `*.` entry), on your click. Every permission is explained in [`docs/store/permission-justifications.md`](docs/store/permission-justifications.md). |

## 🔍 How it works

```
┌──────────────┐  segments, viewport    ┌──────────────────────────┐   provider API
│Content script│◀──────────────────────▶│ Side panel (engine host) │◀──────────────▶ OpenAI-compatible
│ • DOM walk   │                        │ • analyze → brief        │                 endpoints
│ • segmenter  │                        │ • translate (contextual) │
└──────▲───────┘                        │ • check → repair         │
       │ inject                         │ • render + cost          │
┌──────┴───────────────┐  open panel    │                          │
│ Service worker       │───────────────▶│                          │
│ toolbar · Alt+T      │                └──────────────────────────┘
└──────────────────────┘
```

1. **Extract.** The content script walks the page's main content, drops navigation and in-page
   chrome, and splits it into segments: headings, paragraphs, list items, quotes, table cells and
   code. Inline links and emphasis become light markers the model can keep.
2. **Understand.** An `analyze` pass reads the title, outline and opening of the document and
   writes the brief.
3. **Translate.** Each chunk is translated with the brief, your glossary, your style mode, and
   the last few paragraphs before it, so the tone and terms carry from one chunk to the next.
4. **Check.** Segment count, markers, backtick spans, URLs, numbers and length ratios are
   validated. Anything that fails is re-requested once before it's flagged.

The translation engine in `src/engine/` is plain TypeScript with no DOM, `chrome` or vendor SDK
imports. It runs the same way in the panel and in Node, which is how the eval harness tests it.

## 🚀 Getting started

**You'll need:** Chrome 138+ on desktop, and either an API key for a provider or a local model.

### Install

- **Chrome Web Store:** *link to be added when the listing is published.*
- **From source:** needs Node.js 22+ and [pnpm](https://pnpm.io) 10.

  ```bash
  pnpm install
  pnpm build            # writes the extension to .output/chrome-mv3
  ```

  Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose
  `.output/chrome-mv3`. For live reloading while you work, run `pnpm dev`.

### First run

1. A setup guide opens on install (you can reopen it from Settings). Pick a provider, paste its API key, and press
   **Test connection**; Chrome asks for access to that provider only. For a local model, follow
   [`docs/local-models.md`](docs/local-models.md) instead.
2. Go to any article and press <kbd>Alt</kbd>+<kbd>T</kbd> (or click the toolbar icon). The first time, the panel
   says where the text will go and waits for you to confirm.
3. Set your target language, style and glossary in Settings (the gear in the panel).

<kbd>Alt</kbd>+<kbd>T</kbd> is the default on every system, macOS included (<kbd>Option</kbd>+<kbd>T</kbd> there).
To use another key, open `chrome://extensions/shortcuts`, find Translate Side and set one; the same key then opens
and closes the panel.

### Keyboard shortcuts

<!-- Generated from src/shared/shortcuts.ts: keep the two in step (src/shared/shortcuts.test.ts checks it). -->
| Keys | What it does |
|---|---|
| <kbd>Alt</kbd>+<kbd>T</kbd> | Open the panel, or close it when it is open (rebind it at `chrome://extensions/shortcuts`) |
| <kbd>↓</kbd> or <kbd>J</kbd> | Next block |
| <kbd>↑</kbd> or <kbd>K</kbd> | Previous block |
| <kbd>Home</kbd> / <kbd>End</kbd> | First / last block |
| <kbd>O</kbd> | Show or hide the original under this block |
| <kbd>R</kbd> | Retranslate this block |
| <kbd>E</kbd> | Explain this block |
| <kbd>C</kbd> | Copy this block as plain text |
| <kbd>Esc</kbd> | Close the shortcut list in the panel |

The block keys work while a block or one of its buttons has keyboard focus, so they never clash
with a page's or Chrome's own shortcuts. The panel's **?** button lists them too, and so does
the options page.

With a screen reader, the letter and arrow shortcuts need focus mode (forms or application mode) on; every action can also be reached with Tab and pressed with Enter.

### Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the extension with hot reload |
| `pnpm check` | Runs lint, typecheck, the engine boundary check, tests, the build, the bundle size budget and the manifest check (the same as CI) |
| `pnpm test` | Runs the unit, snapshot and boundary tests (Vitest) |
| `pnpm run e2e` | Runs the end-to-end tests: the built extension in Chromium against a mock provider (build first) |
| `pnpm run zip` | Builds the Chrome Web Store package (see [`docs/store/submission.md`](docs/store/submission.md)) |
| `pnpm run store:screenshots` | Regenerates the store screenshots and tile in `docs/store/assets/` |
| `pnpm engine:node` | Runs the translation engine in plain Node |
| `pnpm eval -- --set eval` | Translates the eval set with the current strategy and prompt |
| `pnpm eval:report -- <runs…>` | Compares runs side by side on fidelity, naturalness, tone, terminology and cost |

## 📏 Measured, not guessed

Quality is tracked against an eval set of **23 openly licensed passages**: tech blogs, docs,
opinion pieces, and the hard cases (idioms, humor, sarcasm, Swift's *A Modest Proposal*).
Each passage is scored 1–5 on **fidelity, naturalness, tone and terminology**. Human scores are
the source of truth, and an LLM judge is calibrated against them. See [`eval/README.md`](eval/README.md).

The current numbers (segments lost after repair, code and marker retention, cost against single-pass) are in the eval
gate's baseline, [`eval/gate.json`](eval/gate.json), and each run's summary under [`eval/runs/`](eval/runs/). A broken
brief never fails a job: the job just continues without one.

The [provider matrix](docs/provider-matrix.md) compares Gemini, APIBOX and Ollama cloud on the same set. Two of its
rows were not measured: Anthropic direct (no key) and OpenRouter with Claude Haiku, so **no Haiku cost figure is
claimed**. The matrix also says why local Ollama and LM Studio numbers are yours to measure.

We're honest about the open gap too. Contextual translation doesn't beat single-pass on every
rubric yet, especially tone and terminology. Closing that gap is planned for a later milestone.

## 🔌 Providers and local models

Add connections in **Settings › Providers**: Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama (local or cloud),
LM Studio, or a custom OpenAI- or Anthropic-compatible endpoint. A connection tests itself and says what is wrong
in plain words. Choose which model translates, which writes the document brief, what to fall back to, and a model
per site (with a "local only" switch that never falls back to the cloud).

- **Run a model on your computer:** [`docs/local-models.md`](docs/local-models.md) covers Ollama and LM Studio:
  install, pulling a model, the `OLLAMA_ORIGINS` setting Chrome needs, and troubleshooting.
- **Compare providers:** [`docs/provider-matrix.md`](docs/provider-matrix.md) has quality, cost and speed on the same
  eval set.
- Plain `http://` addresses are accepted only for this computer and your local network; everything else needs
  `https://`.

## 🔐 Privacy

Page text goes only to the provider you chose, directly from your browser, when you start a translation, and on
sites you allowlist. There is no Translate Side server, no analytics and no telemetry. Keys stay on your device.
Mail and sign-in pages, browser pages and form fields are never read. The full policy, with what is stored where and
how to delete it, is in [`docs/privacy.md`](docs/privacy.md).

## 🗺️ Roadmap

| | Milestone | What it brings |
|---|---|---|
| ✅ | **M0** Skeleton and spikes | The panel opens, and pages are extracted and segmented |
| ✅ | **M1** Translate end to end | Engine, streaming output, parser, repair, cost readout |
| ✅ | **M2** Contextual quality | Brief, glossary, style modes, check stage, eval set |
| ✅ | **M3** Reading UX core | Viewport-first translation, cache and resume, selection mode, better error messages |
| ✅ | **M4** Providers | Claude, OpenAI, Gemini, OpenRouter, Ollama and LM Studio, with connection test and fallback |
| ✅ | **M5** Reading UX complete | Hover link, scroll sync, single-page apps, long documents, keyboard and screen readers |
| ✅ | **M6** Release hardening → **v1.0** | Eval gate, end-to-end tests, storage migration, performance, Vietnamese interface, store package and docs |
| ⏳ | **M7** Stronger translation → **v1.1** | Quality modes, edits and a translation memory |
| 🔭 | **M8** Beyond | Firefox and other independent tracks |

The full plan is in [`ROADMAP.md`](ROADMAP.md) and [`docs/plans/`](docs/plans/). The design and its
reasoning are in [`DESIGN.md`](DESIGN.md).

## 🧱 Project layout

```
src/
  entrypoints/   background (service worker), content script, side panel, options page
  engine/        translation engine: strategies, stages, chunker, budget (no DOM / chrome / SDK)
  extract/       main-content extraction (DOM walk, Readability fallback)
  segment/       segmenter and inline markers
  llm/           provider adapters, error classifier, presets
  shared/        settings, protocol, language detection, cost
e2e/             end-to-end tests: the built extension, fixture pages and a mock provider
eval/            eval passages and scored runs
docs/            privacy policy, local-model guide, provider matrix, store listing; plans, decisions, progress logs
```

## 🤝 Contributing

Issues and pull requests are welcome. Before you open a PR:

- Run `pnpm check`. It runs the same checks as CI.
- Keep `src/engine/` free of DOM, `chrome` and SDK imports. The lint rules and `check:engine`
  enforce this.
- If you change a prompt or strategy, attach an `eval:report` comparison to the PR.

## 📄 License

[MIT](LICENSE) © 2026 Translate Peer.
Test fixtures, eval passages and their translations are third-party text under their own
licenses. See [`LICENSE`](LICENSE) and [`eval/README.md`](eval/README.md) for details.
