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
![Status: developer preview](https://img.shields.io/badge/status-developer%20preview-orange)

[Features](#-features) · [How it works](#-how-it-works) · [Getting started](#-getting-started) · [Roadmap](#-roadmap) · [Contributing](#-contributing)

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
| 🪟 **Side-by-side reading** | Click the toolbar icon or press <kbd>Alt</kbd>+<kbd>T</kbd>. The panel opens for that tab and starts translating right away. |
| ⚡ **Streaming output** | Segments appear as they're translated. The first one usually shows up in under 2 seconds. |
| 🧠 **"About this document"** | Before translating, the model writes a short brief covering genre, audience, purpose, tone and key terms. You can read it in the panel, and every chunk is translated with it. |
| 🎨 **Style modes** | **Natural** reads as if it was written in your language. **Faithful** stays closer to the original wording. **Simplified** uses short sentences and plain words. |
| 📖 **Personal glossary** | Pick how a term is always rendered, or keep it as is (for example, "deploy" stays in English). It syncs to other devices signed in to the same Chrome profile. |
| 🛡️ **Checked output** | Every segment is checked for lost code spans, URLs, numbers and formatting. A segment that fails is re-requested once, so you never get a broken one without a warning. |
| 🌐 **Language aware** | Detects the page's language, and skips a page that is already in your target language. |
| 💸 **Cost you can see** | The panel shows the token cost of each page. A per-page token budget keeps a runaway job in check. |
| 🔒 **Minimal permissions** | No blanket access to every site. The extension runs only on the tab where you open it (`activeTab`), and asks for host access per provider. |

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

> **Developer preview.** Translate Side isn't on the Chrome Web Store yet. You build it from
> source and load it unpacked.

**You'll need:** Node.js 22+, [pnpm](https://pnpm.io) 10, Chrome 138+ on desktop, and an API key
for the configured OpenAI-compatible provider.

```bash
pnpm install
pnpm build            # writes the extension to .output/chrome-mv3
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `.output/chrome-mv3`.
3. Open the extension's **Options** and paste your API key. You can also set your target
   language, style and glossary there.
4. Go to any article and press <kbd>Alt</kbd>+<kbd>T</kbd>. You can change the shortcut at
   `chrome://extensions/shortcuts`.

For live reloading while you work, run `pnpm dev`.

### Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the extension with hot reload |
| `pnpm check` | Runs lint, typecheck, the engine boundary check, tests, the build and the manifest check (the same as CI) |
| `pnpm test` | Runs the unit, snapshot and boundary tests (Vitest) |
| `pnpm engine:node` | Runs the translation engine in plain Node |
| `pnpm eval -- --set eval` | Translates the eval set with the current strategy and prompt |
| `pnpm eval:report -- <runs…>` | Compares runs side by side on fidelity, naturalness, tone, terminology and cost |

## 📏 Measured, not guessed

Quality is tracked against an eval set of **23 openly licensed passages**: tech blogs, docs,
opinion pieces, and the hard cases (idioms, humor, sarcasm, Swift's *A Modest Proposal*).
Each passage is scored 1–5 on **fidelity, naturalness, tone and terminology**. Human scores are
the source of truth, and an LLM judge is calibrated against them. See [`eval/README.md`](eval/README.md).

At the end of M2:

- **0** segments lost after repair across the eval set
- **100%** of code spans, markers and URLs kept on segments with code
- The contextual strategy costs **1.17×** single-pass, against a ceiling of 1.3×
- A broken brief never fails a job. The job just continues without one.

We're honest about the open gap too. Contextual translation doesn't beat single-pass on every
rubric yet, especially tone and terminology. Closing that gap is planned for a later milestone.

## 🗺️ Roadmap

| | Milestone | What it brings |
|---|---|---|
| ✅ | **M0** Skeleton and spikes | The panel opens, and pages are extracted and segmented |
| ✅ | **M1** Translate end to end | Engine, streaming output, parser, repair, cost readout |
| ✅ | **M2** Contextual quality | Brief, glossary, style modes, check stage, eval set |
| ⏳ | **M3** Reading UX core → **MVP** | Viewport-first translation, cache and resume, selection mode, better error messages |
| 🔜 | **M4** Providers | Claude, OpenAI, Gemini, OpenRouter, Ollama and LM Studio, with connection test and fallback |
| 🔜 | **M5** Reading UX complete | Hover linking, scroll sync, SPA support, long docs, Chrome built-in AI |
| 🔜 | **M6** Release hardening → **v1.0** | Chrome Web Store, end-to-end tests, beta |
| 🔭 | **M7–M8** Beyond | Refine strategy, translation memory, Firefox |

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
eval/            eval passages and scored runs
docs/            plans, decisions, progress logs
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
