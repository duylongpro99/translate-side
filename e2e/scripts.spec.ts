// Every script the panel can be asked for, with real text: each block carries the target's lang,
// Arabic and Hebrew run right to left, each script reaches its own font rule, and Japanese and
// Chinese Han characters are drawn with their own forms when the platform has both fonts.
import { expect, jobSettled, test, type Extension } from './fixtures.ts';

/** A real sentence per target, with the two Han characters whose forms differ between Japanese and Chinese. */
const SAMPLES: Record<string, string> = {
  vi: 'Người phụ trách nhận tin nhắn khi trang bị báo sai.',
  ja: 'ページが間違っていると報告されたときに連絡を受ける人。直骨',
  'zh-CN': '当页面被报告有误时收到消息的人。直骨',
  'zh-TW': '當頁面被回報有誤時收到訊息的人。直骨',
  ko: '페이지가 잘못되었다고 보고될 때 메시지를 받는 사람.',
  th: 'ผู้ที่ได้รับข้อความเมื่อมีการรายงานว่าหน้านั้นผิด',
  ar: 'الشخص الذي يتلقى الرسالة عندما يُبلَّغ عن خطأ في الصفحة.',
  // Not in the language list: a Chinese or Hebrew browser's default arrives this way, through storage.
  zh: '当页面被报告有误时收到消息的人。直骨',
  he: 'האדם שמקבל את ההודעה כאשר מדווחים שהדף שגוי.',
};

const setTarget = (extension: Extension, lang: string) =>
  extension.worker.evaluate(async (l) => {
    const prefs = (await chrome.storage.sync.get('prefs')).prefs as Record<string, unknown>;
    await chrome.storage.sync.set({ prefs: { ...prefs, targetLang: l } });
  }, lang);

type Seen = { font: string; lang: string | null; dir: string | null; regionDir: string | null; all: boolean };

test('each target script: lang and direction on every block, its own font rule, and Japanese and Chinese Han forms', async ({ extension, mock }) => {
  let lang = 'vi';
  // The sample, then the source text, so the post-checks (numbers, links) pass and every block is final.
  mock.answerWith((text) => `${SAMPLES[lang] ?? ''} ${text}`);
  await extension.seed();
  const page = await extension.open('store/article.html');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');

  const seen: Record<string, Seen> = {};
  for (const next of Object.keys(SAMPLES)) {
    lang = next;
    await setTarget(extension, next);
    const first = panel.locator('.segments .seg[data-kind=p][data-status=final]').first();
    await expect(first).toHaveAttribute('lang', next);
    expect(await jobSettled(panel)).toBe('done');
    seen[next] = await first.evaluate((el, l) => {
      const translated = [...document.querySelectorAll<HTMLElement>('.segments .seg[data-status=final]')];
      return {
        font: getComputedStyle(el).fontFamily,
        lang: el.getAttribute('lang'),
        dir: el.getAttribute('dir'),
        regionDir: el.closest('.segments')?.getAttribute('dir') ?? null,
        all: translated.length > 0 && translated.every((b) => b.getAttribute('lang') === l),
      };
    }, next);
  }

  for (const [l, s] of Object.entries(seen)) expect(s.all, `every translated block carries lang=${l}`).toBe(true);
  for (const rtl of ['ar', 'he']) expect([seen[rtl]?.dir, seen[rtl]?.regionDir], rtl).toEqual(['rtl', 'rtl']);
  for (const ltr of ['vi', 'ja', 'zh-CN', 'ko', 'th']) expect(seen[ltr]?.regionDir || null, ltr).toBeNull();
  // The cascade: each script reaches its own rule (this proves the rules, not the drawn font).
  expect(new Set([seen.ja?.font, seen['zh-CN']?.font, seen['zh-TW']?.font, seen.ko?.font]).size).toBe(4);
  expect(seen.zh?.font, 'bare zh is Simplified').toBe(seen['zh-CN']?.font);
  expect(seen.ar?.font).not.toBe(seen.vi?.font);
  expect(seen.he?.font).not.toBe(seen.vi?.font);

  // The drawn glyphs: 直 and 骨 in the Japanese stack against the Simplified Chinese one, as the panel resolves them.
  const ink = await panel.evaluate(
    ({ ja, zh }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      const draw = (family: string) => {
        ctx.clearRect(0, 0, 160, 90);
        ctx.font = `64px ${family}`;
        ctx.fillText('直骨', 4, 70);
        return ctx.getImageData(0, 0, 160, 90).data.join(',');
      };
      // A generic fallback for comparison: if both stacks draw what the fallback draws, neither platform font exists.
      const fallback = draw('sans-serif');
      const j = draw(ja);
      const z = draw(zh);
      return { differ: j !== z, jaIsFallback: j === fallback, zhIsFallback: z === fallback };
    },
    { ja: seen.ja?.font ?? '', zh: seen['zh-CN']?.font ?? '' },
  );
  test.info().annotations.push({ type: 'glyphs', description: JSON.stringify(ink) });
  console.log(`drawn glyphs 直骨: ${JSON.stringify(ink)}`);
  if (ink.jaIsFallback && ink.zhIsFallback) {
    test.info().annotations.push({ type: 'skip', description: 'no Japanese or Simplified Chinese platform font here: the drawn-glyph check is left to the screenshots' });
    return;
  }
  expect(ink.differ, '直骨 drawn the same in the Japanese and the Simplified Chinese stacks').toBe(true);
});
