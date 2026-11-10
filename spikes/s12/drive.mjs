// Headful isolated Chrome running one S12 scenario. Usage: node drive.mjs <port> <scenario: s1|s2|s3|s4|s5|s7|s8> <order: unawaited|awaited>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [port, scenario, order] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const base = `http://127.0.0.1:${port}`;
const extDir = fs.mkdtempSync(path.join(process.env.TMPDIR, 's12-ext-'));
for (const f of fs.readdirSync('ext')) fs.copyFileSync(path.join('ext', f), path.join(extDir, f));
fs.writeFileSync(path.join(extDir, 'config.js'), `self.CFG = ${JSON.stringify({ base, order })};`);
const udd = fs.mkdtempSync(path.join(process.env.TMPDIR, 's12-udd-'));
const log = (o) => fetch(base + '/log', { method: 'POST', body: JSON.stringify({ src: 'driver', ...o }) }).catch(() => {});
const ch = spawn(CHROME, [`--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check', '--window-size=1100,750', '--window-position=40,40',
  '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const wr = ch.stdio[3], rd = ch.stdio[4];
let id = 0; const pend = new Map(); const targets = new Map(); let buf = '';
rd.on('data', (d) => {
  buf += d.toString(); let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); continue; }
    const ti = m.params?.targetInfo;
    if (m.method === 'Target.targetCreated' || m.method === 'Target.targetInfoChanged') targets.set(ti.targetId, ti);
    if (m.method === 'Target.targetDestroyed') targets.delete(m.params.targetId);
  }
});
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); wr.write(JSON.stringify({ id: i, method, params, sessionId }) + '\0'); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extId = (await send('Extensions.loadUnpacked', { path: extDir })).result.id;
await send('Target.setDiscoverTargets', { discover: true });
await sleep(800);
const swT = [...targets.values()].find((t) => t.type === 'service_worker' && t.url.includes(extId)).targetId;
const swSess = (await send('Target.attachToTarget', { targetId: swT, flatten: true })).result.sessionId;
const sw = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swSess)).result?.result?.value;
const panels = () => [...targets.values()].filter((t) => t.url.startsWith(`chrome-extension://${extId}/panel.html`)).map((t) => t.url.split('/').pop());
// Each tab: CDP target id (for triggerAction) and Chrome tab id (for the worker).
const tabs = {};
async function newTab(name, url) {
  await send('Target.createTarget', { url });
  await sleep(1200);
  // triggerAction wants the tab-type target, not the page target createTarget returns.
  const targetId = (await send('Target.getTargets', { filter: [{ type: 'tab' }] })).result.targetInfos.find((t) => t.url === url).targetId;
  const pageId = [...targets.values()].find((t) => t.type === 'page' && t.url === url)?.targetId;
  tabs[name] = { targetId, pageId, tabId: await sw(`tabIdFor(${JSON.stringify(url)})`) };
  await log({ ev: `tab ${name}`, ...tabs[name] });
}
let n = 0;
// Whether a panel is drawn comes from the panel's own log (visibilityState and animation frames per tick), not screenshots.
const step = async (name, fn, wait = 1500) => { n++; await log({ ev: `STEP ${n}: ${name}`, panels: panels() }); await fn(); await sleep(wait); await sw('pageWidth()'); await log({ ev: `after ${n}`, panels: panels() }); };
const click = (name) => step(`toolbar click on ${name}`, async () => log({ triggerAction: await send('Extensions.triggerAction', { id: extId, targetId: tabs[name].targetId }) }), 3000);
const activate = (name, wait = 3000) => step(`switch to ${name}`, () => sw(`activate(${tabs[name].tabId})`), wait);
const options = (name) => step(`getOptions ${name}`, () => sw(`options(${tabs[name].tabId})`), 500);
const chromeVersion = (await send('Browser.getVersion')).result.product;
await log({ ev: 'run', scenario, order, chromeVersion });
await newTab('A', `${base}/a.html?n=A`);
await newTab('B', `${base}/b.html?n=B`);
// Raise the spike window once: an occluded window reports every page as visible or hidden regardless of the panel.
await send('Target.activateTarget', { targetId: tabs.A.pageId });
await activate('A', 1000);
if (scenario === 's1') {
  await click('A');
  await activate('B', 30000);
  await options('B');
  await activate('A', 5000);
  await options('A');
} else if (scenario === 's2') {
  await newTab('C', `${base}/b.html?n=C`);
  await activate('A', 1000);
  await click('A');
  await activate('C', 1000);
  await click('C');
  await activate('A', 5000);
  await activate('C', 5000);
  await activate('A', 5000);
  await activate('B', 5000);
} else if (scenario === 's3') {
  await click('A');
  await step('navigate A same-origin', () => sw(`navigate(${tabs.A.tabId}, '${base}/b.html?n=A-same')`), 4000);
  await step('navigate A cross-origin', () => sw(`navigate(${tabs.A.tabId}, 'http://localhost:${port}/c.html?n=A-cross')`), 4000);
  await activate('B');
  await activate('A');
  await options('A');
} else if (scenario === 's4') {
  await click('A');
  await step('sidePanel.close A (worker, no gesture)', () => sw(`closePanel(${tabs.A.tabId})`), 3000);
  await activate('B');
  await activate('A');
  await options('A');
  await click('A');
  await step('setOptions A enabled:false (worker)', () => sw(`disable(${tabs.A.tabId})`), 3000);
  await activate('B');
  await activate('A');
  await options('A');
  await click('A');
} else if (scenario === 's5') {
  await click('A');
  await step('move A to a new window', () => sw(`moveToNewWindow(${tabs.A.tabId})`), 5000);
  await options('A');
  await step('tabs.get A', () => sw(`tabsGet(${tabs.A.tabId})`), 500);
  await activate('B');
  await activate('A');
} else if (scenario === 's8') {
  // A second open of an already open tab panel (Alt+T pressed again, the selection button): same path, same tab.
  await click('A');
  await click('A');
  await activate('B');
  await activate('A');
} else if (scenario === 's7') {
  await click('A');
  await step('close tab A', () => sw(`removeTab(${tabs.A.tabId})`), 2000);
  await step('tabs.get A', () => sw(`tabsGet(${tabs.A.tabId})`), 500);
  await options('A');
}
await step('end', async () => {}, 500);
ch.on('exit', () => { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5 }); fs.rmSync(extDir, { recursive: true, force: true }); process.exit(0); });
ch.kill();
