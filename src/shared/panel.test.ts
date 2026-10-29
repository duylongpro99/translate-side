import { describe, expect, it, vi } from 'vitest';
import { accessKey } from './access.ts';
import { CONTENT_SCRIPT_FILE } from './inject.ts';
import {
  CLOSE_PANEL_MESSAGE,
  CONTEXT_MENU_ID,
  createContextMenu,
  listenForActionClicks,
  listenForContextMenuClicks,
  listenForSelectionButton,
  listenForTabLifecycle,
  openPanelAndInject,
  setupPanelBehavior,
} from './panel.ts';
import { SELECTION_BUTTON_MESSAGE, SELECTION_POPUP_PANEL_MESSAGE } from './protocol.ts';

type Api = Parameters<typeof setupPanelBehavior>[0];
type Listener = (...args: never[]) => void;

/** A worker-side fake: sidePanel, scripting and storage.session, logging calls in order. */
function fakeApi(opts: { inject?: () => Promise<unknown>; sync?: Record<string, unknown>; panelAnswer?: () => Promise<unknown> } = {}) {
  const calls: string[] = [];
  const pressedAts: (number | undefined)[] = [];
  const store: Record<string, unknown> = {};
  const sync = opts.sync ?? {};
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
        get: (k: string | null) => Promise.resolve(k === null ? { ...store } : k in store ? { [k]: store[k] } : {}),
        set: (o: Record<string, unknown>) => (Object.assign(store, o), Promise.resolve()),
        remove: (k: string | string[]) => (Array.isArray(k) ? k : [k]).forEach((key) => (store[key] = undefined)) ?? Promise.resolve(),
      },
      sync: { get: (keys: string | string[]) => Promise.resolve(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in sync).map((k) => [k, sync[k]]))) },
      local: { get: () => Promise.resolve({}) },
    },
    runtime: {
      id: 'self',
      getURL: (path: string) => `chrome-extension://self${path}`,
      onMessage: on('message'),
      sendMessage: (m: { type: string; windowId?: number; pressedAt?: number }) => {
        calls.push(`ask:${m.type}:${m.windowId}`);
        pressedAts.push(m.pressedAt);
        return (opts.panelAnswer ?? (() => Promise.reject(new Error('Receiving end does not exist.'))))();
      },
    },
    action: { onClicked: on('action') },
    contextMenus: { onClicked: on('menu') },
    tabs: { onUpdated: on('updated'), onRemoved: on('removed') },
  } as unknown as Api;
  const fire = (name: string, ...args: unknown[]) => listeners[name]?.forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  return { api, calls, pressedAts, store, fire };
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

  it.each(['https://mail.google.com/mail/u/0/', 'https://accounts.google.com/signin', 'https://login.microsoftonline.com/common/oauth2'])('never injects into the denylisted %s', async (url) => {
    const f = fakeApi();
    await openPanelAndInject(f.api, { id: 5, url });
    expect(f.calls).toEqual(['open:5']);
    expect(f.store[accessKey(5)]).toMatchObject({ status: 'blocked', reason: 'denylisted' });
  });

  it('turns an injection failure at gesture time into "blocked"', async () => {
    const f = fakeApi({ inject: () => Promise.reject(new Error('Cannot access contents of the page')) });
    await openPanelAndInject(f.api, { id: 6, url: 'https://example.com/' });
    expect(f.store[accessKey(6)]).toMatchObject({ status: 'blocked', reason: 'inject-failed' });
  });

  it('records what the injection followed: a gesture, or a navigation (plan M5-E3)', async () => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    await openPanelAndInject(f.api, { id: 3, url: 'https://example.com/' });
    expect(f.store[accessKey(3)]).toMatchObject({ status: 'ready', trigger: 'gesture' });
    f.fire('updated', 3, { status: 'complete' }, { url: 'https://example.com/b' });
    await flush();
    await flush();
    expect(f.store[accessKey(3)]).toMatchObject({ status: 'ready', trigger: 'navigation' });
  });

  it("never injects into a site on the user's never-translate list (plan M5-E6, D23), gesture or navigation", async () => {
    const f = fakeApi({ sync: { siteNever: ['*.bank.example'] } });
    listenForTabLifecycle(f.api);
    await openPanelAndInject(f.api, { id: 3, url: 'https://www.bank.example/accounts' });
    expect(f.calls).toEqual(['open:3']);
    expect(f.store[accessKey(3)]).toMatchObject({ status: 'blocked', reason: 'never' });
    f.fire('updated', 3, { status: 'complete' }, { url: 'https://bank.example/' });
    await flush();
    await flush();
    expect(f.calls).toEqual(['open:3']);
    expect(f.store[accessKey(3)]).toMatchObject({ status: 'blocked', reason: 'never', trigger: 'navigation' });
  });

  it('records a repeat injection as ready ("already injected")', async () => {
    const f = fakeApi({ inject: () => Promise.resolve([{ result: 'already' }]) });
    await openPanelAndInject(f.api, { id: 7, url: 'https://example.com/' });
    expect(f.store[accessKey(7)]).toMatchObject({ status: 'ready', detail: 'already injected' });
  });
});

describe('action and context menu', () => {
  it('the action click (toolbar or Alt+T) opens first, asks the panel to close in the same tick, and injects when none did', async () => {
    const f = fakeApi();
    listenForActionClicks(f.api);
    f.fire('action', { id: 9, windowId: 4, url: 'https://example.com/' });
    // Nothing is awaited between the click and the two calls: sidePanel.open keeps the user gesture (S5).
    expect(f.calls).toEqual(['open:9', `ask:${CLOSE_PANEL_MESSAGE}:4`]);
    await flush();
    expect(f.calls).toEqual(['open:9', `ask:${CLOSE_PANEL_MESSAGE}:4`, `inject:9:${CONTENT_SCRIPT_FILE}`]);
  });

  it('stamps the question with the time of the press, so the panel can tell the press that opened it', () => {
    const f = fakeApi();
    listenForActionClicks(f.api);
    const before = Date.now();
    f.fire('action', { id: 9, windowId: 4, url: 'https://example.com/' });
    expect(f.pressedAts[0]).toBeGreaterThanOrEqual(before);
    expect(f.pressedAts[0]).toBeLessThanOrEqual(Date.now());
  });

  it('a click while the panel is open closes it: the panel answers, nothing is injected', async () => {
    const f = fakeApi({ panelAnswer: () => Promise.resolve({ closed: true }) });
    listenForActionClicks(f.api);
    f.fire('action', { id: 9, windowId: 4, url: 'https://example.com/' });
    await flush();
    expect(f.calls.some((c) => c.startsWith('inject'))).toBe(false);
  });

  it('an answer that is not {closed: true} (another window, a panel still starting) opens as usual', async () => {
    const f = fakeApi({ panelAnswer: () => Promise.resolve(undefined) });
    listenForActionClicks(f.api);
    f.fire('action', { id: 9, windowId: 4, url: 'https://example.com/' });
    await flush();
    expect(f.calls.some((c) => c.startsWith('inject'))).toBe(true);
  });

  it('the context menu stays open-only', async () => {
    const f = fakeApi({ panelAnswer: () => Promise.resolve({ closed: true }) });
    await openPanelAndInject(f.api, { id: 9, windowId: 4, url: 'https://example.com/' });
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

  it("a selection from a never-translate site is never kept either (plan M5-E6)", async () => {
    const f = fakeApi({ sync: { siteNever: ['bank.example'] } });
    listenForContextMenuClicks(f.api);
    f.fire('menu', { menuItemId: CONTEXT_MENU_ID, selectionText: 'my balance', pageUrl: 'https://bank.example/a' }, { id: 6, url: 'https://bank.example/a' });
    await flush();
    await flush();
    expect(f.store['snippet:6']).toMatchObject({ blocked: 'never' });
    expect(JSON.stringify(f.store)).not.toContain('my balance');
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

describe('selection button', () => {
  const sender = { id: 'self', frameId: 0, url: 'https://example.com/a', tab: { id: 4, url: 'https://example.com/a' } };

  it('a click opens the panel first, then injects and leaves the text for it, like the context menu, but asks for the selection only', async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: '  Hello there.  ' }, sender);
    // No await before sidePanel.open: the click's gesture came with the message (S9).
    expect(f.calls[0]).toBe('open:4');
    await flush();
    expect(f.calls).toEqual(['open:4', `inject:4:${CONTENT_SCRIPT_FILE}`]);
    expect(f.store['snippet:4']).toMatchObject({ url: 'https://example.com/a', text: 'Hello there.' });
    // It asks for the selection only: the panel offers the page instead of translating it.
    expect(f.store[accessKey(4)]).toMatchObject({ status: 'ready', trigger: 'selection', origin: 'https://example.com' });
  });

  it('keeps the language the page marks the text with; the context menu has none', async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: '猫', lang: 'ja' }, sender);
    await flush();
    expect(f.store['snippet:4']).toMatchObject({ text: '猫', lang: 'ja' });
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: '猫' }, sender);
    await flush();
    expect(f.store['snippet:4']).not.toHaveProperty('lang');
  });

  it.each([
    ['another extension', { ...sender, id: 'other' }],
    ['an extension page (no tab)', { id: 'self', frameId: 0, url: 'chrome-extension://self/x.html' }],
    ['a frame', { ...sender, frameId: 3 }],
  ])('ignores %s', async (_name, from) => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'Hello' }, from);
    await flush();
    expect(f.calls).toEqual([]);
    expect(Object.keys(f.store)).toEqual([]);
  });

  it('ignores other messages and one with no text', async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: CLOSE_PANEL_MESSAGE }, sender);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE }, sender);
    await flush();
    expect(f.calls).toEqual([]);
  });

  it("checks the sender's address, not one in the message: a denylisted page keeps no text", async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    const mail = 'https://mail.google.com/mail/u/0/';
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'my secret mail', url: 'https://example.com/' }, { ...sender, url: mail, tab: { id: 4, url: mail } });
    await flush();
    expect(f.store['snippet:4']).toMatchObject({ blocked: 'denylisted' });
    expect(JSON.stringify(f.store)).not.toContain('my secret mail');
  });

  it('a never-translate site keeps no text either, even when the tab URL is hidden', async () => {
    const f = fakeApi({ sync: { siteNever: ['bank.example'] } });
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'my balance' }, { ...sender, url: 'https://bank.example/a', tab: { id: 4 } });
    await flush();
    await flush();
    expect(f.store['snippet:4']).toMatchObject({ blocked: 'never' });
    expect(JSON.stringify(f.store)).not.toContain('my balance');
    expect(f.calls.some((c) => c.startsWith('inject'))).toBe(false);
  });
});

describe('the selection popup', () => {
  const sender = { id: 'self', frameId: 0, url: 'https://example.com/a', tab: { id: 4, url: 'https://example.com/a' } };
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const popupSender = { id: 'self', frameId: 7, url: `chrome-extension://self/selection-popup.html#${id}`, tab: sender.tab };

  it('a click that opened the popup keeps the text for it, under its id, and leaves the panel closed', async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: ' 猫 ', lang: 'ja', popup: id }, sender);
    await flush();
    expect(f.calls).toEqual([]);
    expect(f.store[`selectionPopup:${id}`]).toMatchObject({ url: 'https://example.com/a', text: '猫', lang: 'ja', tabId: 4 });
    expect(f.store['snippet:4']).toBeUndefined();
  });

  it("checks the sender's address for the popup too: a denylisted page keeps no text", async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    const mail = 'https://mail.google.com/mail/u/0/';
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'my secret mail', popup: id }, { ...sender, url: mail, tab: { id: 4, url: mail } });
    await flush();
    expect(f.store[`selectionPopup:${id}`]).toMatchObject({ blocked: 'denylisted', tabId: 4 });
    expect(JSON.stringify(f.store)).not.toContain('my secret mail');
  });

  it('a popup id that is not one the button makes is not stored under', async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'Hello', popup: 'snippet:9' }, sender);
    await flush();
    expect(Object.keys(f.store).some((k) => k.startsWith('selectionPopup:'))).toBe(false);
  });

  it("Open in side panel injects and hands the popup's selection over to the panel", async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: '猫', lang: 'ja', popup: id }, sender);
    await flush();
    f.fire('message', { type: SELECTION_POPUP_PANEL_MESSAGE, id }, popupSender);
    await flush();
    await flush();
    // The popup opened the panel itself, in its click.
    expect(f.calls).toEqual([`inject:4:${CONTENT_SCRIPT_FILE}`]);
    expect(f.store['snippet:4']).toMatchObject({ url: 'https://example.com/a', text: '猫', lang: 'ja' });
    expect(f.store['snippet:4']).not.toHaveProperty('tabId');
  });

  it("a tab keeps one popup's selection: a new click replaces it, and closing the tab drops it", async () => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    listenForTabLifecycle(f.api);
    const other = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'First', popup: id }, sender);
    await flush();
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'Elsewhere', popup: other }, { ...sender, tab: { id: 5, url: 'https://example.com/a' } });
    await flush();
    const next = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'Second', popup: next }, sender);
    await flush();
    await flush();
    expect(f.store[`selectionPopup:${id}`]).toBeUndefined();
    expect(f.store[`selectionPopup:${next}`]).toMatchObject({ text: 'Second' });
    f.fire('removed', 4);
    await flush();
    expect(f.store[`selectionPopup:${next}`]).toBeUndefined();
    // Another tab's popup is its own.
    expect(f.store[`selectionPopup:${other}`]).toMatchObject({ text: 'Elsewhere', tabId: 5 });
  });

  it.each([
    ['a page', { ...popupSender, url: 'https://example.com/a' }],
    ['another tab', { ...popupSender, tab: { id: 5, url: 'https://example.com/a' } }],
    ['another extension', { ...popupSender, id: 'other' }],
  ])('Open in side panel is not heard from %s', async (_name, from) => {
    const f = fakeApi();
    listenForSelectionButton(f.api);
    f.fire('message', { type: SELECTION_BUTTON_MESSAGE, text: 'Hello', popup: id }, sender);
    await flush();
    f.fire('message', { type: SELECTION_POPUP_PANEL_MESSAGE, id }, from);
    await flush();
    await flush();
    expect(f.calls).toEqual([]);
    expect(f.store['snippet:4']).toBeUndefined();
    expect(f.store['snippet:5']).toBeUndefined();
  });
});

describe('tab lifecycle', () => {
  it('re-injects on load complete only into tabs it injected into before', async () => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    f.fire('updated', 11, { status: 'complete' }, { url: 'https://example.com/' });
    await flush();
    expect(f.calls).toEqual([]);

    f.store[accessKey(12)] = { status: 'ready', origin: 'https://example.com', at: 0 };
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

  it('a gesture records the origin it was granted for, and a same-origin navigation keeps it', async () => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    await openPanelAndInject(f.api, { id: 16, url: 'https://docs.example/a' });
    expect(f.store[accessKey(16)]).toMatchObject({ status: 'ready', origin: 'https://docs.example' });
    f.fire('updated', 16, { status: 'complete' }, { url: 'https://docs.example/b' });
    await flush();
    await flush();
    expect(f.calls.filter((c) => c.startsWith('inject'))).toHaveLength(2);
    expect(f.store[accessKey(16)]).toMatchObject({ status: 'ready', trigger: 'navigation', origin: 'https://docs.example' });
  });

  // With the selection button on every site, Chrome would let the worker inject anywhere (S9): the
  // navigation still follows only what activeTab or the allowlist gave, as without it (S5).
  it('a navigation to another origin is lost even when Chrome would allow the injection, and stays lost', async () => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    f.store[accessKey(17)] = { status: 'ready', origin: 'https://docs.example', at: 0 };
    f.fire('updated', 17, { status: 'complete' }, { url: 'https://news.example/' });
    await flush();
    await flush();
    await flush();
    expect(f.calls).toEqual([]);
    expect(f.store[accessKey(17)]).toMatchObject({ status: 'lost', reason: 'no-grant', origin: 'https://docs.example' });
    // Back on the first origin: activeTab ended at the other origin, so it is not followed either.
    f.fire('updated', 17, { status: 'complete' }, { url: 'https://docs.example/a' });
    await flush();
    await flush();
    await flush();
    expect(f.calls).toEqual([]);
    expect(f.store[accessKey(17)]).toMatchObject({ status: 'lost' });
  });

  it.each([
    ['a gesture on a page that could not be read (a denylisted one)', async (f: ReturnType<typeof fakeApi>) => void (await openPanelAndInject(f.api, { id: 19, url: 'https://mail.google.com/mail/' }))],
    ['an injection the worker never finished', async (f: ReturnType<typeof fakeApi>) => void (f.store[accessKey(19)] = { status: 'injecting', trigger: 'gesture', origin: 'https://docs.example', at: 0 })],
    ['a record with no origin', async (f: ReturnType<typeof fakeApi>) => void (f.store[accessKey(19)] = { status: 'blocked', reason: 'denylisted', at: 0 })],
  ])('after %s, a navigation to another origin is not followed', async (_name, before) => {
    const f = fakeApi();
    listenForTabLifecycle(f.api);
    await before(f);
    f.calls.length = 0;
    f.fire('updated', 19, { status: 'complete' }, { url: 'https://news.example/' });
    await flush();
    await flush();
    await flush();
    expect(f.calls).toEqual([]);
    expect(f.store[accessKey(19)]).toMatchObject({ status: 'lost', reason: 'no-grant' });
  });

  it('a navigation to an allowlisted site is followed: the site has its own grant', async () => {
    const f = fakeApi({ sync: { siteAllowlist: ['news.example'] } });
    listenForTabLifecycle(f.api);
    f.store[accessKey(18)] = { status: 'lost', origin: 'https://docs.example', at: 0 };
    f.fire('updated', 18, { status: 'complete' }, { url: 'https://news.example/' });
    await flush();
    await flush();
    await flush();
    expect(f.calls).toEqual([`inject:18:${CONTENT_SCRIPT_FILE}`]);
    expect(f.store[accessKey(18)]).toMatchObject({ status: 'ready', origin: 'https://news.example' });
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
