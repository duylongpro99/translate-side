// Background wiring (M0-E2/E3). MV3 workers are restarted often, so event listeners must be
// registered synchronously at top level, not inside onInstalled (B3).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

const h = vi.hoisted(() => {
  const state = {
    installed: [] as Listener[],
    clicked: [] as Listener[],
    action: [] as Listener[],
    tabListeners: 0,
    calls: [] as string[],
    setPanelBehavior: (() => Promise.resolve()) as () => Promise<void>,
  };
  const api = {
    runtime: { onInstalled: { addListener: (fn: Listener) => state.installed.push(fn) } },
    sidePanel: {
      setPanelBehavior: () => state.setPanelBehavior(),
      open: (opts: { tabId: number }) => {
        state.calls.push(`open:${opts.tabId}`);
        return Promise.resolve();
      },
    },
    action: { onClicked: { addListener: (fn: Listener) => state.action.push(fn) } },
    tabs: {
      onUpdated: { addListener: () => state.tabListeners++ },
      onRemoved: { addListener: () => state.tabListeners++ },
    },
    scripting: {
      executeScript: (opts: { target: { tabId: number } }) => {
        state.calls.push(`inject:${opts.target.tabId}`);
        return Promise.resolve([{ result: 'injected' }]);
      },
    },
    storage: { session: { set: () => Promise.resolve() } },
    contextMenus: {
      removeAll: () => {
        state.calls.push('removeAll');
        return Promise.resolve();
      },
      create: (opts: { id: string }) => {
        state.calls.push(`create:${opts.id}`);
      },
      onClicked: { addListener: (fn: Listener) => state.clicked.push(fn) },
    },
  };
  return { state, api };
});

vi.mock('wxt/browser', () => ({ browser: h.api }));

const { default: background } = await import('../src/entrypoints/background.ts');
const { CONTEXT_MENU_ID } = await import('../src/shared/panel.ts');

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.state.installed.length = 0;
  h.state.clicked.length = 0;
  h.state.action.length = 0;
  h.state.tabListeners = 0;
  h.state.calls.length = 0;
  h.state.setPanelBehavior = () => Promise.resolve();
});

describe('background', () => {
  it('registers action, context-menu and tab listeners at top level, without onInstalled', () => {
    void background.main();
    expect(h.state.clicked).toHaveLength(1);
    expect(h.state.action).toHaveLength(1);
    expect(h.state.tabListeners).toBe(2);
  });

  it('opens the panel and injects when the menu item is clicked after a worker restart', async () => {
    void background.main(); // a restarted worker: onInstalled does not fire
    h.state.clicked[0]?.({ menuItemId: CONTEXT_MENU_ID }, { id: 7, url: 'https://example.com/' });
    await flush();
    expect(h.state.calls).toEqual(['open:7', 'inject:7']);
  });

  it('opens the panel and injects on the action (toolbar icon or Alt+T)', async () => {
    void background.main();
    h.state.action[0]?.({ id: 8, url: 'https://example.com/' });
    await flush();
    expect(h.state.calls).toEqual(['open:8', 'inject:8']);
  });

  it('recreates the menu on install/update without duplicate ids', async () => {
    void background.main();
    h.state.installed[0]?.({ reason: 'update' });
    await flush();
    expect(h.state.calls).toEqual(['removeAll', `create:${CONTEXT_MENU_ID}`]);
  });

  it('handles a setPanelBehavior failure instead of leaving it unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.state.setPanelBehavior = () => Promise.reject(new Error('boom'));
    void background.main();
    await flush();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
