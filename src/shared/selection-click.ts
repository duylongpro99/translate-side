// What the selection button says and does, for both scripts that draw it: the full content script
// while the panel is connected, and the opt-in selection script on every site. Its click opens the
// popup (src/entrypoints/selection-popup) and sends the text to the worker, which checks the page and
// keeps the text for the popup (src/shared/panel.ts listenForSelectionButton).
import { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import type { SelectionButtonOptions } from '@/extract/selection-button';
import { SELECTION_BUTTON_MESSAGE, SELECTION_POPUP_PATH, type SelectionButtonRequest } from './protocol.ts';
import icon from '../../public/icon/32.png?inline';

export function selectionButtonOptions(): SelectionButtonOptions {
  const popupUrl = popupPage();
  return {
    label: i18n.t('panel.selectionButton.label'),
    tip: i18n.t('panel.selectionButton.tip'),
    icon,
    ...(popupUrl === undefined ? {} : { popupUrl }),
    popupLabel: i18n.t('popup.title'),
    onClick(text, lang, popup) {
      // A copy left by an updated extension throws here at once (its runtime is gone), before any promise.
      try {
        browser.runtime.sendMessage({ type: SELECTION_BUTTON_MESSAGE, text, ...(lang ? { lang } : {}), ...(popup ? { popup } : {}) } satisfies SelectionButtonRequest).catch(() => undefined);
      } catch {
        // Nothing to do: the click goes nowhere, and the page's next load has the new script.
      }
    },
  };
}

/**
 * The popup's page, which only http and https pages may frame (the manifest's web accessible
 * resources); undefined elsewhere (a local file), where the click opens the side panel as the
 * context menu does, and in a copy whose runtime is gone (its clicks go nowhere anyway).
 */
function popupPage(): string | undefined {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return undefined;
  try {
    return browser.runtime.getURL(SELECTION_POPUP_PATH);
  } catch {
    return undefined;
  }
}

/** False in a copy left over from a reloaded or updated extension: its runtime is gone. */
export function isRuntimeAlive(): boolean {
  try {
    return Boolean(browser.runtime.id);
  } catch {
    return false;
  }
}
