// Serves site/ on 127.0.0.1 and localhost (two origins) and sinks logs. Usage: node server.mjs <port> <logfile>
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.argv[2]), logFile = process.argv[3];
const t0 = Date.now();
const log = (o) => fs.appendFileSync(logFile, JSON.stringify({ t: ((Date.now() - t0) / 1000).toFixed(1), ...o }) + '\n');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/log') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { log(JSON.parse(b)); res.end('ok'); }); return; }
  const f = 'site' + (u.pathname === '/a-pushed.html' ? '/a.html' : u.pathname);
  if (fs.existsSync(f)) { res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync(f, 'utf8').replaceAll('__PORT__', port)); }
  else { res.statusCode = 404; res.end('nf'); }
}).listen(port, () => log({ src: 'server', ev: 'listening', port }));
