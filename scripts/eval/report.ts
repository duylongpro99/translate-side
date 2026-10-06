// Comparison report over runs: pnpm run eval:report -- <run-dir> [<run-dir> …] [--out file]
// The first run is the baseline. Reads summary.json, human-scores.md and judge.json from each run folder.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { listPassageIds, loadPassage } from './passages.ts';
import { renderReport } from './report-core.ts';
import { loadRun } from './runs.ts';

const { values: opt, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: { out: { type: 'string' } },
});
const root = path.resolve(process.cwd());
if (positionals.length === 0) throw new Error('usage: pnpm run eval:report -- <run-dir> [<run-dir> …] [--out file]');
const categories: Record<string, string> = {};
for (const id of listPassageIds(root)) categories[id] = loadPassage(root, id).meta.category;
const md = renderReport({ runs: positionals.map((d) => loadRun(path.resolve(d))), categories });
if (opt.out) fs.writeFileSync(path.resolve(opt.out), md);
process.stdout.write(md);
