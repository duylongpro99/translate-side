// Background wiring (M0-E2). MV3 workers are restarted often, so event listeners must be
// registered synchronously at top level, not inside onInstalled (B3).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

const h = vi.hoisted(() => {
  const state = {
    installed: [] as Listener[],
    clicked: [] as Listener[],
    calls: [] as string[],
    setPanelBehavior: (() => Promise.resolve()) as () => Promise<void>,
  };
  const api = {
    runtime: { onInstalled: { addListener: (fn: Listener) => state.installed.push(fn) } },
    sidePanel: {
      setPanelBehavior: () => state.setPanelBehavior(),
      open: (opts: { windowId: number }) => {
        state.calls.push(`open:${opts.windowId}`);
        return Promise.resolve();
      },
    },
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
  h.state.calls.length = 0;
  h.state.setPanelBehavior = () => Promise.resolve();
});

describe('background', () => {
  it('registers the context-menu click listener at top level, without onInstalled', () => {
    void background.main();
    expect(h.state.clicked).toHaveLength(1);
  });

  it('opens the panel when the menu item is clicked after a worker restart', () => {
    void background.main(); // a restarted worker: onInstalled does not fire
    h.state.clicked[0]?.({ menuItemId: CONTEXT_MENU_ID }, { windowId: 7 });
    expect(h.state.calls).toEqual(['open:7']);
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
