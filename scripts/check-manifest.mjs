// Checks the BUILT manifest (not wxt.config.ts): WXT can add keys at build time, e.g.
// content_scripts from a new entrypoint. DESIGN.md §8, plan M0-E2/E3 (decision S5). Run after `wxt build`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const path = process.argv[2] ?? '.output/chrome-mv3/manifest.json';
const m = JSON.parse(readFileSync(path, 'utf8'));
const problems = [];
const expectEqual = (key, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

expectEqual('manifest_version', m.manifest_version, 3);
expectEqual('permissions', m.permissions, ['sidePanel', 'storage', 'activeTab', 'scripting', 'contextMenus']);
expectEqual('optional_host_permissions', m.optional_host_permissions, ['https://*/*', 'http://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
expectEqual('host_permissions', m.host_permissions, undefined);
expectEqual('content_scripts', m.content_scripts, undefined);
expectEqual('minimum_chrome_version', m.minimum_chrome_version, '138');
expectEqual('commands._execute_action.suggested_key', m.commands?._execute_action?.suggested_key, { default: 'Alt+T' });
expectEqual('side_panel.default_path', m.side_panel?.default_path, 'sidepanel.html');
expectEqual('background.service_worker', m.background?.service_worker, 'background.js');
// Localization: the default locale is English, and every __MSG_*__ the manifest uses resolves in both locales.
expectEqual('default_locale', m.default_locale, 'en');
const messageKeys = [];
const collect = (value) => {
  if (typeof value === 'string') for (const [, key] of value.matchAll(/__MSG_(\w+)__/g)) messageKeys.push(key);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
};
collect(m);
if (messageKeys.length === 0) problems.push('manifest: no __MSG_*__ keys (the name and description are localized)');
for (const locale of ['en', 'vi']) {
  const file = join(dirname(path), '_locales', locale, 'messages.json');
  if (!existsSync(file)) {
    problems.push(`_locales/${locale}/messages.json: missing from the build`);
    continue;
  }
  const messages = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of messageKeys) {
    if (typeof messages[key]?.message !== 'string' || messages[key].message === '') problems.push(`_locales/${locale}: __MSG_${key}__ does not resolve`);
  }
}
// The worker injects this file by path (src/shared/inject.ts CONTENT_SCRIPT_FILE).
if (!existsSync(join(dirname(path), 'content-scripts/content.js'))) problems.push('content-scripts/content.js: missing from the build');
// The segment view is dev-only (plan M0-E7): import.meta.env.DEV must drop it from this build.
const chunks = join(dirname(path), 'chunks');
if (existsSync(chunks) && readdirSync(chunks).some((f) => readFileSync(join(chunks, f), 'utf8').includes('dev-view'))) {
  problems.push('chunks/: the dev-only segment view is in the production build');
}

if (problems.length > 0) {
  console.error(`${path} does not match DESIGN.md §8 / M0-E2:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`${path}: OK (built manifest matches DESIGN.md §8 / M0-E2)`);
