import { describe, expect, it, vi } from 'vitest';
import { CLOSE_PANEL_MESSAGE } from '@/shared/panel';
import { listenForCloseRequests, SETTLE_MS } from './toggle.ts';

type Api = Parameters<typeof listenForCloseRequests>[0];

function setup(windowId: number | 'none' = 4) {
  let handler: ((m: unknown, s: unknown, send: (r: unknown) => void) => void) | undefined;
  const api = {
    windows: { getCurrent: () => Promise.resolve({ id: windowId === 'none' ? undefined : windowId }) },
    runtime: {
      onMessage: {
        addListener: (fn: typeof handler) => (handler = fn),
        removeListener: () => (handler = undefined),
      },
    },
  } as unknown as Api;
  let t = 0;
  const close = vi.fn();
  const stop = listenForCloseRequests(api, close, () => t);
  const ask = async (message: unknown) => {
    await Promise.resolve();
    const answers: unknown[] = [];
    handler?.(message, {}, (r) => answers.push(r));
    await new Promise((r) => setTimeout(r, 0));
    return answers;
  };
  return { ask, close, advance: (ms: number) => (t += ms), stop, hasHandler: () => handler !== undefined };
}
const request = (windowId: number) => ({ type: CLOSE_PANEL_MESSAGE, windowId });

describe('the panel answering the worker\'s close request', () => {
  it('closes and answers {closed: true} when asked for its own window after it has settled', async () => {
    const s = setup();
    s.advance(SETTLE_MS + 1);
    expect(await s.ask(request(4))).toEqual([{ closed: true }]);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it('stays silent for another window', async () => {
    const s = setup();
    s.advance(SETTLE_MS + 1);
    expect(await s.ask(request(5))).toEqual([]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it('stays silent in its first second: it is the panel the same click is opening', async () => {
    const s = setup();
    s.advance(SETTLE_MS - 1);
    expect(await s.ask(request(4))).toEqual([]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it('ignores other messages, and a request with no window', async () => {
    const s = setup();
    s.advance(SETTLE_MS + 1);
    expect(await s.ask({ type: 'something-else', windowId: 4 })).toEqual([]);
    expect(await s.ask({ type: CLOSE_PANEL_MESSAGE })).toEqual([]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it('does not know its window: answers nothing', async () => {
    const s = setup('none');
    s.advance(SETTLE_MS + 1);
    expect(await s.ask(request(4))).toEqual([]);
  });

  it('unsubscribes', () => {
    const s = setup();
    s.stop();
    expect(s.hasHandler()).toBe(false);
  });
});
