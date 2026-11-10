import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_PANEL_MESSAGE } from '@/shared/panel';
import { closePanel, listenForCloseRequests, SAME_PRESS_MS } from './toggle.ts';

type Api = Parameters<typeof listenForCloseRequests>[0];

function setup(tabId: number | 'none' = 4) {
  let handler: ((m: unknown, s: unknown, send: (r: unknown) => void) => void) | undefined;
  const api = {
    runtime: {
      onMessage: {
        addListener: (fn: typeof handler) => (handler = fn),
        removeListener: () => (handler = undefined),
      },
    },
  } as unknown as Api;
  const bornAt = 10_000;
  const close = vi.fn();
  const stop = listenForCloseRequests(api, close, tabId === 'none' ? undefined : tabId, bornAt);
  const ask = async (message: unknown) => {
    await Promise.resolve();
    const answers: unknown[] = [];
    handler?.(message, {}, (r) => answers.push(r));
    await new Promise((r) => setTimeout(r, 0));
    return answers;
  };
  return { ask, close, stop, hasHandler: () => handler !== undefined };
}
const request = (tabId: number, pressedAt = 10_000 + SAME_PRESS_MS + 1) => ({ type: CLOSE_PANEL_MESSAGE, tabId, pressedAt });

describe('the panel answering the worker\'s close request', () => {
  it('closes and answers {closed: true} when asked for its own tab for a press made after it was created', async () => {
    const s = setup();
    expect(await s.ask(request(4))).toEqual([{ closed: true }]);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it("stays silent for another tab, even in its own window: that tab's panel is not this one", async () => {
    const s = setup();
    expect(await s.ask(request(5))).toEqual([]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it('stays silent for the press that opened it (stamped before the panel existed)', async () => {
    const s = setup();
    expect(await s.ask(request(4, 10_000 - 5))).toEqual([]);
    expect(await s.ask(request(4, 10_000 + SAME_PRESS_MS - 1))).toEqual([]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it('ignores other messages, and a request with no tab', async () => {
    const s = setup();
    expect(await s.ask({ type: 'something-else', tabId: 4 })).toEqual([]);
    expect(await s.ask({ type: CLOSE_PANEL_MESSAGE })).toEqual([]);
    expect(await s.ask({ type: CLOSE_PANEL_MESSAGE, tabId: 4 })).toEqual([]);
    expect(await s.ask({ type: CLOSE_PANEL_MESSAGE, windowId: 4, pressedAt: 10_000 + SAME_PRESS_MS + 1 })).toEqual([]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it('an unbound panel answers nothing: the press opens that tab\'s own panel instead', async () => {
    const s = setup('none');
    expect(await s.ask(request(4))).toEqual([]);
  });

  it('closes for a second press a moment after it opened, however late its script started', async () => {
    const s = setup();
    expect(await s.ask(request(4, 10_000 + 400))).toEqual([{ closed: true }]);
  });

  it('unsubscribes', () => {
    const s = setup();
    s.stop();
    expect(s.hasHandler()).toBe(false);
  });
});

describe('closePanel', () => {
  let windowClose: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    windowClose = vi.fn();
    vi.stubGlobal('window', { close: windowClose });
  });
  afterEach(() => vi.unstubAllGlobals());

  const fake = (opts: { close?: 'ok' | 'fails'; windowId?: number } = {}) => {
    const calls: string[] = [];
    const api = {
      windows: { getCurrent: () => Promise.resolve({ id: opts.windowId }) },
      sidePanel: {
        setOptions: (o: { tabId: number; enabled: boolean }) => (calls.push(`options:${o.tabId}:${o.enabled}`), Promise.resolve()),
        ...(opts.close
          ? {
              close: (o: { tabId?: number; windowId?: number }) => {
                calls.push(o.tabId === undefined ? `close-window:${o.windowId}` : `close:${o.tabId}`);
                return opts.close === 'ok' ? Promise.resolve() : Promise.reject(new Error('No active side panel'));
              },
            }
          : {}),
      },
    } as unknown as Api;
    return { api, calls };
  };

  it("disables its tab's panel, so it stays closed on that tab, then closes it (S12)", async () => {
    const f = fake({ close: 'ok' });
    await closePanel(f.api, 7);
    expect(f.calls).toEqual(['options:7:false', 'close:7']);
    expect(windowClose).not.toHaveBeenCalled();
  });

  it('closes the page itself when sidePanel.close is missing or cannot close it (a panel page in a tab)', async () => {
    const without = fake();
    await closePanel(without.api, 7);
    expect(without.calls).toEqual(['options:7:false']);
    const failing = fake({ close: 'fails' });
    await closePanel(failing.api, 7);
    expect(failing.calls).toEqual(['options:7:false', 'close:7']);
    expect(windowClose).toHaveBeenCalledTimes(2);
  });

  it("an unbound panel closes for its window and touches no tab's options", async () => {
    const f = fake({ close: 'ok', windowId: 3 });
    await closePanel(f.api, undefined);
    expect(f.calls).toEqual(['close-window:3']);
    expect(windowClose).not.toHaveBeenCalled();
    await closePanel(fake().api, undefined);
    expect(windowClose).toHaveBeenCalledTimes(1);
  });
});
