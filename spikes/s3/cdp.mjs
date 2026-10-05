// Minimal CDP-over-pipe helper for a throwaway headless Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
export async function launch() {
  const udd = fs.mkdtempSync(path.join(process.env.TMPDIR, 's3-udd-'));
  const ch = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--user-data-dir=${udd}`, '--headless=new', '--no-first-run',
    '--window-size=1280,900', '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let id = 0, buf = ''; const pend = new Map(), listeners = [];
  ch.stdio[4].on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\0')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else listeners.forEach((l) => l(m)); }
  });
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); ch.stdio[3].write(JSON.stringify({ id: i, method, params, sessionId }) + '\0'); });
  const close = () => new Promise((r) => { ch.on('exit', () => { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5 }); r(); }); ch.kill(); });
  return { send, close, listeners };
}
export async function openPage(cdp, url) {
  const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })).result;
  const s = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  await cdp.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36', acceptLanguage: 'en-US,en' }, s);
  await cdp.send('Page.enable', {}, s);
  const loaded = new Promise((r) => { const l = (m) => { if (m.sessionId === s && m.method === 'Page.loadEventFired') r(); }; cdp.listeners.push(l); setTimeout(r, 30000); });
  await cdp.send('Page.navigate', { url }, s);
  await loaded;
  const ev = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s)).result?.result?.value;
  return { s, targetId, ev, close: () => cdp.send('Target.closeTarget', { targetId }) };
}
