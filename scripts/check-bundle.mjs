// Checks the gzip size of every script and stylesheet of the BUILT extension, and their total, against
// scripts/bundle-budget.json. Run after `wxt build`. A file is named without its content hash
// (`chunks/openai-Bl_F7xL3.js` is `chunks/openai.js`); files that share a name count together. A file the
// budget does not list, or a listed one the build no longer has, fails too: the budget is then set again
// on purpose, with `--update` (the measured sizes plus 10%) and a new `note`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUILD = '.output/chrome-mv3';
const BUDGET = 'scripts/bundle-budget.json';
const MARGIN = 1.1;

/** Every .js and .css file under `dir`, as build-relative paths. */
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(js|css)$/.test(e.name) ? [join(dir, e.name)] : []));
}

const sizes = {};
for (const file of files(BUILD)) {
  const name = relative(BUILD, file).replace(/-[\w-]{8}(\.(js|css))$/, '$1');
  sizes[name] = (sizes[name] ?? 0) + gzipSync(readFileSync(file), { level: 9 }).length;
}
const total = Object.values(sizes).reduce((a, b) => a + b, 0);
const names = Object.keys(sizes).sort();

if (process.argv.includes('--update')) {
  const note = process.argv[process.argv.indexOf('--update') + 1];
  if (!note || note.startsWith('--')) throw new Error('--update needs a note: where the sizes were measured, and when');
  const budget = { note, files: Object.fromEntries(names.map((n) => [n, Math.ceil(sizes[n] * MARGIN)])), total: Math.ceil(total * MARGIN) };
  writeFileSync(BUDGET, `${JSON.stringify(budget, null, 2)}\n`);
  console.log(`check-bundle: wrote ${BUDGET} (measured ${total} B gzip in all, plus 10%)`);
  process.exit(0);
}

const budget = JSON.parse(readFileSync(BUDGET, 'utf8'));
const problems = [];
for (const n of names) {
  const limit = budget.files[n];
  if (limit === undefined) problems.push(`${n}: ${sizes[n]} B gzip, not in the budget`);
  else if (sizes[n] > limit) problems.push(`${n}: ${sizes[n]} B gzip, over its budget of ${limit} B`);
}
for (const n of Object.keys(budget.files)) if (!(n in sizes)) problems.push(`${n}: in the budget, not in the build`);
if (total > budget.total) problems.push(`total: ${total} B gzip, over its budget of ${budget.total} B`);

if (problems.length) {
  console.error(`check-bundle: ${problems.length} problem(s) against ${BUDGET}:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-bundle: ${names.length} files, ${total} B gzip in all, within ${BUDGET} (total budget ${budget.total} B)`);
