import { render } from 'preact';
import { browser } from 'wxt/browser';
import { App } from './App.tsx';
import { PanelController } from './controller.ts';
import { createTranslator } from './translator.ts';
import './style.css';

const translator = createTranslator(browser);
const controller = new PanelController(browser, { hooks: translator.hooks });
translator.watch(() => controller.tabId);
controller.start().catch((err: unknown) => {
  console.error('[translate-side] panel start failed', err);
});

const root = document.getElementById('app');
if (root) render(<App controller={controller} translator={translator} />, root);
