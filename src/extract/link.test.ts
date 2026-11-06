// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHighlighter, HIGHLIGHT_NAME, indexTargets, placeOf, scrollToSegment, segmentAt, selectedBlocks, watchHover, watchSelectionLink } from './link.ts';
import type { ViewportTarget } from './viewport.ts';

const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('segmentAt', () => {
  it('finds the segment whose element holds the node, the deepest when blocks nest', () => {
    document.body.innerHTML = '<ul id="u"><li id="l"><span id="s">hi</span></li></ul><p id="p">x</p>';
    const el = (id: string) => document.getElementById(id) as Element;
    const targets = new Map<string, ViewportTarget>([
      ['ul', el('u')],
      ['li', el('l')],
      ['p', el('p')],
    ]);
    const order = ['ul', 'li', 'p'];
    expect(segmentAt(window, indexTargets(targets, order), el('s'), 0, 0)).toBe('li');
    expect(segmentAt(window, indexTargets(targets, order), el('u'), 0, 0)).toBe('ul');
    expect(segmentAt(window, indexTargets(targets, order), el('p').firstChild, 0, 0)).toBe('p');
    expect(segmentAt(window, indexTargets(targets, order), document.body, 0, 0)).toBeUndefined();
    expect(segmentAt(window, indexTargets(targets, order), null, 0, 0)).toBeUndefined();
  });

  it('a segment that shares its element with others reports the first of them', () => {
    document.body.innerHTML = '<div id="d">a b</div>';
    const d = document.getElementById('d') as Element;
    expect(segmentAt(window, indexTargets(new Map<string, ViewportTarget>([['a', d], ['b', d]]), ['a', 'b']), d, 0, 0)).toBe('a');
  });

  it('an element shared by several segments and taller than the window says nothing about any of them', () => {
    document.body.innerHTML = '<article id="art"><p id="p">x</p></article>';
    const art = document.getElementById('art') as HTMLElement;
    const p = document.getElementById('p') as Element;
    const index = indexTargets(new Map<string, ViewportTarget>([['a', art], ['b', art], ['c', p]]), ['a', 'b', 'c']);
    art.getBoundingClientRect = () => rect(0, window.innerHeight * 3);
    expect(segmentAt(window, index, art, 0, 0)).toBeUndefined();
    expect(placeOf(window, index, 'a')).toBeUndefined();
    expect(placeOf(window, index, 'c')).toBe(p);
    // Short enough to be that block: the first of them.
    art.getBoundingClientRect = () => rect(0, 100);
    expect(segmentAt(window, index, art, 0, 0)).toBe('a');
    expect(placeOf(window, index, 'a')).toBe(art);
  });

  it('prefers the text range under the pointer to the element it shares', () => {
    document.body.innerHTML = '<div id="d">first second</div>';
    const text = (document.getElementById('d') as Element).firstChild as Text;
    const second = document.createRange();
    second.setStart(text, 6);
    second.setEnd(text, 12);
    const first = document.createRange();
    first.setStart(text, 0);
    first.setEnd(text, 5);
    (document as unknown as { caretPositionFromPoint: unknown }).caretPositionFromPoint = () => ({ offsetNode: text, offset: 8 });
    const targets = new Map<string, ViewportTarget>([['a', first], ['b', second]]);
    expect(segmentAt(window, indexTargets(targets, ['a', 'b']), text, 5, 5)).toBe('b');
    delete (document as unknown as { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
  });
});

describe('watchHover', () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

  it('reports the block under the pointer once per change, one read per frame, and none when the pointer leaves', async () => {
    document.body.innerHTML = '<p id="a">a</p><p id="b">b</p>';
    const a = document.getElementById('a') as Element;
    const b = document.getElementById('b') as Element;
    const seen: (string | undefined)[] = [];
    const watch = watchHover(window, indexTargets(new Map<string, ViewportTarget>([['a', a], ['b', b]]), ['a', 'b']), (id) => seen.push(id));
    const move = (el: Element) => el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    move(a);
    move(a);
    move(a);
    await frame();
    move(a);
    await frame();
    move(b);
    await frame();
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
    expect(seen).toEqual(['a', 'b', undefined]);
    watch.stop();
    move(a);
    await frame();
    expect(seen).toHaveLength(3);
  });
});

describe('createHighlighter', () => {
  function fakeHighlights() {
    const map = new Map<string, unknown>();
    class Highlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    Object.assign(window, { CSS: { highlights: map }, Highlight });
    return map;
  }
  afterEach(() => {
    delete (window as unknown as { CSS?: unknown }).CSS;
    delete (window as unknown as { Highlight?: unknown }).Highlight;
  });

  it('paints the text of an element without touching the page, and clears it', () => {
    const map = fakeHighlights();
    document.body.innerHTML = '<p id="p">some text</p>';
    const p = document.getElementById('p') as Element;
    const before = document.body.innerHTML;
    const h = createHighlighter(window);
    expect(h.show(p)).toBe(true);
    expect(map.has(HIGHLIGHT_NAME)).toBe(true);
    expect(document.body.innerHTML).toBe(before);
    expect(document.head.querySelectorAll('style')).toHaveLength(1);
    h.show(p);
    expect(document.head.querySelectorAll('style')).toHaveLength(1);
    expect(h.show(undefined)).toBe(false);
    expect(map.has(HIGHLIGHT_NAME)).toBe(false);
  });

  it('puts its <style> back when the page replaced <head>, and removes it when the link ends', () => {
    fakeHighlights();
    document.body.innerHTML = '<p id="p">some text</p>';
    const p = document.getElementById('p') as Element;
    const h = createHighlighter(window);
    h.show(p);
    document.head.replaceChildren();
    h.show(p);
    expect(document.head.querySelectorAll('style')).toHaveLength(1);
    h.dispose();
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
  });

  it('does nothing where the browser has no highlight API', () => {
    document.body.innerHTML = '<p id="p">x</p>';
    const h = createHighlighter(window);
    expect(h.show(document.getElementById('p') as Element)).toBe(false);
  });
});

describe('scrollToSegment', () => {
  const setup = (top: number, height: number) => {
    document.body.innerHTML = '<p id="p">x</p>';
    const p = document.getElementById('p') as HTMLElement;
    p.getBoundingClientRect = () => rect(top, height);
    const scrollBy = vi.fn();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    return { p, scrollBy };
  };

  it('moves the page by the distance of the point of the block to the top of the window', () => {
    const { p, scrollBy } = setup(500, 200);
    expect(scrollToSegment(window, p, 0.25)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 550, behavior: 'instant' });
    // A block already scrolled into: negative distance.
    const second = setup(-300, 400);
    expect(scrollToSegment(window, second.p, 0.5)).toBe(true);
    expect(second.scrollBy).toHaveBeenCalledWith({ top: -100, behavior: 'instant' });
  });

  it('does not scroll when the point is already at the top, or for a block that is not laid out or gone', () => {
    const at = setup(-50, 100);
    expect(scrollToSegment(window, at.p, 0.5)).toBe(false);
    const hidden = setup(0, 0);
    expect(scrollToSegment(window, hidden.p, 0)).toBe(false);
    expect(scrollToSegment(window, undefined, 0)).toBe(false);
    const gone = setup(300, 100);
    gone.p.remove();
    expect(scrollToSegment(window, gone.p, 0)).toBe(false);
    expect(at.scrollBy).not.toHaveBeenCalled();
  });

  it('a nonsense offset is the top of the block, not NaN', () => {
    const { p, scrollBy } = setup(200, 100);
    expect(scrollToSegment(window, p, Number.NaN)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 200, behavior: 'instant' });
  });

  it('scrolls the inner pane of a docs site instead of the window', () => {
    const { p, scrollBy } = setup(300, 100);
    const pane = document.createElement('div');
    pane.style.overflowY = 'auto';
    Object.defineProperty(pane, 'scrollHeight', { value: 2000 });
    Object.defineProperty(pane, 'clientHeight', { value: 500 });
    p.replaceWith(pane);
    pane.append(p);
    const paneBy = vi.fn();
    pane.scrollBy = paneBy as unknown as typeof pane.scrollBy;
    pane.getBoundingClientRect = () => rect(60, 500);
    expect(scrollToSegment(window, p, 0)).toBe(true);
    // The pane starts 60 px down the window: the block's top goes to the pane's edge, not the window's.
    expect(paneBy).toHaveBeenCalledWith({ top: 240, behavior: 'instant' });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('selection link', () => {
  const el = (id: string) => document.getElementById(id) as Element;
  const select = (from: Node, fromOffset: number, to: Node, toOffset: number) => {
    const r = document.createRange();
    r.setStart(from, fromOffset);
    r.setEnd(to, toOffset);
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(r);
  };
  afterEach(() => window.getSelection()?.removeAllRanges());

  it('names the blocks a selection reaches into and the sentences it touches in each', () => {
    document.body.innerHTML = '<p id="a">The cat sat. It was <em>very</em> tired.</p><p id="b">Then it slept. The end.</p><p id="c">Not this.</p>';
    const index = indexTargets(new Map<string, ViewportTarget>([['a', el('a')], ['b', el('b')], ['c', el('c')]]), ['a', 'b', 'c']);
    // From "It" in a to "Then" in b.
    select(el('a').firstChild as Text, 13, el('b').firstChild as Text, 4);
    expect(selectedBlocks(window, index)).toEqual([
      { id: 'a', first: 1, last: 1, count: 2, from: 0.419, to: 1 },
      { id: 'b', first: 0, last: 0, count: 2, from: 0, to: 0.609 },
    ]);
  });

  it('counts the deepest of nested blocks, skips a shared element, and works on text ranges', () => {
    document.body.innerHTML = '<ul id="u"><li id="l">One. Two.</li></ul><div id="d">First. Second.</div><section id="s">Shared.</section>';
    const text = el('d').firstChild as Text;
    const second = document.createRange();
    second.setStart(text, 7);
    second.setEnd(text, 14);
    const index = indexTargets(
      new Map<string, ViewportTarget>([
        ['ul', el('u')],
        ['li', el('l')],
        ['second', second],
        ['s1', el('s')],
        ['s2', el('s')],
      ]),
      ['ul', 'li', 'second', 's1', 's2'],
    );
    select(el('l').firstChild as Text, 5, el('l').firstChild as Text, 8);
    expect(selectedBlocks(window, index)).toEqual([{ id: 'li', first: 1, last: 1, count: 2, from: 0.556, to: 1 }]);
    select(text, 8, text, 10);
    expect(selectedBlocks(window, index)).toEqual([{ id: 'second', first: 0, last: 0, count: 1, from: 0, to: 1 }]);
    select(el('s').firstChild as Text, 0, el('s').firstChild as Text, 3);
    expect(selectedBlocks(window, index)).toEqual([]);
  });

  it("counts an outer block's own text only, without the block nested in it", () => {
    document.body.innerHTML = '<ul><li id="o">Outer one. Outer two.<ul><li id="n">Inner one. Inner two.</li></ul>Outer three.</li></ul>';
    const index = indexTargets(new Map<string, ViewportTarget>([['o', el('o')], ['n', el('n')]]), ['o', 'n']);
    const tail = el('o').lastChild as Text;
    // "three" in the outer block's text after the nested list: its third sentence of three.
    select(tail, 6, tail, 11);
    expect(selectedBlocks(window, index)).toEqual([{ id: 'o', first: 2, last: 2, count: 3, from: 0.647, to: 1 }]);
    // From the outer block's second sentence into the nested one: both, each in its own text.
    select(el('o').firstChild as Text, 12, el('n').firstChild as Text, 3);
    expect(selectedBlocks(window, index)).toEqual([
      { id: 'o', first: 1, last: 1, count: 3, from: 0.324, to: 0.618 },
      { id: 'n', first: 0, last: 0, count: 2, from: 0, to: 0.476 },
    ]);
  });

  it('takes no line break of the HTML source for the end of a sentence', () => {
    document.body.innerHTML = '<p id="a">This is a long\n      sentence that wraps. And another one.</p>';
    const index = indexTargets(new Map<string, ViewportTarget>([['a', el('a')]]), ['a']);
    const text = el('a').firstChild as Text;
    select(text, text.data.indexOf('another'), text, text.data.indexOf('another') + 7);
    expect(selectedBlocks(window, index)).toMatchObject([{ id: 'a', first: 1, last: 1, count: 2 }]);
  });

  it('ignores a selection in an editable region, and one of only spaces', () => {
    document.body.innerHTML = '<p id="a">Hello there. More.</p><div id="e" contenteditable="true">Edit me.</div>';
    const index = indexTargets(new Map<string, ViewportTarget>([['a', el('a')], ['e', el('e')]]), ['a', 'e']);
    select(el('e').firstChild as Text, 0, el('e').firstChild as Text, 4);
    expect(selectedBlocks(window, index)).toEqual([]);
    select(el('a').firstChild as Text, 12, el('a').firstChild as Text, 13);
    expect(selectedBlocks(window, index)).toEqual([]);
  });

  it('reports a settled selection once, and its end at once', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<p id="a">One. Two.</p>';
      const index = indexTargets(new Map<string, ViewportTarget>([['a', el('a')]]), ['a']);
      const seen: unknown[] = [];
      const watch = watchSelectionLink(window, index, (b) => seen.push(b), 50);
      // The first report goes out even when empty (a re-read may follow a selection that is gone).
      expect(seen).toEqual([[]]);
      seen.length = 0;
      select(el('a').firstChild as Text, 0, el('a').firstChild as Text, 3);
      document.dispatchEvent(new Event('selectionchange'));
      document.dispatchEvent(new Event('selectionchange'));
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(50);
      expect(seen).toEqual([[{ id: 'a', first: 0, last: 0, count: 2, from: 0, to: 0.444 }]]);
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(50);
      expect(seen).toHaveLength(1);
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
      expect(seen[1]).toEqual([]);
      watch.stop();
      select(el('a').firstChild as Text, 0, el('a').firstChild as Text, 3);
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(50);
      expect(seen).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
