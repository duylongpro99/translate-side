// Proves layer 2 of the engine/ boundary (scripts/check-engine-boundary.mjs): with TypeScript's
// own resolver, the engine program may reach only src/engine/, src/llm/types.ts and TS lib
// files, and src/engine/ holds only regular .ts files. Each probe builds a real file tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { checkEngineBoundary } from '../../scripts/check-engine-boundary.mjs';

const REPO = process.cwd();
const roots: string[] = [];

/** A copy of the repo's engine and interface, with node_modules linked so packages resolve. */
function makeRoot(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-boundary-'));
  roots.push(root);
  fs.cpSync(path.join(REPO, 'src/engine'), path.join(root, 'src/engine'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/llm'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'src/llm/types.ts'), path.join(root, 'src/llm/types.ts'));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  for (const f of ['eslint.config.js', 'eslint/boundary-plugin.js', 'package.json']) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  }
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('engine/ boundary (resolver closure)', () => {
  it('the real repo passes', async () => {
    expect(await checkEngineBoundary(REPO)).toEqual([]);
  });

  it('a clean copy passes', async () => {
    expect(await checkEngineBoundary(makeRoot())).toEqual([]);
  });

  it('rejects a relay through another src/ folder (tester round 2 a)', async () => {
    const root = makeRoot({
      'src/lib/reexport.ts': `export { browser } from 'wxt/browser';\n`,
      'src/engine/x.ts': `import { browser } from '../lib/reexport';\nexport const b = browser;\n`,
    });
    const problems = (await checkEngineBoundary(root)).join('\n');
    expect(problems).toMatch(/src\/lib\/reexport\.ts: outside the engine boundary/);
    expect(problems).toMatch(/node_modules\/.*wxt/);
  });

  it('rejects a relay to an llm/ implementation', async () => {
    const root = makeRoot({
      'src/llm/openai.ts': `export const impl = 1;\n`,
      'src/lib/relay.ts': `export { impl } from '../llm/openai';\n`,
      'src/engine/x.ts': `import { impl } from '../lib/relay';\nexport const i = impl;\n`,
    });
    expect((await checkEngineBoundary(root)).join('\n')).toMatch(/src\/llm\/openai\.ts: outside the engine boundary/);
  });

  it.each(['leak.mts', 'leak.cts', 'leak.js', 'leak.mjs', 'leak.json', 'leak.tsx'])(
    'rejects non-.ts files such as src/engine/%s (tester round 2 b)',
    async (name) => {
      const root = makeRoot({ [`src/engine/${name}`]: `export const x = 1;\n` });
      expect(await checkEngineBoundary(root)).toContain(`src/engine/${name}: only .ts files are allowed in src/engine/`);
    },
  );

  it('follows a .mts leak into the llm/ implementation it re-exports', async () => {
    const root = makeRoot({
      'src/llm/openai.ts': `export const impl2 = 1;\n`,
      'src/engine/leak.mts': `export { impl2 } from '../llm/openai';\n`,
      'src/engine/x.ts': `import { impl2 } from './leak.mjs';\nexport const i = impl2;\n`,
    });
    const problems = (await checkEngineBoundary(root)).join('\n');
    expect(problems).toMatch(/leak\.mts: only \.ts files/);
    expect(problems).toMatch(/src\/llm\/openai\.ts: outside the engine boundary/);
  });

  it('rejects symlinks in src/engine/', async () => {
    const root = makeRoot({ 'src/lib/reexport.ts': `export { browser } from 'wxt/browser';\n` });
    fs.symlinkSync(path.join(root, 'src/lib/reexport.ts'), path.join(root, 'src/engine/link.ts'));
    expect(await checkEngineBoundary(root)).toContain('src/engine/link.ts: symlinks are not allowed in src/engine/');
  });

  it('rejects a package import even when lint is bypassed', async () => {
    const root = makeRoot({ 'src/engine/x.ts': `import type { Browser } from 'wxt/browser';\nexport type B = Browser;\n` });
    expect((await checkEngineBoundary(root)).join('\n')).toMatch(/node_modules\/.*wxt.*outside the engine boundary/);
  });

  it.each(['src/eslint.config.js', 'src/engine/eslint.config.js', 'src/engine/deep/eslint.config.mjs', 'src/.eslintrc.json'])(
    'rejects a nested ESLint config at %s (own red-team)',
    async (file) => {
      const root = makeRoot({ [file]: file.endsWith('.json') ? '{}' : 'export default [];\n' });
      expect((await checkEngineBoundary(root)).join('\n')).toContain(`${file}: only the root eslint.config.js may exist`);
    },
  );

  it('rejects a root config that drops the boundary for engine files', async () => {
    const root = makeRoot();
    const config = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
    // A narrowed glob: .mts files in engine/ would silently lose every boundary rule.
    const narrowed = config.replace("export const ENGINE_FILES = ['src/engine/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];", "export const ENGINE_FILES = ['src/engine/**/*.ts'];");
    expect(narrowed).not.toBe(config);
    fs.writeFileSync(path.join(root, 'eslint.config.js'), narrowed);
    const problems = (await checkEngineBoundary(root)).join('\n');
    expect(problems).toMatch(/src\/engine\/probe\.mts: ESLint rule no-restricted-syntax is not on/);
    expect(problems).toMatch(/src\/engine\/probe\.mts: inline ESLint config is not disabled/);
    expect(problems).not.toMatch(/src\/engine\/index\.ts:/);
  });

  it('rejects a root config that turns a boundary rule off', async () => {
    const root = makeRoot();
    const config = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
    const off = config.replace("    'no-new-func': 'error',", "    'no-new-func': 'off',");
    expect(off).not.toBe(config);
    fs.writeFileSync(path.join(root, 'eslint.config.js'), off);
    expect((await checkEngineBoundary(root)).join('\n')).toMatch(/src\/engine\/index\.ts: ESLint rule no-new-func is not on/);
  });

  it('rejects engine source that imports a test file', async () => {
    const root = makeRoot({
      'src/engine/x.test.ts': `export const t = 1;\n`,
      'src/engine/x.ts': `import { t } from './x.test.ts';\nexport const u = t;\n`,
    });
    expect(await checkEngineBoundary(root)).toContain('src/engine/x.test.ts: engine source must not import test files');
  });

  it('rejects a root config that stops banning TS suppressions in engine source (tester round 3 B)', async () => {
    const root = makeRoot();
    const config = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
    const off = config.replace("{ 'ts-expect-error': true,", "{ 'ts-expect-error': 'allow-with-description',");
    expect(off).not.toBe(config);
    fs.writeFileSync(path.join(root, 'eslint.config.js'), off);
    expect(await checkEngineBoundary(root)).toContain('src/engine/index.ts: @ts-expect-error/@ts-ignore/@ts-nocheck are not banned');
  });

  // Round 3 (NB-4): one allowlist, used by ESLint and by this check.
  it('rejects a root config whose engine package allowlist differs from the shared one', async () => {
    const root = makeRoot();
    const config = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
    const widened = config.replace('allowedPackages: ENGINE_PACKAGES', "allowedPackages: ['wxt']");
    expect(widened).not.toBe(config);
    fs.writeFileSync(path.join(root, 'eslint.config.js'), widened);
    expect((await checkEngineBoundary(root)).join('\n')).toMatch(/src\/engine\/index\.ts: boundary\/engine-imports allows packages \["wxt"\]/);
  });
});

// Round 3 (tester D): the type layer is only as good as src/engine/tsconfig.json, so its
// contents are checked too (a DOM lib file counts as a TS lib file in the closure above).
describe('engine/ boundary (tsconfig contents)', () => {
  type Options = Record<string, unknown>;
  function withTsconfig(edit: (cfg: { compilerOptions: Options } & Options) => void): string {
    const root = makeRoot();
    const file = path.join(root, 'src/engine/tsconfig.json');
    const { config } = ts.parseConfigFileTextToJson(file, fs.readFileSync(file, 'utf8'));
    edit(config);
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    return root;
  }

  it.each([
    ['DOM lib', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.lib = ['ES2022', 'DOM']; }, /lib must not include "DOM"/],
    ['DOM.Iterable lib', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.lib = ['ES2022', 'dom.iterable']; }, /lib must not include "dom\.iterable"/],
    ['WebWorker lib', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.lib = ['ES2022', 'WebWorker']; }, /lib must not include "WebWorker"/],
    ['WebWorker.ImportScripts lib', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.lib = ['ES2022', 'webworker.importscripts']; }, /lib must not include/],
    ['default lib (no lib option)', (c: Options & { compilerOptions: Options }) => { delete c.compilerOptions.lib; }, /lib must be set/],
    ['ambient chrome types', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.types = ['chrome']; }, /types must be \[\]/],
    ['all ambient types (no types option)', (c: Options & { compilerOptions: Options }) => { delete c.compilerOptions.types; }, /types must be \[\]/],
    ['typeRoots', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.typeRoots = ['../../node_modules/@types']; }, /typeRoots is not allowed/],
    ['paths', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.paths = { '@/*': ['../*'] }; }, /paths is not allowed/],
    ['baseUrl', (c: Options & { compilerOptions: Options }) => { c.compilerOptions.baseUrl = '..'; }, /baseUrl is not allowed/],
    ['extends', (c: Options & { compilerOptions: Options }) => { c.extends = '../../tsconfig.json'; }, /extends is not allowed/],
    ['wider include', (c: Options & { compilerOptions: Options }) => { c.include = ['../**/*.ts']; }, /include must be/],
    ['changed exclude', (c: Options & { compilerOptions: Options }) => { c.exclude = []; }, /exclude must be/],
    ['files', (c: Options & { compilerOptions: Options }) => { c.files = ['../shared/panel.ts']; }, /files is not allowed/],
  ])('rejects %s', async (_name, edit, pattern) => {
    expect((await checkEngineBoundary(withTsconfig(edit))).join('\n')).toMatch(pattern);
  });

  it('allows a newer ES lib', async () => {
    const root = withTsconfig((c) => { c.compilerOptions.lib = ['ES2023', 'ESNext.Disposable']; });
    expect(await checkEngineBoundary(root)).toEqual([]);
  });
});
