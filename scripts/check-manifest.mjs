// Checks the BUILT manifest (not wxt.config.ts): WXT can add keys at build time, e.g.
// content_scripts from a new entrypoint. DESIGN.md §8, plan M0-E2. Run after `wxt build`.
import { readFileSync } from 'node:fs';

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
expectEqual('optional_host_permissions', m.optional_host_permissions, ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
expectEqual('host_permissions', m.host_permissions, undefined);
expectEqual('content_scripts', m.content_scripts, undefined);
expectEqual('minimum_chrome_version', m.minimum_chrome_version, '138');
expectEqual('commands._execute_action.suggested_key', m.commands?._execute_action?.suggested_key, { default: 'Alt+T' });
expectEqual('side_panel.default_path', m.side_panel?.default_path, 'sidepanel.html');
expectEqual('background.service_worker', m.background?.service_worker, 'background.js');

if (problems.length > 0) {
  console.error(`${path} does not match DESIGN.md §8 / M0-E2:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`${path}: OK (built manifest matches DESIGN.md §8 / M0-E2)`);
