import { render } from 'preact';
import { browser } from 'wxt/browser';
import { App } from './App.tsx';
import { PanelController } from './controller.ts';
import { createTranslator } from './translator.ts';
import { injectInto } from '@/shared/inject';
import { autoTranslates } from '@/shared/sites';
import { closePanel, listenForCloseRequests } from './toggle.ts';
import './style.css';

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
if (root) render(<App controller={controller} translator={{ ...translator, send: (tabId, name, body) => controller.send(tabId, name, body) }} />, root);
