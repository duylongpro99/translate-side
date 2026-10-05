# M5 — Reading UX complete and robustness

Size: M · Depends on: M3 (observer infra, cache), M4 (routing storage, fallback chain,
permission flow) · Unblocks: M6

## 1. Goal

**Finish the side-by-side reading experience and make it survive real sites: single-page apps,
clicking through docs, huge pages and tables.**

The MVP works on one page at a time. The main use case in DESIGN §1 is reading **docs**, which
means clicking from page to page on Docusaurus, MkDocs or GitBook sites, many of which are SPAs.
If every click needs another toolbar press, the tool is an annoyance (ROADMAP §4, S5). M5 also
completes the "side by side" promise with hover linking and two-way scroll sync, and adds the
free, offline Chrome built-in path as a last-resort fallback.

## 2. Done looks like

- Hovering a translated paragraph highlights the original on the page, and the reverse.
  Scroll sync works both ways with no jitter.
- On an allowlisted docs site, clicking through pages keeps translating with the panel open.
  Sidebar text that repeats across pages comes from the cache for free. On a non-allowlisted
  site, the panel shows a one-click **Translate this page**.
- SPA route changes re-extract; only new or changed segments are translated.
- A 100-screen page stays responsive: the panel translates the viewport plus ~2 screens ahead,
  with a **Translate the rest** button.
- Tables translate cell by cell with each row in one chunk. Captions and alt text are a setting.
- Settings has site rules: auto-translate allowlist, never translate, local only, per-site model.
- If every provider is down, Chrome's Translator takes over, clearly labeled "basic translation".
- Each block has **Explain this** (a short note on idioms or cultural references).
- Settings export/import as JSON, with keys excluded unless confirmed.
- `Alt+T` toggles the panel; panel shortcuts and basic a11y (focus order, ARIA on segments).

## 3. Success criteria

| # | Check | Target |
|---|---|---|
| 1 | Browse 3 pages of an allowlisted Docusaurus site with the panel open | each translates without re-clicking |
| 2 | Repeated sidebar text on pages 2 and 3 | 0 tokens (usage meter) |
| 3 | 100-screen page | panel stays responsive; lazy mode keeps ahead of the reader |
| 4 | All providers down | `basic` Chrome Translator fallback, labeled |
| 5 | Segment ids stable across SPA re-extraction | 100% on fixture SPAs |
| 6 | Scroll sync loop | no feedback loop or jitter |
| 7 | Exported JSON contains no keys unless "include keys" confirmed | yes |
| 8 | Keyboard-only use of panel actions | possible |

## 4. Out of scope

- Firefox build (moved to M8 per ROADMAP §0).
- Code-comment translation (M8).
- `refine`, quality modes, inline editing (M7).
- Store packaging, e2e suite, perf budget (M6).

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| Docs-site navigation | S5, ROADMAP §8 item 6 | Allowlisting requests an optional host permission for that site so re-injection works on every navigation; "auto-open" means "auto-translate when the panel is already open". |
| Long-page threshold | §8 item 8 | Lazy mode above a segment or token threshold (tune on fixtures, start ~400 segments); viewport + ~2 screens ahead; "Translate the rest". |
| Chrome built-in shape | §8 item 3 | Two things: `chrome-builtin` adapter for Nano (`LanguageModel`, experimental, behind a flag) and a separate **`MTClient` port** (`translate(text, from, to)`) used only by the `basic` strategy. Fallback chain gets a terminal `basic` entry that switches strategy. |
| Chrome built-in in v1.0 | S8, ROADMAP §5 | Ship only if S8 showed it reliable; otherwise move to v1.1 and onboarding offers two paths. |
| Scroll sync loop guard | M5-E1 | Source-tagged scroll events with a short suppression window. |

## 6. Work plan

The navigation work is on the critical path (ROADMAP §4), so it goes first.

**Sub-goal A — keep translating as the reader moves through a site**
- M5-E3 Per-site host permission + re-injection on navigation; "Translate this page" fallback.
- M5-E2 SPA handling: MutationObserver + URL-change detection → re-extract; stable ids; cache
  serves unchanged segments.
- M5-E6 Site rules UI (allowlist, never translate, local only, per-site model) on M4-E8 storage.

**Sub-goal B — true side-by-side**
- M5-E1 Hover link both ways; bidirectional scroll sync with loop guard.
- M5-E8 "Explain this" (`explain@1` via `translateSnippet`, shown as a note).

**Sub-goal C — survive big and structured pages**
- M5-E4 Lazy mode for long docs.
- M5-E5 Tables (cell segments, rows in one chunk via `groupId`), captions and alt text setting.

**Sub-goal D — never leave the reader with nothing**
- M5-E7 `chrome-builtin` Nano adapter (flagged), `MTClient` port for Translator, `basic`
  strategy, "basic translation" label, terminal fallback entry.

**Sub-goal E — portable and accessible**
- M5-E9 Import/export settings JSON.
- M5-E10 Shortcuts and a11y.

Start M6 store assets and docs (M6-E1/E8) in parallel during this milestone.

## 7. Demo script

1. Allowlist a Docusaurus site (permission prompt appears once). Open the panel; click through
   three pages; each translates on its own. Show 0 tokens for the repeated sidebar in the usage
   meter.
2. On a non-allowlisted site, click a link: the panel offers **Translate this page**.
3. Hover paragraphs in both directions; scroll the page, then the panel.
4. Open a 100-screen page; scroll quickly; show the panel keeping ahead; press "Translate the
   rest".
5. Open a page with a large table; check rows read coherently.
6. Block all provider origins; retranslate: blocks show "basic translation".
7. Use "Explain this" on an idiom.
8. Export settings; show no key in the file; import into a fresh profile.

## 8. Risks

| Risk | Mitigation |
|---|---|
| SPA frameworks mutate the DOM constantly (re-render storms) | Debounce MutationObserver; diff by stable ids; only re-extract main content. |
| Re-injection timing races with SPA hydration | Re-extract after `document_idle` plus a short settle; fixture tests on 2–3 SPA docs sites. |
| Chrome built-in unavailable on many machines | Gate by `availability()`; it's a last fallback, not a dependency. |
| Bidirectional sync feels laggy | Map by segment ids, not pixel ratios; throttle to animation frames. |

## 9. Handoff to M6

- Feature-complete v1.0 scope.
- SPA and navigation fixtures for the e2e suite.
- List of permissions actually used, for the store justification.
