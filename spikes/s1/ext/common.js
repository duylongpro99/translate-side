// Config is passed via panel.html?scenario=..&port=..&dur=..
self.S1 = {
  log(base, o) { return fetch(base + '/log', { method: 'POST', body: JSON.stringify(o) }).catch(() => {}); },
  async stream(base, who, dur, onChunk) {
    const ttfb = (who.match(/ttfb(\d+)/) || [0, 0])[1];
    const r = await fetch(`${base}/stream?dur=${dur}&who=${who}&ttfb=${ttfb}`);
    const rd = r.body.getReader(); const dec = new TextDecoder(); let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; n += (dec.decode(value).match(/data:/g) || []).length; await onChunk(n); }
    return n;
  },
};
