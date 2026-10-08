import { describe, expect, it, vi } from 'vitest';
import { accessKey } from './access.ts';
import { CONTENT_SCRIPT_FILE } from './inject.ts';
import {
  CONTEXT_MENU_ID,
  createContextMenu,
  listenForActionClicks,
  listenForContextMenuClicks,
  listenForTabLifecycle,
  openPanelAndInject,
  setupPanelBehavior,
} from './panel.ts';

type Api = Parameters<typeof setupPanelBehavior>[0];
type Listener = (...args: never[]) => void;

/** A worker-side fake: sidePanel, scripting and storage.session, logging calls in order. */
function fakeApi(opts: { inject?: () => Promise<unknown> } = {}) {
  const calls: string[] = [];
  const store: Record<string, unknown> = {};
  const listeners: Record<string, Listener[]> = {};
  const on = (name: string) => ({ addListener: (fn: Listener) => (listeners[name] ??= []).push(fn) });
  const api = {
    sidePanel: {
      open: (o: { tabId: number }) => (calls.push(`open:${o.tabId}`), Promise.resolve()),
    },
    scripting: {
      executeScript: (o: { target: { tabId: number }; files: string[] }) => {
        calls.push(`inject:${o.target.tabId}:${o.files.join()}`);
        return (opts.inject ?? (() => Promise.resolve([{ result: 'injected' }])))();
      },
    },
    storage: {
      session: {
        get: (k: string) => Promise.resolve(k in store ? { [k]: store[k] } : {}),
        set: (o: Record<string, unknown>) => (Object.assign(store, o), Promise.resolve()),
        remove: (k: string) => ((store[k] = undefined), Promise.resolve()),
      },
    },
    action: { onClicked: on('action') },
    contextMenus: { onClicked: on('menu') },
    tabs: { onUpdated: on('updated'), onRemoved: on('removed') },
  } as unknown as Api;
  const fire = (name: string, ...args: unknown[]) => listeners[name]?.forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  return { api, calls, store, fire };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('setupPanelBehavior', () => {
  it('does not let the action open the panel by itself (decision S5)', async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    const api = { sidePanel: { setPanelBehavior } } as unknown as Api;
    expect(await setupPanelBehavior(api)).toBe(true);
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
  });

  it('is gated by availability, not version', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await setupPanelBehavior({} as Api)).toBe(false);
  });
});

describe('openPanelAndInject', () => {
  it('opens the panel first, synchronously, then injects and records access', async () => {
    const f = fakeApi();
    const done = openPanelAndInject(f.api, { id: 3, url: 'https://example.com/' });
    // sidePanel.open must run inside the gesture: before any await.
    expect(f.calls[0]).toBe('open:3');
    await done;
    expect(f.calls).toEqual(['open:3', `inject:3:${CONTENT_SCRIPT_FILE}`]);
    expect(f.store[accessKey(3)]).toMatchObject({ status: 'ready' });
  });

  it('reports "can\'t read this page" for chrome:// and Web Store pages without injecting', async () => {
    for (const url of ['chrome://extensions/', 'https://chromewebstore.google.com/detail/x']) {
      const f = fakeApi();
      await openPanelAndInject(f.api, { id: 4, url });
      expect(f.calls).toEqual(['open:4']);
      expect(f.store[accessKey(4)]).toMatchObject({ status: 'blocked', reason: 'restricted' });
    }
  });

  it('never injects into a denylisted origin', async () => {
    const f = fakeApi();
    await openPanelAndInject(f.api, { id: 5, url: 'https://mail.google.com/mail/u/0/' });
    expect(f.calls).toEqual(['open:5']);
    expect(f.store[accessKey(5)]).toMatchObject({ status: 'blocked', reason: 'denylisted' });
  });

  it('turns an injection failure at gesture time into "blocked"', async () => {
    const f = fakeApi({ inject: () => Promise.reject(new Error('Cannot access contents of the page')) });
    await openPanelAndInject(f.api, { id: 6, url: 'https://example.com/' });
    expect(f.store[accessKey(6)]).toMatchObject({ status: 'blocked', reason: 'inject-failed' });
  });

  it('records a repeat injection as ready ("already injected")', async () => {
    const f = fakeApi({ inject: () => Promise.resolve([{ result: 'already' }]) });
    await openPanelAndInject(f.api, { id: 7, url: 'https://example.com/' });
    expect(f.store[accessKey(7)]).toMatchObject({ status: 'ready', detail: 'already injected' });
  });
});

describe('action and context menu', () => {
  it('the action click (toolbar or Alt+T) opens and injects', async () => {
    const f = fakeApi();
    listenForActionClicks(f.api);
    f.fire('action', { id: 9, url: 'https://example.com/' });
    await flush();
    expect(f.calls).toEqual(['open:9', `inject:9:${CONTENT_SCRIPT_FILE}`]);
  });

  it('removes old menu entries before creating the stub entry', async () => {
    const calls: string[] = [];
    const api = {
      contextMenus: {
        removeAll: () => (calls.push('removeAll'), Promise.resolve()),
        create: (o: { id: string }) => calls.push(`create:${o.id}`),
      },
    } as unknown as Api;
    await createContextMenu(api);
    expect(calls).toEqual(['removeAll', `create:${CONTEXT_MENU_ID}`]);
  });

  it('the menu item opens the panel for its tab and injects, and ignores other items', async () => {
    const f = fakeApi();
    listenForContextMenuClicks(f.api);
    f.fire('menu', { menuItemId: 'other' }, { id: 1, url: 'https://example.com/' });
    await flush();
    expect(f.calls).toEqual([]);
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID }, { id: 2, url: 'https://example.com/' });
    await flush();
    expect(f.calls).toEqual(['open:2', `inject:2:${CONTENT_SCRIPT_FILE}`]);
  });
});

describe('selection hand-over (plan M3-E4)', () => {
  it('the menu is named for what it does', async () => {
    const created: { title: string }[] = [];
    const api = { contextMenus: { removeAll: () => Promise.resolve(), create: (o: { title: string }) => created.push(o) } } as unknown as Api;
    await createContextMenu(api);
    expect(created.map((c) => c.title)).toEqual(['Translate in side panel']);
  });

  it('a click on a selection opens the panel first and leaves the text for it, with the page it came from', async () => {
    const f = fakeApi();
    listenForContextMenuClicks(f.api);
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID, selectionText: '  Hello there.  ', pageUrl: 'https://example.com/a' }, { id: 4, url: 'https://example.com/a' });
    await flush();
    expect(f.calls[0]).toBe('open:4');
    expect(f.store['snippet:4']).toMatchObject({ url: 'https://example.com/a', text: 'Hello there.' });
    expect(f.store['snippet:4']).not.toHaveProperty('blocked');
  });

  it('works where nothing can be injected: the selection does not depend on the injection', async () => {
    const f = fakeApi({ inject: () => Promise.reject(new Error('Cannot access contents of the page')) });
    listenForContextMenuClicks(f.api);
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID, selectionText: 'text', pageUrl: 'https://example.com/' }, { id: 4, url: 'https://example.com/' });
    await flush();
    expect(f.store['snippet:4']).toMatchObject({ text: 'text' });
  });

  it('no selection: only the panel opens, no record', async () => {
    const f = fakeApi();
    listenForContextMenuClicks(f.api);
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID, pageUrl: 'https://example.com/' }, { id: 4, url: 'https://example.com/' });
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID, selectionText: '   ', pageUrl: 'https://example.com/' }, { id: 4, url: 'https://example.com/' });
    await flush();
    expect(Object.keys(f.store).filter((k) => k.startsWith('snippet:'))).toEqual([]);
  });

  it.each([
    ['the tab', { id: 6, url: 'https://mail.google.com/mail/u/0/' }, { pageUrl: 'https://mail.google.com/mail/u/0/' }],
    ['the page', { id: 6, url: 'https://example.com/' }, { pageUrl: 'https://login.microsoftonline.com/x' }],
    ['a frame in an ordinary page', { id: 6, url: 'https://example.com/' }, { pageUrl: 'https://example.com/', frameUrl: 'https://accounts.google.com/signin' }],
  ])('a selection from a denylisted site (%s) is never kept: the record says blocked and holds no text', async (_, tab, info) => {
    const f = fakeApi();
    listenForContextMenuClicks(f.api);
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID, selectionText: 'my secret mail', ...info }, tab);
    await flush();
    expect(f.store['snippet:6']).toMatchObject({ blocked: 'denylisted' });
    expect(JSON.stringify(f.store)).not.toContain('my secret mail');
  });

  it('the record goes when its tab closes', async () => {
    const f = fakeApi();
    listenForContextMenuClicks(f.api);
    listenForTabLifecycle(f.api);
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID, selectionText: 'x', pageUrl: 'https://example.com/' }, { id: 8, url: 'https://example.com/' });
    await flush();
    expect(f.store['snippet:8']).toBeDefined();
    f.fire('removed', 8);
    await flush();
    expect(f.store['snippet:8']).toBeUndefined();
  });
});

describe('tab lifecycle', () => {
  it('re-injects on load complete only into tabs it injected into before', async () => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    f.fire('updated', 11, { status: 'complete' }, { url: 'https://example.com/' });
    await flush();
    expect(f.calls).toEqual([]);

    f.store[accessKey(12)] = { status: 'ready', at: 0 };
    f.fire('updated', 12, { status: 'loading' }, { url: 'https://example.com/a' });
    f.fire('updated', 12, { status: 'complete' }, { url: 'https://example.com/a' });
    await flush();
    await flush();
    expect(f.calls).toEqual([`inject:12:${CONTENT_SCRIPT_FILE}`]);
    expect(f.store[accessKey(12)]).toMatchObject({ status: 'ready' });
  });

  it('marks access lost when the URL is hidden after a navigation (grant gone)', async () => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    f.store[accessKey(13)] = { status: 'ready', at: 0 };
    f.fire('updated', 13, { status: 'complete' }, {});
    await flush();
    await flush();
    expect(f.calls).toEqual([]);
    expect(f.store[accessKey(13)]).toMatchObject({ status: 'lost', reason: 'no-grant' });
  });

  it('marks access lost when re-injection fails after a navigation', async () => {
    const f = fakeApi({ inject: () => Promise.reject(new Error('Cannot access contents of the page')) });
    listenForTabLifecycle(f.api);
    f.store[accessKey(14)] = { status: 'ready', at: 0 };
    f.fire('updated', 14, { status: 'complete' }, { url: 'https://other.example/' });
    await flush();
    await flush();
    expect(f.store[accessKey(14)]).toMatchObject({ status: 'lost', reason: 'no-grant' });
  });

  it('drops the record when the tab closes', async () => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    f.store[accessKey(15)] = { status: 'ready', at: 0 };
    f.fire('removed', 15);
    await flush();
    expect(f.store[accessKey(15)]).toBeUndefined();
  });
});
