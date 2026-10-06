// Runs a TypeScript entry that uses the extension's `@/` alias and extensionless imports (the
// extractor does) in plain Node: esbuild bundles it, the vendor packages stay external.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');

// The bundle lives two levels below the repo root, like tests/fixtures/, so load.ts's
// import.meta.dirname-relative paths still resolve.
/** Bundle `entry` (repo-relative) and import the result. Its top level runs on import. */
export async function runBundled(entry) {
  const dir = path.join(ROOT, '.cache/eval');
  mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, `${path.basename(entry).replace(/\.\w+$/, '')}.mjs`);
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    alias: { '@': path.join(ROOT, 'src') },
    logLevel: 'warning',
  });
  return import(pathToFileURL(outfile).href);
}
