// Applies the repair plan to an arm: for every chunk whose plan has re-request ids, sends ONE follow-up call with only
// those segments (same prompt, max_tokens 4096, escaped source when the first pass was ambiguous), parses it, and merges
// the result. Writes runs/<arm>.repair.jsonl and prints segment loss before and after repair.
// Usage: node repair.mjs <arm>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { reparse, CH } from './reparse.mjs';

const arm = process.argv[2];
const rows = fs.readFileSync(new URL(`runs/${arm}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.status === 200);
// The plan comes from the offline v2 re-parse, not from the parse stored at run time (older arms ran with v1).
for (const row of rows) row.plan = reparse(row, 'v2').pl;
const all = CH;
const todo = rows.filter((r) => r.plan.rerequest.length);
// Sub-chunks keep the original ids, so the parser's expected set is exactly the re-request set.
const sub = todo.map((r) => ({ ...all[r.chunk], id: `${r.chunk}`, segs: all[r.chunk].segs.filter((s) => r.plan.rerequest.includes(s.id)), ambiguous: r.plan.ambiguous }));
const plain = sub.filter((c) => !c.ambiguous), escd = sub.filter((c) => c.ambiguous);
const lang = rows[0]?.lang ?? 'vi', effort = rows[0]?.effort ?? 'low';
const runSet = (set, name, extra) => {
  if (!set.length) return [];
  const f = new URL(`runs/_sub-${name}.json`, import.meta.url);
  fs.writeFileSync(f, JSON.stringify(set));
  const r = spawnSync('node', ['run.mjs', `${arm}.repair-${name}`, '--set', 'file', '--file', f.pathname, '--lang', lang, '--effort', effort, '--max-tokens', '4096', '--conc', '4', ...extra], { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
  if (r.status) throw new Error('repair run failed');
  fs.unlinkSync(f);
  return fs.readFileSync(new URL(`runs/${arm}.repair-${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
};
const rep = [...runSet(plain, 'plain', []), ...runSet(escd, 'escaped', ['--escape'])];
const byChunk = Object.fromEntries(rep.map((r) => [r.chunk, r]));
let total = 0, lostBefore = 0, lostAfter = 0, calls = rep.length;
const lines = [];
for (const r of rows) {
  total += r.nSegs;
  const bad = new Set(r.plan.rerequest);
  lostBefore += bad.size;
  if (!bad.size) continue;
  const f = byChunk[r.chunk];
  const fixed = f?.status === 200 ? Object.keys(f.segs).map(Number).filter((id) => bad.has(id) && !f.plan.rerequest.includes(id)) : [];
  const still = [...bad].filter((id) => !fixed.includes(id));
  lostAfter += still.length;
  lines.push({ chunk: r.chunk, rerequest: [...bad], fixed, still, secondFinish: f?.finish, secondFixes: f?.fixes?.map((x) => x.kind) });
}
const summary = { arm, chunks: rows.length, segments: total, rerequestedSegs: lostBefore, repairCalls: calls, lostAfterOneRepair: lostAfter, detail: lines };
fs.writeFileSync(new URL(`runs/${arm}.repair.json`, import.meta.url), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, detail: lines.filter((l) => l.still.length) }));
