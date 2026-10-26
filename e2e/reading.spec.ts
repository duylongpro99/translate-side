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

/**
 * Moves the panel tab into a window of its own, where it draws frames: a background tab draws none
 * (fixtures.ts), so a hover never lands and a block's toolbar, anchored to it, keeps its place from
 * before a scroll. The page stays the active tab of the first window, so the panel keeps following it.
 */
const ownWindow = async (extension: Extension, panel: Page, size: { width: number; height: number }) => {
  await extension.worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error(`no tab for ${url}`);
    await chrome.windows.create({ tabId: tab.id, focused: true });
  }, panel.url());
  await panel.setViewportSize(size);
};

/** Waits for the panel's next frame, where anchored toolbars take their place. */
const frame = (panel: Page) => panel.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

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
      await extension.translate(page);
      expect(await jobSettled(panel)).toBe('done');
      await ownWindow(extension, panel, { width: 360, height: 500 });
      const measure = async () => {
        await frame(panel);
        return panel.evaluate(() => {
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
      };
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

for (const target of ['vi', 'ar']) {
  test(`${target}: a block's toolbar floats over the text: hover and focus move no line, and the first block's toolbar clears the header`, async ({ extension, mock }) => {
    mock.answerWith((text) => (target === 'ar' ? `${SAMPLES.ar} ${text}` : (VI[text] ?? `vi:${text}`)));
    await extension.seed();
    if (target !== 'vi') await setTarget(extension, target);
    const page = await extension.open('store/article.html');
    const panel = await extension.panel();
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    await ownWindow(extension, panel, { width: 320, height: 600 });
    expect(await jobSettled(panel)).toBe('done');
    /** Every text line of every block, toolbars left out. */
    const lines = () =>
      panel.evaluate(() => {
        const out: number[][] = [];
        const walk = (n: Node) => {
          if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const r of range.getClientRects()) out.push([r.left, r.top, r.right, r.bottom]);
          } else if (n instanceof HTMLElement && !n.matches('.seg__actions')) n.childNodes.forEach(walk);
        };
        walk(document.querySelector('.segments') as Node);
        return out;
      });
    /** The block's toolbar box and its own top, when the toolbar shows. */
    const toolbar = async (id: string) => {
      await frame(panel);
      return panel.evaluate((id) => {
        const block = document.querySelector<HTMLElement>(`.seg[data-id="${id}"]`) as HTMLElement;
        const bar = block.querySelector(':scope > .seg__actions') as HTMLElement;
        const box = bar.getBoundingClientRect();
        // What the sticky header and the job bar under it cover (blocks-nav.ts coveredBy).
        const header = Math.max(...[...document.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));
        return { shown: getComputedStyle(bar).opacity === '1', top: box.top, bottom: box.bottom, blockTop: block.getBoundingClientRect().top, header };
      }, id);
    };
    const kinds = ['heading', 'p', 'li', 'code'];
    const ids = await panel.evaluate(
      // Not the first block if there is another: the first starts right under the header, with no room above it.
      (kinds) =>
        kinds.map((k) => {
          const blocks = [...document.querySelectorAll<HTMLElement>(`.segments .seg[data-kind="${k}"]:has(> .seg__actions)`)];
          return (blocks.find((b) => b.previousElementSibling) ?? blocks[0])?.dataset.id ?? '';
        }),
      kinds,
    );
    for (const [i, id] of ids.entries()) {
      expect(id, `a ${kinds[i]} block with a toolbar`).not.toBe('');
      const block = panel.locator(`.seg[data-id="${id}"]`);
      await block.evaluate((b) => b.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await panel.mouse.move(0, 599);
      const before = await lines();
      await block.hover({ position: { x: 20, y: 6 } });
      const hovered = await toolbar(id);
      expect(hovered.shown, `${kinds[i]} toolbar on hover`).toBe(true);
      // Anchored to its own block (not the last one on the page), touching its top edge when there is room above it.
      if (hovered.blockTop > hovered.header + 32) expect(Math.abs(hovered.bottom - hovered.blockTop), `${kinds[i]} toolbar sits on its block`).toBeLessThan(1);
      else expect(hovered.top, `${kinds[i]} toolbar below the header`).toBeGreaterThanOrEqual(hovered.header);
      expect(await lines(), `lines while the ${kinds[i]} is hovered`).toEqual(before);
      await panel.mouse.move(0, 599);
      await block.focus();
      expect((await toolbar(id)).shown, `${kinds[i]} toolbar on focus`).toBe(true);
      expect(await lines(), `lines while the ${kinds[i]} has the focus`).toEqual(before);
      await block.blur();
    }

    // The first block under the sticky header: its toolbar stays below the header and its buttons take the click.
    const id = ids[1] as string;
    await panel.evaluate((id) => {
      const block = document.querySelector(`.seg[data-id="${id}"]`) as HTMLElement;
      const header = Math.max(...[...document.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));
      window.scrollBy({ top: block.getBoundingClientRect().top - header - 1, behavior: 'instant' });
    }, id);
    const block = panel.locator(`.seg[data-id="${id}"]`);
    await block.hover({ position: { x: 20, y: 30 } });
    const under = await toolbar(id);
    expect(under.shown).toBe(true);
    expect(under.top).toBeGreaterThanOrEqual(under.header);
    const original = block.getByTestId('seg-original');
    await original.click();
    await expect(original).toHaveAttribute('aria-pressed', 'true');

    // A focused block stays focused through a jump of the scroll (scroll follow, the scrollbar): its toolbar
    // must not stay on screen over other blocks once the block itself is out of sight.
    const loose = (id: string) =>
      panel.evaluate((id) => {
        const block = document.querySelector(`.seg[data-id="${id}"]`) as HTMLElement;
        const bar = block.querySelector(':scope > .seg__actions') as HTMLElement;
        const covered = Math.max(...[...document.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));
        const b = block.getBoundingClientRect();
        const t = bar.getBoundingClientRect();
        const blockSeen = b.bottom > covered && b.top < innerHeight;
        const barSeen = getComputedStyle(bar).opacity === '1' && t.bottom > covered && t.top < innerHeight;
        return barSeen && !blockSeen;
      }, id);
    // A block in the middle, so a jump to either end leaves it out of sight.
    const middle = panel.locator('.segments .seg[data-kind=p]:has(> .seg__actions)').nth(3);
    const middleId = (await middle.getAttribute('data-id')) as string;
    await panel.mouse.move(0, 599);
    await middle.evaluate((b) => b.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await middle.focus();
    await middle.press('Shift');
    await frame(panel);
    for (const top of [1e6, 0, 1e6]) {
      await panel.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), top);
      await frame(panel);
      expect(await loose(middleId), `toolbar of a focused block after a jump to ${top}`).toBe(false);
    }
  });
}
