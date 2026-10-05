// Launch an isolated Chrome, load ext/ unpacked, open panel.html for one scenario, and watch the
// service-worker target appear/disappear via CDP target discovery (no attach, so DevTools does not
// keep the worker alive). Usage: node drive.mjs <scenario> <serverPort> <durSec> <watchSec>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [scenario, sport, dur, watch] = [process.argv[2], process.argv[3], process.argv[4] ?? '90', Number(process.argv[5] ?? 150)];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ext = path.resolve('ext');
const udd = fs.mkdtempSync(path.join(process.env.TMPDIR, 's1-udd-'));
const base = `http://127.0.0.1:${sport}`;
const log = (o) => fetch(base + '/log', { method: 'POST', body: JSON.stringify({ src: 'cdp', ...o }) }).catch(() => {});
const ch = spawn(CHROME, [`--user-data-dir=${udd}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const wr = ch.stdio[3], rd = ch.stdio[4];
let id = 0; const pend = new Map(); const handlers = [];
let buf = '';
rd.on('data', (d) => {
  buf += d.toString();
  let i; while ((i = buf.indexOf('\0')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else handlers.forEach((h) => h(m));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); wr.write(JSON.stringify({ id: i, method, params }) + '\0'); });
const res = await send('Extensions.loadUnpacked', { path: ext });
if (!res.result) { console.error('loadUnpacked failed', JSON.stringify(res)); process.exit(1); }
const extId = res.result.id;
const swTargets = new Set();
handlers.push((m) => {
  const ti = m.params?.targetInfo;
  if (m.method === 'Target.targetCreated' && ti.type === 'service_worker' && ti.url.includes(extId)) { swTargets.add(ti.targetId); log({ ev: 'SW-TARGET-UP', scenario }); }
  if (m.method === 'Target.targetDestroyed' && swTargets.has(m.params.targetId)) { swTargets.delete(m.params.targetId); log({ ev: 'SW-TARGET-DOWN', scenario }); }
});
await send('Target.setDiscoverTargets', { discover: true });
await log({ ev: 'loaded', extId, scenario });
await send('Target.createTarget', { url: `chrome-extension://${extId}/panel.html?scenario=${scenario}&port=${sport}&dur=${dur}` });
setTimeout(() => { log({ ev: 'driver-exit', scenario }); ch.on('exit', () => { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5 }); process.exit(0); }); ch.kill(); }, watch * 1000);
