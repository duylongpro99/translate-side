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
);
