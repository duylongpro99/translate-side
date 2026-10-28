import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

// See DESIGN.md §8 (minimal permissions) and ROADMAP §8 items 18–20.
export default defineConfig({
  srcDir: 'src',
  // A preview build (Best on, WXT_BEST_PREVIEW=1; src/shared/quality.ts) goes to its own directory, so it never replaces the release build.
  outDir: process.env.WXT_BEST_PREVIEW === '1' ? '.output-preview' : '.output',
  modules: ['@wxt-dev/i18n/module'],
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: {
    // Text the browser shows comes from src/locales (en is the default; vi follows Chrome's language).
    default_locale: 'en',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    // 138: built-in AI baseline. Newer features are gated by availability checks, not version.
    minimum_chrome_version: '138',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'contextMenus', 'tts'],
    // Requested at runtime, per origin: provider endpoints, and sites the user allowlists.
    // http://*/* covers LAN gateways and plain-HTTP sites (decision S5, ROADMAP §8 item 19).
    optional_host_permissions: ['https://*/*', 'http://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: {
      default_title: '__MSG_actionTitle__',
    },
    // The selection popup (src/entrypoints/selection-popup): the selection button frames it next to the
    // selected text, so http and https pages may load it. Nothing else of the extension is web accessible.
    web_accessible_resources: [{ resources: ['selection-popup.html'], matches: ['http://*/*', 'https://*/*'] }],
    commands: {
      // Fires action.onClicked: it opens the side panel and injects (decision S5), or closes the panel
      // when it is open in that window (M5-E10, replacing D11's open-only; src/shared/panel.ts).
      // Rebindable at chrome://extensions/shortcuts (ROADMAP §8 item 20).
      _execute_action: {
        suggested_key: { default: 'Alt+T' },
        description: '__MSG_commandToggle__',
      },
    },
  },
});
