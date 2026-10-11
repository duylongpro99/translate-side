import { defineConfig } from '@playwright/test';

// The extension e2e suite (`pnpm run build && pnpm run e2e`). One worker: the fixture server and the
// mock provider listen on fixed ports (e2e/servers.ts), and every test launches its own Chromium.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: '../test-results/e2e',
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

/**
 * Chromium flags for every launch (e2e/fixtures.ts). The panel runs as a background tab next to the
 * page (Playwright cannot open the docked side panel); without these Chrome throttles its timers and
 * the job stalls. The real side panel is not a background tab, so they change nothing it relies on.
 */
export const CHROMIUM_ARGS = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
