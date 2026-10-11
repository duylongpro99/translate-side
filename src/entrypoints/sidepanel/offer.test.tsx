// @vitest-environment jsdom
// The panel's Translate this page offer (plan M5-E3): shown for a page read after a navigation
// on a site that is not allowlisted, and for a never-translate site, with the original text below.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { App, type TranslatorProps } from './App.tsx';
import type { PanelController, PanelView } from './controller.ts';
import { Jobs } from './jobs.ts';
import { OfferStore } from './offers.ts';

const segments = [{ id: 's1', kind: 'p' as const, text: 'Hello.', inlineMarkup: 'Hello.', domPath: '/p[1]', translate: true }];
const ready: PanelView = { kind: 'ready', docId: 'd1', result: { ok: true, via: 'walk', url: 'https://docs.example.org/two', title: 'Two', segments } };

function mount(offers: OfferStore, actions: Partial<TranslatorProps> = {}) {
  const controller = { view: ready, tabId: 3, subscribe: (fn: (v: PanelView, id: number) => void) => (fn(ready, 3), () => undefined), retry: () => undefined };
  const translator: TranslatorProps = {
    jobs: new Jobs({ translateClient: () => Promise.reject(new Error('unused')) }),
    actions: () => ({}) as never,
    offers,
    ...actions,
  };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  act(() => render(<App controller={controller as unknown as PanelController} translator={translator} />, root));
  return root;
}

describe('Translate this page (plan M5-E3)', () => {
  it('offers both actions above the original text, and follows the store', async () => {
    const offers = new OfferStore();
    const translatePage = vi.fn();
    let grant: (v: boolean) => void = () => {};
    const allowSite = vi.fn(() => new Promise<boolean>((r) => (grant = r)));
    const root = mount(offers, { translatePage, allowSite });
    expect(root.querySelector('[data-testid="offer"]')).toBeNull();
    expect(root.querySelector('[data-testid="panel-ready"]')).not.toBeNull();

    act(() => offers.set(3, { docId: 'd1', url: 'https://docs.example.org/two', reason: 'ask', site: 'docs.example.org' }));
    expect(root.querySelector('[data-testid="offer"]')?.textContent).toContain('Nothing has been sent');
    expect(root.querySelector('.seg')?.textContent).toBe('Hello.');

    act(() => (root.querySelector('[data-testid="translate-page"]') as HTMLButtonElement).click());
    expect(translatePage).toHaveBeenCalledWith(3);

    const allow = root.querySelector('[data-testid="allow-site"]') as HTMLButtonElement;
    expect(allow.textContent).toBe('Always translate docs.example.org');
    act(() => allow.click());
    expect(allowSite).toHaveBeenCalledWith(3);
    await act(async () => grant(false));
    expect(root.querySelector('[data-testid="offer"]')?.textContent).toContain('was not granted');

    act(() => offers.clear(3));
    expect(root.querySelector('[data-testid="offer"]')).toBeNull();
  });

  it('a full allowlist says so', async () => {
    const offers = new OfferStore();
    offers.set(3, { docId: 'd1', url: 'https://docs.example.org/two', reason: 'ask', site: 'docs.example.org' });
    const root = mount(offers, { allowSite: () => Promise.reject(new Error('At most 200 sites per list. Remove a site first.')) });
    await act(async () => (root.querySelector('[data-testid="allow-site"]') as HTMLButtonElement).click());
    expect(root.querySelector('[data-testid="offer"]')?.textContent).toContain('At most 200 sites');
  });

  it('an offer for another document of the tab is not shown', () => {
    const offers = new OfferStore();
    offers.set(3, { docId: 'old', url: 'https://docs.example.org/one', reason: 'ask', site: 'docs.example.org' });
    const root = mount(offers);
    expect(root.querySelector('[data-testid="offer"]')).toBeNull();
  });

  it('a never-translate site says so, with no translate button', () => {
    const offers = new OfferStore();
    offers.set(3, { docId: 'd1', url: 'https://docs.example.org/two', reason: 'never', site: 'docs.example.org' });
    const root = mount(offers);
    const bar = root.querySelector('[data-testid="offer"]');
    expect(bar?.getAttribute('data-reason')).toBe('never');
    expect(bar?.textContent).toContain('You chose never to translate docs.example.org');
    expect(root.querySelector('[data-testid="translate-page"]')).toBeNull();
  });
});
