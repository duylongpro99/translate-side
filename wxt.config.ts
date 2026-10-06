import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

// See DESIGN.md §8 (minimal permissions) and ROADMAP §8 items 18–20.
export default defineConfig({
  srcDir: 'src',
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: {
    name: 'Translate Side',
    description: 'Translate the current page in the side panel.',
    // 138: built-in AI baseline. Newer features are gated by availability checks, not version.
    minimum_chrome_version: '138',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'contextMenus'],
    // Requested at runtime, per origin: provider endpoints, and sites the user allowlists.
    // http://*/* covers LAN gateways and plain-HTTP sites (decision S5, ROADMAP §8 item 19).
    optional_host_permissions: ['https://*/*', 'http://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: {
      default_title: 'Open Translate Side',
    },
    commands: {
      // Fires action.onClicked, which opens the side panel and injects (decision S5). Open-only:
      // the panel closes with its own X (D11).
      // Rebindable at chrome://extensions/shortcuts (ROADMAP §8 item 20).
      _execute_action: {
        suggested_key: { default: 'Alt+T' },
        description: 'Open the Translate Side panel',
      },
    },
  },
});
