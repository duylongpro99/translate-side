// Headful isolated Chrome; scripted S5 scenario. Usage: node drive.mjs <mode: behavior|onclicked> <port> <variant: optional|granted>
// NOPERM=1 skips the permission-prompt step, so a run never depends on someone clicking "Allow".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [mode, port, variant] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// "granted" variant: same extension but the site origins are install-time host permissions,
// standing in for "user granted the optional host permission when allowlisting the site".
const extDir = fs.mkdtempSync(path.join(process.env.TMPDIR, 's5-ext-'));
for (const f of fs.readdirSync('ext')) fs.copyFileSync(path.join('ext', f), path.join(extDir, f));
if (variant === 'granted') {
  const m = JSON.parse(fs.readFileSync('ext/manifest.json', 'utf8'));
  m.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*']; delete m.optional_host_permissions;
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(m));
}
fs.writeFileSync(path.join(extDir, 'config.js'), `self.CFG = ${JSON.stringify({ base: `http://127.0.0.1:${port}`, mode })};`);
const udd = fs.mkdtempSync(path.join(process.env.TMPDIR, 's5-udd-'));
const base = `http://127.0.0.1:${port}`;
const log = (o) => fetch(base + '/log', { method: 'POST', body: JSON.stringify({ src: 'driver', ...o }) }).catch(() => {});
const ch = spawn(CHROME, [`--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check', '--window-size=1000,700', '--window-position=40,40',
  '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const wr = ch.stdio[3], rd = ch.stdio[4];
let id = 0; const pend = new Map(); const targets = new Map();
let buf = '';
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
const extId2 = extId;
await sleep(500);
const tab = (await send('Target.createTarget', { url: `${base}/a.html` })).result.targetId;
await sleep(1500);
const tabT = (await send('Target.getTargets', { filter: [{ type: 'tab' }] })).result.targetInfos.find((t) => t.url.startsWith(base)).targetId;
const swT = [...targets.values()].find((t) => t.type === 'service_worker' && t.url.includes(extId)).targetId;
const swSess = (await send('Target.attachToTarget', { targetId: swT, flatten: true })).result.sessionId;
const swEval = (expr) => send('Runtime.evaluate', { expression: expr }, swSess);
const sess = (await send('Target.attachToTarget', { targetId: tab, flatten: true })).result.sessionId;
await sleep(1500);
const panelTarget = () => [...targets.values()].find((t) => t.url.startsWith(`chrome-extension://${extId2}/panel.html`));
async function clickIn(sessionId, selector) {
  const r = await send('Runtime.evaluate', { expression: `(() => { const e = document.querySelector('${selector}'); if (!e) return JSON.stringify(null); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify([r.x + r.width/2, r.y + r.height/2]); })()`, returnByValue: true }, sessionId);
  const xy = JSON.parse(r.result.result.value ?? 'null');
  if (!xy) return log({ ev: 'CLICK-TARGET-MISSING', selector });
  const [x, y] = xy;
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
}
let n = 0, tab2;
const step = async (name, fn, wait = 1500) => { n++; await log({ ev: `STEP ${n}: ${name}`, panelTargetOpen: !!panelTarget() }); await fn(); await sleep(wait); };
const probe = (tag) => swEval(`driverProbe('${n}-${tag}')`);
let panelSess = null;
const panelClick = async (sel) => {
  const p = panelTarget(); if (!p) return log({ ev: 'no panel target to click' });
  if (!panelSess) panelSess = (await send('Target.attachToTarget', { targetId: p.targetId, flatten: true })).result.sessionId;
  await clickIn(panelSess, sel);
};
if (process.env.PERMTEST2) {
  await step('triggerAction on A', async () => log({ r: await send('Extensions.triggerAction', { id: extId2, targetId: tabT }) }), 2500);
  await step('panel click: request undeclared LAN origin', () => panelClick('#perm2'), 3000);
} else if (process.env.PERMTEST) {
  await step('triggerAction on A', async () => log({ r: await send('Extensions.triggerAction', { id: extId2, targetId: tabT }) }), 2500);
  await step('click link to C (cross origin)', () => clickIn(sess, '#cross'), 2500);
  await step('panel click: request site permission, then wait 20 s with no navigation', () => panelClick('#perm'), 20000);
  await step('navigate to A (does navigation resolve the prompt?)', () => send('Page.navigate', { url: `${base}/a.html` }, sess), 5000);
  await step('probe after', () => probe('after-perm-nav'));
} else {
await step('A loaded, no grant: worker probe', () => probe('A-nogrant'));
await step('worker sidePanel.open with no gesture', () => swEval('driverOpenPanel()'));
await step('triggerAction on A (toolbar click)', async () => log({ r: await send('Extensions.triggerAction', { id: extId2, targetId: tabT }) }), 2500);
await step('worker probe after grant', () => probe('A-granted'));
await step('click #hash link (same document)', () => clickIn(sess, '#hash'));
await step('worker probe after hash nav', () => probe('A-hash'));
await step('click pushState link', () => clickIn(sess, '#push'));
await step('worker probe after pushState', () => probe('A-push'));
await step('click link to B (same origin, full nav)', () => clickIn(sess, '#same'), 2500);
await step('worker probe on B', () => probe('B'));
await step('panel click: inject', () => panelClick('#inject'));
await step('panel click: sidePanel.open', () => panelClick('#open'));
await step('triggerAction on B', async () => log({ r: await send('Extensions.triggerAction', { id: extId2, targetId: tabT }) }), 2500);
await step('reload B (granted)', () => send('Page.reload', {}, sess), 2500);
await step('worker probe after reload', () => probe('B-reload'));
await step('browser-initiated nav to A (same origin)', () => send('Page.navigate', { url: `${base}/a.html` }, sess), 2500);
await step('worker probe on A after same-origin omnibox nav', () => probe('A-omni'));
await step('open 2nd tab (switch tabs)', async () => { tab2 = (await send('Target.createTarget', { url: `${base}/b.html` })).result.targetId; }, 2500);
await step('worker probe on tab 2', () => probe('tab2'));
await step('close 2nd tab (back to tab 1)', () => send('Target.closeTarget', { targetId: tab2 }), 2500);
await step('worker probe back on tab 1', () => probe('tab1-back'));
await step('click link to C (cross origin)', () => clickIn(sess, '#cross'), 2500);
await step('worker probe on C', () => probe('C'));
// Decision 3 case: after the cross-origin navigation the grant is gone; a panel click must not be able to inject.
await step('panel click: inject on C after grant loss (expect FAIL)', () => panelClick('#inject'));
if (!process.env.NOPERM) {
  await step('panel click: request site permission (C origin)', () => panelClick('#perm'), 15000);
  await step('worker probe on C after permission request', () => probe('C-after-perm'));
}
await step('click back to A via history', () => send('Runtime.evaluate', { expression: 'history.back()' }, sess), 2500);
await step('worker probe after back', () => probe('back'));
}
await step('end', async () => {});
await log({ ev: 'targets-at-end', t: [...targets.values()].map((t) => `${t.type} ${t.url}`) });
ch.on('exit', () => { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5 }); fs.rmSync(extDir, { recursive: true, force: true }); process.exit(0); });
ch.kill();
