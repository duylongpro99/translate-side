import { render } from 'preact';
import { browser } from 'wxt/browser';
import { applyThemeSync, followTheme } from '@/ui/theme';
import { i18n } from '#i18n';
import { createDiagnosticsLog } from '@/shared/diagnostics';
import { POPUP_MESSAGE } from '@/shared/protocol';
import { clearPopupRecord, isPopupId } from '@/shared/snippet';
import { ErrorBoundary } from '../sidepanel/ErrorBoundary.tsx';
import { createTranslator } from '../sidepanel/translator.ts';
import { Popup } from './Popup.tsx';
import './style.css';

// The selection popup's page (src/extract/selection-button.ts frames it at `#<id>`). It talks to the
// content script that framed it only to say how tall it is and when to close, and only over the
// MessageChannel port that script hands it: the port comes with the popup's id, which the page
// around the popup never sees, so a page script can't hand it a port of its own.

applyThemeSync();
followTheme(browser);
document.title = i18n.t('popup.title');
document.documentElement.lang = browser.i18n.getUILanguage();

const id = location.hash.slice(1);
type Out = { height?: number; close?: true };
let port: MessagePort | undefined;
/** What was said before the port came: the latest height, and whether to close. */
let held: Out = {};
const post = (message: Out) => {
  if (port) port.postMessage({ type: POPUP_MESSAGE, ...message });
  else held = { ...held, ...message };
};
const close = () => post({ close: true });
addEventListener('message', (e) => {
  const data = e.data as { type?: unknown; id?: unknown } | null;
  if (port || e.source !== parent || data?.type !== POPUP_MESSAGE || data.id !== id || !isPopupId(id)) return;
  port = e.ports[0];
  if (!port) return;
  if (held.height !== undefined || held.close) post(held);
  held = {};
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
});
// The text is not kept past the popup: closing it ends this page.
addEventListener('pagehide', () => {
  if (isPopupId(id)) clearPopupRecord(browser, id).catch(() => {});
});

const root = document.getElementById('app');
if (root) {
  // The frame's border is outside the content: 2px more than the content's own height.
  const report = () => post({ height: root.getBoundingClientRect().height + 2 });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(report).observe(root);
  const translator = createTranslator(browser);
  render(
    <ErrorBoundary name="SelectionPopup" log={createDiagnosticsLog(browser)} version={browser.runtime.getManifest().version}>
      <Popup api={browser} translator={translator} id={isPopupId(id) ? id : ''} onClose={close} />
    </ErrorBoundary>,
    root,
  );
}
