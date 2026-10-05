// S4 driver: isolated headless Chrome, loads the probe extension in two variants, runs the probes from the panel
// page (opened as an extension tab: same chrome-extension:// origin and permissions as the side panel document) and
// from the service worker. The key goes over the CDP pipe into page memory only; output is redacted.
// Usage: node drive.mjs   → writes results/<variant>.json and prints a table.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('results', { recursive: true });

async function variant(name, mutate) {
  const extDir = fs.mkdtempSync(path.join(process.env.TMPDIR, 's4-ext-'));
  for (const f of fs.readdirSync('ext')) fs.copyFileSync(path.join('ext', f), path.join(extDir, f));
  const m = JSON.parse(fs.readFileSync('ext/manifest.json', 'utf8')); mutate(m);
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(m));
  const udd = fs.mkdtempSync(path.join(process.env.TMPDIR, 's4-udd-'));
  const ch = spawn(CHROME, [`--user-data-dir=${udd}`, '--headless=new', '--no-first-run', '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const wr = ch.stdio[3], rd = ch.stdio[4];
  let id = 0, buf = ''; const pend = new Map(); const targets = new Map();
  rd.on('data', (d) => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); continue; }
      const ti = msg.params?.targetInfo; if (ti) targets.set(ti.targetId, ti);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); wr.write(JSON.stringify({ id: i, method, params, sessionId }) + '\0'); });
  const extId = (await send('Extensions.loadUnpacked', { path: extDir })).result.id;
  await send('Target.setDiscoverTargets', { discover: true });
  await sleep(800);
  const pageT = (await send('Target.createTarget', { url: `chrome-extension://${extId}/panel.html` })).result.targetId;
  await sleep(1200);
  let swT;
  for (let k = 0; k < 20 && !swT; k++) { swT = [...targets.values()].find((t) => t.type === 'service_worker' && t.url.includes(extId))?.targetId; if (!swT) await sleep(500); }
  if (!swT || !pageT) throw new Error(`targets missing: sw=${swT} page=${pageT}`);
  const run = async (targetId, ctx) => {
    const at = await send('Target.attachToTarget', { targetId, flatten: true });
    if (!at.result) throw new Error(`attach ${ctx}: ${JSON.stringify(at.error)}`);
    const s = at.result.sessionId;
    const r = await send('Runtime.evaluate', { expression: `runProbes(${JSON.stringify(key)}, ${JSON.stringify(ctx)}).then(JSON.stringify)`, awaitPromise: true, returnByValue: true }, s);
    return JSON.parse(redact(r.result.result.value, key));
  };
  // Worker first: while the panel probes run (>30 s) the idle worker is suspended and its target goes away (as in S1).
  const w = await run(swT, 'worker');
  const rows = [...await run(pageT, 'panel'), ...w];
  ch.kill();
  const out = { variant: name, chrome: 'see results/chrome-version.txt', host_permissions: m.host_permissions ?? [], at: new Date().toISOString(), rows };
  fs.writeFileSync(`results/${name}.json`, JSON.stringify(out, null, 1));
  for (const r of rows) console.log(name.padEnd(8), r.ctx.padEnd(6), r.name.padEnd(52), r.ok ? `${r.status} ${r.type} ${JSON.stringify(r.headers)} ${r.body.replace(/\s+/g, ' ').slice(0, 110)}` : `THROW ${r.errorName}: ${r.errorMessage}`);
}

await variant('granted', () => {});
await variant('none', (m) => { delete m.host_permissions; });
