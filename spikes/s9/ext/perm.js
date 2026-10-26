// Manual Q2: permissions.request needs a person to answer Chrome's prompt, which no script can.
const out = document.getElementById('out');
const log = (o) => {
  out.textContent += JSON.stringify(o) + '\n';
  fetch(self.CFG.base + '/log', { method: 'POST', body: JSON.stringify({ src: 'perm-page', ...o }) }).catch(() => {});
};
const show = async (tag) => log({ ev: 'permissions.getAll', tag, origins: (await chrome.permissions.getAll()).origins });
const on = (id, fn) => document.getElementById(id).addEventListener('click', () => fn().catch((e) => log({ ev: 'error', id, err: e.message })));
on('narrow', async () => { log({ ev: 'request narrow', granted: await chrome.permissions.request({ origins: ['https://api.example.com/*', 'http://localhost/*'] }) }); await show('narrow'); });
on('broad', async () => { log({ ev: 'request broad', granted: await chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] }) }); await show('broad'); });
on('remove', async () => { log({ ev: 'remove broad', removed: await chrome.permissions.remove({ origins: ['https://*/*', 'http://*/*'] }) }); await show('after-remove'); });
on('show', () => show('now'));
