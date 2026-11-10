// The panel's half of the Alt+T / toolbar toggle (plan M5-E10, src/shared/panel.ts
// togglePanelAndInject): the worker asks about a tab, and that tab's panel closes itself.
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

/**
 * Closes this panel. `tabId` is the tab the panel is bound to (its `?tab=` query), never a tab it merely shows.
 * Disabling the tab's panel closes it and keeps it closed when the reader comes back to the tab, until it is
 * opened again (S12); sidePanel.close (Chrome 141+) makes sure. An unbound panel (the window-wide one from
 * before S12, or the page opened by hand) closes for its window. Whatever cannot close it, the page closes itself.
 */
export async function closePanel(api: Browser, tabId: number | undefined): Promise<void> {
  try {
    if (tabId !== undefined) {
      await api.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
      if (typeof api.sidePanel.close === 'function') return await api.sidePanel.close({ tabId });
    } else if (typeof api.sidePanel.close === 'function') {
      const win = await api.windows.getCurrent();
      if (win.id !== undefined) return await api.sidePanel.close({ windowId: win.id });
    }
  } catch {
    // Not a panel Chrome knows as this tab's or this window's (a page in a tab): fall through.
  }
  window.close();
}

/**
 * Answers the worker's "close the panel of this tab" when this panel is bound to that tab (its `?tab=` query).
 * An unbound panel answers nothing: the press then opens that tab's own panel. `bornAt`: when this page was
 * created (ms since the epoch). Returns the unsubscribe.
 */
export function listenForCloseRequests(api: Browser, close: () => void, tabId: number | undefined, bornAt: number = performance.timeOrigin): () => void {
  const onMessage = (message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
    if (!isClosePanelRequest(message)) return undefined;
    if (tabId === undefined || message.tabId !== tabId) return undefined;
    if (typeof message.pressedAt !== 'number' || message.pressedAt < bornAt + SAME_PRESS_MS) return undefined;
    sendResponse({ closed: true });
    setTimeout(close, 0);
    return undefined;
  };
  api.runtime.onMessage.addListener(onMessage as never);
  return () => api.runtime.onMessage.removeListener(onMessage as never);
}
