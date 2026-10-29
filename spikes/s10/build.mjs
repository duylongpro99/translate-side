// Bundles entries/bench.ts into ext/bench.js and copies the onnxruntime-web WASM runtime into ext/ort/.
// Everything the page runs ships inside ext/ (MV3: no remote code); only voice weights are fetched.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const here = dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const ortDir = dirname(require.resolve('onnxruntime-web/wasm'));
// phonemize's anyascii table (870 KB) only serves its opt-in `anyAscii` transliteration, which we never enable.
const stubAnyAscii = {
  name: 'stub-anyascii',
  setup(b) {
    b.onLoad({ filter: /anyascii\.json$/ }, () => ({ contents: '{}', loader: 'json' }));
  },
};
// Keep IPA as UTF-8 instead of \uXXXX escapes (phonemize's lexicon is IPA-heavy).
const common = { bundle: true, format: 'esm', minify: true, charset: 'utf8', plugins: [stubAnyAscii], conditions: ['onnxruntime-web-use-extern-wasm'] };

await build({
  ...common,
  entryPoints: [join(here, 'entries/bench.ts')],
  target: 'chrome120',
  outfile: join(here, 'ext/bench.js'),
  logLevel: 'warning',
});

mkdirSync(join(here, 'ext/ort'), { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(join(ortDir, f), join(here, 'ext/ort', f));

// Sizes: what the product would add to the package.
const files = ['bench.js', 'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm'];
const sizes = Object.fromEntries(
  files.map((f) => {
    const buf = readFileSync(join(here, 'ext', f));
    return [f, { raw: statSync(join(here, 'ext', f)).size, gzip9: gzipSync(buf, { level: 9 }).length }];
  }),
);
// The G2P parts on their own (bundled + minified), to separate them from the ORT JS in bench.js.
for (const [name, entry] of [
  ['g2p-vi', join(here, 'g2p-vi.ts')],
  ['g2p-en (phonemize + adapter)', join(here, 'g2p-en.ts')],
  ['piper-plus-en (rejected)', '@piper-plus/g2p/en'],
  ['ort-wasm-js', 'onnxruntime-web/wasm'],
]) {
  const r = await build({
    ...common,
    stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: here, loader: 'ts' },
    write: false,
  });
  const buf = Buffer.from(r.outputFiles[0].contents);
  sizes[`(part) ${name}`] = { raw: buf.length, gzip9: gzipSync(buf, { level: 9 }).length };
}
const total = files.reduce((a, f) => ({ raw: a.raw + sizes[f].raw, gzip9: a.gzip9 + sizes[f].gzip9 }), { raw: 0, gzip9: 0 });
const ortVersion = JSON.parse(readFileSync(join(ortDir, '..', 'package.json'), 'utf8')).version;
const out = { onnxruntimeWeb: ortVersion, files: sizes, shippedTotal: total };
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results/bundle-size.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
