// The panel's half of the Alt+T / toolbar toggle (plan M5-E10, src/shared/panel.ts
// togglePanelAndInject): the worker asks, the panel in that window closes itself.
import type { browser } from 'wxt/browser';
import { isClosePanelRequest } from '@/shared/panel';

type Browser = typeof browser;

/**
 * The panel the press opens is created after the press, so a question stamped before the panel
 * existed (plus this slack for clock jitter) is the press that opened it, and is ignored. A
 * second press, which is at least a key-repeat later, closes the panel at once, however slowly
 * the panel loaded. The age is the panel's own creation time, not when its script started.
 */
export const SAME_PRESS_MS = 100;

/** Closes this panel: sidePanel.close (Chrome 141+) for the panel's own window, else the page closes itself. */
export async function closePanel(api: Browser): Promise<void> {
  const win = await api.windows.getCurrent();
  if (typeof api.sidePanel.close === 'function' && win.id !== undefined) await api.sidePanel.close({ windowId: win.id });
  else window.close();
}

/** Answers the worker's "close the panel in this window" for this panel's own window. `bornAt`: when this page was created (ms since the epoch). Returns the unsubscribe. */
export function listenForCloseRequests(api: Browser, close: () => void, bornAt: number = performance.timeOrigin): () => void {
  let windowId: number | undefined;
  void api.windows
    .getCurrent()
    .then((w) => {
      windowId = w.id;
    })
    .catch(() => undefined);
  const onMessage = (message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
    if (!isClosePanelRequest(message) || windowId === undefined || message.windowId !== windowId) return undefined;
    if (typeof message.pressedAt !== 'number' || message.pressedAt < bornAt + SAME_PRESS_MS) return undefined;
    sendResponse({ closed: true });
    setTimeout(close, 0);
    return undefined;
  };
  api.runtime.onMessage.addListener(onMessage as never);
  return () => api.runtime.onMessage.removeListener(onMessage as never);
}
