import { browser } from 'wxt/browser';
import {
  createContextMenu,
  listenForActionClicks,
  listenForContextMenuClicks,
  listenForTabLifecycle,
  setupPanelBehavior,
} from '@/shared/panel';
import { openOnboarding } from '@/shared/onboarding';
import { migrateProviders } from '@/shared/providers';

// The worker is a coordinator only (decision S1): action, context menu, injection and tab
// lifecycle. It holds no translation state; segments go content ⇄ panel directly.
export default defineBackground(() => {
  // Listeners are registered synchronously at top level: MV3 workers restart often, and
  // onInstalled does not fire again on restart.
  listenForActionClicks(browser);
  listenForContextMenuClicks(browser);
  listenForTabLifecycle(browser);
  browser.runtime.onInstalled.addListener((details) => {
    // First install: the 3-step guide opens once (plan M4-E13). An update or a reload does not.
    if (details.reason === 'install') {
      openOnboarding(browser).catch((err: unknown) => {
        console.error('[translate-side] onboarding could not open', err);
      });
    }
    createContextMenu(browser).catch((err: unknown) => {
      console.error('[translate-side] context menu setup failed', err);
    });
    // M1–M3 settings → the connections/profiles/routing schema (plan M4-E2). Readers migrate too,
    // so this only makes it happen before the first panel or options page opens.
    migrateProviders(browser).catch((err: unknown) => {
      console.error('[translate-side] settings migration failed', err);
    });
  });

  // Toolbar icon and Alt+T (_execute_action) fire action.onClicked, which opens the panel.
  setupPanelBehavior(browser).catch((err: unknown) => {
    console.error('[translate-side] setPanelBehavior failed', err);
  });
});
