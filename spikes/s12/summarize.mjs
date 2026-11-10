// Summarizes an S12 log per driver step. Usage: node summarize.mjs results/<run>.jsonl
// For each step: the panel documents that exist, worker events, and per panel the ticks, drawn frames and fetch bytes.
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const run = lines.find((l) => l.ev === 'run');
console.log(`# ${process.argv[2]} | ${run?.scenario} ${run?.order} | ${run?.chromeVersion}`);
let cur = { name: 'setup', panel: new Map(), events: [] };
const flush = () => {
  const per = [...cur.panel].map(([tab, p]) => `tab ${tab}: ${p.ticks} ticks, ${p.frames} frames, vis ${[...p.vis].join('/')}, fetch ${p.bytes ?? '-'}`);
  console.log(`- ${cur.name} | panels ${JSON.stringify(cur.panels ?? [])}`);
  for (const e of cur.events) console.log(`    ${e}`);
  for (const p of per) console.log(`    ${p}`);
};
for (const l of lines) {
  if (l.src === 'driver' && l.ev?.startsWith('STEP')) { flush(); cur = { name: l.ev, panel: new Map(), events: [] }; continue; }
  if (l.src === 'driver' && l.ev?.startsWith('after')) { cur.panels = l.panels; continue; }
  if (l.src === 'panel') {
    const p = cur.panel.get(l.tab) ?? { ticks: 0, frames: 0, vis: new Set() };
    cur.panel.set(l.tab, p);
    if (l.ev === 'tick') { p.ticks++; p.frames += l.frames; p.vis.add(l.visibility); continue; }
    if (l.ev === 'fetch-progress') { p.bytes = l.bytes; continue; }
    cur.events.push(`${l.t} panel(${l.tab}) ${l.ev}${l.state ? ' ' + l.state : ''}${l.err ? ' ' + l.err : ''}`);
    continue;
  }
  if (l.src === 'sw' && l.ev === 'page-width') { cur.events.push(`${l.t} active page ${l.tabId} width ${l.width}`); continue; }
  if (l.src === 'sw' && !/^activate-/.test(l.ev)) {
    const detail = l.err ?? (l.r !== undefined ? JSON.stringify(l.r) : l.i ? JSON.stringify(l.i) : l.tabId ?? '');
    cur.events.push(`${l.t} sw ${l.ev} ${String(detail).slice(0, 140)}`);
  }
}
flush();
