// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHtml } from '../../tests/fixtures/load.ts';
import { extractPage } from './index.ts';
import { watchViewport } from './viewport.ts';
import type { Viewport } from '@/shared/protocol';

const LONG = 'Futures decouple a value from how it is computed, so programs can wait for results. '.repeat(8);

/** Lays out `els` as a column of 100 px blocks from `top` (jsdom has no layout). */
function layout(els: Element[], top: () => number) {
  els.forEach((el, i) => {
    el.getBoundingClientRect = () => {
      const y = top() + i * 100;
      return { top: y, bottom: y + 100, left: 0, right: 500, width: 500, height: 100, x: 0, y, toJSON: () => ({}) } as DOMRect;
    };
  });
}

describe('extractPage targets (plan M3-E1)', () => {
  it('maps every segment to its live element, a #run block to a Range over its own text', () => {
    const doc = loadHtml(`<!doctype html><html><head><title>T</title></head><body><main><h1>Title</h1><p>${LONG}</p><div>Loose text <b>here</b>.<p>${LONG} two</p></div></main></body></html>`, 'https://example.com/a');
    const targets = new Map<string, Element | Range>();
    const result = extractPage(doc, targets);
    if (!result.ok) throw new Error('no content');
    expect(targets.size).toBe(result.segments.length);
    const run = result.segments.find((s) => s.domPath.includes('#run'));
    for (const s of result.segments) {
      const t = targets.get(s.id);
      if (s === run) continue;
      expect(t instanceof (doc.defaultView as Window & typeof globalThis).Element).toBe(true);
      expect((t as Element).ownerDocument).toBe(doc);
      expect((t as Element).isConnected).toBe(true);
    }
    const range = run && (targets.get(run.id) as Range);
    expect(range?.toString()).toBe('Loose text here.');
    expect((range?.commonAncestorContainer as Element).localName).toBe('div');
    expect((targets.get(result.segments[0]?.id ?? '') as Element).localName).toBe('h1');
  });

  it('extractPage without targets is unchanged', () => {
    const doc = loadHtml(`<!doctype html><html><head><title>T</title></head><body><main><p>${LONG}</p></main></body></html>`, 'https://example.com/a');
    const result = extractPage(doc);
    expect(result.ok && 'visible' in result).toBe(false);
  });
});

describe('watchViewport', () => {
  afterEach(() => vi.useRealTimers());

  function page(n = 10) {
    document.body.innerHTML = Array.from({ length: n }, (_, i) => `<p id="e${i}">P${i}</p>`).join('');
    const els = [...document.querySelectorAll('p')];
    let scrollTop = 0;
    layout(els, () => -scrollTop);
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    const targets = new Map(els.map((el, i) => [`s${i}`, el as Element]));
    const order = els.map((_, i) => `s${i}`);
    return { targets, order, scrollTo: (y: number) => (scrollTop = y) };
  }

  it('reports the segments on screen in page order, and the top one with how far it is scrolled', () => {
    const { targets, order, scrollTo } = page();
    const w = watchViewport(window, targets, order, () => undefined);
    expect(w.now()).toEqual({ visible: ['s0', 's1', 's2'], anchor: { id: 's0', offset: 0 } });
    scrollTo(250);
    expect(w.now()).toEqual({ visible: ['s2', 's3', 's4', 's5'], anchor: { id: 's2', offset: 0.5 } });
    w.stop();
  });

  it('pushes a change after a scroll, throttled, and only when it differs', () => {
    vi.useFakeTimers();
    const { targets, order, scrollTo } = page();
    const seen: Viewport[] = [];
    const w = watchViewport(window, targets, order, (v) => seen.push(v), { throttleMs: 50 });
    w.now();
    scrollTo(10);
    document.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(60);
    expect(seen).toEqual([{ visible: ['s0', 's1', 's2', 's3'], anchor: { id: 's0', offset: 0.1 } }]);
    // Same viewport again: nothing new.
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(60);
    expect(seen).toHaveLength(1);
    w.stop();
    scrollTo(500);
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(60);
    expect(seen).toHaveLength(1);
  });

  it('several segments of one element: all visible, the first is the anchor', () => {
    const { targets } = page(2);
    const shared = targets.get('s0') as Element;
    const w = watchViewport(window, new Map([...targets, ['r1', shared]]), ['s0', 'r1', 's1'], () => undefined);
    expect(w.now()).toEqual({ visible: ['s0', 'r1', 's1'], anchor: { id: 's0', offset: 0 } });
    w.stop();
  });

  it('an element shared by several segments and taller than the window counts for none of them (Readability path)', () => {
    const { targets } = page(3);
    const [e0, e1, e2] = [...targets.values()];
    // The article ancestor three made-up blocks fall back to: 2,000 px tall, its top above the window.
    const article = document.createElement('article');
    article.getBoundingClientRect = () => ({ top: -200, bottom: 1800, left: 0, right: 500, width: 500, height: 2000, x: 0, y: -200, toJSON: () => ({}) }) as DOMRect;
    document.body.append(article);
    const w = watchViewport(window, new Map([['r0', article], ['s1', e1 as Element], ['r1', article], ['r2', article], ['s2', e2 as Element]]), ['r0', 's1', 'r1', 'r2', 's2'], () => undefined);
    expect(w.now()).toEqual({ visible: ['s1', 's2'], anchor: { id: 's1', offset: 0 } });
    w.stop();
    // Alone it says nothing at all: nothing visible, no anchor (the job keeps its order, the panel stays).
    const only = watchViewport(window, new Map([['r0', article], ['r1', article]]), ['r0', 'r1'], () => undefined);
    expect(only.now()).toEqual({ visible: [] });
    only.stop();
    // One segment's element taller than the window (a long code block) still counts.
    const block = e0 as Element;
    block.getBoundingClientRect = article.getBoundingClientRect;
    const one = watchViewport(window, new Map([['c0', block]]), ['c0'], () => undefined);
    expect(one.now()).toEqual({ visible: ['c0'], anchor: { id: 'c0', offset: 0.1 } });
    one.stop();
  });

  it('Range targets (made-up paragraphs of one container, M3 dogfood B3) are measured on each read, with or without an observer', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<font>One. Two. Three. Four. Five.</font>';
    const text = document.querySelector('font')?.firstChild as Text;
    let scrollTop = 0;
    const ranges = [0, 5, 10, 17, 23].map((start, i) => {
      const r = document.createRange();
      r.setStart(text, start);
      r.setEnd(text, start + 4);
      r.getBoundingClientRect = () => {
        const y = i * 100 - scrollTop;
        return { top: y, bottom: y + 100, left: 0, right: 500, width: 500, height: 100, x: 0, y, toJSON: () => ({}) } as DOMRect;
      };
      return r;
    });
    const targets = new Map(ranges.map((r, i) => [`p${i}`, r]));
    const order = [...targets.keys()];
    const observed: unknown[] = [];
    class FakeObserver {
      observe(t: unknown) {
        observed.push(t);
      }
      disconnect() {}
    }
    const win = { IntersectionObserver: FakeObserver, document, innerHeight: 300, innerWidth: 800, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as Window;
    const seen: Viewport[] = [];
    const w = watchViewport(win, targets, order, (v) => seen.push(v), { throttleMs: 0 });
    expect(observed).toHaveLength(0);
    expect(w.now()).toEqual({ visible: ['p0', 'p1', 'p2'], anchor: { id: 'p0', offset: 0 } });
    scrollTop = 250;
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toEqual({ visible: ['p2', 'p3', 'p4'], anchor: { id: 'p2', offset: 0.5 } });
    w.stop();
    // Without an observer too.
    scrollTop = 0;
    const plain = watchViewport(window, targets, order, () => undefined);
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    expect(plain.now().visible).toEqual(['p0', 'p1', 'p2']);
    plain.stop();
  });

  it('uses an IntersectionObserver when there is one, and disconnects it on stop', () => {
    vi.useFakeTimers();
    const { targets, order } = page(4);
    let callback!: (entries: { target: Element; isIntersecting: boolean }[]) => void;
    const observed: Element[] = [];
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect = disconnect;
    }
    const win = { IntersectionObserver: FakeObserver, document, innerHeight: 300, innerWidth: 800, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as Window;
    const seen: Viewport[] = [];
    const w = watchViewport(win, targets, order, (v) => seen.push(v), { throttleMs: 0 });
    expect(observed).toHaveLength(4);
    expect(w.now().visible).toEqual(['s0', 's1', 's2']);
    callback([{ target: targets.get('s0') as Element, isIntersecting: false }, { target: targets.get('s3') as Element, isIntersecting: true }]);
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)?.visible).toEqual(['s1', 's2', 's3']);
    w.stop();
    expect(disconnect).toHaveBeenCalled();
  });
});
