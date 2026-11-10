// Per-tab panel: global panel off at startup; the toolbar click enables and opens the clicked tab's panel.
importScripts('config.js'); // written by the driver: self.CFG = { base, order: 'unawaited' | 'awaited' }
const { base, order } = self.CFG;
const log = (o) => fetch(base + '/log', { method: 'POST', body: JSON.stringify({ src: 'sw', ...o }) }).catch(() => {});
const wrap = (name, p) => p.then((r) => log({ ev: `${name}-OK`, r: r ?? null }), (e) => log({ ev: `${name}-FAIL`, err: e.message }));
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
wrap('global-disable', chrome.sidePanel.setOptions({ enabled: false }));
log({ ev: 'sw-start', order, hasClose: typeof chrome.sidePanel.close, hasOnOpened: typeof chrome.sidePanel.onOpened });
chrome.sidePanel.onOpened?.addListener((i) => log({ ev: 'sidePanel.onOpened', i }));
chrome.sidePanel.onClosed?.addListener((i) => log({ ev: 'sidePanel.onClosed', i }));
chrome.action.onClicked.addListener(async (tab) => {
  const opts = { tabId: tab.id, path: `panel.html?tab=${tab.id}`, enabled: true };
  log({ ev: 'action.onClicked', tabId: tab.id, order });
  if (order === 'awaited') {
    await wrap('setOptions', chrome.sidePanel.setOptions(opts));
    wrap('open', chrome.sidePanel.open({ tabId: tab.id }));
  } else {
    wrap('setOptions', chrome.sidePanel.setOptions(opts));
    wrap('open', chrome.sidePanel.open({ tabId: tab.id }));
  }
});
chrome.tabs.onActivated.addListener((i) => log({ ev: 'tabs.onActivated', tabId: i.tabId, windowId: i.windowId }));
chrome.tabs.onDetached.addListener((tabId, i) => log({ ev: 'tabs.onDetached', tabId, i }));
chrome.tabs.onAttached.addListener((tabId, i) => log({ ev: 'tabs.onAttached', tabId, i }));
// Driver helpers, called through Runtime.evaluate on the worker (no user gesture).
self.tabIdFor = async (url) => (await chrome.tabs.query({ url })).map((t) => t.id)[0];
self.activate = (tabId) => wrap(`activate-${tabId}`, chrome.tabs.update(tabId, { active: true }));
self.closePanel = (tabId) => wrap(`close-${tabId}`, chrome.sidePanel.close({ tabId }));
self.disable = (tabId) => wrap(`disable-${tabId}`, chrome.sidePanel.setOptions({ tabId, enabled: false }));
self.moveToNewWindow = (tabId) => wrap(`move-${tabId}`, chrome.windows.create({ tabId }).then((w) => ({ windowId: w.id })));
self.navigate = (tabId, url) => wrap(`navigate-${tabId}`, chrome.tabs.update(tabId, { url }).then(() => url));
self.removeTab = (tabId) => wrap(`remove-${tabId}`, chrome.tabs.remove(tabId));
self.options = (tabId) => wrap(`getOptions-${tabId}`, chrome.sidePanel.getOptions({ tabId }));
self.tabsGet = (tabId) => wrap(`tabs.get-${tabId}`, chrome.tabs.get(tabId).then((t) => ({ id: t.id, windowId: t.windowId })));
// The active page's width: it shrinks by the panel's width only while a side panel is shown beside it.
self.pageWidth = async () => {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => innerWidth });
  log({ ev: 'page-width', tabId: t.id, width: r.result });
};
