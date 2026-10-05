// Logs everything to the local server. Config comes from chrome.storage.local (set by the driver).
let base = null, lastTab = null, mode = null;
chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => { if (lastTab == null && t) lastTab = t.id; });
const log = (o) => base && fetch(base + '/log', { method: 'POST', body: JSON.stringify({ src: 'sw', ...o }) }).catch(() => {});
async function probe(tabId, why) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href });
    log({ ev: 'inject-OK', why, url: r.result });
  } catch (e) { log({ ev: 'inject-FAIL', why, err: e.message }); }
}
async function tryOpenPanel(tabId, why) {
  try { await chrome.sidePanel.open({ tabId }); log({ ev: 'sidePanel.open-OK', why }); }
  catch (e) { log({ ev: 'sidePanel.open-FAIL', why, err: e.message }); }
}
async function configure(c) {
  if (!c.base) return;
  base = c.base; mode = c.mode;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === 'behavior' });
  log({ ev: 'sw-config', mode, hasClose: typeof chrome.sidePanel.close, hasGetLayout: typeof chrome.sidePanel.getLayout,
    perms: await chrome.permissions.getAll() });
}
importScripts('config.js'); // written by the driver: self.CFG = { base, mode }
configure(self.CFG);
// Called by the driver through Runtime.evaluate on the worker (no user gesture).
self.driverProbe = async (tag) => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); probe(t.id, 'driver-probe:' + tag); };
self.driverOpenPanel = async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); tryOpenPanel(t.id, 'no gesture (driver eval)'); };
chrome.action.onClicked.addListener(async (tab) => {
  lastTab = tab.id; log({ ev: 'action.onClicked', url: tab.url });
  if (mode === 'onclicked') await tryOpenPanel(tab.id, 'action click gesture');
  probe(tab.id, 'after action click');
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' || info.url) {
    log({ ev: 'tabs.onUpdated', info, urlVisible: tab.url ?? null });
    if (info.status === 'complete') probe(tabId, 'onUpdated complete (no gesture)');
  }
});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.cmd === 'tab') { reply(lastTab); }
});
