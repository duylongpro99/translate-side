// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHighlighter, HIGHLIGHT_NAME, indexTargets, placeOf, scrollToSegment, segmentAt, watchHover } from './link.ts';
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
