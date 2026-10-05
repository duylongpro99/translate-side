const q = new URLSearchParams(location.search);
const cfg = { cmd: 'start', scenario: q.get('scenario'), dur: Number(q.get('dur') || 90), base: `http://127.0.0.1:${q.get('port')}` };
const L = (o) => S1.log(cfg.base, { src: 'panel', ...o });
const sc = cfg.scenario;
if (sc.startsWith('idle')) {
  L({ ev: 'idle-no-job' });
} else if (sc.startsWith('panelhost')) {
  // Engine hosted in the extension page itself.
  L({ ev: 'panel-job-start' });
  S1.stream(cfg.base, 'panel', cfg.dur, async (n) => { if (n % 10 === 0) L({ ev: 'progress', n }); })
    .then((n) => L({ ev: 'job-COMPLETE', n }), (e) => L({ ev: 'job-error', err: String(e) }));
} else if (sc.startsWith('noport')) {
  chrome.runtime.sendMessage(cfg);
  L({ ev: 'sent-start-msg' });
} else {
  let port = chrome.runtime.connect({ name: 'job' });
  let msgs = 0; port.onMessage.addListener(() => msgs++);
  port.postMessage(cfg);
  let iv = sc.includes('panelping') ? setInterval(() => port.postMessage({ cmd: 'ping' }), 10000) : null;
  port.onDisconnect.addListener(() => {
    clearInterval(iv);
    L({ ev: 'port-DISCONNECTED', msgsReceived: msgs, err: chrome.runtime.lastError?.message });
    // Reconnecting wakes the worker again; sw-start reports what survived.
    setTimeout(() => { const p2 = chrome.runtime.connect({ name: 'job' }); p2.postMessage({ cmd: 'hello', base: cfg.base }); }, 2000);
  });
}
