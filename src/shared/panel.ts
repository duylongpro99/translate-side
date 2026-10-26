// Side panel wiring in the worker (plan M0-E2/E3, decision S5). Features are gated by
// availability checks, not Chrome version (ROADMAP §8 item 18).
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { clearAccess, readAccess } from './access.ts';
import { injectInto, type InjectTrigger, type TabRef } from './inject.ts';
import { isSelectionButtonRequest } from './protocol.ts';
import { clearTabOverride } from './providers.ts';
import { anyDenylisted, clearSnippet, MAX_SELECTION_CHARS, writeSnippet } from './snippet.ts';
import { readSiteLists, listedFor } from './sites.ts';

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
 * first call, with no await before it (S5). Open-only: a second click keeps the panel open (the context menu; the action toggles, togglePanelAndInject).
 */
export function openPanelAndInject(api: Browser, tab: TabRef | undefined, trigger: InjectTrigger = 'gesture'): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return Promise.resolve();
  const opened = api.sidePanel?.open({ tabId }).catch(logError('sidePanel.open'));
  const injected = injectInto(api, tab ?? {}, trigger).then(() => undefined, logError('injection'));
  return Promise.all([opened, injected]).then(() => undefined);
}

/** The worker's question to the panels: "is yours in this window? then close". */
export const CLOSE_PANEL_MESSAGE = 'translate-side:close-panel';

export interface ClosePanelRequest {
  type: typeof CLOSE_PANEL_MESSAGE;
  windowId: number | undefined;
  /** When the worker saw the press (ms since the epoch): the panel the same press opens was created after it. */
  pressedAt: number;
}

export const isClosePanelRequest = (m: unknown): m is ClosePanelRequest => typeof m === 'object' && m !== null && (m as { type?: unknown }).type === CLOSE_PANEL_MESSAGE;

/**
 * Toolbar icon and Alt+T (M5-E10): opens the panel, or closes it when it is open in the tab's
 * window. `sidePanel.open` needs the user gesture, so it is still the first call with no await
 * before it (S5); the question "is a panel open here?" is sent in the same tick, ahead of the
 * panel the open creates (which ignores a question asked before it was created, see sidepanel/toggle.ts).
 * A panel that is open closes itself (sidePanel.close from Chrome 141, else window.close), so no
 * Chrome version gate is needed. A panel that closed is not injected into.
 */
export function togglePanelAndInject(api: Browser, tab: TabRef | undefined): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return Promise.resolve();
  const opened = api.sidePanel?.open({ tabId }).catch(logError('sidePanel.open'));
  const request: ClosePanelRequest = { type: CLOSE_PANEL_MESSAGE, windowId: tab?.windowId, pressedAt: Date.now() };
  const closed = api.runtime.sendMessage(request).then(
    (answer: unknown) => typeof answer === 'object' && answer !== null && (answer as { closed?: unknown }).closed === true,
    () => false,
  );
  return Promise.all([opened, closed]).then(async ([, wasOpen]) => {
    if (wasOpen) return;
    await injectInto(api, tab ?? {}, 'gesture').then(() => undefined, logError('injection'));
  });
}

/** Toolbar icon and Alt+T (_execute_action). Register synchronously at top level. */
export function listenForActionClicks(api: Browser): void {
  api.action.onClicked.addListener((tab) => {
    void togglePanelAndInject(api, tab);
  });
}

/** Call from runtime.onInstalled. removeAll() first, so an update doesn't hit a duplicate id. */
export async function createContextMenu(api: Browser): Promise<void> {
  if (!api.contextMenus) return;
  await api.contextMenus.removeAll();
  // On a selection it translates the selection (plan M3-E4); on the page it opens the panel.
  api.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: i18n.t('panel.contextMenuTitle'),
    contexts: ['page', 'selection'],
  });
}

/** Call synchronously at the top level of the worker, so it survives worker restarts. */
export function listenForContextMenuClicks(api: Browser): void {
  if (!api.contextMenus) return;
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    // The click is a user gesture and grants activeTab, like the action (S5). Open first, with no
    // await before it (sidePanel.open needs the gesture); the selection is handed over beside it.
    void openPanelAndInject(api, tab);
    void handOverSelection(api, tab, info);
  });
}

/**
 * The selection button opens the panel, injects and hands the text over, like the context menu on a
 * selection, but asks for the selection only: the page is read and offered, not translated. The click's gesture comes with the message (S9), so sidePanel.open is still the
 * first call, with no await before it. Only this extension's content script in a tab's top frame is
 * heard, and the denylist and never-translate checks use the sender's address, not one in the message.
 * Call synchronously at the top level of the worker.
 */
export function listenForSelectionButton(api: Browser): void {
  api.runtime.onMessage.addListener((message: unknown, sender: { id?: string | undefined; tab?: TabRef | undefined; frameId?: number | undefined; url?: string | undefined }) => {
    if (!isSelectionButtonRequest(message)) return;
    if (sender.id !== api.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) return;
    // The page's address for the injection's own checks too, should the tab's be hidden.
    const tab = { ...sender.tab, url: sender.tab.url ?? sender.url };
    void openPanelAndInject(api, tab, 'selection');
    // The content script caps the text; so does the worker, whatever sent it (the panel cuts it again).
    void handOverSelection(api, tab, { selectionText: message.text.slice(0, 2 * MAX_SELECTION_CHARS), pageUrl: sender.url, frameUrl: sender.url, lang: message.lang });
  });
}

/**
 * Leaves the selected text for the panel (plan M3-E4). Chrome hands it over with the click, so this
 * works on a page where extraction fails and even where nothing can be injected. A selection from a
 * denylisted site is not kept (M3-D13, DESIGN §8): the record only says it was blocked. Checks the
 * tab, the page and the frame the text sits in, since an iframe can be a denylisted site.
 * The worker translates nothing: the panel does, when it sees the record. `lang` is the language the
 * page marks the text with (the selection button sends it; a context-menu click has none).
 */
export async function handOverSelection(api: Browser, tab: TabRef | undefined, info: { selectionText?: string | undefined; pageUrl?: string | undefined; frameUrl?: string | undefined; lang?: string | undefined }): Promise<void> {
  const tabId = tab?.id;
  const text = info.selectionText?.trim();
  if (tabId === undefined || !text) return;
  const url = info.pageUrl ?? tab?.url ?? '';
  try {
    if (anyDenylisted(tab?.url, info.pageUrl, info.frameUrl)) return await writeSnippet(api, tabId, { url, blocked: 'denylisted' });
    // The user's never-translate list (plan M5-E6); unreadable counts as empty, like the injection's check.
    const never = await readSiteLists(api).then(
      (l) => l.never,
      () => [],
    );
    if ([tab?.url, info.pageUrl, info.frameUrl].some((u) => listedFor(never, u) !== undefined)) await writeSnippet(api, tabId, { url, blocked: 'never' });
    // The panel checks the tag before using it (src/shared/language.ts normalizeLang); the worker only bounds it.
    else await writeSnippet(api, tabId, { url, text, ...(info.lang ? { lang: info.lang.slice(0, 35) } : {}) });
  } catch (err) {
    logError('handing over the selection')(err);
  }
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
      .then((access) => (access ? injectInto(api, { id: tabId, url: tab.url }, 'navigation', access) : undefined))
      .catch(logError('re-injection'));
  });
  api.tabs.onRemoved.addListener((tabId) => {
    clearAccess(api, tabId).catch(logError('clearing tab access'));
    clearSnippet(api, tabId).catch(logError('clearing the selection'));
    clearTabOverride(api, tabId).catch(logError("clearing the tab's model"));
  });
}
