import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import boundaryPlugin from './eslint/boundary-plugin.js';

// Engine boundary (DESIGN.md §5.1, plan M0 §6): engine/ may not reach chrome, wxt/*, the DOM
// or llm/ implementations. Three layers, each proven by tests/boundary:
//   1. here: an import ALLOWLIST (eslint/boundary-plugin.js) plus bans on every non-import way
//      to load code or reach the global object;
//   2. scripts/check-engine-boundary.mjs: TypeScript's resolver over the whole engine program,
//      and only .ts files (no symlinks) in src/engine/;
//   3. src/engine/tsconfig.json: no DOM lib and no ambient @types.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Every script extension, so a .mts/.js file can't sit outside the rules (layer 2 also bans them).
export const ENGINE_FILES = ['src/engine/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];
const ENGINE_TESTS = ['src/engine/**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

const LOADER = 'engine/ must use static imports, which the allowlist checks (DESIGN.md §5.1).';
const ESCAPE = 'engine/ must not reach the Function constructor or the global object (DESIGN.md §5.1).';

const engineBoundary = {
  name: 'engine boundary',
  files: ENGINE_FILES,
  plugins: { boundary: boundaryPlugin },
  rules: {
    'boundary/engine-imports': ['error', { root: ROOT, allowedPackages: [] }],
    'no-restricted-globals': [
      'error',
      // The global object itself is banned: it reaches chrome/DOM through casts, computed keys,
      // destructuring and aliases, which no property list can cover.
      ...['globalThis', 'self', 'global'].map((name) => ({
        name,
        message: 'engine/ must not use the global object; take what it needs through injected ports (DESIGN.md §5.1).',
      })),
      ...['chrome', 'browser'].map((name) => ({
        name,
        message: 'engine/ must not use extension APIs (DESIGN.md §5.1).',
      })),
      ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'location', 'HTMLElement', 'Element', 'Node', 'DOMParser', 'MutationObserver', 'IntersectionObserver'].map(
        (name) => ({ name, message: 'engine/ must not touch the DOM (DESIGN.md §5.1).' }),
      ),
      ...['Function', 'Reflect', 'eval'].map((name) => ({ name, message: ESCAPE })),
      // Runtime code loading and network: the engine talks to models only through LLMClient.
      ...['importScripts', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker'].map((name) => ({
        name,
        message: 'engine/ must not load code or use the network; use the LLMClient port (DESIGN.md §5.1).',
      })),
    ],
    'no-restricted-syntax': [
      'error',
      { selector: 'ImportExpression', message: LOADER },
      { selector: 'TSImportEqualsDeclaration', message: LOADER },
      // `typeof import('wxt/browser')` and `import('x').T`.
      { selector: 'TSImportType', message: LOADER },
      // Any use of the name `require`, declared or not (calls, aliases, require.call, …).
      { selector: "Identifier[name='require']", message: LOADER },
      // Ambient declarations: `declare const chrome: any` makes `chrome` a local name, so
      // no-restricted-globals no longer sees it, yet at runtime it is still the global.
      // `declare global` / `declare module` / namespaces could add globals the same way.
      {
        selector: ':matches(VariableDeclaration, ClassDeclaration, TSEnumDeclaration)[declare=true], TSDeclareFunction, TSModuleDeclaration',
        message: 'engine/ must not use ambient declarations; they can hide globals from the boundary rule (DESIGN.md §5.1).',
      },
      // import.meta.glob / .resolve / .env: Vite and Node load or reveal modules through it.
      { selector: 'MetaProperty', message: LOADER },
      // `(() => {}).constructor('return this')()` and friends reach the Function constructor.
      { selector: "MemberExpression[property.name='constructor']", message: ESCAPE },
      { selector: "MemberExpression[property.value='constructor']", message: ESCAPE },
      { selector: "Property[key.name='constructor'][parent.type='ObjectPattern']", message: ESCAPE },
      { selector: "MemberExpression[property.name='__proto__']", message: ESCAPE },
      {
        selector: "MemberExpression[object.name='Object'][property.name=/^(getPrototypeOf|getOwnPropertyDescriptors?|setPrototypeOf)$/]",
        message: ESCAPE,
      },
    ],
    // String-evaluated code can reach anything, including the global object.
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    '@typescript-eslint/triple-slash-reference': ['error', { path: 'never', types: 'never', lib: 'never' }],
  },
};

// Engine tests may also import the test runner.
const engineTestImports = {
  name: 'engine boundary: test imports',
  files: ENGINE_TESTS,
  rules: { 'boundary/engine-imports': ['error', { root: ROOT, allowedPackages: ['vitest'] }] },
};

// engine/ may import llm/types.ts, so that file imports nothing; otherwise it would be a
// transitive way around the engine boundary.
const IMPORT_FREE = 'llm/types.ts is imported by engine/ and must not import anything (DESIGN.md §5.1).';
const llmTypesImportFree = {
  name: 'llm/types import-free',
  files: ['src/llm/types.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: 'ImportDeclaration', message: IMPORT_FREE },
      { selector: 'ImportExpression', message: IMPORT_FREE },
      { selector: 'ExportAllDeclaration', message: IMPORT_FREE },
      { selector: 'ExportNamedDeclaration[source]', message: IMPORT_FREE },
      { selector: 'TSImportType', message: IMPORT_FREE },
      { selector: "Identifier[name='require']", message: IMPORT_FREE },
      { selector: 'MetaProperty', message: IMPORT_FREE },
    ],
    '@typescript-eslint/triple-slash-reference': ['error', { path: 'never', types: 'never', lib: 'never' }],
  },
};

export default tseslint.config(
  { ignores: ['.output/', '.wxt/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['*.config.{js,ts}', 'eslint/**', 'scripts/**', 'tests/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/entrypoints/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.webextensions } },
  },
  engineBoundary,
  engineTestImports,
  {
    // An inline eslint-disable would switch the boundary off, so engine source can't use
    // inline config. Engine tests keep it (they check the globals are absent on purpose).
    name: 'engine boundary: no inline config',
    files: ENGINE_FILES,
    ignores: ENGINE_TESTS,
    linterOptions: { noInlineConfig: true },
  },
  llmTypesImportFree,
);
