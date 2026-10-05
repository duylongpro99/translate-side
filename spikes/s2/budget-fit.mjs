// Budget formula fit (S2 record §6): headroom = formula budget − completion tokens actually used, per chunk.
// In-sample = the 270 low-effort first-pass calls the formula was fitted on (max_tokens 4096, none cut);
// holdout = the DESIGN-size arms (runs/large-*.jsonl), which ran WITH the formula as max_tokens.
// Usage: node budget-fit.mjs
import fs from 'node:fs';
const dir = new URL('runs/', import.meta.url);
const load = (f) => fs.readFileSync(new URL(f, dir), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter((r) => r.status === 200 && r.usage);
const formula = (r, k = 2.0, reserve = 256) => Math.ceil(k * (r.srcChars / 4) + 12 * r.nSegs + reserve);
const IN = ['vi-raw-1', 'vi-raw-2', 'vi-esc', 'de-raw', 'ja-raw'].flatMap((a) => load(`${a}.jsonl`));
const report = (name, rows) => {
  const h = rows.map((r) => ({ chunk: `${r.arm}/${r.chunk}`, used: r.usage.completion_tokens, budget: formula(r), headroom: formula(r) - r.usage.completion_tokens, ratio: r.usage.completion_tokens / formula(r), finish: r.finish })).sort((a, b) => a.headroom - b.headroom);
  const q = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];
  console.log(`\n${name}: ${rows.length} chunks; over budget ${h.filter((x) => x.headroom < 0 || x.finish === 'length').length}; used/budget med ${q(h.map((x) => x.ratio), 0.5).toFixed(2)}, p90 ${q(h.map((x) => x.ratio), 0.9).toFixed(2)}, max ${Math.max(...h.map((x) => x.ratio)).toFixed(2)}`);
  console.log('smallest headroom:', h.slice(0, 5).map((x) => `${x.chunk} ${x.headroom} (${x.used}/${x.budget}${x.finish === 'length' ? ', cut' : ''})`).join('; '));
};
report('in-sample (fitted on)', IN);
for (const f of fs.readdirSync(dir).filter((f) => /^large-[^.]+\.jsonl$/.test(f))) report(`holdout ${f}`, load(f));
