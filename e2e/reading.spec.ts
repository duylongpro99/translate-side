// The reading view: the vertical rhythm between blocks (measured on the text, not on the blocks' boxes,
// which hold notes, badges and the action toolbar), reading settings that start no job and never move
// the page, the per-script fonts and direction, and the keyboard focus below the sticky header.
import type { Page } from '@playwright/test';
import { expect, jobSettled, test, type Extension } from './fixtures.ts';
import { VI } from './store-article.ts';

type Gap = { pair: string; gap: number };

/**
 * The gap between each block's text and the next one's, by kind pair (p→p, li→li, heading→p,
 * p→heading). A Range around a block's own text gives each line's content area; half the leading
 * is added above the first line and below the last, so a gap is the space between line boxes, the
 * space the stylesheet's margins set. Notes, badges, labels and the toolbar are left out.
 */
export async function textGaps(panel: Page): Promise<{ size: number; gaps: Gap[] }> {
  return panel.evaluate(() => {
    const SKIP = '.seg__actions, .seg__note, .seg__badge, .seg__refined, .seg__original, .seg__draft, .seg__explain, .seg__label, .sr-only, .seg__editor, .seg__confirm';
    const blocks = [...document.querySelectorAll<HTMLElement>('.segments .seg[data-id]')];
    // Neighbours only: a pair with a code block or a table cell is left out, not bridged.
    const measured = (b: HTMLElement) => !b.closest('.seg-table') && b.dataset.kind !== 'code';
    const box = (block: HTMLElement) => {
      const rects: DOMRect[] = [];
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.textContent?.trim()) return;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...[...range.getClientRects()].filter((r) => r.height > 0));
        } else if (node instanceof HTMLElement && !node.matches(SKIP)) node.childNodes.forEach(walk);
      };
      block.childNodes.forEach(walk);
      if (rects.length === 0) return undefined;
      const lh = parseFloat(getComputedStyle(block).lineHeight);
      const first = rects.reduce((a, r) => (r.top < a.top ? r : a));
      const last = rects.reduce((a, r) => (r.bottom > a.bottom ? r : a));
      const half = (r: DOMRect) => (Number.isFinite(lh) ? Math.max(0, (lh - r.height) / 2) : 0);
      return { top: first.top - half(first), bottom: last.bottom + half(last) };
    };
    const name = (b: HTMLElement) => (b.dataset.kind === 'heading' ? 'heading' : (b.dataset.kind ?? '?'));
    const gaps: { pair: string; gap: number }[] = [];
    for (let i = 1; i < blocks.length; i++) {
      if (!measured(blocks[i - 1] as HTMLElement) || !measured(blocks[i] as HTMLElement)) continue;
      const a = box(blocks[i - 1] as HTMLElement);
      const b = box(blocks[i] as HTMLElement);
      if (a && b) gaps.push({ pair: `${name(blocks[i - 1] as HTMLElement)}→${name(blocks[i] as HTMLElement)}`, gap: Math.round((b.top - a.bottom) * 10) / 10 });
    }
    const size = parseFloat(getComputedStyle(document.querySelector('.segments') ?? document.body).fontSize);
    return { size, gaps };
  });
}

/** The largest gap per kind pair. */
const largest = (gaps: Gap[]) => gaps.reduce<Record<string, number>>((m, g) => ({ ...m, [g.pair]: Math.max(m[g.pair] ?? -Infinity, g.gap) }), {});

/** Sets the reading settings the way the Aa popover does: one write to the `reading` sync item. */
const setReading = (extension: Extension, reading: Record<string, unknown>) => extension.worker.evaluate((r) => chrome.storage.sync.set({ reading: r }), reading);

/** Sets the target language in the preferences (the page is translated again into it). */
const setTarget = (extension: Extension, lang: string) =>
  extension.worker.evaluate(async (l) => {
    const prefs = (await chrome.storage.sync.get('prefs')).prefs as Record<string, unknown>;
    await chrome.storage.sync.set({ prefs: { ...prefs, targetLang: l } });
  }, lang);

test('the gaps between blocks on the store article stay on the spacing scale', async ({ extension, mock }) => {
  mock.answerWith((text) => VI[text] ?? `vi:${text}`);
  await extension.seed();
  const page = await extension.open('store/article.html');
  const panel = await extension.panel();
  await panel.setViewportSize({ width: 420, height: 800 });
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  for (const size of [16, 20]) {
    await setReading(extension, { size });
    await expect(panel.locator('.segments')).toHaveCSS('font-size', `${size}px`);
    const { gaps } = await textGaps(panel);
    console.log(`reading size ${size}px; largest gap per pair: ${JSON.stringify(largest(gaps))}`);
    expect(gaps.length).toBeGreaterThan(5);
    for (const { pair, gap } of gaps) {
      const [, to] = pair.split('→');
      const limit = to === 'heading' ? 1.5 * size + 2 : pair === 'li→li' ? 0.25 * size + 2 : 0.9 * size + 2;
      expect(gap, `${pair} at ${size}px`).toBeLessThanOrEqual(limit);
    }
  }
});

test('a reading settings change applies at once, sends nothing and leaves the page where it is', async ({ extension, mock }) => {
  await extension.seed();
  const page = await extension.open('long/long-100-screens.html');
  const panel = await extension.panel();
  await panel.setViewportSize({ width: 420, height: 700 });
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  // Follow is on by default, both ways: the panel is scrolled to the middle and the page follows it.
  // (In this harness a script scroll of the page itself is pulled back by the background panel tab.)
  await panel.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight / 2, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await panel.waitForTimeout(800);
  const topBlock = () =>
    panel.evaluate(() => {
      const covered = Math.max(...[...document.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));
      return [...document.querySelectorAll<HTMLElement>('.segments [data-id]')].find((b) => b.getBoundingClientRect().bottom > covered + 0.5)?.dataset.id;
    });
  const pageY = await page.evaluate(() => window.scrollY);
  const block = await topBlock();
  const calls = mock.calls.length;

  await setReading(extension, { size: 21, width: 'narrow', typeface: 'serif' });
  await expect(panel.locator('.segments')).toHaveCSS('font-size', '21px');
  await panel.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
  expect(await topBlock()).toBe(block);
  expect(mock.calls.length).toBe(calls);

  await setReading(extension, { size: 14, width: 'full', typeface: 'sans' });
  await expect(panel.locator('.segments')).toHaveCSS('font-size', '14px');
  await panel.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
  expect(await topBlock()).toBe(block);
  expect(mock.calls.length).toBe(calls);
});

/** A real sentence per script, so each block is drawn in that script's fonts. */
const SAMPLES: Record<string, string> = {
  vi: 'Người phụ trách nhận tin nhắn khi trang bị báo sai.',
  ja: 'ページが間違っていると報告されたときに連絡を受ける人。直骨',
  'zh-CN': '当页面被报告有误时收到消息的人。直骨',
  'zh-TW': '當頁面被回報有誤時收到訊息的人。直骨',
  zh: '当页面被报告有误时收到消息的人。直骨',
  ko: '페이지가 잘못되었다고 보고될 때 메시지를 받는 사람.',
  th: 'ผู้ที่ได้รับข้อความเมื่อมีการรายงานว่าหน้านั้นผิด',
  ar: 'الشخص الذي يتلقى الرسالة عندما يُبلَّغ عن خطأ في الصفحة.',
  he: 'האדם שמקבל את ההודעה כאשר מדווחים שהדף שגוי.',
};

test('each script reaches its own font rule, and Arabic and Hebrew run right to left', async ({ extension, mock }) => {
  let lang = 'vi';
  // The sample, then the source text, so the post-checks (numbers, links) still pass.
  mock.answerWith((text) => `${SAMPLES[lang] ?? ''} ${text}`);
  await extension.seed();
  const page = await extension.open('store/article.html');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  const seen: Record<string, { font: string; lang: string | null; dir: string | null; regionDir: string | null }> = {};
  for (const next of Object.keys(SAMPLES)) {
    lang = next;
    await setTarget(extension, next);
    const first = panel.locator('.segments .seg[data-kind=p][data-status=final]').first();
    await expect(first).toHaveAttribute('lang', next);
    await expect(first).toContainText(SAMPLES[next]?.slice(0, 6) ?? '');
    expect(await jobSettled(panel)).toBe('done');
    seen[next] = await first.evaluate((el) => ({ font: getComputedStyle(el).fontFamily, lang: el.getAttribute('lang'), dir: el.getAttribute('dir'), regionDir: el.closest('.segments')?.getAttribute('dir') ?? null }));
  }
  console.log(JSON.stringify(seen, null, 1));
  // Han characters take Japanese, Simplified or Traditional forms only through their own stacks.
  expect(new Set([seen.ja?.font, seen['zh-CN']?.font, seen['zh-TW']?.font, seen.ko?.font]).size).toBe(4);
  expect(seen.zh?.font).toBe(seen['zh-CN']?.font);
  expect(seen.ar?.font).not.toBe(seen.vi?.font);
  expect(seen.he?.font).not.toBe(seen.vi?.font);
  expect(seen.th?.font).not.toBe(seen.vi?.font);
  for (const rtl of ['ar', 'he']) expect([seen[rtl]?.dir, seen[rtl]?.regionDir], rtl).toEqual(['rtl', 'rtl']);
  expect(seen.vi?.dir || null).toBeNull();
});

for (const { target, ui } of [
  { target: 'vi', ui: 'en' },
  { target: 'ar', ui: 'vi' },
]) {
  test.describe(`${target} text, ${ui} interface`, () => {
    test.use({ uiLang: ui });
    test('J and K keep the focused block below the header, and its toolbar covers no text, also after Original', async ({ extension, mock }) => {
      mock.answerWith((text) => (target === 'ar' ? `${SAMPLES.ar} ${text}` : (VI[text] ?? `vi:${text}`)));
      await extension.seed();
      if (target !== 'vi') await setTarget(extension, target);
      const page = await extension.open('store/article.html');
      const panel = await extension.panel();
      await panel.setViewportSize({ width: 360, height: 500 });
      await extension.translate(page);
      expect(await jobSettled(panel)).toBe('done');
      const measure = () =>
        panel.evaluate(() => {
          const block = document.activeElement as HTMLElement;
          const covered = Math.max(...[...document.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));
          const lines: DOMRect[] = [];
          const walk = (n: Node) => {
            if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
              const range = document.createRange();
              range.selectNodeContents(n);
              lines.push(...range.getClientRects());
            } else if (n instanceof HTMLElement && !n.matches('.seg__actions')) n.childNodes.forEach(walk);
          };
          block.childNodes.forEach(walk);
          const bar = block.querySelector('.seg__actions');
          const box = bar?.getBoundingClientRect();
          const shown = bar !== null && getComputedStyle(bar).opacity === '1' && (box?.width ?? 0) > 0;
          const overlaps = box && shown ? lines.some((r) => r.left < box.right - 0.5 && r.right > box.left + 0.5 && r.top < box.bottom - 0.5 && r.bottom > box.top + 0.5) : false;
          return { id: block.dataset.id, status: block.dataset.status, kind: block.dataset.kind, top: block.getBoundingClientRect().top, covered, overlaps, shown, hasBar: bar !== null };
        });
      await panel.locator('.segments .seg[data-id]').first().focus();
      for (let i = 0; i < 8; i++) {
        await panel.keyboard.press('j');
        let m = await measure();
        expect(m.top, `block ${m.id}`).toBeGreaterThanOrEqual(m.covered - 1);
        // A finished block shows its toolbar while it has the focus.
        if (m.hasBar) expect(m.shown, `toolbar of block ${m.id}`).toBe(true);
        expect(m.overlaps, `toolbar over the text of block ${m.id}`).toBe(false);
        if (m.status === 'final' && m.kind !== 'code') {
          // Original: the label turns into "Hide original", the widest one, and still covers nothing.
          await panel.keyboard.press('o');
          m = await measure();
          expect(m.overlaps, `toolbar over the text of block ${m.id} with its original shown`).toBe(false);
          await panel.keyboard.press('o');
        }
      }
    });
  });
}
