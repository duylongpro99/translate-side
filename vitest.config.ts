import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

const ENGINE_TESTS = 'src/engine/**/*.test.ts';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    // `pnpm run test:coverage` (part of `pnpm check`). Thresholds cover engine/ and llm/ only, where the
    // logic is; the UI is covered by the e2e suite (e2e/).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/testing.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      // The measured values rounded down to the nearest 5 (statements, branches, functions, lines).
      thresholds: {
        'src/engine/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'src/llm/**': { statements: 90, branches: 85, functions: 85, lines: 90 },
      },
    },
    projects: [
      {
        // engine/ runs in plain Node with no WXT plugin, no fake browser and no auto-imports
        // (DESIGN.md §5.1: the engine runs unchanged in a Node eval harness).
        test: { name: 'engine', include: [ENGINE_TESTS], environment: 'node' },
      },
      {
        plugins: [WxtVitest()],
        test: {
          name: 'shell',
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'scripts/eval/**/*.test.ts'],
          exclude: [ENGINE_TESTS],
          environment: 'node',
        },
      },
    ],
  },
});
