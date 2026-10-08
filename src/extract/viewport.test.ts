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
  it('maps every segment to its live element, a #run block to its container', () => {
    const doc = loadHtml(`<!doctype html><html><head><title>T</title></head><body><main><h1>Title</h1><p>${LONG}</p><div>Loose text <b>here</b>.<p>${LONG} two</p></div></main></body></html>`, 'https://example.com/a');
    const targets = new Map<string, Element>();
    const result = extractPage(doc, targets);
    if (!result.ok) throw new Error('no content');
    expect(targets.size).toBe(result.segments.length);
    for (const s of result.segments) {
      const el = targets.get(s.id);
      expect(el?.ownerDocument).toBe(doc);
      expect(el?.isConnected).toBe(true);
    }
    const run = result.segments.find((s) => s.domPath.includes('#run'));
    expect(run && targets.get(run.id)?.localName).toBe('div');
    expect(targets.get(result.segments[0]?.id ?? '')?.localName).toBe('h1');
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
