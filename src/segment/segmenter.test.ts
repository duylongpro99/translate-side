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

  it('puts a space between an element marked as its own box and the element it touches', () => {
    const [s] = seg('<p><span data-ts-box>Written by</span><a href="/a" data-ts-box>Ana</a>.</p>');
    expect(s?.inlineMarkup).toBe('Written by [link]Ana[/link].');
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
    expect(brief('<code><div>line 1</div><div>line 2</div></code>')).toEqual([['code', 'line 1\nline 2']]);
  });

  it('treats code-editor surfaces (CodeMirror) as code blocks, one line per div', () => {
    const s = seg('<div class="cm-editor"><div class="cm-content" contenteditable="true" role="textbox"><div class="cm-line">const a = 1;</div><div class="cm-line">  f(a);</div></div></div>');
    expect(s.map((x) => [x.kind, x.text, x.translate])).toEqual([['code', 'const a = 1;\n  f(a);', false]]);
  });

  it('marks blocks the page opts out of (translate="no", .notranslate) do-not-translate, keeping their kind', () => {
    const s = seg('<p translate="no">Brand Name</p><div class="notranslate"><p>Kept term</p></div><div translate="no"><p translate="yes">Back in</p></div><p>Normal</p>');
    expect(s.map((x) => [x.kind, x.text, x.translate])).toEqual([
      ['p', 'Brand Name', false],
      ['p', 'Kept term', false],
      ['p', 'Back in', true],
      ['p', 'Normal', true],
    ]);
  });

  it('ignores opt-outs on the content root and its ancestors (page-wide translate="no" guards)', () => {
    const root = document.createElement('div');
    root.className = 'notranslate';
    root.innerHTML = '<p>Body text</p><p translate="no">Brand</p>';
    document.body.replaceChildren(root);
    document.body.setAttribute('translate', 'no');
    try {
      expect(segment(root, { pathOf: domPathOf }).map((x) => [x.text, x.translate])).toEqual([
        ['Body text', true],
        ['Brand', false],
      ]);
    } finally {
      document.body.removeAttribute('translate');
    }
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

  it('keeps the row groupId on lists and quotes inside a cell', () => {
    const s = seg('<table><tr><th>Name</th></tr><tr><td>Option</td><td><ul><li>one</li><li>two</li></ul><blockquote>q</blockquote></td></tr></table>').slice(1);
    expect(s.map((x) => x.kind)).toEqual(['table-cell', 'li', 'li', 'quote']);
    expect(new Set(s.map((x) => x.groupId)).size).toBe(1);
    expect(s[0]?.groupId).toBeDefined();
  });

  it('keeps symbol-only cells so rows stay aligned, without translating them', () => {
    const s = seg('<table><thead><tr><th>Style</th><th>Example</th></tr></thead><tr><td>JSX-style</td><td><code>{/* ... */}</code></td></tr></table>').slice(2);
    expect(s.map((x) => [x.text, x.translate])).toEqual([
      ['JSX-style', true],
      ['{/* ... */}', false],
    ]);
  });
});

describe('layout tables (M3 dogfood B3; Readability\'s data-table test)', () => {
  const kinds = (html: string) => seg(html).map((x) => [x.kind, x.text, x.groupId === undefined ? '' : 'g']);
  const para = (n: number) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i} of the essay, long enough to read.</p>`).join('');

  it('an essay in one cell of a one-row table (paulgraham.com) reads as paragraphs, not cells', () => {
    const s = seg(`<table><tr><td><img src="nav.gif"></td><td><table width="435"><tr><td><font>July 2023${para(3)}</font></td></tr></table></td></tr></table>`);
    expect(s.map((x) => x.kind)).toEqual(['p', 'p', 'p', 'p']);
    expect(s.every((x) => x.groupId === undefined)).toBe(true);
    expect(s[0]?.text).toBe('July 2023');
  });

  it('a comment thread of nested one-row tables (news.ycombinator.com) reads as paragraphs', () => {
    const comment = (who: string, text: string) => `<tr><td><table><tr><td class="ind"><img width="40"></td><td class="votelinks"><a href="#">up</a></td><td class="default"><div><span class="comhead"><a class="hnuser">${who}</a> 2 hours ago</span></div><div class="comment"><div class="commtext">${text}</div></div></td></tr></table></td></tr>`;
    const s = seg(`<table id="hnmain"><tr><td><table class="comment-tree">${comment('alice', 'First comment.<p>Second paragraph.</p>')}${comment('bob', 'A reply.')}</table></td></tr></table>`);
    expect(s.filter((x) => x.kind === 'table-cell')).toEqual([]);
    expect(s.map((x) => x.text)).toEqual(['up', 'alice 2 hours ago', 'First comment.', 'Second paragraph.', 'up', 'bob 2 hours ago', 'A reply.']);
  });

  it('data tables stay tables: header cells, a caption, or enough rows and columns', () => {
    expect(kinds('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>').map((k) => k[0])).toEqual(['table-cell', 'table-cell', 'table-cell', 'table-cell']);
    expect(kinds('<table><caption>Sizes</caption><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>').slice(1).every((k) => k[0] === 'table-cell' && k[2] === 'g')).toBe(true);
    const grid = (r: number, c: number) => `<table>${Array.from({ length: r }, (_, i) => `<tr>${Array.from({ length: c }, (_, j) => `<td>r${i}c${j}</td>`).join('')}</tr>`).join('')}</table>`;
    // 3 × 4 = 12 cells: data; 10 rows: data; 5 columns: data.
    for (const [r, c] of [[3, 4], [10, 2], [2, 5]] as const) expect(kinds(grid(r, c)).every((k) => k[0] === 'table-cell'), `${r}x${c}`).toBe(true);
    // 2 × 2, one row, one column, role=presentation: layout.
    for (const html of [grid(2, 2), grid(1, 3), grid(4, 1), grid(3, 4).replace('<table>', '<table role="presentation">')]) expect(kinds(html).every((k) => k[0] === 'p' && k[2] === ''), html).toBe(true);
  });

  it('rows left without their table (Readability unwrapped it into a div) are not table cells', () => {
    const div = document.createElement('div');
    const tr = div.appendChild(document.createElement('tr'));
    tr.appendChild(document.createElement('td')).textContent = 'Cell text';
    expect(segment(div, { pathOf: domPathOf }).map((x) => x.kind)).toEqual(['p']);
  });

  it('a data table inside a layout table is still a table; the layout around it is not', () => {
    const s = seg(`<table><tr><td>${para(1)}<table><tr><th>K</th><th>V</th></tr><tr><td>a</td><td>1</td></tr></table></td></tr></table>`);
    expect(s.map((x) => x.kind)).toEqual(['p', 'table-cell', 'table-cell', 'table-cell', 'table-cell']);
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
