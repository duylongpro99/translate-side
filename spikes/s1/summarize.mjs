// Summarize results/*.jsonl into one row per (round, scenario).
import fs from 'node:fs';
const rows = [];
for (const f of fs.readdirSync('results').filter((f) => f.endsWith('.jsonl')).sort()) {
  const [, round, sc] = f.match(/^r(\d)-(.+)\.jsonl$/);
  const L = fs.readFileSync('results/' + f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const find = (p) => L.find(p);
  const open = find((l) => l.ev === 'stream-open'), done = find((l) => l.ev === 'stream-complete'), ab = find((l) => l.ev === 'stream-ABORTED-by-client');
  const start = find((l) => l.ev === 'job-start' || l.ev === 'panel-job-start' || l.ev === 'idle-no-job');
  const down = find((l) => l.ev === 'SW-TARGET-DOWN');
  const resume = find((l) => l.ev === 'sw-start');
  rows.push({ round, sc,
    stream: done ? `complete ${done.n} chunks` : ab ? `ABORTED after ${ab.n} chunks (${(ab.t - open.t).toFixed(1)}s)` : open ? 'open?' : '-',
    swDownAfterStart: down ? `${(down.t - start.t).toFixed(1)}s` : 'alive at end',
    sessionStateOnRestart: resume ? JSON.stringify(resume.session.job) : '' });
}
console.log('| round | scenario | stream result | worker down (s after job start) | storage.session seen on restart |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.round} | ${r.sc} | ${r.stream} | ${r.swDownAfterStart} | ${r.sessionStateOnRestart.replace(/"startedAt":\d+,?/, '')} |`);
