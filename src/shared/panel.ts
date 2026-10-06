// Side panel wiring in the worker (plan M0-E2/E3, decision S5). Features are gated by
// availability checks, not Chrome version (ROADMAP §8 item 18).
import type { browser } from 'wxt/browser';
import { clearAccess, readAccess } from './access.ts';
import { injectInto, type TabRef } from './inject.ts';

export const CONTEXT_MENU_ID = 'translate-side.open-panel';

type Browser = typeof browser;

const logError = (what: string) => (err: unknown) => {
  console.error(`[translate-side] ${what} failed`, err);
};

/**
 * The action must NOT open the panel by itself: with openPanelOnActionClick the panel opens
 * without an activeTab grant and action.onClicked never fires (S5 decision 1). The action
 * handler opens the panel and injects instead.
 */
export async function setupPanelBehavior(api: Browser): Promise<boolean> {
  if (typeof api.sidePanel?.setPanelBehavior !== 'function') {
    console.warn('[translate-side] sidePanel API unavailable');
    return false;
  }
  await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  return true;
}

/**
 * Open the panel for the tab, then inject. sidePanel.open needs the user gesture, so it is the
 * first call, with no await before it (S5). Open-only: a second click keeps the panel open (D11).
 */
export function openPanelAndInject(api: Browser, tab: TabRef | undefined): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return Promise.resolve();
  const opened = api.sidePanel?.open({ tabId }).catch(logError('sidePanel.open'));
  const injected = injectInto(api, tab ?? {}, 'gesture').then(() => undefined, logError('injection'));
  return Promise.all([opened, injected]).then(() => undefined);
}

/** Toolbar icon and Alt+T (_execute_action). Register synchronously at top level. */
export function listenForActionClicks(api: Browser): void {
  api.action.onClicked.addListener((tab) => {
    void openPanelAndInject(api, tab);
  });
}

/** Call from runtime.onInstalled. removeAll() first, so an update doesn't hit a duplicate id. */
export async function createContextMenu(api: Browser): Promise<void> {
  if (!api.contextMenus) return;
  await api.contextMenus.removeAll();
  // Stub entry (M0-E2). Selection translation arrives later.
  api.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Open Translate Side',
    contexts: ['page', 'selection'],
  });
}

/** Call synchronously at the top level of the worker, so it survives worker restarts. */
export function listenForContextMenuClicks(api: Browser): void {
  if (!api.contextMenus) return;
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    // The click is a user gesture and grants activeTab, like the action (S5).
    void openPanelAndInject(api, tab);
  });
}

/**
 * Tab lifecycle: re-inject when a tab we injected into finishes loading (a reload or a
 * navigation, while the activeTab grant lasts; S5), and drop the record when the tab closes.
 * Injection is idempotent, so the extra `complete` events of hash and pushState changes are harmless.
 */
export function listenForTabLifecycle(api: Browser): void {
  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== 'complete') return;
    readAccess(api, tabId)
      .then((access) => (access ? injectInto(api, { id: tabId, url: tab.url }, 'navigation') : undefined))
      .catch(logError('re-injection'));
  });
  api.tabs.onRemoved.addListener((tabId) => {
    clearAccess(api, tabId).catch(logError('clearing tab access'));
  });
}
