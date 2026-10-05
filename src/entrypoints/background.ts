import { browser } from 'wxt/browser';
import { setupPanelBehavior, setupContextMenu } from '@/shared/panel';

export default defineBackground(() => {
  // Toolbar icon and Alt+T (_execute_action) both open the side panel.
  void setupPanelBehavior(browser);

  browser.runtime.onInstalled.addListener(() => {
    setupContextMenu(browser);
  });
});
