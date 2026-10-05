const render = async () => { const { log = [], behavior } = await chrome.storage.local.get(null); b.textContent = behavior; o.textContent = log.map((l) => JSON.stringify(l)).join('\n'); };
chrome.storage.onChanged.addListener(render); render();
on.onclick = () => chrome.runtime.sendMessage({ cmd: 'behavior', on: true });
off.onclick = () => chrome.runtime.sendMessage({ cmd: 'behavior', on: false });
probe.onclick = () => chrome.runtime.sendMessage({ cmd: 'probe' });
clear.onclick = () => chrome.runtime.sendMessage({ cmd: 'clear' });
