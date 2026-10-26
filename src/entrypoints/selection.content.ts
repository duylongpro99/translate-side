// The selection button on every site (opt-in; src/shared/selection-button.ts, decision S9). The
// worker registers this script only while the option is on and the permission is held. It draws the
// selection button and nothing else: it reads no page content, and the selection only goes anywhere
// when the reader clicks the button. Kept small, since it runs on every page: no Preact, no extractor.
import { browser } from 'wxt/browser';
import { acquireSelectionButton } from '@/extract/selection-button';
import { classifyUrl } from '@/shared/denylist';
import { isRuntimeAlive, selectionButtonOptions } from '@/shared/selection-click';

/** The option's storage.local item (src/shared/selection-button.ts SELECTION_EVERYWHERE_KEY), not imported to keep this small. */
const OPTION_KEY = 'selectionEverywhere';

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  main() {
    // The registration leaves these out already; a host its patterns miss stays clean too.
    if (!classifyUrl(location.href).ok) return;
    const leave = acquireSelectionButton(window, selectionButtonOptions(), isRuntimeAlive);
    // Turned off: pages already open lose the button at once, not at their next load.
    browser.storage.local.onChanged.addListener((changes) => {
      if (OPTION_KEY in changes && changes[OPTION_KEY]?.newValue !== true) leave();
    });
  },
});
