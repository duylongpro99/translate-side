import { browser } from 'wxt/browser';
import { createContextMenu, listenForContextMenuClicks, setupPanelBehavior } from '@/shared/panel';

export default defineBackground(() => {
  // Listeners are registered synchronously at top level: MV3 workers restart often, and
  // onInstalled does not fire again on restart.
  listenForContextMenuClicks(browser);
  browser.runtime.onInstalled.addListener(() => {
    createContextMenu(browser).catch((err: unknown) => {
      console.error('[translate-side] context menu setup failed', err);
    });
  });

  // Toolbar icon and Alt+T (_execute_action) both open the side panel.
  setupPanelBehavior(browser).catch((err: unknown) => {
    console.error('[translate-side] setPanelBehavior failed', err);
  });
});
