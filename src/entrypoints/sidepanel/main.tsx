import { render } from 'preact';
import { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { createDiagnosticsLog } from '@/shared/diagnostics';
import { PanelController } from './controller.ts';
import { createTranslator } from './translator.ts';
import { injectInto } from '@/shared/inject';
import { autoTranslates } from '@/shared/sites';
import { closePanel, listenForCloseRequests } from './toggle.ts';
import './style.css';

// The page's title and language follow the browser's UI language (the static ones in index.html are the English default).
document.title = i18n.t('panel.appName');
document.documentElement.lang = browser.i18n.getUILanguage();

const translator = createTranslator(browser);
const controller = new PanelController(browser, {
  hooks: translator.hooks,
  // A tab this session never read, on an allowlisted site: the open panel reads it by itself (plan
  // M5-E3). Its URL is visible only with a grant, so any other tab stays "Nothing read yet".
  autoInject: async (tabId) => {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || !(await autoTranslates(browser, tab.url))) return false;
    await injectInto(browser, { id: tabId, url: tab.url }, 'navigation');
    return true;
  },
});
listenForCloseRequests(browser, () => void closePanel(browser));
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
