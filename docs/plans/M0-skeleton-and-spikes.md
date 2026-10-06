# M0 — Skeleton and spikes

Size: M · Depends on: nothing · Unblocks: M1

## 1. Goal

**Prove the extension shell can reliably read a real page, and settle the architecture unknowns
before any translation code depends on them.**

Two things have to be true before an engine is worth writing. First, the text going into it
has to be clean: extraction and segmentation decide translation quality as much as the prompt
does. Second, the five unknowns in ROADMAP §2 (S1–S5) can each change where code lives or what
the user flow is. S1 alone decides whether the engine runs in the service worker or in the
side panel page. Answering them now is cheap. Answering them after M1 means rewriting it.

## 2. Done looks like

- Click the toolbar icon (or press `Alt+T`) on an article or docs page. The side panel opens
  and shows the page's original text as clean, typed segments: headings, paragraphs, list
  items, quotes, code blocks (marked do-not-translate) and table cells.
- Navigation, sidebars, ads and footers are gone. Code blocks are intact.
- `docs/decisions/` has a short record for each of S1–S5, and the engine host is decided.

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | Fixture sites with no UI noise in segments, judged against the hand-checked list `spikes/s3/noise.json` (moves to `fixtures/` with M0-E8), with M0-E5's generic + per-site cleanup selectors (decision S3) | ≥ 8 of 10 |
| 2 | Fixture sites with all code blocks intact and marked do-not-translate | 10 of 10 |
| 3 | Segment ids stable across two extractions of the same page | 100% |
| 4 | Panel opens on `chrome://` / Web Store pages with a clear "can't read this page" state, no crash | yes |
| 5 | Decision records S1–S5 merged | 5 of 5 |
| 6 | "Where the engine runs" decision is final | yes |
| 7 | CI runs lint, typecheck, unit/snapshot tests and the `engine/` boundary rule | green |

## 4. Out of scope

- Any LLM call in product code (spikes may call models).
- Settings beyond a placeholder options page.
- Viewport tracking, hover, scroll sync (M3/M5).
- SPA re-extraction (M5).

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| UI framework (Preact or Svelte) | M0-E1 | Preact: smaller learning surface with TS, easy signals for streaming state. Pick once. |
| Engine host | S1 | Decided (S1): **side panel page**. An open Port does not keep the worker alive; the worker is a coordinator only (DESIGN §4.1). |
| `<seg>` grammar and repair policy | S2 | Decided (S2, option C): lenient v1 grammar everywhere; close-by-lookahead grammar plus a per-chunk nonce only on chunks whose source holds literal tags; one-round repair; no escaping; output budget formula (DESIGN §5.7). |
| Extraction policy | S3 | Decided (S3): `main`/`article`/`[role=main]` walk first, with generic + per-site cleanup selectors; Readability as the fallback when the walk finds no container or too little text; then the selection hint. |
| Ollama 403 classification | S4 | Decided (S4): pre-fetch checks; `fetch` `TypeError` without host permission → `cors` (`cause: "permission"`); new `quota` kind; the local `403` + auth `none` → `cors` rule kept, untested (DESIGN §4.3.5). |
| Navigation and permissions | S5 | Decided (S5): (a) `action.onClicked` → `sidePanel.open` with optional `http://*/*` too; (c) `Alt+T` opens only in M0; allowlisting a site requests an optional host permission for re-injection; "auto-open" becomes "auto-translate when the panel is already open". |
| `minimum_chrome_version` | S5, S8 | 138, with features gated by availability checks rather than version (§8 item 18). |

S6–S8 (prompt caching on Haiku, SDKs in the extension, Chrome built-in availability) are
smaller and may finish in M1.

## 6. Work plan

Do the architecture-changing spikes first, in parallel with setup, so their answers land
before the shell wiring hardens.

**Sub-goal A — a project you can build on (week 1)**
- M0-E1 Project setup: WXT, TS strict, UI framework, Vitest, ESLint, CI.
  The boundary rule matters most: `engine/` may not import `chrome`, `wxt/*`, DOM types or
  `llm/` implementations.
- M0-E2 Manifest and entrypoints: `sidePanel`, `storage`, `activeTab`, `scripting`,
  `contextMenus`; `optional_host_permissions`; `Alt+T` command; `action.onClicked` → `sidePanel.open`
  with `openPanelOnActionClick: false` (decision S5).

**Sub-goal B — retire the architecture risks (weeks 1–2, time-boxed 1–2 days each)**
- S1 worker suspension during streaming → engine host decision.
- S5 `activeTab` and navigation → permission and allowlist design.
- S2 `<seg>` robustness on Haiku 4.5 and a 7–8B local model → parser grammar.
- S3 extraction on 10 docs/article sites → fixtures and fallback thresholds.
- S4 Ollama from an extension → error classifier rule.

**Sub-goal C — clean segments in the panel (weeks 2–3)**
- M0-E3 Injection under `activeTab`, handling "already injected" and "cannot inject here".
- M0-E4 Typed, versioned Port protocol (content ⇄ panel directly via `tabs.connect`; the worker
  handles action, injection and tab lifecycle; decision S1), tab-scoped routing.
- M0-E5 Extraction: walk first with generic + per-site cleanup selectors, Readability fallback,
  then the selection hint (decision S3); denylisted origins never extracted.
- M0-E6 Segmenter: kinds, inline markers (`[link]…[/link]`, backticks, `*…*`), `domPath`,
  stable ids (hash of path + text), and **`groupId` for table rows** (§8 item 12).
- M0-E7 Panel renders originals by kind; loading/empty/error states; dev-only segment view.
- M0-E8 Ten fixtures from S3 with snapshot tests.

Start collecting eval passages for M2 (M2-E8) now. It needs no code.

## 7. Demo script

1. Load the unpacked build in Chrome 138+.
2. For each of the 10 fixture sites: open the page, press `Alt+T`, scroll the panel. Confirm
   kinds are right, code blocks are intact and marked, and there's no nav/footer text.
3. Open `chrome://extensions` and press `Alt+T`: the panel shows "can't read this page".
4. Reload a fixture and re-open: the dev view shows the same segment ids.
5. Walk through `docs/decisions/` S1–S5 and state the engine host.

## 8. Risks

| Risk | Mitigation |
|---|---|
| S1 is inconclusive (suspension behaves differently across runs) | Default to the panel-hosted engine; it removes the question. |
| Readability strips docs-site content (admonitions, tabs, `details`) | Fixtures make losses visible; add special segment kinds or walk fallback per S3. |
| Spikes overrun | Hard 2-day box each; record "unknown, chose X because" if needed. |

## 9. Handoff to M1

- `Segment` type (with `groupId`) and the message protocol.
- Engine host decision and the S2 parser grammar.
- Ten fixtures and the snapshot tests.
- Boundary lint rule, so `engine/` stays portable from its first line.
