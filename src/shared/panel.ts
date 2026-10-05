// Side panel wiring. Features are gated by availability checks, not Chrome version
// (ROADMAP §8 item 18).

import type { browser } from 'wxt/browser';

export const CONTEXT_MENU_ID = 'translate-side.open-panel';

type Browser = typeof browser;

export async function setupPanelBehavior(api: Browser): Promise<boolean> {
  if (typeof api.sidePanel?.setPanelBehavior !== 'function') {
    console.warn('[translate-side] sidePanel API unavailable');
    return false;
  }
  await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  return true;
}

export function setupContextMenu(api: Browser): void {
  if (!api.contextMenus) return;
  // Stub entry (M0-E2). Selection translation arrives later.
  api.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Open Translate Side',
    contexts: ['page', 'selection'],
  });
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || tab?.windowId === undefined) return;
    // The click is a user gesture, so sidePanel.open is allowed here.
    void api.sidePanel?.open({ windowId: tab.windowId });
  });
}
