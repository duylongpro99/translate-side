// Regenerates the Chrome Web Store screenshots and the promo tile in docs/store/assets/ (docs/store/submission.md).
// It runs e2e/store-screenshots.spec.ts, which reuses the e2e harness (the built extension, the mock provider,
// a fixture article), so no real key or account is involved. Build first: `pnpm run build`.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e/playwright.config.ts', 'e2e/store-screenshots.spec.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, STORE_SCREENSHOTS: '1' },
});
process.exit(result.status ?? 1);
