// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { domPathOf } from './dom-path.ts';
import { segment } from './segmenter.ts';

function seg(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return segment(root, { pathOf: domPathOf });
}

const brief = (html: string) => seg(html).map((s) => [s.kind, s.inlineMarkup]);

describe('segmenter kinds', () => {
  it('maps blocks to kinds', () => {
    expect(
      brief(`<h2>Head</h2><p>Para</p><ul><li>Item</li></ul><blockquote><p>Q1</p><p>Q2</p></blockquote>
        <figure><img alt="x"><figcaption>Cap</figcaption></figure><table><caption>TCap</caption><tr><td>Cell</td></tr></table>
        <dl><dt>Term</dt><dd>Def</dd></dl><details open><summary>Sum</summary></details><pre>code()</pre>`),
    ).toEqual([
      ['heading', 'Head'],
      ['p', 'Para'],
      ['li', 'Item'],
      ['quote', 'Q1'],
      ['quote', 'Q2'],
      ['caption', 'Cap'],
      ['caption', 'TCap'],
      ['table-cell', 'Cell'],
      ['p', 'Term'],
      ['p', 'Def'],
      ['p', 'Sum'],
      ['code', 'code()'],
    ]);
  });

  it('records heading levels', () => {
    expect(seg('<h1>A</h1><h4>B</h4>').map((s) => s.level)).toEqual([1, 4]);
  });

  it('splits a list item around its nested list and keeps paragraphs inside items as li', () => {
    expect(brief('<ul><li>Outer <b>x</b><ul><li>Inner</li></ul>tail</li><li><p>P in li</p></li></ul>')).toEqual([
      ['li', 'Outer *x*'],
      ['li', 'Inner'],
      ['li', 'tail'],
      ['li', 'P in li'],
    ]);
  });

  it('turns loose text in containers into paragraphs with #run paths', () => {
    const s = seg('<div>Loose one<p>Para</p>Loose two</div>');
    expect(s.map((x) => [x.kind, x.text])).toEqual([
      ['p', 'Loose one'],
      ['p', 'Para'],
      ['p', 'Loose two'],
    ]);
    expect(s[0]?.domPath).toMatch(/#run\[1\]$/);
    expect(s[2]?.domPath).toMatch(/#run\[2\]$/);
    expect(s[1]?.domPath).not.toContain('#run');
  });

  it('skips segments with no letters or digits, but never code', () => {
    expect(brief('<p>—</p><p>​</p><pre>{}</pre>')).toEqual([['code', '{}']]);
  });
});

describe('inline markers', () => {
  it('marks links, inline code and emphasis', () => {
    const [s] = seg('<p>See <a href="/x">the <em>docs</em></a>, run <code>npm i</code> and <strong>stop</strong>.</p>');
    expect(s?.text).toBe('See the docs, run npm i and stop.');
    expect(s?.inlineMarkup).toBe('See [link]the *docs*[/link], run `npm i` and *stop*.');
  });

  it('keeps edge whitespace outside markers and flattens nested emphasis', () => {
    const [s] = seg('<p>a<a href="#"> link </a>b <strong>bold <em>both</em></strong></p>');
    expect(s?.inlineMarkup).toBe('a [link]link[/link] b *bold both*');
  });

  it('adds no markers around empty elements or anchors without href', () => {
    const [s] = seg('<p><i class="icon"></i>Text <a name="x">anchor</a><em> </em>end</p>');
    expect(s?.inlineMarkup).toBe('Text anchor end');
  });

  it('turns <br> into a newline and collapses other whitespace', () => {
    const [s] = seg('<p>Line one<br>\n   line   two</p>');
    expect(s?.text).toBe('Line one\nline two');
  });
});

describe('code blocks', () => {
  it('keeps code verbatim (indentation, <br> lines), marks it do-not-translate, records its language', () => {
    const [s] = seg('<pre class="language-rust"><code><span>fn main() {</span><br><span>    println!("hi");</span><br><span>}</span>\n</code></pre>');
    expect(s).toMatchObject({ kind: 'code', translate: false, codeLang: 'rust', text: 'fn main() {\n    println!("hi");\n}' });
    expect(s?.inlineMarkup).toBe(s?.text);
  });

  it('treats a block-level <code> outside <pre> as a code block', () => {
    expect(brief('<code><div>line 1</div><div>line 2</div></code>')).toEqual([['code', 'line 1line 2']]);
  });

  it('marks everything else translatable', () => {
    expect(seg('<p>x</p><li>y</li>').every((s) => s.translate)).toBe(true);
  });
});

describe('tables', () => {
  it('gives the cells of one row the same groupId, and each row its own', () => {
    const s = seg('<table><thead><tr><th>Name</th><th>Desc</th></tr></thead><tbody><tr><td>a</td><td><p>first</p><p>second</p></td></tr></tbody></table>');
    expect(s.map((x) => [x.kind, x.text])).toEqual([
      ['table-cell', 'Name'],
      ['table-cell', 'Desc'],
      ['table-cell', 'a'],
      ['table-cell', 'first'],
      ['table-cell', 'second'],
    ]);
    const [h1, h2, a, first, second] = s.map((x) => x.groupId);
    expect(h1).toBeDefined();
    expect(h1).toBe(h2);
    expect(a).toBe(first);
    expect(first).toBe(second);
    expect(a).not.toBe(h1);
    expect(seg('<p>no table</p>')[0]?.groupId).toBeUndefined();
  });
});

describe('ids', () => {
  it('are stable across re-segmentation and change with text or position', () => {
    const html = '<h2>Title</h2><p>Body</p>';
    const a = seg(html).map((s) => s.id);
    expect(seg(html).map((s) => s.id)).toEqual(a);
    expect(seg('<h2>Title</h2><p>Body!</p>').map((s) => s.id)).toEqual([a[0], expect.not.stringMatching(a[1] ?? '')]);
    expect(seg('<h2>Lead</h2><h2>Title</h2><p>Body</p>')[1]?.id).not.toBe(a[0]);
  });

  it('are unique even when path and text repeat', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Same</p><p>Same</p>';
    const ids = segment(root, { pathOf: () => '/same' }).map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });
});
