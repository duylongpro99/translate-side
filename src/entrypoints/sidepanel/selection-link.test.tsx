// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectedBlock } from '@/shared/protocol';
import { SENTENCE_HIGHLIGHT, SelectionStore, sentenceRanges, textRange, useSelectionLink } from './selection-link.ts';

const block = (id: string, first: number, last: number, count: number, from: number, to: number): SelectedBlock => ({ id, first, last, count, from, to });

describe('SelectionStore', () => {
  it('keeps the selected blocks per tab and document, and tells its listeners', () => {
    const store = new SelectionStore();
    const seen: unknown[] = [];
    const off = store.subscribe((t, d, b) => seen.push([t, d, b.length]));
    store.set(1, 'doc', [block('a', 0, 0, 1, 0, 1)]);
    expect(store.get(1, 'doc')).toHaveLength(1);
    expect(store.get(1, 'other')).toEqual([]);
    store.set(1, 'doc', []);
    expect(store.get(1, 'doc')).toEqual([]);
    store.set(2, 'doc', [block('a', 0, 0, 1, 0, 1)]);
    store.drop(2);
    expect(store.get(2, 'doc')).toEqual([]);
    off();
    store.set(3, 'doc', []);
    expect(seen).toEqual([
      [1, 'doc', 1],
      [1, 'doc', 0],
      [2, 'doc', 1],
    ]);
  });
});

describe('textRange', () => {
  it('spans text nodes across inline elements', () => {
    document.body.innerHTML = '<span id="t">Nó <em>rất</em> mệt. Rồi.</span>';
    const r = textRange(document.getElementById('t') as Element, { start: 0, end: 11 });
    expect(r?.toString()).toBe('Nó rất mệt.');
    expect(textRange(document.getElementById('t') as Element, { start: 12, end: 16 })?.toString()).toBe('Rồi.');
    expect(textRange(document.getElementById('t') as Element, { start: 12, end: 99 })).toBeUndefined();
  });
});

const PANEL = `<div class="segments">
  <p data-id="a"><span class="seg__text" lang="vi">Con mèo ngồi. Nó <em>rất</em> mệt. Rồi nó ngủ.</span><span class="seg__actions">Copy</span></p>
  <p data-id="b"><span lang="en">Still waiting.</span></p>
  <p data-id="c"><span class="seg__text" lang="vi">Một. Hai.</span></p>
</div>`;

describe('sentenceRanges', () => {
  it('ranges over the matching sentences of each translated block only', () => {
    document.body.innerHTML = PANEL;
    const find = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`) ?? undefined;
    const { ranges, first } = sentenceRanges([block('a', 1, 1, 3, 0.3, 0.6), block('b', 0, 0, 1, 0, 1), block('c', 0, 1, 2, 0, 1), block('gone', 0, 0, 1, 0, 1)], find);
    expect(ranges.map(String)).toEqual(['Nó rất mệt.', 'Một.', 'Hai.']);
    expect(first?.dataset.id).toBe('a');
  });
});

describe('useSelectionLink', () => {
  let frames: FrameRequestCallback[] = [];
  const flush = () => {
    const now = frames;
    frames = [];
    for (const f of now) f(0);
  };
  const set = new Map<string, { ranges: Range[] }>();
  beforeEach(() => {
    frames = [];
    set.clear();
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    (window as unknown as { CSS: unknown }).CSS = { highlights: { set: (n: string, h: { ranges: Range[] }) => set.set(n, h), delete: (n: string) => set.delete(n) } };
    (window as unknown as { Highlight: unknown }).Highlight = class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { CSS?: unknown }).CSS;
    delete (window as unknown as { Highlight?: unknown }).Highlight;
    document.body.replaceChildren();
  });

  function Host({ store, on = true }: { store: SelectionStore; on?: boolean }) {
    useSelectionLink(store, 7, 'doc', on, false);
    return null;
  }
  const shown = () => set.get(SENTENCE_HIGHLIGHT)?.ranges.map(String);

  it('highlights while the selection lasts, follows the translation as it arrives, and clears', async () => {
    document.body.innerHTML = `${PANEL}<div id="root"></div>`;
    const store = new SelectionStore();
    const root = document.getElementById('root') as HTMLElement;
    act(() => render(<Host store={store} />, root));
    act(() => store.set(7, 'doc', [block('a', 2, 2, 3, 0.7, 1)]));
    flush();
    expect(shown()).toEqual(['Rồi nó ngủ.']);
    // Another page's selection is not this one's.
    act(() => store.set(7, 'other', [block('c', 0, 0, 2, 0, 0.5)]));
    flush();
    expect(shown()).toEqual(['Rồi nó ngủ.']);
    // A waiting block gets its translation while the selection stays: painted then.
    act(() => store.set(7, 'doc', [block('b', 0, 0, 1, 0, 1)]));
    flush();
    expect(shown()).toBeUndefined();
    const b = document.querySelector('[data-id="b"]') as HTMLElement;
    b.innerHTML = '<span class="seg__text" lang="vi">Vẫn chờ.</span>';
    await Promise.resolve();
    flush();
    expect(shown()).toEqual(['Vẫn chờ.']);
    act(() => store.set(7, 'doc', []));
    flush();
    expect(shown()).toBeUndefined();
    // Off: nothing is painted, and turning it off clears what was.
    act(() => store.set(7, 'doc', [block('c', 0, 0, 2, 0, 0.5)]));
    flush();
    expect(shown()).toEqual(['Một.']);
    act(() => render(<Host store={store} on={false} />, root));
    expect(shown()).toBeUndefined();
    act(() => store.set(7, 'doc', [block('a', 0, 0, 3, 0, 0.3)]));
    flush();
    expect(shown()).toBeUndefined();
    act(() => render(null, root));
  });

  it('with follow on, brings a new selection into view, but not a block translated after it', async () => {
    document.body.innerHTML = `${PANEL}<div id="root"></div>`;
    const below = { top: 5000, bottom: 5100, height: 100, left: 0, right: 300, width: 300, x: 0, y: 5000, toJSON: () => ({}) } as DOMRect;
    for (const el of document.querySelectorAll<HTMLElement>('[data-id]')) el.getBoundingClientRect = () => below;
    const scrollBy = vi.fn();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    const store = new SelectionStore();
    const root = document.getElementById('root') as HTMLElement;
    function Following() {
      useSelectionLink(store, 7, 'doc', true, true);
      return null;
    }
    act(() => render(<Following />, root));
    act(() => store.set(7, 'doc', [block('c', 0, 0, 2, 0, 0.5)]));
    flush();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // A selection in a block still waiting: nothing to show, and no scroll when its text arrives later.
    act(() => store.set(7, 'doc', [block('b', 0, 0, 1, 0, 1)]));
    flush();
    const b = document.querySelector('[data-id="b"]') as HTMLElement;
    b.innerHTML = '<span class="seg__text" lang="vi">Vẫn chờ.</span>';
    await Promise.resolve();
    flush();
    expect(shown()).toEqual(['Vẫn chờ.']);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    act(() => render(null, root));
  });
});
