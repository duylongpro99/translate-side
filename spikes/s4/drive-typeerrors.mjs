// K3 / row 2 driver: same isolated Chrome setup as drive.mjs. Variants: granted (ollama.com + no-such-host.invalid +
// 127.0.0.1 as host permissions) and none. Runs runTypeErrorProbes in the panel page and the worker, then one call in the
// panel page under CDP offline emulation. Writes results/typeerrors-<variant>.json.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function variant(name, hosts) {
  const extDir = fs.mkdtempSync(path.join(process.env.TMPDIR, 's4-ext-'));
  for (const f of fs.readdirSync('ext')) fs.copyFileSync(path.join('ext', f), path.join(extDir, f));
  const m = JSON.parse(fs.readFileSync('ext/manifest.json', 'utf8'));
  if (hosts) m.host_permissions = hosts; else delete m.host_permissions;
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(m));
  const udd = fs.mkdtempSync(path.join(process.env.TMPDIR, 's4-udd-'));
  const ch = spawn(CHROME, [`--user-data-dir=${udd}`, '--headless=new', '--no-first-run', '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const wr = ch.stdio[3], rd = ch.stdio[4];
  let id = 0, buf = ''; const pend = new Map(); const targets = new Map();
  rd.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\0')) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); continue; } const ti = msg.params?.targetInfo; if (ti) targets.set(ti.targetId, ti); } });
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); wr.write(JSON.stringify({ id: i, method, params, sessionId }) + '\0'); });
  const extId = (await send('Extensions.loadUnpacked', { path: extDir })).result.id;
  await send('Target.setDiscoverTargets', { discover: true });
  await sleep(800);
  const pageT = (await send('Target.createTarget', { url: `chrome-extension://${extId}/panel.html` })).result.targetId;
  let swT; for (let k = 0; k < 20 && !swT; k++) { swT = [...targets.values()].find((t) => t.type === 'service_worker' && t.url.includes(extId))?.targetId; if (!swT) await sleep(500); }
  const attach = async (t) => (await send('Target.attachToTarget', { targetId: t, flatten: true })).result.sessionId;
  const ev = async (s, fn, ctx) => JSON.parse(redact((await send('Runtime.evaluate', { expression: `${fn}(${JSON.stringify(key)}, ${JSON.stringify(ctx)}).then(JSON.stringify)`, awaitPromise: true, returnByValue: true }, s)).result.result.value, key));
  const sw = await attach(swT);
  const rows = await ev(sw, 'runTypeErrorProbes', 'worker');
  const pg = await attach(pageT);
  rows.push(...await ev(pg, 'runTypeErrorProbes', 'panel'));
  await send('Network.enable', {}, pg);
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, pg);
  rows.push(...await ev(pg, 'runOfflineProbe', 'panel'));
  ch.kill();
  fs.writeFileSync(`results/typeerrors-${name}.json`, JSON.stringify({ variant: name, host_permissions: hosts ?? [], at: new Date().toISOString(), rows }, null, 1));
  for (const r of rows) console.log(name.padEnd(8), r.ctx.padEnd(6), r.name.padEnd(74), r.ok ? (r.contains !== undefined ? `contains=${r.contains}` : `status ${r.status}`) : `THROW ${r.errorName}: ${r.errorMessage}`);
}
await variant('granted', ['https://ollama.com/*', 'https://no-such-host.invalid/*', 'https://127.0.0.1/*']);
await variant('none', null);
