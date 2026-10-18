// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { READING_KEY } from '@/shared/reading';
import { ReadingPopover } from './ReadingPopover.tsx';

type Api = Parameters<typeof ReadingPopover>[0]['api'];
type Listener = (changes: Record<string, { newValue?: unknown }>) => void;

function fakeApi(stored?: unknown) {
  const sync = new Map<string, unknown>(stored === undefined ? [] : [[READING_KEY, stored]]);
  const listeners = new Set<Listener>();
  const api = {
    storage: {
      sync: {
        get: (k: string) => Promise.resolve(sync.has(k) ? { [k]: structuredClone(sync.get(k)) } : {}),
        set: (o: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(o)) sync.set(k, v);
          listeners.forEach((l) => l(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: v }]))));
          return Promise.resolve();
        },
        onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
      },
    },
  } as unknown as Api;
  return { api, sync };
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 10)));
let root: HTMLDivElement;
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel) as T;

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

describe('ReadingPopover', () => {
  it('opens from Aa as a labelled dialog with the size, typeface, line width and theme', async () => {
    const f = fakeApi({ theme: 'paper', typeface: 'serif', size: 18, width: 'narrow' });
    await act(() => render(<ReadingPopover api={f.api} />, root));
    await settle();
    const trigger = $<HTMLButtonElement>('[data-testid=reading-button]');
    expect(trigger.getAttribute('aria-label')).toBe('Reading');
    await act(() => trigger.click());
    expect($('[role=dialog]').getAttribute('aria-label')).toBe('Reading');
    expect($('[data-testid=reading-size]').textContent).toBe('18');
    const checked = (id: string) => $<HTMLInputElement>(`[data-testid=${id}] input:checked`).value;
    expect([checked('reading-typeface'), checked('reading-width'), checked('reading-theme')]).toEqual(['serif', 'narrow', 'paper']);
  });

  it('writes each change at once to the reading item, never to the preferences', async () => {
    const f = fakeApi();
    f.sync.set('prefs', { targetLang: 'vi' });
    await act(() => render(<ReadingPopover api={f.api} />, root));
    await settle();
    await act(() => $<HTMLButtonElement>('[data-testid=reading-larger]').click());
    await settle();
    expect($('[data-testid=reading-size]').textContent).toBe('17');
    await act(() => $<HTMLInputElement>('[data-testid=reading-theme] input[value=dark]').click());
    await settle();
    await act(() => $<HTMLInputElement>('[data-testid=reading-typeface] input[value=serif]').click());
    await settle();
    expect(f.sync.get(READING_KEY)).toEqual({ theme: 'dark', typeface: 'serif', size: 17, width: 'medium' });
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi' });
  });

  it('stops the size at 13 and 24', async () => {
    const f = fakeApi({ size: 24 });
    await act(() => render(<ReadingPopover api={f.api} />, root));
    await settle();
    // aria-disabled, not disabled: the focused button keeps the focus at the limit.
    expect($('[data-testid=reading-larger]').getAttribute('aria-disabled')).toBe('true');
    expect($('[data-testid=reading-smaller]').getAttribute('aria-disabled')).toBe('false');
    await act(() => $<HTMLButtonElement>('[data-testid=reading-larger]').click());
    await settle();
    expect(f.sync.get(READING_KEY)).toEqual({ size: 24 });
  });

  it('two quick clicks are two steps', async () => {
    const f = fakeApi();
    await act(() => render(<ReadingPopover api={f.api} />, root));
    await settle();
    await act(() => {
      $<HTMLButtonElement>('[data-testid=reading-larger]').click();
      $<HTMLButtonElement>('[data-testid=reading-larger]').click();
    });
    await settle();
    expect((f.sync.get(READING_KEY) as { size: number }).size).toBe(18);
  });

  it('follows a change made elsewhere, cleaned', async () => {
    const f = fakeApi();
    await act(() => render(<ReadingPopover api={f.api} />, root));
    await settle();
    await act(() => f.api.storage.sync.set({ [READING_KEY]: { size: 99, theme: 'neon' } }));
    expect($('[data-testid=reading-size]').textContent).toBe('24');
    expect($<HTMLInputElement>('[data-testid=reading-theme] input:checked').value).toBe('system');
  });
});
