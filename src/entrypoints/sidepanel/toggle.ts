// The panel's half of the Alt+T / toolbar toggle (plan M5-E10, src/shared/panel.ts
// togglePanelAndInject): the worker asks, the panel in that window closes itself.
import type { browser } from 'wxt/browser';
import { isClosePanelRequest } from '@/shared/panel';

type Browser = typeof browser;

/** A panel younger than this is the one the same click is opening: it does not answer the worker's question. */
export const SETTLE_MS = 1500;

/** Closes this panel: sidePanel.close (Chrome 141+) for the panel's own window, else the page closes itself. */
export async function closePanel(api: Browser): Promise<void> {
  const win = await api.windows.getCurrent();
  if (typeof api.sidePanel.close === 'function' && win.id !== undefined) await api.sidePanel.close({ windowId: win.id });
  else window.close();
}

/** Answers the worker's "close the panel in this window" for this panel's own window. Returns the unsubscribe. */
export function listenForCloseRequests(api: Browser, close: () => void, now: () => number = Date.now): () => void {
  const born = now();
  let windowId: number | undefined;
  void api.windows
    .getCurrent()
    .then((w) => {
      windowId = w.id;
    })
    .catch(() => undefined);
  const onMessage = (message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
    if (!isClosePanelRequest(message) || windowId === undefined || message.windowId !== windowId || now() - born < SETTLE_MS) return undefined;
    sendResponse({ closed: true });
    setTimeout(close, 0);
    return undefined;
  };
  api.runtime.onMessage.addListener(onMessage as never);
  return () => api.runtime.onMessage.removeListener(onMessage as never);
}
