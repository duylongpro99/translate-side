import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Engine boundary (DESIGN.md §5.1, plan M0 §6): engine/ may not import chrome, wxt/*, DOM
// types or llm/ implementations. Imports and globals are checked here; DOM and chrome types
// are also kept out by src/engine/tsconfig.json. Proven by tests/boundary.
export const ENGINE_FILES = ['src/engine/**/*.{ts,tsx}'];

const engineBoundary = {
  name: 'engine boundary',
  files: ENGINE_FILES,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'chrome', message: 'engine/ must not use chrome.* (DESIGN.md §5.1).' },
          { name: 'wxt', message: 'engine/ must not import wxt (DESIGN.md §5.1).' },
          { name: 'webextension-polyfill', message: 'engine/ must not use extension APIs.' },
          // In gitignore-style patterns '#' starts a comment, so this alias goes here.
          { name: '#imports', message: 'engine/ must not use wxt auto-imports (DESIGN.md §5.1).' },
        ],
        patterns: [
          {
            group: ['wxt/*', '@wxt-dev/*', '@types/chrome', '@types/chrome/*'],
            message: 'engine/ must not import wxt or extension APIs (DESIGN.md §5.1).',
          },
          {
            group: ['**/llm/*', '**/llm/**', '!**/llm/types', '!**/llm/types.ts'],
            message: 'engine/ may import only the LLMClient interface (llm/types), not implementations.',
          },
          {
            // Barrels ('../llm', '@/llm') have no segment after llm/, so the group above misses
            // them. It can't list '**/llm' itself: in gitignore syntax, excluding the directory
            // would stop '!**/llm/types' from re-including the interface.
            regex: '(^|/)llm/?$',
            message: 'engine/ may import only the LLMClient interface (llm/types), not the llm/ barrel.',
          },
          {
            group: ['**/entrypoints/**', '**/shared/**', 'preact', 'preact/*'],
            message: 'engine/ must not depend on the extension shell or UI.',
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      ...['chrome', 'browser'].map((name) => ({
        name,
        message: 'engine/ must not use extension APIs (DESIGN.md §5.1).',
      })),
      ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'location', 'HTMLElement', 'Element', 'Node', 'DOMParser', 'MutationObserver', 'IntersectionObserver'].map(
        (name) => ({ name, message: 'engine/ must not touch the DOM (DESIGN.md §5.1).' }),
      ),
    ],
    // no-restricted-imports only sees static imports, so ban the dynamic forms outright.
    'no-restricted-syntax': [
      'error',
      { selector: 'ImportExpression', message: 'engine/ must use static imports so the boundary rule can check them.' },
      { selector: "CallExpression[callee.name='require']", message: 'engine/ must use static imports so the boundary rule can check them.' },
      {
        // `(globalThis as any).chrome`: no-restricted-properties doesn't see through the cast.
        selector:
          'MemberExpression[object.type=/^(TSAsExpression|TSSatisfiesExpression|TSNonNullExpression|TSTypeAssertion)$/][object.expression.name=/^(globalThis|self|global)$/]',
        message: 'engine/ must not reach into the global object (DESIGN.md §5.1).',
      },
    ],
    // Reaching the same globals through the global object (not airtight, but closes the easy path).
    'no-restricted-properties': [
      'error',
      ...['globalThis', 'self', 'global'].flatMap((object) =>
        ['chrome', 'browser', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'location'].map(
          (property) => ({ object, property, message: 'engine/ must not use extension APIs or the DOM (DESIGN.md §5.1).' }),
        ),
      ),
    ],
    '@typescript-eslint/triple-slash-reference': ['error', { path: 'never', types: 'never', lib: 'never' }],
  },
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
      { selector: "CallExpression[callee.name='require']", message: IMPORT_FREE },
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
    files: ['*.config.{js,ts}', 'scripts/**', 'tests/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/entrypoints/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.webextensions } },
  },
  engineBoundary,
  llmTypesImportFree,
);
