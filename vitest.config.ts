import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

const ENGINE_TESTS = 'src/engine/**/*.test.ts';

export default defineConfig({
  test: {
    testTimeout: 30_000,
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
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          exclude: [ENGINE_TESTS],
          environment: 'node',
        },
      },
    ],
  },
});
