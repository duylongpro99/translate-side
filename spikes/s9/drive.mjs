// Headful isolated Chrome; scripted S9 scenario. Usage: node drive.mjs <mode: activetab|granted|broad|manual> <port>
// activetab: the toolbar click grants activeTab and injects the button. granted: 127.0.0.1 is an install-time host
// permission and a registered content script draws the button. broad: the optional https://*/* and http://*/* are
// granted through chrome://extensions (a script cannot answer Chrome's permission prompt), next to a narrower
// provider origin and an allowlisted site, then removed again (Chrome 155: the grants do nothing for optional
// permissions, see results/broad-developerprivate.jsonl). manual: opens perm.html for a person to answer the prompts (Q2).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [mode, port] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const base = `http://127.0.0.1:${port}`;
const extDir = fs.mkdtempSync(path.join(process.env.TMPDIR, 's9-ext-'));
for (const f of fs.readdirSync('ext')) fs.copyFileSync(path.join('ext', f), path.join(extDir, f));
if (mode === 'granted') {
  const m = JSON.parse(fs.readFileSync('ext/manifest.json', 'utf8'));
  m.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(m));
}
fs.writeFileSync(path.join(extDir, 'config.js'), `self.CFG = ${JSON.stringify({ base })};`);
const udd = fs.mkdtempSync(path.join(process.env.TMPDIR, 's9-udd-'));
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
const version = (await send('Browser.getVersion')).result.product;
await log({ ev: 'chrome', version, mode });
const extId = (await send('Extensions.loadUnpacked', { path: extDir })).result.id;
await send('Target.setDiscoverTargets', { discover: true });
await sleep(800);
const swT = () => [...targets.values()].find((t) => t.type === 'service_worker' && t.url.includes(extId)).targetId;
let swSess = (await send('Target.attachToTarget', { targetId: swT(), flatten: true })).result.sessionId;
const sw = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true }, swSess);
  if (r.result?.exceptionDetails) await log({ ev: 'sw eval error', expr, err: r.result.exceptionDetails.exception?.description });
};
const panelOpen = () => [...targets.values()].some((t) => t.url.startsWith(`chrome-extension://${extId}/panel.html`));
const tab = (await send('Target.createTarget', { url: `${base}/a.html` })).result.targetId;
await sleep(1500);
const tabT = (await send('Target.getTargets', { filter: [{ type: 'tab' }] })).result.targetInfos.find((t) => t.url.startsWith(base)).targetId;
const sess = (await send('Target.attachToTarget', { targetId: tab, flatten: true })).result.sessionId;
async function clickIn(sessionId, selector) {
  const r = await send('Runtime.evaluate', { expression: `(() => { const e = document.querySelector('${selector}'); if (!e) return JSON.stringify(null); const r = e.getBoundingClientRect(); return JSON.stringify([r.x + r.width/2, r.y + r.height/2]); })()`, returnByValue: true }, sessionId);
  const xy = JSON.parse(r.result.result.value ?? 'null');
  if (!xy) return log({ ev: 'CLICK-TARGET-MISSING', selector });
  const [x, y] = xy;
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
}
let n = 0;
const step = async (name, fn, wait = 1500) => { n++; await log({ ev: `STEP ${n}: ${name}` }); await fn(); await sleep(wait); await log({ ev: `after step ${n}`, panelOpen: panelOpen() }); };
const devPrivate = async (calls) => {
  const ext = (await send('Target.createTarget', { url: 'chrome://extensions' })).result.targetId;
  await sleep(1500);
  const s = (await send('Target.attachToTarget', { targetId: ext, flatten: true })).result.sessionId;
  for (const c of calls) {
    const r = await send('Runtime.evaluate', { expression: `chrome.developerPrivate.${c}.then(() => 'ok', (e) => 'error: ' + e.message)`, awaitPromise: true, returnByValue: true }, s);
    await log({ ev: 'developerPrivate', call: c, result: r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description });
  }
  await send('Target.closeTarget', { targetId: ext });
  await sleep(500);
  await send('Target.activateTarget', { targetId: tab });
};
const q1 = async () => {
  // The control runs first, while the page has had no user activation since it loaded.
  await step('Q1 control: synthetic click from the page (no activation)', () => send('Runtime.evaluate', { expression: `document.getElementById('s9-now').click()` }, sess), 2000);
  await step('close the panel (if open)', () => sw('closePanel()'));
  await step('Q1 real click on "open now" (panel closed)', () => clickIn(sess, '#s9-now'), 2000);
  await step('close the panel', () => sw('closePanel()'));
  await step('Q1 real click on "open after 1.5 s"', () => clickIn(sess, '#s9-late'), 3500);
  await step('close the panel', () => sw('closePanel()'));
};

if (mode === 'activetab') {
  await step('toolbar click on A: activeTab grant, button injected, panel stays closed', async () => log({ r: await send('Extensions.triggerAction', { id: extId, targetId: tabT }) }), 2500);
  await q1();
} else if (mode === 'granted') {
  await step('register the button script for the granted origin', () => sw(`register(['http://127.0.0.1/*'])`));
  await step('reload A', () => send('Page.reload', {}, sess), 2500);
  await q1();
} else if (mode === 'broad') {
  await step('permissions at start', () => sw(`perms('start')`));
  await step('grant a provider origin and an allowlisted site (narrow)', () => devPrivate([`addHostPermission('${extId}', 'https://api.example.com/*')`, `addHostPermission('${extId}', 'http://localhost/*')`]));
  await step('permissions after the narrow grants', () => sw(`perms('narrow')`));
  await step('grant the broad patterns (tier B on)', () => devPrivate([`addHostPermission('${extId}', 'https://*/*')`, `addHostPermission('${extId}', 'http://*/*')`]));
  await step('permissions after the broad grant', () => sw(`perms('broad')`));
  await step('register the button script for the broad patterns', () => sw(`register(['https://*/*', 'http://*/*'])`));
  await step('reload A', () => send('Page.reload', {}, sess), 2500);
  await q1();
  await step('Q3 probe on A', () => sw(`probe('A')`));
  await step('Q3 link click A -> C (cross origin)', () => clickIn(sess, '#cross'), 2500);
  await step('Q3 probe on C', () => sw(`probe('C')`));
  await step('Q3 omnibox-style navigation C -> B', () => send('Page.navigate', { url: `${base}/b.html` }, sess), 2500);
  await step('Q2 remove the broad patterns', () => sw(`removeOrigins(['https://*/*', 'http://*/*'])`));
  await step('permissions after removing the broad patterns', () => sw(`perms('after-remove')`));
  await step('Q3 reload B after the removal', () => send('Page.reload', {}, sess), 2500);
  await step('Q2 grant the broad patterns again, then remove only https', () => devPrivate([`addHostPermission('${extId}', 'https://*/*')`, `addHostPermission('${extId}', 'http://*/*')`]));
  await step('permissions after the second broad grant', () => sw(`perms('broad-2')`));
  await step('Q2 remove the broad patterns with permissions.remove of each', () => sw(`removeOrigins(['https://*/*']).then(() => removeOrigins(['http://*/*']))`));
  await step('permissions after the second removal', () => sw(`perms('after-remove-2')`));
} else if (mode === 'manual') {
  await send('Target.createTarget', { url: `chrome-extension://${extId}/perm.html` });
  await log({ ev: 'manual: click the buttons on perm.html in order, answer each prompt with Allow; the run ends after 120 s' });
  await sleep(120000);
}
await step('end', async () => {});
ch.on('exit', () => { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5 }); fs.rmSync(extDir, { recursive: true, force: true }); process.exit(0); });
ch.kill();
