// Runs a TS/ESM script after bundling it to CommonJS with esbuild (Node cannot load `phonemize`'s JSON imports
// natively, and one of its dependencies uses `await` as an identifier, so ESM output fails). No top-level await.
// Usage: node scripts/run.mjs scripts/score-en.ts [args...]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname;
// CJS output has no import.meta: give each of our own source files its real path instead.
const importMetaPerFile = {
  name: 'import-meta-per-file',
  setup(b) {
    b.onLoad({ filter: /spikes\/s10\/.*\.(ts|mjs)$|scratchpad\/.*\.(ts|mjs)$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      return {
        contents: src
          .replaceAll('import.meta.dirname', JSON.stringify(dirname(args.path)))
          .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(args.path).href)),
        loader: args.path.endsWith('.ts') ? 'ts' : 'js',
        resolveDir: dirname(args.path),
      };
    });
  },
};
const entry = resolve(process.argv[2]);
const outDir = resolve(here, '../../../.cache/s10/run');
mkdirSync(outDir, { recursive: true });
const outfile = resolve(outDir, basename(entry).replace(/\.ts$/, '.cjs'));
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  packages: 'bundle',
  external: ['@playwright/test', 'esbuild'],
  plugins: [importMetaPerFile],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(3)], { stdio: 'inherit', cwd: process.cwd() });
process.exit(r.status ?? 1);
