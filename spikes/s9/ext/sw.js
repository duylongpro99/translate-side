// Logs everything to the local server. Config comes from config.js, written by the driver.
importScripts('config.js'); // self.CFG = { base }
const log = (o) => fetch(self.CFG.base + '/log', { method: 'POST', body: JSON.stringify({ src: 'sw', ...o }) }).catch(() => {});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
// Toolbar click: grants activeTab and injects the button; it does not open the panel.
chrome.action.onClicked.addListener(async (tab) => {
  log({ ev: 'action.onClicked', url: tab.url });
  await injectButton(tab.id, 'action click');
});
// Q1: the button's click arrives here. sidePanel.open is the first call, with no await before it.
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m.cmd !== 'open') return;
  const tabId = sender.tab?.id;
  chrome.sidePanel.open({ tabId }).then(
    () => log({ ev: 'Q1 sidePanel.open OK', button: m.id, trusted: m.trusted, pageActivation: m.active }),
    (e) => log({ ev: 'Q1 sidePanel.open FAIL', button: m.id, trusted: m.trusted, pageActivation: m.active, err: e.message }),
  );
});
async function injectButton(tabId, why) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['cs.js'] });
    log({ ev: 'inject-OK', why });
  } catch (e) {
    log({ ev: 'inject-FAIL', why, err: e.message });
  }
}
// Q3: what the worker sees after each navigation, with no gesture.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  let inject = 'OK';
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href });
  } catch (e) {
    inject = 'FAIL: ' + e.message;
  }
  log({ ev: 'Q3 tabs.onUpdated complete', urlVisible: tab.url ?? null, probeInject: inject });
});
// Driver helpers, called through Runtime.evaluate on the worker (no gesture).
const tabOf = async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
self.perms = async (tag) => log({ ev: 'permissions.getAll', tag, origins: (await chrome.permissions.getAll()).origins });
self.register = async (matches) => {
  await chrome.scripting.unregisterContentScripts().catch(() => {});
  await chrome.scripting.registerContentScripts([{ id: 's9', matches, js: ['cs.js'], runAt: 'document_idle', persistAcrossSessions: false }]);
  log({ ev: 'registered', matches });
};
self.removeOrigins = async (origins) => {
  try {
    log({ ev: 'permissions.remove', origins, result: await chrome.permissions.remove({ origins }) });
  } catch (e) {
    log({ ev: 'permissions.remove FAIL', origins, err: e.message });
  }
};
self.closePanel = async () => {
  const t = await tabOf();
  try {
    await chrome.sidePanel.close({ windowId: t.windowId });
    log({ ev: 'sidePanel.close OK' });
  } catch (e) {
    log({ ev: 'sidePanel.close FAIL', err: e.message });
  }
};
self.probe = async (tag) => {
  const t = await tabOf();
  let inject = 'OK';
  try {
    await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => location.href });
  } catch (e) {
    inject = 'FAIL: ' + e.message;
  }
  log({ ev: 'probe', tag, urlVisible: t.url ?? null, inject });
};
log({ ev: 'sw-start' });
