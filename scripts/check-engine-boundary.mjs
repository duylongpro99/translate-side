// Structural engine boundary check (DESIGN.md §5.1), run in CI next to lint:
//   1. src/engine/ contains only regular .ts files (plus its tsconfig.json): no symlinks and no
//      .mts/.cts/.js/… files that other tooling might treat differently.
//   2. TypeScript's own resolver builds the engine program (all non-test engine files, with
//      src/engine/tsconfig.json). Every file in its transitive closure must be inside
//      src/engine/, be src/llm/types.ts, or be a TypeScript default lib file. A relay through
//      another folder, an alias, or a package (wxt, @types/chrome, …) shows up here.
//   3. ESLint itself confirms the boundary applies: only the root eslint.config.js exists (ESLint
//      10 looks up config per file, so a nested one would replace it), and the effective config
//      for every engine file has the boundary rules on and inline config off.
// Run: node scripts/check-engine-boundary.mjs [root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';

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
    if (!/\.test\.[a-z]+$/.test(file) && config?.linterOptions?.noInlineConfig !== true) {
      problems.push(`${rel}: inline ESLint config is not disabled`);
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
    } else if (!inside && real !== interfaceFile) {
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
  console.log('engine boundary: OK (closure = src/engine/ + src/llm/types.ts + TS lib; ESLint boundary applies to every engine file)');
}
