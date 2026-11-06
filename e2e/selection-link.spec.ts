// The selection link (DESIGN.md §3): text selected on the page lights up the matching sentences of
// its translation in the panel, by sentence number when both sides have as many, by place when the
// translation joined sentences, and the highlight goes with the selection.
import type { Page } from '@playwright/test';
import { expect, jobSettled, test } from './fixtures.ts';

/** Selects, in the first paragraph of the page with at least three sentences, its sentence `n` (0-based); returns the paragraph's index and that sentence. */
function selectSentence(page: Page, n: number): Promise<{ index: number; sentence: string }> {
  return page.evaluate((n) => {
    const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
    const paragraphs = [...document.querySelectorAll('p')];
    const index = paragraphs.findIndex((p) => p.childNodes.length === 1 && p.firstChild?.nodeType === Node.TEXT_NODE && [...seg.segment(p.textContent ?? '')].length >= 3);
    const p = paragraphs[index] as HTMLParagraphElement;
    const parts = [...seg.segment(p.textContent ?? '')];
    const part = parts[n] as { segment: string; index: number };
    const sentence = part.segment.trim();
    const range = document.createRange();
    // A few letters inside the sentence, not the whole of it.
    range.setStart(p.firstChild as Text, part.index + 2);
    range.setEnd(p.firstChild as Text, part.index + 8);
    const sel = getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    return { index, sentence };
  }, n);
}

/** What the panel's sentence highlight covers, as text. */
const highlighted = (panel: Page) =>
  panel.evaluate(() => {
    const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('translate-side-sentence');
    return h ? [...h].map((r) => r.toString()) : [];
  });

test('a selection on the page lights up the matching sentence of the translation, and goes with it', async ({ extension, mock }) => {
  await extension.seed();
  const page = await extension.open('long/long-100-screens.html');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');

  // The mock answers `vi:` + the text: as many sentences, paired by number.
  const { sentence } = await selectSentence(page, 1);
  await expect.poll(() => highlighted(panel)).toEqual([sentence]);
  const second = await selectSentence(page, 2);
  await expect.poll(() => highlighted(panel)).toEqual([second.sentence]);

  await page.evaluate(() => getSelection()?.removeAllRanges());
  await expect.poll(() => highlighted(panel)).toEqual([]);
  // Nothing was sent for it.
  const calls = mock.calls.length;
  await selectSentence(page, 1);
  await expect.poll(() => highlighted(panel)).toHaveLength(1);
  expect(mock.calls.length).toBe(calls);
});

test('a translation that joined two sentences lights up the joined one', async ({ extension, mock }) => {
  // The translation joins the first two sentences of every block into one.
  mock.answerWith((text) => {
    const parts = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map((s) => s.segment.trim());
    if (parts.length < 3) return `vi:${text}`;
    return [`vi:${(parts[0] as string).replace(/[.!?]$/, '')} and ${parts[1] as string}`, ...parts.slice(2)].join(' ');
  });
  await extension.seed();
  const page = await extension.open('long/long-100-screens.html');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');

  await selectSentence(page, 1);
  await expect.poll(async () => (await highlighted(panel)).length).toBe(1);
  const [joined] = await highlighted(panel);
  expect(joined).toMatch(/^vi:.* and /);
});
