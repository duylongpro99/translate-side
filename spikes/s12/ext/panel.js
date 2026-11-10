// Logs its lifecycle, a 1 s tick and the progress of a slow streaming fetch, so the log shows whether a hidden panel runs.
const base = self.CFG.base;
const tab = new URLSearchParams(location.search).get('tab') ?? 'global';
const t0 = Date.now();
const log = (o) => fetch(base + '/log', { method: 'POST', body: JSON.stringify({ src: 'panel', tab, ...o }) }).catch(() => {});
document.getElementById('who').textContent = 'panel for tab ' + tab;
log({ ev: 'panel-LOADED', href: location.href, visibility: document.visibilityState });
let seq = 0, frames = 0;
// Animation frames stop when the panel is not drawn, even when visibilityState stays 'visible'.
const frame = () => { frames++; requestAnimationFrame(frame); };
requestAnimationFrame(frame);
setInterval(() => { log({ ev: 'tick', seq: ++seq, upMs: Date.now() - t0, visibility: document.visibilityState, frames, width: innerWidth }); frames = 0; }, 1000);
addEventListener('visibilitychange', () => log({ ev: 'panel-visibility', state: document.visibilityState }));
addEventListener('pagehide', () => log({ ev: 'panel-UNLOAD' }));
(async () => {
  try {
    const res = await fetch(`${base}/slow?tab=${tab}`);
    const reader = res.body.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      log({ ev: 'fetch-progress', bytes, visibility: document.visibilityState });
    }
    log({ ev: 'fetch-DONE', bytes });
  } catch (e) { log({ ev: 'fetch-ERR', err: String(e) }); }
})();
