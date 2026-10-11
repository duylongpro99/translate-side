# M3 dogfood: agent QA pass (stands in for M3-E11 / §3 #8)

- Date: 2026-10-10. Build: `master` @ 6af810b (M3 + M4), built in a throwaway worktree (`wxt build`). The worktree has since been removed.
- Harness: Chrome for Testing (playwright chromium-1243) with `--headless=new` and playwright-core 1.57. The approach is the same as `scripts/eval/ext-run.mjs`, plus a small control server (`scratchpad/df-server.mjs`) so the session could be driven step by step.
- Provider: the Gemini preset `gemini-flash-lite` (shown in the panel as `gemini-3.5-flash-lite`), using the real key from `.env`. The key was never printed, and I checked that no file in the scratchpad contains it. Target language: Vietnamese. Style: Natural. Gloss: first.
- Spend according to the extension's own ledger: **$0.545** (374,678 input and 173,112 output tokens) over 213 provider requests.
- Screenshots: `scratchpad/dogfood-shots/` (98 files, all from the panel or the page, none with a key).
- Harness shortcuts. They are the reason for some of the gaps in section 3:
  - The panel ran as a tab (`sidepanel.html`) in the same window as the page, 1200 px wide, plus one check at 420 px.
  - Alt+T and the toolbar click were replaced by what the worker does: inject the content script and write the `access:<tab>` record.
  - Host permissions were added to a copy of the manifest.
  - The context-menu click was replaced by writing the `snippet:<tab>` record the worker writes.
  - "Network drop" was Playwright `setOffline(true)`.

Known items I did not re-report as new: M3-D11 (screen-done and whole-page speed), M3-D14 (banking, moved to M4), and the M5 scope items from plan §4 (SPA re-extraction). Carry-overs are listed in progress-m3.md.

## 1. Dogfood log

Wall time is from the injection to the job ending. "Screen" is the job's own `data-screen-done` stamp. Bug B4 shows this stamp is not reliable.

| # | Site | What I did | Result | Reach for another translator? |
|---|---|---|---|---|
| 1 | Docusaurus: docusaurus.io/docs, /installation, /configuration, /cli | Opened at the top. SPA-clicked to Installation, then reloaded. Clicked to Configuration and reloaded. Network drop and Retry on Configuration. Bad key on Configuration and on CLI. Closed and reopened the panel. Revisited all three pages. | Intro: 99/99 in 36 s, screen 2.9 s, $0.019. Installation: 69/69 in 18 s. Code blocks were kept as code; italics, links and inline code were kept. Reopening the panel: 0 requests, served in 0.0 s. Revisiting all 3 pages: 0 requests. Offline at 7/75: the job stopped at "Lost the connection · 45 of 75 translated, the rest is waiting · Retry". After going online, Retry sent 1 request and finished 75/75. **The SPA click left the old page in the panel, and Alt+T did not re-read it (B5).** **Bad key: no "Fix key" (B1), and the page lost its translation (B2).** | No for reading. Yes for clicking through docs: you have to reload every page (B5). |
| 2 | MkDocs Material: getting-started, creating-your-site, publishing-your-site | Opened, then clicked through 2 pages. These are full page loads on this site. | 32/32 in 16 s, 55/55 in 17 s, 31/31 in 14.5 s. Screen 2.1–4.6 s. The new page was picked up after each click. Code blocks and blocks hidden in tabs were labelled correctly. | No |
| 3 | GitBook: gitbook.com/docs, quickstart, formatting | Opened. SPA-clicked to Quickstart (stale, B5), then reloaded. Clicked to Formatting and reloaded. | 77/77 in 17 s. 113/113 in 22 s. 27/27 in 5 s. Screen 2.5–3.3 s. | Same as #1: you have to reload after each click. |
| 4 | MDN: Array.map, filter, forEach | Opened, then clicked through 2 pages (full loads). Revisited later. Checked at 420 px width. | 66/66 in 17 s, 54/54 in 12.5 s, 64/64 in 14 s. Screen about 1.5 s. Code and inline `code` were kept. Looks good at 420 px. While a heading streamed, it briefly showed the raw marker `[link]C` (B7). Revisit: 0 requests. | No |
| 5 | react.dev/learn/thinking-in-react | Opened at the top, scroll test, SPA click to "Describing the UI". | 99/99 in 26 s, screen 2.7 s. The SPA click left the old page (B5). Some link texts stayed in English, e.g. "start a React project" (B10). | No, apart from B5 |
| 6 | ja.react.dev/learn/describing-the-ui (Japanese to Vietnamese) | Opened. | 86/86 in 17 s, screen 2.8 s. Good Vietnamese, and terms were kept (component, props, JSX). | No |
| 7 | en.wikipedia.org/wiki/Printing_press (long) | Opened at 35% scroll, then scrolled to 85%. | 312/312 in 97 s (whole page about 100 s, known M3-D11), $0.085. The panel followed the page scroll to the right region. When the job stamped "screen done", the visible blocks in the panel were still English (B4). Infobox and tables rendered fine. | Borderline: the first screen is slow when you open mid-article. |
| 8 | en.wikipedia.org/wiki/Movable_type | Opened at 40%. Traced the order in which blocks became final, then cancelled. | The first request translated the article top (blocks 3–9). The visible blocks (58–65) arrived in the second batch, at about 5–7 s. | Borderline (B4) |
| 9 | github.com/expressjs/express (README) | Opened. Revisited. | 130/130 in 22 s. Code kept. The screen stamp was never set because the visible file list is not part of the extracted text. Harmless. Revisit: 0 requests. | No |
| 10 | GitHub issue facebook/react#11347 (long thread) | Opened, scrolled to 85%. | 350/350 in 51 s, $0.049. Screen 13.6 s. **Scroll reprioritising worked:** 5 s after the jump, 8 of the 10 visible blocks were final while the whole page stood at 114 of 350. | No |
| 11 | Stack Overflow /q/1642028 | Opened. | The first load showed the real question, but the panel said **"Couldn't read this page. Select text to translate it."** Every later load hit a Cloudflare "Just a moment…" page, so I could neither diagnose it nor try selection mode there (B9). | Yes, inconclusive. Needs a check in a real browser. |
| 12 | news.ycombinator.com (front page) | Opened, scroll test. | 91/91 in 28 s. Table rows were kept (61 rows). Screen at 17 s, because almost the whole list is on screen. | No |
| 13 | HN item 50028275 (comment thread) | Opened, cancelled at 60 s. | 240/249. Each comment's paragraphs were laid out as side-by-side table cells, with no usernames and no nesting. The panel overflowed sideways (scrollWidth 2,287 px against 1,200) (B3). | Yes: hard to follow the thread. |
| 14 | paulgraham.com/greatwork.html (long-form essay) | Opened at the top. Scrolled to 70% after 30 s. Cancelled at about 90 s. | **Unusable:** the whole essay came out as **one table row of 290 cells**, so the panel's scrollWidth was **41,463 px** (B3). The screen stamp never fired. The panel could not follow the scroll (every cell counts as visible). Translation ran strictly in page order: 61/263 at 30 s, and the region at 70% was still untranslated 60 s after scrolling there. After cancelling, the cost readout said "$0 · excludes cancelled requests" even though about 15 requests had finished (B12). | **Yes** |
| 15 | BBC article (cm1dwgr666wno) | Opened at 30%. Revisited. | 49/49 in 17 s, $0.013. The screen stamp came at 1.5 s, but the 2 paragraphs on screen were still English at that moment (screenshot pair) (B4). Revisit: 1 request, $0.0002 (a live page with a changed line). | Borderline (B4) |
| 16 | Guardian long-read (Havana syndrome) | Opened at 40%. On the first try, DNS lookups for the provider failed for about 40 s (`ERR_NAME_NOT_RESOLVED` on my machine). The second run used the cache. | The first run retried by itself and recovered without losing anything. Second run: 92/92 in 33.5 s. | No |
| 17 | astralcodexten.com Substack post | Opened at 30%. Timed when the on-screen paragraphs became final. | The job stamped screen done at **2.1 s**, but the 3 paragraphs on screen became final at **7.6 s, 8.7 s and 9.7 s** (B4). A blockquote inside the translated region stayed English for a while. Cancelled at 40 s (20/185). | Borderline (B4) |
| 18 | postgresql.org numeric types (tables and code) | Opened, scroll test. Tried the per-block Original, Retranslate and Copy actions. Viewed at 420 px. | 108/108 in 31 s. The tables look good at 1200 px. **At 420 px the table makes the whole panel scroll sideways (774 px) and draws over the sticky header (B6).** Some errors: "decimal point" became "dấu phẩy động" (floating point), "variable" became "biến đổi", and glosses were inserted into type-name cells, e.g. `bigint (số nguyên lớn)` (B10). Original toggle: works. Retranslating a block: 1 request, the text was replaced. | No at a wide panel. Annoying at a real panel width. |
| 19 | example.com (selection mode) | Selected the body and handed it over as the worker does after the context-menu click. | The selection view worked: "Selection · 6 of 7 · 1 failed · Retry failed · Back to the page". This is a multilingual page now. The Chinese, French, Russian and Spanish paragraphs were marked final but **left in their original language**. Arabic failed the quality checks. The Vietnamese line began with a garbled word, "Tenền miền" (B8). | Yes for mixed-language text (edge case) |
| 20 | Negative: accounts.google.com, icloud.com | Opened and injected. | Blocked view: "Translate Side never reads this site…". 0 requests. | n/a, pass |
| 21 | Negative: mail.google.com, outlook.live.com/mail (logged out) | Opened and injected. | Both redirect to public marketing pages (workspace.google.com, microsoft.com). These are not denylisted, and the pages were translated. That is correct. I could not reach a real inbox. | n/a |
| 22 | Negative: github.com/login with the password field focused | Typed into the username and password fields, kept focus in the password field, injected. Then blurred and injected again. | Focused: "Not read: a password field is in use… Nothing was sent". 0 requests. Blurred: "Couldn't read this page" (no article content). The field values never appeared in the panel. 0 requests. | n/a, pass |
| — | ja.wikipedia / de.wikipedia | Tried to open them for the non-English case. | Wikimedia returned "Wikimedia Error" to the automated browser, so I used ja.react.dev instead. | not tested |
| — | Medium | Tried medium.com/tag/programming. | `ERR_CONNECTION_CLOSED` from the automated browser. | not tested |

**Tally:**
- 19 content sites attempted. 17 produced a result I could judge (ja/de Wikipedia and Medium could not be loaded).
- **12 pass** (a reader would not need another translator): Docusaurus, MkDocs, GitBook, MDN, react.dev, ja.react.dev, Wikipedia, GitHub README, GitHub issue, HN front page, Guardian, PostgreSQL. The SPA docs sites pass only with a reload after every click.
- **3 borderline** on first-screen speed: BBC, Substack, Movable type (B4).
- **4 fail or degraded**: Paul Graham essay, HN thread, Stack Overflow (inconclusive), mixed-language selection.
- **3 negative cases pass**: the denylist, the password rule, and the mail redirects.

**M3 behaviour checks:**
- **Visible first, then following the scroll:** partly. The panel's scroll follow worked everywhere except on layout-table pages. Reprioritising after a scroll was confirmed on the GitHub issue. Opening mid-article did not put the visible paragraphs first (B4).
- **Code and inline formatting:** pass.
- **Cache on reopen or revisit:** pass. 0 requests across 9 revisits.
- **Network drop then Retry:** pass.
- **Bad key shows "Fix key":** **fail with Gemini** (B1).
- **Selection mode:** mechanics pass. Quality on mixed-language text fails (B8).
- **SPA navigation picks up the new page:** **no** (B5, M5 scope).
- **Denylist and password rule:** pass.
- **Per-block Original and Retranslate:** pass. Copy could not be checked.

## 2. Bug list (proposed triage)

### B1. A bad Gemini key never shows "Fix key". Every block fails with "Retry failed" instead. Proposed: **MVP blocker (M3)**

- **Repro:**
  1. Use the Gemini preset with a translated page open.
  2. Replace the key with an invalid one (`AIza…BAD…`).
  3. Click "Retranslate page", or open a new page.
- **Expected:** §3 #6 says "Fix key" appears inline, and §2 says auth errors give "Fix key" and no fallback.
- **Actual:** the job bar shows "Vietnamese · 0 of 75 · 75 failed · Retry failed". Each block says "Not translated: Please pass a valid API key" with its own Retry button. There is no `fix-key` button. On a fresh page: "1 of 184 · 183 failed". 3–4 requests, all HTTP **400**. Only generativelanguage.googleapis.com was contacted.
- **Cause (from reading the code):** Gemini's OpenAI-compatible endpoint returns **400** (not 401/403) for an invalid key. `src/llm/errors.ts:116-124` maps 400 to `bad_request` unless it is a billing or context-length error. M3 was tested with APIBOX, which returns 401.
- **Evidence:** `dogfood-shots/badkey-fixkey.png`, `dogfood-shots/badkey-fresh-page.png`
- **Why a blocker:** Gemini is the preset in daily use, and this is §3 #6 exactly. A small fix would be to treat a 400 whose message says "API key not valid", or whose `reason` is `API_KEY_INVALID`, as `auth`.

### B2. A failed "Retranslate page" wipes the translation on screen and deletes its cache entries. Proposed: **MVP blocker (M3, small)**

- **Repro:**
  1. Translate a page fully (Docusaurus /configuration, 75/75).
  2. Make the run fail: bad key (B1), or presumably a network drop.
  3. Click "Retranslate page".
  4. Fix the key and revisit the page.
- **Expected:** §2 and the sub-goal C title say failure never loses the page: what was translated stays. The per-block retranslate already keeps the old text until new text arrives (jobs.ts:834).
- **Actual:**
  - All 75 Vietnamese blocks were replaced by English text plus "Not translated" notes.
  - On the revisit with a good key, the page was translated again: 5 requests, $0.0125. Revisiting the other two Docusaurus pages cost 0 requests.
  - This matches the cache rule "a failure removes the entry" (cache.ts:6, jobs.ts:13). In a retranslate run, that deletes a good stored translation.
- **Evidence:** `dogfood-shots/badkey-fixkey.png`. The revisit cost is in the log row for #1.

### B3. Layout tables (Paul Graham essays, HN comment threads) are rendered as a grid of table cells: one row of 290 columns. Proposed: **MVP blocker (M3)**, or accept with the selection-mode workaround per plan §8

- **Repro (Paul Graham):** open paulgraham.com/greatwork.html, then press Alt+T.
- **Repro (HN):** open any HN item with comments.
- **Expected:** a readable column of paragraphs, and the panel follows the scroll.
- **Actual on the Paul Graham essay:**
  - 290 `table-cell` blocks in **1 row**, so the panel's scrollWidth is **41,463 px**. You cannot read it.
  - The scroll follow and viewport priority cannot work, because every block counts as visible. A 70% scroll had no effect for 60 s or more.
  - The screen stamp never fired.
- **Actual on the HN thread:** each comment's paragraphs become side-by-side cells across 118 rows (scrollWidth 2,287 px against 1,200). There are no author names and no nesting.
- **Evidence:** `dogfood-shots/pg-greatwork-scroll-panel.png` and `pg-greatwork-scroll-page.png`, `dogfood-shots/hn-item-final-panel.png`
- **Note:** plan §8 expected gaps like this ("add those sites as fixtures; selection mode covers the gap meanwhile"). But selecting an 11,000-word essay by hand is not a real workaround. Detecting layout tables (one row, or cells that hold whole paragraphs) would fix both sites.

### B4. Opening mid-article does not translate the on-screen paragraphs first, and the job's "screen done" stamp fires before they are done. Proposed: **raise with the user. It affects M3-D11's evidence.** MVP blocker if confirmed in real Chrome.

- **Repro:**
  1. Open a long article.
  2. Scroll to 30–40%.
  3. Press Alt+T.
  4. Watch the paragraphs that are on screen.
- **Expected:** §2 and §3 #1 say the on-screen paragraphs are translated first, in about 2 s.
- **Actual:**
  - **BBC:** stamp at 1.5 s, at 5/49 done. The 2 paragraphs on screen were still English (screenshot pair).
  - **Substack (ACX):** stamp at 2.1 s. The 3 paragraphs on screen became final at 7.6, 8.7 and 9.7 s.
  - **Wikipedia Movable type:** the first request translated the article top (blocks 3–9). The on-screen blocks (58–65) came in the second batch, at about 5–7 s.
  - **Wikipedia Printing press:** at the stamp, all 15 blocks visible in the panel were still pending.
  - **The `data-first-visible` stamp:** it records 12–22 ms on pages where cached boilerplate headings ("History", "See also") are served from the cache, even when they are off screen.
- **Why it matters:** M3-D11 accepted §3 #1 as met "on first on-screen text (~1.9–2.6 s)". On these real pages, true first on-screen text was **5–10 s** with Gemini flash-lite, and the stamps overstate how fast it is. I did not establish the root cause. The initial viewport is read synchronously (viewport.ts:52). Possible causes: the screen set does not match what is really visible after the scroll and layout shifts, or the first chunks start in page order before the priority list arrives.
- **Evidence:** `bbc-article-screen-panel.png` and `bbc-article-screen-page.png`, `wikipedia-printing-screen-panel.png` and `wikipedia-printing-screen-page.png`, `substack-vistrace-panel.png`
- **Related, works as intended:** when you *scroll* during a job, the pending chunks are reordered as designed (GitHub issue, #10).

### B5. SPA navigation leaves the previous page's translation in the panel, with no hint, and Alt+T does not re-read the page. Proposed: **later (M5, plan §4)**, with an optional small M3 mitigation

- **Repro:**
  1. On docusaurus.io/docs (also react.dev and gitbook.com/docs), translate the page.
  2. Click a sidebar link. The URL changes without a full page load.
  3. Press Alt+T again.
- **Expected (M3):** out of scope. SPA re-extraction is M5.
- **Actual:**
  - The panel keeps showing the old title and blocks for 30 s or more after the click, and nothing says the page changed.
  - A new gesture is ignored. `controller.ts` `apply('ready')` returns early for a live connection whose view is `ready`.
  - A page reload works. That relies on the worker re-injecting when the page finishes loading, which in this harness ran with patched host permissions (see section 3).
- **Evidence:** `docusaurus-spa-nav.png`, `docusaurus-spa-after-alt-t.png`, `reactdev-click-describing-panel.png`, `gitbook-click-quickstart-panel.png`
- **Suggestion:** on three of the five docs sites tested, every click means a reload. A cheap M3 step would be to let a new gesture re-read the page when the tab URL differs from the URL that was extracted, or at least to show "This page changed — press Alt+T". I would not block M3 on it.

### B6. At a real side-panel width (420 px), a wide table makes the whole panel scroll sideways and draws over the sticky header. Proposed: **later (M5 reading UX or M6 polish)**

- **Repro:** PostgreSQL numeric types page, panel 420 px wide.
- **Expected:** the table scrolls inside its own box. The header stays intact.
- **Actual:** the document scrollWidth is 774 px. The header shifts sideways: "EN →" and the title are cut off, and the table's last column is painted over the header area.
- **Evidence:** `dogfood-shots/narrow-420-postgres-table.png`. For comparison, the MDN code page at 420 px looks fine: `narrow-420-mdn.png`.

### B7. The raw `[link]` marker shows while a block streams. Proposed: **later (M6 polish)**

- **Repro:** MDN Array.map, opened at the top. The "Syntax" heading briefly showed `[link]C`. It resolved to proper text once final.
- **Evidence:** `dogfood-shots/mdn-array-map-screen-panel.png`

### B8. A selection of mixed-language text comes back partly untranslated but marked final. Proposed: **later (M7 translation quality)**, edge case

- **Repro:** select all of example.com, which is now a multilingual page, then right-click → Translate in side panel.
- **Expected:** every paragraph in Vietnamese.
- **Actual:**
  - "6 of 7 · 1 failed". The zh, fr, ru and es paragraphs are shown as final but are unchanged.
  - Arabic: "Not translated: …quality checks".
  - The first Vietnamese word is garbled: "Tenền miền" for "Tên miền".
- **Evidence:** `dogfood-shots/example-selection.png`

### B9. Stack Overflow question page: the panel said "Couldn't read this page". Proposed: **needs a repro in real Chrome.** If confirmed, add a fixture (later, M5 site rules). Selection mode is the M3 workaround.

- **Repro:** open stackoverflow.com/questions/1642028, then press Alt+T.
- **Actual:** the empty-extraction hint appeared, although the screenshot taken right after shows the full question. Every later load was a Cloudflare challenge, so I could neither tell whether the extraction ran on the challenge page nor test selection mode there.
- **Evidence:** `dogfood-shots/stackoverflow-page.png`, `stackoverflow-panel.png`, `stackoverflow-page-after-reload.png`

### B10. Translation quality nits. Proposed: **later (M7)**

- Redundant glosses, for example "Material for MkDocs (khung tài liệu) là một framework tài liệu… MkDocs (trình tạo trang tĩnh), một trình tạo trang tĩnh".
- Glosses inside code or identifier cells: `bigint (số nguyên lớn)`.
- Wrong terms: "decimal point" became "dấu phẩy động" (floating point), and "variable" became "biến đổi".
- Link text left in English on react.dev ("start a React project", "Adding Interactivity").
- **Evidence:** `narrow-420-postgres-table.png`, `reactdev-click-describing-panel.png`

### B11. Metrics stamps are misleading. Proposed: **later (eval tooling)**, folded into B4

- `data-first-visible` counts cached off-screen headings.
- `data-screen-done` never fires when nothing extracted is on screen (GitHub repo page) or on a layout-table page.

### B12. The cost readout showed "$0 · excludes cancelled requests" after cancelling a Paul Graham run with about 15 finished requests. Proposed: **later (M6), investigate**

- The readout showed no cost at all during that run, unlike every other page.
- Cancelling on the HN thread showed $0.0559 correctly, so the problem is not cancelling in general.
- I did not check whether the spend ledger counted that run.
- **Evidence:** the jobText was captured in the log. No separate screenshot.

**Proposed MVP blockers: B1, B2, B3, and B4 (raise with the user, because it reopens M3-D11's basis).** Everything else is later or known: B5 → M5; B6 and B7 → M5/M6; B8 and B10 → M7; B9 → needs a repro; B11 and B12 → tooling and M6.

## 3. What I could not test, and why

- **Real toolbar click and Alt+T, and the real side panel:** these cannot be scripted. The panel ran as a tab, and the gesture was emulated by injecting and writing the access record.
- **Real permission prompt and the activeTab lifetime:** host permissions were added to a copy of the manifest. So the re-injection after a full navigation (MkDocs and MDN clicks, reloads) worked here, but it may behave differently with activeTab only. The worker's own denylist check before injection was also bypassed by the harness. The content script's own check was verified (#20).
- **Real context-menu click:** the selection hand-off record was written directly. The denylisted-selection block (M3-D13) is the worker's code, so I did not exercise it.
- **Real Wi-Fi off:** Playwright offline mode does not cut streams already in flight. That is why 45/75 finished after going offline at 7/75. A real DNS outage happened by chance on the Guardian run and was retried successfully.
- **Rate-limit backoff indicator:** no 429 happened.
- **Copy button:** the clipboard read was refused in the background tab, so it is unverified.
- **Logged-in sites** (Gmail or Outlook inbox, banking): no accounts. Banking is M3-D14 → M4 anyway.
- **First-run privacy notice:** it was pre-acknowledged in storage.
- **Sites blocked for the automated browser:** ja and de Wikipedia ("Wikimedia Error"), Medium (connection closed), and Stack Overflow after the first load (Cloudflare).
- **The human side of §3 #8:** seven days of habit, and whether a reader actually trusts the Vietnamese. This pass judged usability from screenshots and timings only.
