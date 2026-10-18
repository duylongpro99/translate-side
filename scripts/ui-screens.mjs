// Takes the before or after screenshots of the UI refresh (e2e/ui-screens.spec.ts) into
// plans/261018-0900-m8-ui-ux-refresh/screens/<before|after>/. It refuses to overwrite a folder that
// already exists: delete it on purpose first. It uses the e2e harness's extension in .output-preview/,
// which `pnpm run e2e` makes.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mode = process.argv.slice(2).find((a) => a !== '--');
if (mode !== 'before' && mode !== 'after') {
  console.error('usage: pnpm run ui:screens -- before|after');
  process.exit(2);
}
const out = process.env.UI_SCREENS_DIR ?? path.join(root, 'plans/261018-0900-m8-ui-ux-refresh/screens', mode);
if (existsSync(out)) {
  console.error(`ui-screens: ${path.relative(root, out)} already exists; delete it first to take the ${mode} screenshots again`);
  process.exit(1);
}
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e/playwright.config.ts', 'e2e/ui-screens.spec.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, UI_SCREENS: mode, UI_SCREENS_DIR: out },
});
process.exit(result.status ?? 1);
