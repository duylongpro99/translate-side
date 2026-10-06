import { describe, expect, it } from 'vitest';
import { parseMarkup } from './markup.ts';

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
