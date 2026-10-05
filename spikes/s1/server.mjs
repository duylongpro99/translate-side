// Throttled mock LLM stream + log sink for S1. Usage: node server.mjs <port> <logfile>
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.argv[2] ?? 8787);
const logFile = process.argv[3] ?? 'log.jsonl';
const t0 = Date.now();
const log = (o) => fs.appendFileSync(logFile, JSON.stringify({ t: ((Date.now() - t0) / 1000).toFixed(1), ...o }) + '\n');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/log') {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { log(JSON.parse(b)); } catch { log({ bad: b }); } res.end('ok'); });
    return;
  }
  if (u.pathname === '/stream') {
    const dur = Number(u.searchParams.get('dur') ?? 90), who = u.searchParams.get('who') ?? '?';
    const ttfb = Number(u.searchParams.get('ttfb') ?? 0);
    let n = 0, done = false, iv = null;
    log({ src: 'server', ev: 'stream-open', who, dur, ttfb });
    const t = setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); start(); }, ttfb * 1000);
    const start = () => iv = setInterval(() => {
      n++;
      res.write(`data: {"tok":${n}}\n\n`);
      if (n >= dur) { done = true; clearInterval(iv); res.end(); log({ src: 'server', ev: 'stream-complete', who, n }); }
    }, 1000);
    res.on('close', () => { clearTimeout(t); clearInterval(iv); if (!done) log({ src: 'server', ev: 'stream-ABORTED-by-client', who, n }); });
    return;
  }
  res.end('?');
}).listen(port, '127.0.0.1', () => log({ src: 'server', ev: 'listening', port }));
