# M3 — Reading UX core → MVP

Size: M · Depends on: M1, M2 · Unblocks: M5 (observer infra), M4 quick switcher (header)

## 1. Goal

**Make the extension good enough to use every day, so reading a foreign page is faster with it
than without it.**

After M2 the translations are good, but the experience isn't yet: you wait for the whole page,
pay again on every revisit, and lose work when something fails. M3 fixes the four things that
decide whether someone keeps using a reader tool: **speed to the first readable line, zero cost
on revisit, graceful failure, and an escape hatch** (selection mode) when extraction fails. The
MVP bar is personal and strict: the developer uses it daily for a week without reaching for
another translator.

## 2. Done looks like

- Open the panel and the paragraphs on screen are translated first, within about 2 seconds.
  Scrolling moves what's translated next.
- Revisiting a translated page shows the translation instantly, with no API calls.
- If the network drops, everything already translated stays, and the panel offers a retry.
  A bad key shows "Fix key" inline. A rate limit shows a backoff indicator. A failed segment has
  its own retry button.
- Select text, right-click **Translate in side panel**: works on any page, including ones where
  extraction fails ("Couldn't read this page. Select text to translate it.").
- Each block has: show original inline, retranslate (skips the cache), copy.
- The header shows the language pair (with a target-language switch), model, style mode,
  settings, cancel/retranslate page and a scroll-follow toggle.
- First run shows a privacy notice. Banking, mail, `chrome://`, Web Store and pages with a
  focused password field are never extracted.

## 3. Success criteria (the MVP bar)

| # | Check | Target |
|---|---|---|
| 1 | Visible segments translated after opening, any article/docs page | ~2 s |
| 2 | Whole 3,000-word page | < ~30 s |
| 3 | Reopen a translated page | renders from cache, 0 API calls |
| 4 | Kill network mid-translation | translated part intact, retry offered |
| 5 | Selection mode on a page where extraction fails | works |
| 6 | Bad key | "Fix key" inline, nothing sent elsewhere |
| 7 | Denylisted page | never extracted, never sent |
| 8 | Dogfood | 7 days of daily use, no other translator needed; bug list triaged |

## 4. Out of scope

- Hover link and bidirectional scroll sync (M5). Only one-way page → panel follow here.
- SPA re-extraction, follow-link navigation on docs sites, lazy mode for huge pages (M5).
- Any provider except Anthropic; quick switcher (M4).
- "Explain this" (M5).

## 5. Decisions to make

| Decision | Input | Recommended default |
|---|---|---|
| Translation cache key | DESIGN §7 | `hash(segmentText + targetLang + model + styleMode + strategy@version + promptVersions + glossaryHash)`; highest revision only; LRU ~50 MB. |
| Brief excluded from the segment cache key | ROADMAP §8 item 11 | Yes, deliberately (boilerplate reuse wins). State it in DESIGN; retranslate always bypasses the cache. |
| Re-prioritization on scroll | M3-E1 | Reorder pending chunks only; never abort in-flight ones. |
| Resume after interruption | S1 decision | If the engine is panel-hosted, no resume machinery: cache keeps finished segments, and a retry re-runs only missing ones. |
| Password field rule | M3-E10 | Check for a focused `input[type=password]` at extraction time; skip the page. |

## 6. Work plan

**Sub-goal A — readable in seconds**
- M3-E1 IntersectionObserver → `priority` ids; engine orders chunks by priority and
  re-prioritizes pending chunks on scroll.
- M3-E7 One-way scroll follow (page → panel), header toggle.

**Sub-goal B — free on revisit**
- M3-E2 IndexedDB translation cache (key, LRU, revision rule), brief cache, cache stats in
  settings.
- M3-E3 Job persistence/resume per S1, or panel-hosted engine wiring.

**Sub-goal C — failure never loses the page**
- M3-E8 Error UX: auth → "Fix key" (no fallback); rate limit → backoff indicator per chunk;
  `segment.failed` → inline retry; network down → whole-page retry.
- M3-E4 Selection mode via context menu (`translateSnippet`) and the extraction-failure hint.

**Sub-goal D — control and trust**
- M3-E5 Per-block actions: show original inline, retranslate, copy.
- M3-E6 Header controls, including target-language and style-mode switches.
- M3-E9 Per-page cost readout and running total in settings (built-in Anthropic pricing).
- M3-E10 First-run privacy notice and built-in denylist.

**Sub-goal E — prove it's an MVP**
- M3-E11 Dogfood for one week. Log every time you reach for another translator and why.
  Triage: MVP blockers fixed in M3, the rest scheduled.

## 7. Demo script

1. Open a long article scrolled to the middle; press `Alt+T`. The visible paragraphs appear
   first (~2 s).
2. Scroll down fast; watch the next chunks follow the viewport.
3. Close and reopen the panel on the same page; network panel shows no API calls.
4. Mid-translation, turn off Wi-Fi: translated blocks stay; "Retry" appears. Turn it on; retry.
5. Replace the key with a bad one; retranslate: "Fix key" inline.
6. Open a page where extraction fails; select a paragraph; right-click → Translate in side panel.
7. Open a webmail page: nothing is extracted.
8. Show the dogfood log and the triaged bug list.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Brief call delays first viewport chunk | Measure; start the first chunk in parallel or before the brief if needed (see M2 risk). |
| Cache key misses due to small text differences (whitespace, markers) | Normalize segment text before hashing; test with fixture re-extraction. |
| Dogfood exposes extraction gaps on daily sites | Add those sites as fixtures; selection mode covers the gap meanwhile. |

## 9. Handoff to M4 and M5

- IntersectionObserver infra (M5 hover and bidirectional sync build on it).
- Panel header layout with a slot for the quick switcher (M4-E11).
- Error UX patterns that M4's fallback chain and model badges extend.
- Cache that makes M5's SPA re-extraction cheap.
