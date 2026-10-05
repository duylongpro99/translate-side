const loadedAt = Date.now();
let base;
const log = (o) => fetch(base + '/log', { method: 'POST', body: JSON.stringify({ src: 'panel', ...o }) }).catch(() => {});
base = self.CFG.base; log({ ev: 'panel-LOADED', href: location.href });
setInterval(() => log({ ev: 'panel-alive', upSec: Math.round((Date.now() - loadedAt) / 1000) }), 5000);
addEventListener('visibilitychange', () => log({ ev: 'panel-visibility', state: document.visibilityState }));
addEventListener('pagehide', () => log({ ev: 'panel-UNLOAD' }));
const activeTab = async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
document.getElementById('inject').onclick = async () => {
  const t = await activeTab();
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => location.href });
    log({ ev: 'panel-click-inject-OK', url: r.result });
  } catch (e) { log({ ev: 'panel-click-inject-FAIL', err: e.message, activation: navigator.userActivation.isActive }); }
};
document.getElementById('perm').onclick = async () => {
  const t = await activeTab();
  log({ ev: 'perm-request-start', activation: navigator.userActivation.isActive, tabUrl: t.url ?? '(hidden)' });
  const pending = setTimeout(() => log({ ev: 'perm-request-PENDING-after-3s (prompt shown?)' }), 3000);
  setTimeout(() => log({ ev: 'perm-request-still-pending-after-12s' }), 12000);
  try { const ok = await chrome.permissions.request({ origins: ['http://localhost/*'] }); clearTimeout(pending); log({ ev: 'perm-request-result', ok, nowGranted: await chrome.permissions.getAll() }); }
  catch (e) { clearTimeout(pending); log({ ev: 'perm-request-ERR', err: e.message }); }
};
document.getElementById('open').onclick = async () => {
  const t = await activeTab();
  try { await chrome.sidePanel.open({ tabId: t.id }); log({ ev: 'panel-click-sidePanel.open-OK' }); }
  catch (e) { log({ ev: 'panel-click-sidePanel.open-FAIL', err: e.message }); }
};
document.getElementById('perm2').onclick = async () => {
  try { const ok = await chrome.permissions.request({ origins: ['http://192.168.1.50/*'] }); log({ ev: 'undeclared-perm-result', ok }); }
  catch (e) { log({ ev: 'undeclared-perm-ERR', err: e.message }); }
};
