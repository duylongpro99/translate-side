import { describe, expect, it } from 'vitest';
import { markerKinds, parseMarkup } from './markup.ts';

describe('parseMarkup', () => {
  it('parses links, code and emphasis, nested', () => {
    expect(parseMarkup('See [link]the *docs*[/link], run `npm i`.')).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', children: [{ type: 'text', text: 'the ' }, { type: 'em', children: [{ type: 'text', text: 'docs' }] }] },
      { type: 'text', text: ', run ' },
      { type: 'code', text: 'npm i' },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps unbalanced markers as text', () => {
    expect(parseMarkup('5 * 3 = 15')).toEqual([{ type: 'text', text: '5 * 3 = 15' }]);
    expect(parseMarkup('a [link]b')).toEqual([{ type: 'text', text: 'a [link]b' }]);
    expect(parseMarkup('x [/link] y')).toEqual([{ type: 'text', text: 'x [/link] y' }]);
  });

  it('never produces HTML', () => {
    expect(parseMarkup('<img src=x onerror=alert(1)>')).toEqual([{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('literal marker characters (M0 carry-over NB6)', () => {
  const seg = (text: string, inlineMarkup = text) => ({ text, inlineMarkup });

  it('page text with marker characters and no formatting is never parsed as markup', () => {
    for (const text of ['2 * 3 * 4 = 24', 'Use [link] and [/link] tags', 'type `[link]x[/link]` here', 'a *b* c']) {
      const kinds = markerKinds(seg(text));
      expect(kinds.size).toBe(0);
      expect(parseMarkup(text, kinds)).toEqual([{ type: 'text', text }]);
    }
  });

  it('keeps real formatting when the markup is exactly the text plus markers', () => {
    const s = seg('See the docs and npm i now.', 'See [link]the docs[/link] and `npm i` *now*.');
    expect([...markerKinds(s)].sort()).toEqual(['code', 'em', 'link']);
  });

  it('a page mixing a literal * with real emphasis shows everything as text', () => {
    // The page says "5 * 3" and has <em>now</em>: the markup has three stars, and which pair is real can't be told.
    const s = seg('5 * 3 is 15 now', '5 * 3 is 15 *now*');
    expect(markerKinds(s).size).toBe(0);
    expect(parseMarkup('5 * 3 là 15 *bây giờ*', markerKinds(s))).toEqual([{ type: 'text', text: '5 * 3 là 15 *bây giờ*' }]);
  });

  it('the model cannot add a kind of formatting the source does not have', () => {
    const kinds = markerKinds(seg('Read the docs.', 'Read [link]the docs[/link].'));
    expect(parseMarkup('Đọc [link]tài liệu[/link] *ngay*.', kinds)).toEqual([
      { type: 'text', text: 'Đọc ' },
      { type: 'link', children: [{ type: 'text', text: 'tài liệu' }] },
      { type: 'text', text: ' *ngay*.' },
    ]);
  });
});
