import { render } from 'preact';
import { browser } from 'wxt/browser';
import { App } from './App.tsx';
import { PanelController } from './controller.ts';
import './style.css';

const controller = new PanelController(browser);
controller.start().catch((err: unknown) => {
  console.error('[translate-side] panel start failed', err);
});

const root = document.getElementById('app');
if (root) render(<App controller={controller} />, root);
