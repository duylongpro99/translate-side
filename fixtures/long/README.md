# Long fixtures (plan M5-E4/E5; handoff to M6)

Synthetic filler made by `node scripts/make-long-fixtures.mjs` (deterministic, MIT, no third-party text).

| File | What | Numbers |
|---|---|---|
| `long-100-screens.html` | 45 chapters: headings, paragraphs, lists, quotes, figures with captions and alt text, code | 767 segments (45 of them alt text, 45 code), 75,721 px tall at 1000 px wide = ~95 screens of 800 px |
| `large-table.html` | one data table, caption, header row | 120 rows + header, 5 cells each; every row lands in one chunk (`tests/fixtures/long.test.ts`) |

Lazy mode's threshold (`LAZY_SEGMENTS` in `src/entrypoints/sidepanel/jobs.ts`) is 400 translatable segments: the
fixtures of `fixtures/sites` run 40–340 segments and stay whole; `long-100-screens` (722 translatable, alt text off) is lazy.
