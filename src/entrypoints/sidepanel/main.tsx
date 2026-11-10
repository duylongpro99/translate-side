import { render } from 'preact';
import { browser } from 'wxt/browser';
import { applyThemeSync, followTheme } from '@/ui/theme';
import { i18n } from '#i18n';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { createDiagnosticsLog } from '@/shared/diagnostics';
import { PanelController } from './controller.ts';
import { createTranslator } from './translator.ts';
import { injectInto } from '@/shared/inject';
import { autoTranslates } from '@/shared/sites';
import { boundTabId } from '@/shared/tab-panel';
import { closePanel, listenForCloseRequests } from './toggle.ts';
import './style.css';

// The theme first, from the synchronous mirror, so the first paint is already in it; storage.sync then reconciles.
applyThemeSync();
followTheme(browser);

// The page's title and language follow the browser's UI language (the static ones in index.html are the English default).
document.title = i18n.t('panel.appName');
document.documentElement.lang = browser.i18n.getUILanguage();

// The tab this panel is bound to (decision S12): the worker opens each tab's panel at sidepanel.html?tab=<id>.
const bound = boundTabId(location.search);
const translator = createTranslator(browser);
const controller = new PanelController(browser, {
  tabId: bound,
  hooks: translator.hooks,
  // The panel's tab, never read in this session, on an allowlisted site: the panel reads it by itself
  // (plan M5-E3), also after a navigation there. Its URL is visible only with a grant.
  autoInject: async (tabId) => {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || !(await autoTranslates(browser, tab.url))) return false;
    await injectInto(browser, { id: tabId, url: tab.url }, 'navigation');
    return true;
  },
});
listenForCloseRequests(browser, () => void closePanel(browser, bound), bound);
translator.watch(() => controller.tabId);
controller.start().catch((err: unknown) => {
  console.error('[translate-side] panel start failed', err);
});

const root = document.getElementById('app');
if (root) {
  render(
    <ErrorBoundary name="App" log={createDiagnosticsLog(browser)} version={browser.runtime.getManifest().version}>
      <App controller={controller} translator={{ ...translator, send: (tabId, name, body) => controller.send(tabId, name, body) }} />
    </ErrorBoundary>,
    root,
  );
}
