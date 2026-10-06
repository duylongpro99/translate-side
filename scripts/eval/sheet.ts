// Writes the human scoring sheet for a run: pnpm run eval:sheet -- <run-dir> [--out file] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { listPassageIds, loadPassage } from './passages.ts';
import { HUMAN_SHEET, loadRun } from './runs.ts';
import { renderHumanSheet, renderPassageBlock } from './sheet-core.ts';

const { values: opt, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: { out: { type: 'string' }, force: { type: 'boolean', default: false } },
});
const root = path.resolve(process.cwd());
const dir = positionals[0];
if (!dir) throw new Error('usage: pnpm run eval:sheet -- <run-dir> [--out file] [--force]');
const run = loadRun(path.resolve(dir));
const out = path.resolve(opt.out ?? path.join(run.dir, HUMAN_SHEET));
if (fs.existsSync(out) && !opt.force) throw new Error(`${out} exists: it may hold scores. Pass --force to overwrite.`);
const ids = listPassageIds(root).filter((id) => run.outputs[id]);
const blocks = ids.map((id) => renderPassageBlock(loadPassage(root, id), run.outputs[id] ?? [], run.summary.target));
fs.writeFileSync(out, renderHumanSheet(run.summary, blocks));
console.log(`wrote ${path.relative(root, out)} (${ids.length} passages)`);
