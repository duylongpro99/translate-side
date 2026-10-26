// What the selection button says and does, for both scripts that draw it: the full content script
// while the panel is connected, and the opt-in selection script on every site. Its click goes to the
// worker, which opens the panel and hands the text over (src/shared/panel.ts listenForSelectionButton).
import { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import type { SelectionButtonOptions } from '@/extract/selection-button';
import { SELECTION_BUTTON_MESSAGE, type SelectionButtonRequest } from './protocol.ts';
import icon from '../../public/icon/32.png?inline';

export function selectionButtonOptions(): SelectionButtonOptions {
  return {
    label: i18n.t('panel.selectionButton.label'),
    tip: i18n.t('panel.selectionButton.tip'),
    icon,
    onClick(text) {
      // A copy left by an updated extension throws here at once (its runtime is gone), before any promise.
      try {
        browser.runtime.sendMessage({ type: SELECTION_BUTTON_MESSAGE, text } satisfies SelectionButtonRequest).catch(() => undefined);
      } catch {
        // Nothing to do: the click goes nowhere, and the page's next load has the new script.
      }
    },
  };
}

/** False in a copy left over from a reloaded or updated extension: its runtime is gone. */
export function isRuntimeAlive(): boolean {
  try {
    return Boolean(browser.runtime.id);
  } catch {
    return false;
  }
}
