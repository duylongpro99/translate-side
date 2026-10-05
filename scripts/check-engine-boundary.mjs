// Structural engine boundary check (DESIGN.md §5.1), run in CI next to lint:
//   1. src/engine/ contains only regular .ts files (plus its tsconfig.json): no symlinks and no
//      .mts/.cts/.js/… files that other tooling might treat differently.
//   2. TypeScript's own resolver builds the engine program (all non-test engine files, with
//      src/engine/tsconfig.json). Every file in its transitive closure must be inside
//      src/engine/, be src/llm/types.ts, or be a TypeScript default lib file. A relay through
//      another folder, an alias, or a package (wxt, @types/chrome, …) shows up here.
//   3. ESLint itself confirms the boundary applies: only the root eslint.config.js exists (ESLint
//      10 looks up config per file, so a nested one would replace it), and the effective config
//      for every engine file has the boundary rules on, inline config off, TS suppressions
//      banned, and the shared package allowlist (eslint/boundary-plugin.js).
//   4. src/engine/tsconfig.json is the expected shape: no DOM/WebWorker lib, no ambient types,
//      no extends/paths/baseUrl/typeRoots/files, and the expected include/exclude. Lib files
//      are trusted by step 2, so the lib list is what keeps DOM types out.
// Run: node scripts/check-engine-boundary.mjs [root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { ENGINE_PACKAGES, ENGINE_TEST_PACKAGES } from '../eslint/boundary-plugin.js';

const TEST_FILE = /\.test\.ts$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) out.push({ path: p, kind: 'symlink' });
    else if (entry.isDirectory()) walk(p, out);
    else out.push({ path: p, kind: entry.isFile() ? 'file' : 'other' });
  }
  return out;
}

const CONFIG_FILE = /^(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\..+)?)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.output', '.wxt', 'coverage']);
const REQUIRED_RULES = ['boundary/engine-imports', 'no-restricted-globals', 'no-restricted-syntax', 'no-eval', 'no-new-func'];
const SUPPRESSIONS = ['ts-expect-error', 'ts-ignore', 'ts-nocheck'];

const sameList = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());

/** Package name of a file under node_modules (the innermost one), or null. */
function packageOf(file) {
  const parts = file.split(path.sep);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0 || i + 1 >= parts.length) return null;
  return parts[i + 1].startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
}

const EXPECTED_INCLUDE = ['./**/*.ts'];
const EXPECTED_EXCLUDE = ['./**/*.test.ts'];
const FORBIDDEN_OPTIONS = ['paths', 'baseUrl', 'typeRoots', 'rootDirs'];
const FORBIDDEN_TOP = ['extends', 'files', 'references'];

function checkTsconfig(configPath, rel) {
  const problems = [];
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error || !config) return [`${rel}: cannot be read: ${error ? ts.flattenDiagnosticMessageText(error.messageText, '\n') : 'empty'}`];
  const opts = config.compilerOptions ?? {};
  for (const key of FORBIDDEN_TOP) if (key in config) problems.push(`${rel}: ${key} is not allowed`);
  for (const key of FORBIDDEN_OPTIONS) if (key in opts) problems.push(`${rel}: compilerOptions.${key} is not allowed`);
  if (!Array.isArray(opts.lib)) problems.push(`${rel}: compilerOptions.lib must be set (the default lib includes the DOM)`);
  for (const lib of opts.lib ?? []) {
    if (!/^es(\d+|next)(\..+)?$/i.test(lib) || /dom|webworker|scripthost/i.test(lib)) {
      problems.push(`${rel}: compilerOptions.lib must not include "${lib}" (ES libs only)`);
    }
  }
  if (!Array.isArray(opts.types) || opts.types.length > 0) {
    problems.push(`${rel}: compilerOptions.types must be [] (no ambient @types such as chrome or node)`);
  }
  if (!sameList(config.include, EXPECTED_INCLUDE)) problems.push(`${rel}: include must be ${JSON.stringify(EXPECTED_INCLUDE)}`);
  if (!sameList(config.exclude, EXPECTED_EXCLUDE)) problems.push(`${rel}: exclude must be ${JSON.stringify(EXPECTED_EXCLUDE)}`);
  return problems;
}

function findConfigFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) findConfigFiles(p, out);
    else if (CONFIG_FILE.test(entry.name)) out.push(p);
  }
  return out;
}

async function checkEslintApplies(root, engineFiles) {
  const problems = [];
  for (const file of findConfigFiles(root)) {
    if (file !== path.join(root, 'eslint.config.js')) {
      problems.push(`${path.relative(root, file)}: only the root eslint.config.js may exist (it would override the boundary)`);
    }
  }
  const eslint = new ESLint({ cwd: root });
  // Real files plus synthetic ones, so a new file or extension is covered before it exists.
  const probes = [...engineFiles, ...['probe.ts', 'probe.mts', 'probe.js', 'deep/probe.ts'].map((f) => path.join(root, 'src/engine', f))];
  for (const file of probes) {
    const rel = path.relative(root, file);
    let config;
    try {
      config = await eslint.calculateConfigForFile(file);
    } catch (err) {
      problems.push(`${rel}: ESLint config failed to load: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const rule of REQUIRED_RULES) {
      const severity = config?.rules?.[rule]?.[0];
      if (severity !== 2 && severity !== 'error') problems.push(`${rel}: ESLint rule ${rule} is not on`);
    }
    const isTest = /\.test\.[a-z]+$/.test(file);
    const allowed = config?.rules?.['boundary/engine-imports']?.[1]?.allowedPackages;
    if (!sameList(allowed, isTest ? ENGINE_TEST_PACKAGES : ENGINE_PACKAGES)) {
      problems.push(`${rel}: boundary/engine-imports allows packages ${JSON.stringify(allowed ?? [])}, not the shared list in eslint/boundary-plugin.js`);
    }
    if (isTest) continue;
    if (config?.linterOptions?.noInlineConfig !== true) problems.push(`${rel}: inline ESLint config is not disabled`);
    const [severity, banTs = {}] = config?.rules?.['@typescript-eslint/ban-ts-comment'] ?? [];
    if ((severity !== 2 && severity !== 'error') || SUPPRESSIONS.some((d) => banTs[d] !== true)) {
      problems.push(`${rel}: @ts-expect-error/@ts-ignore/@ts-nocheck are not banned`);
    }
  }
  return problems;
}

export async function checkEngineBoundary(root) {
  const engineDir = path.join(root, 'src/engine');
  const realEngine = fs.realpathSync(engineDir);
  const interfaceFile = fs.realpathSync(path.join(root, 'src/llm/types.ts'));
  const problems = [];
  const rel = (p) => path.relative(root, p);

  const entries = walk(engineDir);
  for (const e of entries) {
    if (e.kind !== 'file') problems.push(`${rel(e.path)}: ${e.kind}s are not allowed in src/engine/`);
    else if (!e.path.endsWith('.ts') && e.path !== path.join(engineDir, 'tsconfig.json')) {
      problems.push(`${rel(e.path)}: only .ts files are allowed in src/engine/`);
    }
  }

  const configPath = path.join(engineDir, 'tsconfig.json');
  problems.push(...checkTsconfig(configPath, rel(configPath)));
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  // Roots: every non-test .ts file on disk, not only what tsconfig "include" matches.
  const roots = entries
    .filter((e) => e.kind === 'file' && /\.(ts|mts|cts|tsx)$/.test(e.path) && !TEST_FILE.test(e.path))
    .map((e) => e.path);
  const program = ts.createProgram(roots, { ...parsed.options, allowJs: true, noEmit: true });
  for (const sf of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(sf)) continue;
    const real = fs.realpathSync(sf.fileName);
    const inside = !path.relative(realEngine, real).startsWith('..');
    if (TEST_FILE.test(real) && inside) {
      problems.push(`${rel(sf.fileName)}: engine source must not import test files`);
    } else if (!inside && real !== interfaceFile && !ENGINE_PACKAGES.includes(packageOf(real))) {
      problems.push(`${rel(sf.fileName)}: outside the engine boundary, but reachable from src/engine/`);
    }
  }
  problems.push(...(await checkEslintApplies(root, entries.filter((e) => e.kind === 'file' && !e.path.endsWith('.json')).map((e) => e.path))));
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? '.');
  const problems = await checkEngineBoundary(root);
  if (problems.length > 0) {
    console.error(`engine boundary violated (DESIGN.md §5.1):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('engine boundary: OK (closure = src/engine/ + src/llm/types.ts + TS lib; ESLint boundary applies to every engine file; engine tsconfig as expected)');
}
