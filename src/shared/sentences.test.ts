import { describe, expect, it } from 'vitest';
import { matchSentences, sentenceSpans, touchedSentences } from './sentences.ts';

const texts = (text: string, spans: { start: number; end: number }[]) => spans.map((s) => text.slice(s.start, s.end));

describe('sentenceSpans', () => {
  it('cuts a text into its sentences, without the space between them', () => {
    const text = 'The cat sat. It was very tired!  Then it slept?';
    expect(texts(text, sentenceSpans(text, 'en'))).toEqual(['The cat sat.', 'It was very tired!', 'Then it slept?']);
  });

  it('cuts Vietnamese and Japanese too', () => {
    const vi = 'Con mèo ngồi. Nó rất mệt. Rồi nó ngủ.';
    expect(sentenceSpans(vi, 'vi')).toHaveLength(3);
    const ja = '猫が座った。とても疲れていた。それから眠った。';
    expect(texts(ja, sentenceSpans(ja, 'ja'))).toEqual(['猫が座った。', 'とても疲れていた。', 'それから眠った。']);
  });

  it('is one sentence for a text without a breaker, none for blank text, and takes an unknown tag', () => {
    expect(sentenceSpans('A heading', 'en')).toEqual([{ start: 0, end: 9 }]);
    expect(sentenceSpans('   ', 'en')).toEqual([]);
    expect(sentenceSpans('One. Two.', 'not a tag!')).toHaveLength(2);
  });
});

describe('touchedSentences', () => {
  const text = 'The cat sat. It was very tired. Then it slept.';

  it('names the sentences a range reaches into and where they run', () => {
    // "very tired" inside the second sentence.
    const start = text.indexOf('very');
    expect(touchedSentences(text, start, start + 10, 'en')).toEqual({ first: 1, last: 1, count: 3, from: 0.283, to: 0.674 });
  });

  it('spans sentences when the range does', () => {
    expect(touchedSentences(text, text.indexOf('sat'), text.indexOf('Then') + 2, 'en')).toMatchObject({ first: 0, last: 2, count: 3, from: 0, to: 1 });
  });

  it('is undefined for a range only over the space between sentences', () => {
    const gap = text.indexOf(' It');
    expect(touchedSentences(text, gap, gap + 1, 'en')).toBeUndefined();
    expect(touchedSentences('', 0, 0)).toBeUndefined();
  });
});

describe('matchSentences', () => {
  it('pairs sentences by number when both sides have as many', () => {
    const source = 'The cat sat. It was very tired. Then it slept.';
    const target = 'Con mèo ngồi. Nó rất mệt. Rồi nó ngủ.';
    const touched = touchedSentences(source, source.indexOf('very'), source.indexOf('tired') + 5, 'en');
    if (!touched) throw new Error('nothing touched');
    expect(texts(target, matchSentences(target, touched, 'vi'))).toEqual(['Nó rất mệt.']);
  });

  it('pairs a range of sentences by number', () => {
    const target = 'A. B. C. D.';
    expect(texts(target, matchSentences(target, { first: 1, last: 2, count: 4, from: 0.3, to: 0.7 }))).toEqual(['B.', 'C.']);
  });

  it('pairs by place when the translation joined two sentences', () => {
    // Original: "A one. B two. C three." (3), translation joined A and B (2).
    const target = 'A one and B two. C three.';
    expect(texts(target, matchSentences(target, { first: 1, last: 1, count: 3, from: 0.318, to: 0.591 }))).toEqual(['A one and B two.']);
    expect(texts(target, matchSentences(target, { first: 2, last: 2, count: 3, from: 0.636, to: 1 }))).toEqual(['C three.']);
  });

  it('pairs by place when the translation split a sentence', () => {
    // Original: "Long first sentence here, with more. Short." (2), translation split the first (3).
    const target = 'Long first. Sentence here with more. Short.';
    expect(texts(target, matchSentences(target, { first: 0, last: 0, count: 2, from: 0, to: 0.86 }))).toEqual(['Long first.', 'Sentence here with more.']);
    expect(texts(target, matchSentences(target, { first: 1, last: 1, count: 2, from: 0.88, to: 1 }))).toEqual(['Short.']);
  });

  it('always pairs at least the sentence at the middle of the share', () => {
    const target = 'A very long sentence that takes most of the block. B.';
    const got = matchSentences(target, { first: 3, last: 3, count: 5, from: 0.6, to: 0.7 });
    expect(texts(target, got)).toEqual(['A very long sentence that takes most of the block.']);
  });

  it('pairs nothing in a blank translation', () => {
    expect(matchSentences('  ', { first: 0, last: 0, count: 1, from: 0, to: 1 })).toEqual([]);
  });
});
