// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/types';
import { App, type TranslatorProps } from './App.tsx';
import type { PanelController, PanelView } from './controller.ts';
import { FOLLOW_KEY, blockFinder, followTop, readFollow, scrollToAnchor, writeFollow } from './follow.ts';
import type { Jobs } from './jobs.ts';
import { ViewportStore } from './viewport.ts';

const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe('followTop', () => {
  it('puts the anchor point of the block right under the sticky chrome', () => {
    // Block at 500 px below the window top, 200 px tall, page scrolled half way into it, 80 px of header.
    expect(followTop({ top: 500, height: 200 }, 0.5, 1000, 80)).toBe(1520);
    expect(followTop({ top: 500, height: 200 }, 0, 0, 80)).toBe(420);
    expect(followTop({ top: 10, height: 200 }, 0, 0, 80)).toBe(0);
  });
});

describe('the toggle is remembered per viewer', () => {
  beforeEach(() => localStorage.clear());

  it('is on by default, and kept when turned off', () => {
    expect(readFollow()).toBe(true);
    writeFollow(false);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('0');
    expect(readFollow()).toBe(false);
    writeFollow(true);
    expect(readFollow()).toBe(true);
  });

  it('storage that throws (blocked site data) means on, and a write is dropped', () => {
    const broken = () => {
      throw new Error('denied');
    };
    expect(readFollow(broken)).toBe(true);
    expect(() => writeFollow(false, broken)).not.toThrow();
  });
});

describe('scroll follow in the panel (plan M3-E7)', () => {
  const seg = (id: string): Segment => ({ id, kind: 'p', text: id, inlineMarkup: id, domPath: `/p[${id}]`, translate: true });
  const segments = ['a', 'b', 'c'].map(seg);
  let root: HTMLElement;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    root = document.createElement('div');
    document.body.replaceChildren(root);
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    act(() => render(null, root));
  });

  function mount(viewports: ViewportStore) {
    const view: PanelView = { kind: 'ready', docId: 'd', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments } };
    const controller = { view, tabId: 7, subscribe: (fn: (v: PanelView, t: number | undefined) => void) => (fn(view, 7), () => undefined), retry: () => undefined };
    const jobs = { docOf: () => undefined, get: () => undefined, subscribe: () => () => undefined };
    const translator: TranslatorProps = { jobs: jobs as unknown as Jobs, actions: () => ({ cancel() {}, resume() {}, openOptions() {}, retrySegment() {}, retranslateSegment() {}, retranslatePage() {}, grantAccess() {}, continuePastLimit() {} }), viewports };
    act(() => render(<App controller={controller as unknown as PanelController} translator={translator} />, root));
    // Layout: header 40 px tall; block b at 600 px from the window top, 100 px tall.
    (root.querySelector('.panel__header') as HTMLElement).getBoundingClientRect = () => rect(0, 40);
    (root.querySelector('[data-id="b"]') as HTMLElement).getBoundingClientRect = () => rect(600, 100);
  }

  const button = () => root.querySelector<HTMLButtonElement>('[data-testid="scroll-follow"]');
  const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

  it('scrolls the panel to the block the page is at, on every viewport change', async () => {
    const viewports = new ViewportStore();
    mount(viewports);
    expect(button()?.getAttribute('aria-pressed')).toBe('true');
    viewports.set(7, 'd', { visible: ['b', 'c'], anchor: { id: 'b', offset: 0.25 } });
    await frame();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 600 + 25 - 40, behavior: 'instant' });
    // Another tab's or another document's viewport is not followed.
    scrollTo.mockClear();
    viewports.set(8, 'd', { visible: ['b'], anchor: { id: 'b', offset: 0.9 } });
    viewports.set(7, 'old', { visible: ['b'], anchor: { id: 'b', offset: 0.9 } });
    await frame();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('turned off: no scrolling, and the choice is kept; turned on again: catches up at once', async () => {
    const viewports = new ViewportStore();
    mount(viewports);
    act(() => button()?.click());
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('0');
    viewports.set(7, 'd', { visible: ['b'], anchor: { id: 'b', offset: 0 } });
    await frame();
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => button()?.click());
    await frame();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 560, behavior: 'instant' });
  });

  it('looks blocks up once, and again only when a block was replaced (R4)', () => {
    const viewports = new ViewportStore();
    mount(viewports);
    const spy = vi.spyOn(document, 'querySelectorAll');
    const find = blockFinder(document);
    const b = find('b');
    expect(b?.dataset.id).toBe('b');
    find('b');
    find('a');
    expect(spy.mock.calls.filter(([s]) => s === '.segments [data-id]')).toHaveLength(1);
    const copy = b?.cloneNode(true) as HTMLElement;
    b?.replaceWith(copy);
    expect(find('b')).toBe(copy);
    expect(spy.mock.calls.filter(([s]) => s === '.segments [data-id]')).toHaveLength(2);
    spy.mockRestore();
  });

  it('an anchor with no block in the panel is ignored', () => {
    const viewports = new ViewportStore();
    mount(viewports);
    expect(scrollToAnchor(document, { id: 'nope', offset: 0 })).toBe(false);
    expect(scrollToAnchor(document, undefined)).toBe(false);
  });
});
