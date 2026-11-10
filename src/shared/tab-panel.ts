// The side panel is per tab (decision S12): the global panel is off, and each open enables the panel for the
// tab that asked, at a path that names that tab. Chrome then shows it on that tab only, keeps it open there,
// and keeps it running while another tab is on screen.
import type { browser } from 'wxt/browser';

type Browser = typeof browser;

/** The panel page, as `side_panel.default_path` names it. */
export const PANEL_PATH = 'sidepanel.html';

/** The query parameter that binds a panel to its tab. */
const TAB_PARAM = 'tab';

/**
 * Opens the panel on `tabId` only. `sidePanel.open` needs the user gesture, so both calls go out in the same
 * tick with no await before `open`: awaiting `setOptions` first loses the gesture (S12). Chrome applies the
 * options before it opens. Rejects when the panel did not open; a failed `setOptions` is only logged.
 */
export function openTabPanel(api: Browser, tabId: number): Promise<void> {
  api.sidePanel.setOptions({ tabId, path: `${PANEL_PATH}?${TAB_PARAM}=${tabId}`, enabled: true }).catch((err: unknown) => {
    console.error('[translate-side] sidePanel.setOptions failed', err);
  });
  return api.sidePanel.open({ tabId });
}

/** The tab a panel page serves, from its `?tab=` query; undefined when absent or not a tab id. */
export function boundTabId(search: string): number | undefined {
  const raw = new URLSearchParams(search).get(TAB_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
