import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { chromeLanguageDetector, DETECTOR_MIN_CONFIDENCE, detectionSample, detectSourceLanguage, normalizeLang, sameLanguage, SAMPLE_CHARS, segmentsInLanguage, type LanguageDetectorPort } from './language';

const seg = (id: string, text: string, over: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `/p[${id}]`, translate: true, ...over });

/** A detector that answers `answer(text)`, recording what it was asked. */
function fakeDetector(answer: (text: string) => { detectedLanguage: string; confidence: number }[] | Promise<never>) {
  const asked: string[] = [];
  const port: LanguageDetectorPort = {
    detect: async (text) => {
      asked.push(text);
      return answer(text);
    },
  };
  return Object.assign(port, { asked });
}
const says = (lang: string, confidence = 0.95) => fakeDetector(() => [{ detectedLanguage: lang, confidence }, { detectedLanguage: 'und', confidence: 0.01 }]);

describe('detectSourceLanguage: override → LanguageDetector → <html lang> → unknown', () => {
  const sample = 'Das ist ein Satz auf Deutsch.';

  it('the override wins and the detector is not asked', async () => {
    const d = says('de');
    expect(await detectSourceLanguage({ override: 'fr', sample, pageLang: 'en' }, d)).toEqual({ lang: 'fr', via: 'override' });
    expect(d.asked).toEqual([]);
  });

  it('the detector beats the page lang (pages often say lang="en" whatever they hold)', async () => {
    expect(await detectSourceLanguage({ sample, pageLang: 'en' }, says('de', 0.9))).toEqual({ lang: 'de', via: 'detector', confidence: 0.9 });
  });

  it('falls back to <html lang> when the detector is missing, unsure, says und, throws, or is too slow', async () => {
    const page = { sample, pageLang: 'en-us' };
    const html = { lang: 'en-US', via: 'html-lang' };
    expect(await detectSourceLanguage(page, undefined)).toEqual(html);
    expect(await detectSourceLanguage(page, says('de', DETECTOR_MIN_CONFIDENCE - 0.01))).toEqual(html);
    expect(await detectSourceLanguage(page, says('und'))).toEqual(html);
    expect(await detectSourceLanguage(page, fakeDetector(() => Promise.reject(new Error('NotAllowedError'))))).toEqual(html);
    expect(await detectSourceLanguage(page, fakeDetector(() => []))).toEqual(html);
    const slow: LanguageDetectorPort = { detect: () => new Promise(() => {}) };
    expect(await detectSourceLanguage(page, slow, 20)).toEqual(html);
  });

  it('is unknown ("") when nothing answers: the brief decides (engine side)', async () => {
    expect(await detectSourceLanguage({ sample, pageLang: undefined }, undefined)).toEqual({ lang: '', via: 'unknown' });
    expect(await detectSourceLanguage({ sample: '', pageLang: 'und' }, says('de'))).toEqual({ lang: '', via: 'unknown' });
    expect(await detectSourceLanguage({ override: 'auto?', sample: '', pageLang: '' }, undefined)).toEqual({ lang: '', via: 'unknown' });
  });
});

describe('sameLanguage (skip-if-same-language)', () => {
  it('compares the primary language', () => {
    expect(sameLanguage('vi', 'vi')).toBe(true);
    expect(sameLanguage('en-US', 'en')).toBe(true);
    expect(sameLanguage('pt', 'pt-BR')).toBe(true);
    expect(sameLanguage('EN_gb', 'en')).toBe(true);
    expect(sameLanguage('en', 'vi')).toBe(false);
  });

  it('never matches an unknown language', () => {
    expect(sameLanguage('', 'en')).toBe(false);
    expect(sameLanguage('und', 'en')).toBe(false);
    expect(sameLanguage('en', '')).toBe(false);
  });

  it('for Chinese, also needs the same known script', () => {
    expect(sameLanguage('zh-CN', 'zh-CN')).toBe(true);
    expect(sameLanguage('zh-Hans', 'zh-CN')).toBe(true);
    expect(sameLanguage('zh-HK', 'zh-TW')).toBe(true);
    expect(sameLanguage('zh-CN', 'zh-TW')).toBe(false);
    expect(sameLanguage('zh', 'zh-TW')).toBe(false);
    expect(sameLanguage('zh', 'zh-CN')).toBe(false);
  });

  it('normalizes tags', () => {
    expect(normalizeLang(' en_us ')).toBe('en-US');
    expect(normalizeLang('und')).toBe('');
    expect(normalizeLang('English')).toBe('');
    expect(normalizeLang(undefined)).toBe('');
  });
});

describe('detection sample and per-segment detection (flag)', () => {
  it('samples translatable, non-code text up to SAMPLE_CHARS', () => {
    const segs = [seg('a', 'Hello there.'), seg('c', 'let x = 1;', { kind: 'code', translate: false }), seg('n', '42', { translate: false }), seg('b', 'x'.repeat(5000))];
    const s = detectionSample(segs);
    expect(s.startsWith('Hello there.\nxxx')).toBe(true);
    expect(s).toHaveLength(SAMPLE_CHARS);
    expect(s).not.toContain('let x');
  });

  it('marks segments confidently in the target language; short ones and failures are translated', async () => {
    const d = fakeDetector((text) => [{ detectedLanguage: text.startsWith('Đây') ? 'vi' : text.startsWith('Ein') ? 'de' : 'en', confidence: text.includes('?') ? 0.3 : 0.9 }]);
    const segs = [
      seg('vi', 'Đây là một câu tiếng Việt khá dài.'),
      seg('en', 'This is a fairly long English sentence.'),
      seg('unsure', 'Đây là một câu tiếng Việt? Không chắc.'),
      seg('short', 'Đây là'),
      seg('code', 'Đây là một đoạn mã rất dài nữa đó', { kind: 'code', translate: false }),
    ];
    expect([...(await segmentsInLanguage(segs, 'vi', d))]).toEqual(['vi']);
    expect(d.asked).toHaveLength(3);
    expect([...(await segmentsInLanguage(segs, 'vi', undefined))]).toEqual([]);
  });
});

describe('chromeLanguageDetector (the port over Chrome 138+ LanguageDetector)', () => {
  it('is undefined without the API', () => {
    expect(chromeLanguageDetector({})).toBeUndefined();
  });

  it('creates the detector once and passes the answer through', async () => {
    let created = 0;
    const scope = {
      LanguageDetector: {
        availability: async () => 'available' as const,
        create: async () => {
          created++;
          return { detect: async (text: string) => [{ detectedLanguage: text === 'Hallo' ? 'de' : 'en', confidence: 0.9 }] };
        },
      },
    };
    const port = chromeLanguageDetector(scope);
    expect(await port?.detect('Hallo')).toEqual([{ detectedLanguage: 'de', confidence: 0.9 }]);
    expect(await port?.detect('Hello')).toEqual([{ detectedLanguage: 'en', confidence: 0.9 }]);
    expect(created).toBe(1);
  });

  it('answers nothing when the model is unavailable, and retries a create that failed', async () => {
    const unavailable = chromeLanguageDetector({ LanguageDetector: { availability: async () => 'unavailable', create: async () => ({ detect: async () => [] }) } });
    expect(await unavailable?.detect('x')).toEqual([]);
    let attempts = 0;
    const needsGesture = chromeLanguageDetector({
      LanguageDetector: {
        availability: async () => 'downloadable',
        create: async () => {
          if (++attempts === 1) throw new DOMException('needs a user gesture', 'NotAllowedError');
          return { detect: async () => [{ detectedLanguage: 'fr', confidence: 0.8 }] };
        },
      },
    });
    expect(await needsGesture?.detect('x')).toEqual([]);
    expect(await needsGesture?.detect('x')).toEqual([{ detectedLanguage: 'fr', confidence: 0.8 }]);
  });
});
