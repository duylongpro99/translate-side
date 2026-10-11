// @vitest-environment jsdom
// Scroll sync both ways and the hover link in the panel (plan M5-E1): by segment id, one report per
// frame, and no scroll passed back and forth.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuard } from '@/shared/guard';
import { panelAnchor, useHoverLink, useScrollFollow, type SendToPage } from './follow.ts';
import { HoverStore } from './hover.ts';
import { ViewportStore } from './viewport.ts';

const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

let root: HTMLElement;
let scrollTo: ReturnType<typeof vi.fn>;
/** Lays the blocks out as a column of 100 px blocks, the page scrolled by `scrollY`, under a 40 px header. */
let scrollY = 0;
function layout() {
  (document.querySelector('.panel__header') as HTMLElement).getBoundingClientRect = () => rect(0, 40);
  document.querySelectorAll<HTMLElement>('.segments [data-id]').forEach((el, i) => {
    el.getBoundingClientRect = () => rect(40 + i * 100 - scrollY, 100);
  });
}

beforeEach(() => {
  scrollY = 0;
  root = document.createElement('div');
  root.innerHTML = '<header class="panel__header"></header><div class="segments">' + ['a', 'b', 'c', 'd'].map((id) => `<p data-id="${id}"><button>x</button></p>`).join('') + '</div>';
  document.body.replaceChildren(root);
  layout();
  scrollTo = vi.fn((o: { top: number }) => {
    scrollY = o.top;
    layout();
  });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('panelAnchor', () => {
  it('names the topmost block below the header and how far into it the panel is', () => {
    expect(panelAnchor(document)).toEqual({ id: 'a', offset: 0 });
    scrollY = 250;
    layout();
    // b is 40+100-250 = -110 → bottom -10; c is -10..90: 50 px of 100 are under the header → 0.5.
    expect(panelAnchor(document)).toEqual({ id: 'c', offset: 0.5 });
    scrollY = 10_000;
    layout();
    expect(panelAnchor(document)).toBeUndefined();
  });
});

describe('scroll sync both ways', () => {
  function Probe({ viewports, send, guard }: { viewports: ViewportStore; send: SendToPage; guard: ReturnType<typeof createGuard> }) {
    useScrollFollow(viewports, 7, 'd', true, send, guard);
    return null;
  }
  const mount = (viewports: ViewportStore, send: SendToPage, guard = createGuard()) => {
    const spare = document.createElement('div');
    document.body.append(spare);
    act(() => render(<Probe viewports={viewports} send={send} guard={guard} />, spare));
    return () => act(() => render(null, spare));
  };
  const scrollPanel = (y: number) => {
    scrollY = y;
    layout();
    window.dispatchEvent(new Event('scroll'));
  };

  it('the reader scrolling the panel tells the page which block and how far, once per frame', async () => {
    const sent: unknown[] = [];
    const unmount = mount(new ViewportStore(), ((_t: number, name: string, body: unknown) => sent.push([name, body])) as SendToPage);
    await frame();
    sent.length = 0;
    scrollPanel(50);
    scrollPanel(120);
    scrollPanel(250);
    await frame();
    expect(sent).toEqual([['scroll', { id: 'c', offset: 0.5 }]]);
    // The same place again is not sent twice.
    scrollPanel(250);
    await frame();
    expect(sent).toHaveLength(1);
    unmount();
  });

  it('the page scrolling moves the panel without the panel echoing it back', async () => {
    const viewports = new ViewportStore();
    const sent: unknown[] = [];
    const unmount = mount(viewports, ((_t: number, name: string, body: unknown) => sent.push([name, body])) as SendToPage);
    await frame();
    viewports.set(7, 'd', { visible: ['c'], anchor: { id: 'c', offset: 0.5 } });
    await frame();
    expect(scrollTo).toHaveBeenCalledWith({ top: 250, behavior: 'instant' });
    // The scroll event of that move arrives: it is the page's, not the reader's.
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(sent).toEqual([]);
    unmount();
  });

  it("an echo of the panel's own scroll, tagged by the page, does not scroll the panel", async () => {
    const viewports = new ViewportStore();
    const unmount = mount(viewports, () => undefined);
    await frame();
    scrollTo.mockClear();
    viewports.set(7, 'd', { visible: ['c'], anchor: { id: 'c', offset: 0.9 }, echo: true });
    await frame();
    expect(scrollTo).not.toHaveBeenCalled();
    unmount();
  });

  it('the reader scrolling on after a follow is told to the page again once the window has passed', async () => {
    let t = 0;
    const guard = createGuard(() => t, 100);
    const viewports = new ViewportStore();
    const sent: unknown[] = [];
    const unmount = mount(viewports, ((_t: number, name: string, body: unknown) => sent.push([name, body])) as SendToPage, guard);
    await frame();
    viewports.set(7, 'd', { visible: ['b'], anchor: { id: 'b', offset: 0 } });
    await frame();
    sent.length = 0;
    // Still inside the window: the scroll is the follow's.
    scrollPanel(130);
    await frame();
    expect(sent).toEqual([]);
    t = 500;
    scrollPanel(250);
    await frame();
    expect(sent).toEqual([['scroll', { id: 'c', offset: 0.5 }]]);
    unmount();
  });

  it('a long run of alternating scrolls settles: no command is sent for a scroll the other side caused', async () => {
    const viewports = new ViewportStore();
    const sent: { id: string }[] = [];
    const unmount = mount(viewports, ((_t: number, _n: string, body: { id: string }) => sent.push(body)) as SendToPage);
    await frame();
    for (let i = 0; i < 20; i++) {
      viewports.set(7, 'd', { visible: ['b'], anchor: { id: i % 2 ? 'b' : 'c', offset: 0.1 * (i % 5) } });
      await frame();
      // Each follow's own scroll event.
      window.dispatchEvent(new Event('scroll'));
      await frame();
    }
    expect(sent).toEqual([]);
    unmount();
  });
});

describe('hover link', () => {
  function Probe({ hovers, send }: { hovers: HoverStore; send: SendToPage }) {
    useHoverLink(hovers, 7, 'd', send, true);
    return null;
  }
  const mount = (hovers: HoverStore, send: SendToPage) => {
    const spare = document.createElement('div');
    document.body.append(spare);
    act(() => render(<Probe hovers={hovers} send={send} />, spare));
    return () => act(() => render(null, spare));
  };
  const block = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`) as HTMLElement;

  it('the page block under the pointer is marked in the panel, and the mark moves and clears', () => {
    const hovers = new HoverStore();
    const unmount = mount(hovers, () => undefined);
    act(() => hovers.set(7, 'd', 'b'));
    expect(block('b').classList.contains('seg--linked')).toBe(true);
    act(() => hovers.set(7, 'd', 'c'));
    expect(block('b').classList.contains('seg--linked')).toBe(false);
    expect(block('c').classList.contains('seg--linked')).toBe(true);
    act(() => hovers.set(7, 'd', undefined));
    expect(document.querySelector('.seg--linked')).toBeNull();
    // Another tab's hover is not shown.
    act(() => hovers.set(8, 'd', 'a'));
    expect(document.querySelector('.seg--linked')).toBeNull();
    unmount();
  });

  it('the panel block under the pointer (or focus) is highlighted on the page, once per change', () => {
    const sent: unknown[] = [];
    const unmount = mount(new HoverStore(), ((_t: number, name: string, body: unknown) => sent.push([name, body])) as SendToPage);
    const over = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    over(block('b').querySelector('button') as Element);
    over(block('b'));
    over(block('c'));
    block('c').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(sent).toEqual([
      ['highlight', { id: 'b' }],
      ['highlight', { id: 'c' }],
      ['highlight', {}],
    ]);
    unmount();
    expect(sent).toHaveLength(3);
  });

  it('is cleared on the page when the panel stops linking', () => {
    const sent: unknown[] = [];
    const unmount = mount(new HoverStore(), ((_t: number, name: string, body: unknown) => sent.push([name, body])) as SendToPage);
    block('a').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    unmount();
    expect(sent.at(-1)).toEqual(['highlight', {}]);
  });
});
