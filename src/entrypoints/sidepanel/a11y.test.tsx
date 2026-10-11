// @vitest-environment jsdom
// Keyboard and screen-reader use of the segment list (plan M5-E10).
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/index';
import type { SegState } from './jobs.ts';
import { SegmentList } from './SegmentList.tsx';

const seg = (id: string, kind: Segment['kind'], text: string): Segment => ({ id, kind, text, inlineMarkup: text, domPath: `/x[${id}]`, translate: kind !== 'code' });
const segments: Segment[] = [seg('a', 'heading', 'Title here'), seg('b', 'p', 'First paragraph text'), seg('c', 'li', 'One'), seg('d', 'li', 'Two'), seg('e', 'code', 'let x = 1;'), seg('f', 'p', 'Last paragraph')];
const states = new Map<string, SegState>(
  segments
    .filter((s) => s.translate)
    .map((s): [string, SegState] => [s.id, s.id === 'f' ? { status: 'streaming', text: 'Dang' } : { status: 'final', text: `VI ${s.text}`, revision: 1 }]),
);

let root: HTMLDivElement;
const actions = { retry: vi.fn(), retranslate: vi.fn(), explain: vi.fn() };
const draw = async (props: Partial<Parameters<typeof SegmentList>[0]> = {}) => {
  await act(() => render(<SegmentList segments={segments} states={states} actions={actions} targetLang="vi" sourceLang="en" {...props} />, root));
};
const block = (id: string) => root.querySelector<HTMLElement>(`[data-id="${id}"]`) as HTMLElement;
const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  await act(() => void el.dispatchEvent(e));
  return e;
};
const focus = async (el: HTMLElement) => {
  await act(() => el.focus());
  await act(() => void el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
};

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  Object.values(actions).forEach((f) => f.mockClear());
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollBy = (() => undefined) as never;
});

describe('segment list a11y', () => {
  it('is a labelled region, busy while the job runs, with list items in a list', async () => {
    await draw({ busy: true });
    const region = root.querySelector('.segments');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBe('Translation');
    expect(region?.getAttribute('aria-busy')).toBe('true');
    const list = root.querySelector('[role="list"]');
    expect([...(list?.querySelectorAll('[role="listitem"]') ?? [])].map((e) => (e as HTMLElement).dataset.id)).toEqual(['c', 'd']);
    expect(block('f').getAttribute('aria-busy')).toBe('true');
    expect(block('b').hasAttribute('aria-busy')).toBe(false);
  });

  it('marks the translation with the target language and the shown original with the source', async () => {
    await draw();
    expect(block('b').querySelector('[lang="vi"]')?.textContent).toBe('VI First paragraph text');
    await act(() => block('b').querySelector<HTMLButtonElement>('[data-testid="seg-original"]')?.click());
    expect(block('b').querySelector('[data-testid="seg-original-text"]')?.getAttribute('lang')).toBe('en');
    expect(block('e').querySelector('[lang]')).toBeNull(); // code: no language
  });

  it('has one Tab stop for the list, and only the active block\'s buttons are tabbable', async () => {
    await draw();
    const stops = [...root.querySelectorAll<HTMLElement>('[data-id], button')].filter((e) => e.tabIndex === 0);
    expect(stops.map((e) => e.dataset.id ?? e.getAttribute('data-testid'))).toEqual(['a', 'seg-original', 'seg-retranslate', 'seg-explain', 'seg-copy']);
    await focus(block('b'));
    const after = [...root.querySelectorAll<HTMLElement>('[data-id], button')].filter((e) => e.tabIndex === 0).map((e) => e.dataset.id ?? e.getAttribute('data-testid'));
    expect(after).toEqual(['b', 'seg-original', 'seg-retranslate', 'seg-explain', 'seg-copy']);
  });

  it('moves between blocks with the arrows, J/K, Home and End', async () => {
    await draw();
    await focus(block('a'));
    await key(block('a'), 'ArrowDown');
    expect(document.activeElement).toBe(block('b'));
    await key(block('b'), 'j');
    expect(document.activeElement).toBe(block('c'));
    await key(block('c'), 'k');
    expect(document.activeElement).toBe(block('b'));
    await key(block('b'), 'End');
    expect(document.activeElement).toBe(block('f'));
    await key(block('f'), 'ArrowDown');
    expect(document.activeElement).toBe(block('f'));
    await key(block('f'), 'Home');
    expect(document.activeElement).toBe(block('a'));
  });

  it('runs a block\'s actions from the keyboard', async () => {
    await draw();
    await focus(block('b'));
    await key(block('b'), 'r');
    expect(actions.retranslate).toHaveBeenCalledWith('b');
    await key(block('b'), 'e');
    expect(actions.explain).toHaveBeenCalledWith('b');
    await key(block('b'), 'o');
    expect(block('b').querySelector('[data-testid="seg-original-text"]')).toBeTruthy();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await key(block('b'), 'c');
    expect(writeText).toHaveBeenCalledWith('VI First paragraph text');
  });

  it('leaves keys with a modifier, and a block with no such action, alone', async () => {
    await draw();
    await focus(block('b'));
    expect((await key(block('b'), 'r', { ctrlKey: true })).defaultPrevented).toBe(false);
    expect((await key(block('b'), 'r', { altKey: true })).defaultPrevented).toBe(false);
    expect((await key(block('b'), 'r', { metaKey: true })).defaultPrevented).toBe(false);
    expect(actions.retranslate).not.toHaveBeenCalled();
    await focus(block('e'));
    expect((await key(block('e'), 'r')).defaultPrevented).toBe(false); // code: Copy only
    await key(block('e'), 'x');
    expect(actions.retranslate).not.toHaveBeenCalled();
  });

  it('every action button names its key (aria-keyshortcuts)', async () => {
    await draw();
    const keys = [...block('b').querySelectorAll('button')].map((b) => b.getAttribute('aria-keyshortcuts'));
    expect(keys).toEqual(['O', 'R', 'E', 'C']);
  });
});
