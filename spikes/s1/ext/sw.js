importScripts('common.js');
const bootAt = Date.now();
let base = null;
// On every worker start, report what job state survived in storage.session.
chrome.storage.session.get(null).then((s) => {
  if (s.base) { base = s.base; S1.log(base, { src: 'sw', ev: 'sw-start', session: s }); }
});
async function runJob(cfg, port) {
  base = cfg.base;
  await chrome.storage.session.set({ base, job: { scenario: cfg.scenario, startedAt: Date.now(), state: 'running', n: 0 } });
  S1.log(base, { src: 'sw', ev: 'job-start', scenario: cfg.scenario, dur: cfg.dur });
  let ping = null;
  if (cfg.scenario.includes('platformping')) ping = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  let last = 0;
  try {
    const n = await S1.stream(base, 'sw-' + cfg.scenario, cfg.dur, async (n) => {
      if (cfg.scenario.includes('portmsgs') && port) port.postMessage({ n });
      if (cfg.scenario.includes('persist')) await chrome.storage.session.set({ job: { scenario: cfg.scenario, state: 'running', n } });
      if (n - last >= 10) { last = n; S1.log(base, { src: 'sw', ev: 'progress', n, upSec: Math.round((Date.now() - bootAt) / 1000) }); }
    });
    S1.log(base, { src: 'sw', ev: 'job-COMPLETE', n });
    await chrome.storage.session.set({ job: { scenario: cfg.scenario, state: 'complete', n } });
  } catch (e) {
    S1.log(base, { src: 'sw', ev: 'job-error', err: String(e) });
  } finally { clearInterval(ping); }
}
chrome.runtime.onMessage.addListener((m) => { if (m.cmd === 'start') runJob(m); });
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((m) => {
    if (m.cmd === 'start') runJob(m, port);
    else if (m.cmd === 'ping') {} // receiving the message is the point
    else if (m.cmd === 'hello') S1.log(base ?? m.base, { src: 'sw', ev: 'port-hello-after-reconnect' });
  });
});
