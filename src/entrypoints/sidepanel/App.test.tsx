// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { App } from './App.tsx';
import type { PanelController, PanelView } from './controller.ts';

function fakeController(view: PanelView) {
  let listener: ((v: PanelView) => void) | undefined;
  const c = {
    view,
    retried: 0,
    subscribe(fn: (v: PanelView) => void) {
      listener = fn;
      fn(c.view);
      return () => undefined;
    },
    retry() {
      c.retried++;
    },
    push(v: PanelView) {
      c.view = v;
      act(() => listener?.(v));
    },
  };
  return c;
}

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

const mount = (view: PanelView) => {
  const c = fakeController(view);
  act(() => render(<App controller={c as unknown as PanelController} />, root));
  return c;
};

const seg = (s: Partial<Segment> & Pick<Segment, 'kind' | 'inlineMarkup'>): Segment => ({
  id: `id-${Math.random().toString(36).slice(2)}`,
  text: s.inlineMarkup,
  domPath: '/x',
  translate: s.kind !== 'code',
  ...s,
});

describe('panel states', () => {
  it.each([
    [{ kind: 'loading' }, 'Reading the page'],
    [{ kind: 'idle' }, 'Press Alt+T'],
    [{ kind: 'blocked', reason: 'restricted' }, "Can't read this page"],
    [{ kind: 'blocked', reason: 'inject-failed', detail: 'Cannot access a chrome:// URL' }, "Can't read this page"],
    [{ kind: 'blocked', reason: 'denylisted' }, 'never reads this site'],
    [{ kind: 'lost' }, 'Press Alt+T or click the toolbar icon'],
    [{ kind: 'empty', url: 'https://x/' }, "Couldn't find the main text"],
    [{ kind: 'error', message: 'boom' }, 'boom'],
  ] as [PanelView, string][])('%o shows "%s"', (view, text) => {
    mount(view);
    expect(root.textContent).toContain(text);
    expect(root.querySelector(`[data-state="${view.kind}"]`)).not.toBeNull();
  });

  it('retries from the error state', () => {
    const c = mount({ kind: 'error', message: 'boom' });
    act(() => (root.querySelector('[data-state=error] button') as HTMLButtonElement).click());
    expect(c.retried).toBe(1);
  });

  it('switches when the controller reports a new view', () => {
    const c = mount({ kind: 'loading' });
    c.push({ kind: 'blocked', reason: 'restricted' });
    expect(root.textContent).toContain("Can't read this page");
  });
});

describe('segments by kind', () => {
  const segments = [
    seg({ kind: 'heading', level: 1, inlineMarkup: 'Title' }),
    seg({ kind: 'p', inlineMarkup: 'See [link]docs[/link] and `npm i` *now*.' }),
    seg({ kind: 'li', inlineMarkup: 'Item' }),
    seg({ kind: 'quote', inlineMarkup: 'Quoted' }),
    seg({ kind: 'code', inlineMarkup: 'fn main() {\n}', codeLang: 'rust' }),
    seg({ kind: 'table-cell', inlineMarkup: 'A', groupId: 'r1' }),
    seg({ kind: 'table-cell', inlineMarkup: 'B', groupId: 'r1' }),
    seg({ kind: 'table-cell', inlineMarkup: 'C', groupId: 'r2' }),
    seg({ kind: 'caption', inlineMarkup: 'Cap' }),
    seg({ kind: 'p', inlineMarkup: 'In a tab', hidden: true }),
    seg({ kind: 'p', inlineMarkup: '<img src=x onerror=alert(1)>' }),
  ];

  it('renders each kind, markers as elements, and tables by row', () => {
    mount({ kind: 'ready', docId: 'd', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments } });
    const kinds = [...root.querySelectorAll('[data-kind]')].map((e) => e.getAttribute('data-kind'));
    expect(kinds).toEqual(['heading', 'p', 'li', 'quote', 'code', 'table-cell', 'table-cell', 'table-cell', 'caption', 'p', 'p']);
    const p = root.querySelector('[data-kind=p]');
    expect(p?.querySelector('.seg__link')?.textContent).toBe('docs');
    expect(p?.querySelector('code')?.textContent).toBe('npm i');
    expect(p?.querySelector('em')?.textContent).toBe('now');
    expect(root.querySelector('[data-kind=code] pre')?.textContent).toBe('fn main() {\n}');
    expect(root.querySelector('[data-kind=code]')?.textContent).toContain('rust · code, kept as is');
    expect([...root.querySelectorAll('.seg-row')].map((r) => r.querySelectorAll('[role=cell]').length)).toEqual([2, 1]);
    expect(root.querySelector('.seg--hidden')?.textContent).toContain('hidden on the page');
    // Page text is never parsed as HTML.
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps two adjacent tables apart, and a list in a cell in its row', () => {
    const cells = [
      seg({ kind: 'table-cell', inlineMarkup: 'A', groupId: 'r1', domPath: '/table[1]/tr[1]/td[1]' }),
      seg({ kind: 'li', inlineMarkup: 'A-item', groupId: 'r1', domPath: '/table[1]/tr[1]/td[2]/ul[1]/li[1]' }),
      seg({ kind: 'table-cell', inlineMarkup: 'B', groupId: 'r2', domPath: '/table[2]/tr[1]/td[1]' }),
      // Readability-created tables have `~table` steps.
      seg({ kind: 'table-cell', inlineMarkup: 'C', groupId: 'r3', domPath: '/div[1]/~table[1]/tr[1]/td[1]' }),
      seg({ kind: 'table-cell', inlineMarkup: 'D', groupId: 'r4', domPath: '/div[1]/~table[2]/tr[1]/td[1]' }),
    ];
    mount({ kind: 'ready', docId: 'd', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments: cells } });
    const tables = [...root.querySelectorAll('.seg-table')];
    expect(tables.map((t) => t.textContent)).toEqual(['AA-item', 'B', 'C', 'D']);
    expect(tables[0]?.querySelectorAll('.seg-row')).toHaveLength(1);
  });

  it('has a dev segment view with ids in dev builds', () => {
    mount({ kind: 'ready', docId: 'doc12345', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments } });
    expect(import.meta.env.DEV).toBe(true);
    act(() => (root.querySelector('.panel__dev') as HTMLButtonElement).click());
    const dev = root.querySelector('[data-testid=dev-view]');
    expect(dev?.querySelectorAll('tbody tr')).toHaveLength(segments.length);
    expect(dev?.textContent).toContain(segments[0]?.id);
  });
});
