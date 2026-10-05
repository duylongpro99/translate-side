// Every result is appended to storage.local.log and rendered by the panel.
const log = async (ev, extra = {}) => {
  const { log = [] } = await chrome.storage.local.get('log');
  log.push({ t: new Date().toLocaleTimeString(), ev, ...extra }); await chrome.storage.local.set({ log });
};
async function probe(tabId, why) {
  try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href }); log('inject OK', { why, url: r.result }); }
  catch (e) { log('inject FAIL', { why, err: e.message }); }
}
async function openPanel(tabId, why) {
  try { await chrome.sidePanel.open({ tabId }); log('sidePanel.open OK', { why }); } catch (e) { log('sidePanel.open FAIL', { why, err: e.message }); }
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 's5', title: 'S5: open panel + inject', contexts: ['page', 'selection'] });
  chrome.storage.local.set({ behavior: false, log: [] });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});
chrome.action.onClicked.addListener((tab) => { log('action.onClicked (toolbar or Alt+T)'); openPanel(tab.id, 'action'); probe(tab.id, 'action'); });
chrome.commands.onCommand.addListener((cmd, tab) => { log('commands.onCommand', { cmd }); probe(tab.id, 'named command'); });
chrome.contextMenus.onClicked.addListener((info, tab) => { log('contextMenus.onClicked'); openPanel(tab.id, 'context menu'); probe(tab.id, 'context menu'); });
chrome.runtime.onMessage.addListener(async (m) => {
  if (m.cmd === 'probe') { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); probe(t.id, 'panel button (no new grant)'); }
  if (m.cmd === 'behavior') { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: m.on }); await chrome.storage.local.set({ behavior: m.on }); log('openPanelOnActionClick = ' + m.on); }
  if (m.cmd === 'clear') chrome.storage.local.set({ log: [] });
});
